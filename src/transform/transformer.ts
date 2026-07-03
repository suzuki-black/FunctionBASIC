// 変換器（構造化BASIC AST → MSX-BASIC）。docs/05
// 初期実装: スコープ解決・再帰検出・2文字名割当・FUNCTION→GOSUB・REF名前置換・1行IF畳み込み・行番号割当。
// 未対応構文は診断（E_NOT_IMPLEMENTED）で明示する（黙って誤変換しない）。
import type {
  Program,
  FunctionDef,
  Stmt,
  Expr,
  LValue,
  TypeSuffix,
} from "../ast/nodes.ts";
import { suffixOf } from "../ast/nodes.ts";
import type { Diagnostic, DiagParams } from "../core/diagnostics.ts";
import type { Position } from "../core/position.ts";
import { error } from "../core/diagnostics.ts";
import { hasError } from "../core/diagnostics.ts";
import {
  isBuiltinFunction,
  isBuiltinStatement,
  isBuiltin,
  BUILTIN_CLAUSE_WORDS,
} from "../core/builtins.ts";
import { NamePool } from "./names.ts";
import { assembleZ80 } from "../asm/z80asm.ts";
import { typeCheck } from "./typecheck.ts";
import { inlineConsts } from "./const-inline.ts";
import { checkNameCollisions } from "./check-names.ts";
import { foldProgram } from "./fold-expr.ts";
import { reduceStrengthProgram } from "./strength-reduce.ts";
import { stripComments } from "./strip-comments.ts";
import { KEYWORDS } from "../lexer/keywords.ts";
import { BUILTIN_STATEMENTS, BUILTIN_FUNCTIONS } from "../core/builtins.ts";
import type { MapTable } from "../core/maptable.ts";
import { findNonSjis } from "../core/sjis.ts";

export interface MsxLine {
  lineNo: number;
  text: string;
}
export interface TransformResult {
  code: MsxLine[];
  diagnostics: Diagnostic[];
  varNameMap: Array<{ original: string; scope: string; msxName: string }>;
  map: MapTable;
}

const ORIGIN = { line: 0, column: 0 };

// トークン化後のおおよそのバイト長（キーワード/組み込みは1バイト）。docs/05 §5.12.1
const ONE_BYTE = new Set<string>([
  ...KEYWORDS,
  ...BUILTIN_STATEMENTS,
  ...BUILTIN_FUNCTIONS,
  ...BUILTIN_CLAUSE_WORDS,
  "GOTO",
  "GOSUB",
  "THEN",
]);
// UTF-8 バイト長（Node/ブラウザ両対応）
const utf8len = (s: string): number => new TextEncoder().encode(s).length;
export function estimateMsxBytes(text: string): number {
  const parts = text.match(/"[^"]*"|[A-Za-z][A-Za-z0-9_]*[%!#$]?|[^"A-Za-z]+/g) ?? [];
  let total = 0;
  for (const p of parts) {
    if (p.startsWith('"')) total += utf8len(p);
    else if (/^[A-Za-z]/.test(p) && ONE_BYTE.has(p.toUpperCase())) total += 1;
    else total += utf8len(p);
  }
  return total;
}

// 文字列を尊重して区切り文字でトップレベル分割
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    if (ch === sep && !inStr) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// 長いPRINTを ; で分割（末尾 ; で改行抑制を維持）。docs/05 §5.12.2
function splitPrint(seg: string): string[] {
  const m = seg.match(/^PRINT\s+([\s\S]*)$/i);
  if (!m) return [seg];
  const endsSemi = m[1].trimEnd().endsWith(";");
  const parts = splitTop(m[1], ";").map((s) => s.trim()).filter((s) => s !== "");
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const p of parts) {
    if (cur.length && estimateMsxBytes("PRINT " + [...cur, p].join(";") + ";") > 255) {
      chunks.push(cur);
      cur = [p];
    } else cur.push(p);
  }
  if (cur.length) chunks.push(cur);
  return chunks.map(
    (c, i) => "PRINT " + c.join(";") + (i < chunks.length - 1 ? ";" : endsSemi ? ";" : ""),
  );
}

// 1行を255バイト以内へ自動分割。docs/05 §5.12.2
// - 条件文(IF…THEN…)は安全に分割できないのでそのまま（必要なら E_LINE_TOO_LONG）
// - それ以外は ":" 区切りを255以内で再パック、長いPRINTは ";" 分割
export function splitLongLine(text: string): string[] {
  if (estimateMsxBytes(text) <= 255) return [text];
  if (/^\s*IF\b/i.test(text)) return [text];
  const segs = splitTop(text, ":").map((s) => s.trim());
  const expanded = segs.flatMap((s) => (estimateMsxBytes(s) > 255 ? splitPrint(s) : [s]));
  const lines: string[] = [];
  let cur = "";
  for (const s of expanded) {
    const cand = cur ? cur + ": " + s : s;
    if (cur && estimateMsxBytes(cand) > 255) {
      lines.push(cur);
      cur = s;
    } else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---- 変数収集 ----
// 式中の変数名を集める（ユーザ関数呼び出し・組み込み関数は変数ではない）
function collectExprVars(
  e: Expr,
  funcNames: Set<string>,
  vars: Set<string>,
  arrays: Set<string>,
): void {
  switch (e.type) {
    case "Num":
    case "Str":
      return;
    case "Var":
      // 組み込み"文"サブキーワード(PUT SPRITE の SPRITE 等)も、括弧なしで使う組み込み
      // "関数"(INKEY$/CSRLIN/ERR/ERL/TIME 等)も MSX 予約語＝変数ではないので改名しない。
      if (!isBuiltin(e.name)) vars.add(e.name);
      return;
    case "ArrayRef":
      // SPRITE$(n) 等の組み込み配列風は改名しない
      if (!isBuiltin(e.name)) {
        vars.add(e.name);
        arrays.add(e.name);
      }
      e.indices.forEach((x) => collectExprVars(x, funcNames, vars, arrays));
      return;
    case "Un":
      collectExprVars(e.operand, funcNames, vars, arrays);
      return;
    case "Bin":
      collectExprVars(e.left, funcNames, vars, arrays);
      collectExprVars(e.right, funcNames, vars, arrays);
      return;
    case "Group":
      e.items.forEach((x) => collectExprVars(x, funcNames, vars, arrays));
      return;
    case "CallExpr": {
      // 組み込み"関数"だけでなく、括弧を取る組み込み"文"名（SPRITE(n)/KANJI(n) 等）も
      // 変数ではない＝改名しない。
      const isCall = funcNames.has(e.name) || isBuiltin(e.name);
      if (!isCall) {
        vars.add(e.name);
        arrays.add(e.name);
      }
      e.args.forEach((a) => collectExprVars(a.expr, funcNames, vars, arrays));
      return;
    }
  }
}

function collectStmtVars(
  s: Stmt,
  funcNames: Set<string>,
  vars: Set<string>,
  arrays: Set<string>,
): void {
  const E = (e: Expr) => collectExprVars(e, funcNames, vars, arrays);
  switch (s.type) {
    case "Let":
      if (s.target.type === "Var") {
        if (!isBuiltin(s.target.name)) vars.add(s.target.name);
      } else {
        if (!isBuiltin(s.target.name)) {
          vars.add(s.target.name);
          arrays.add(s.target.name);
        }
        s.target.indices.forEach(E);
      }
      E(s.expr);
      return;
    case "Dim":
      s.decls.forEach((d) => {
        vars.add(d.name);
        arrays.add(d.name);
        d.dims.forEach(E);
      });
      return;
    case "Return":
      if (s.expr) E(s.expr);
      return;
    case "Builtin":
      s.parts.forEach((p) => {
        if (p.kind === "expr") E(p.expr);
      });
      return;
    case "Call":
      s.call.args.forEach((a) => E(a.expr));
      return;
    case "If":
      E(s.cond);
      s.then.forEach((x) => collectStmtVars(x, funcNames, vars, arrays));
      s.else?.forEach((x) => collectStmtVars(x, funcNames, vars, arrays));
      return;
    case "For":
      vars.add(s.varName);
      E(s.from);
      E(s.to);
      if (s.step) E(s.step);
      s.body.forEach((x) => collectStmtVars(x, funcNames, vars, arrays));
      return;
    case "While":
      E(s.cond);
      s.body.forEach((x) => collectStmtVars(x, funcNames, vars, arrays));
      return;
    case "On":
      if (s.arg) E(s.arg);
      return;
    case "Global":
    case "Break":
    case "Continue":
    case "Comment":
    case "Include":
      return;
  }
}

function globalNamesOf(fn: FunctionDef): Set<string> {
  const g = new Set<string>();
  const walk = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.type === "Global") s.names.forEach((n) => g.add(n));
      else if (s.type === "If") {
        walk(s.then);
        if (s.else) walk(s.else);
      } else if (s.type === "For" || s.type === "While") walk(s.body);
    }
  };
  walk(fn.body);
  return g;
}

export interface TransformOptions {
  lineMap?: Array<{ file: string; line: number }>; // 統合ソース行 → 由来（INCLUDE provenance）
  sources?: string[]; // 取り込んだ全ファイル（先頭=エントリ）
  source?: string; // エントリファイル名
  optimize?: boolean; // 定数畳み込み最適化（オプトイン・既定OFF）
  strengthReduce?: boolean; // べき乗の強度低減 X^2→X*X（オプトイン・既定OFF）
  stripComments?: boolean; // コメント除去（オプトイン・既定OFF。飛び先は安全に保持）
  hotPlacement?: boolean; // 呼出頻度順に関数を低い行番号へ（GOSUB 行番号サーチ短縮・オプトイン）
  recursionDepth?: number; // 再帰スタックの最大深さ（DIMサイズ・既定100）
}

// 各ユーザ関数の静的な呼び出しサイト数を数える（MAIN＋全関数本体を走査）。
// 呼び出しの多い関数ほど低い行番号へ置くと、MSX-BASIC の GOSUB 行番号探索が短くなる。
function countCallSites(program: Program): Map<string, number> {
  const cnt = new Map<string, number>();
  const bump = (n: string) => cnt.set(n, (cnt.get(n) ?? 0) + 1);
  const we = (e: Expr | undefined): void => {
    if (!e) return;
    switch (e.type) {
      case "CallExpr": bump(e.name); e.args.forEach((a) => we(a.expr)); break;
      case "Bin": we(e.left); we(e.right); break;
      case "Un": we(e.operand); break;
      case "Group": e.items.forEach(we); break;
      case "ArrayRef": e.indices.forEach(we); break;
    }
  };
  const ws = (ss: Stmt[]): void => {
    for (const s of ss) {
      switch (s.type) {
        case "Call": bump(s.call.name); s.call.args.forEach((a) => we(a.expr)); break;
        case "Let": we(s.expr); if (s.target.type === "ArrayRef") s.target.indices.forEach(we); break;
        case "Return": we(s.expr); break;
        case "If": we(s.cond); ws(s.then); if (s.else) ws(s.else); break;
        case "For": we(s.from); we(s.to); we(s.step); ws(s.body); break;
        case "While": we(s.cond); ws(s.body); break;
        case "Builtin": for (const p of s.parts) if (p.kind === "expr") we(p.expr); break;
        case "On": we(s.arg); break;
      }
    }
  };
  ws(program.toplevel);
  for (const f of program.functions) ws(f.body);
  return cnt;
}

// プログラム中の全ユーザ変数名（大文字・サフィックス込み）を集める。
// インライン ASM の "(NAME)" が BASIC 変数か直値アドレスかの判定に使う。
function collectVarNames(program: Program): Set<string> {
  const names = new Set<string>();
  const we = (e: Expr | undefined): void => {
    if (!e) return;
    switch (e.type) {
      case "Var": names.add(e.name); break;
      case "ArrayRef": names.add(e.name); e.indices.forEach(we); break;
      case "Bin": we(e.left); we(e.right); break;
      case "Un": we(e.operand); break;
      case "Group": e.items.forEach(we); break;
      case "CallExpr": e.args.forEach((a) => we(a.expr)); break;
    }
  };
  const ws = (ss: Stmt[]): void => {
    for (const s of ss) {
      switch (s.type) {
        case "Let": if (s.target.type === "Var") names.add(s.target.name); else { names.add(s.target.name); s.target.indices.forEach(we); } we(s.expr); break;
        case "Dim": for (const d of s.decls) { names.add(d.name); d.dims.forEach(we); } break;
        case "Global": for (const n of s.names) names.add(n); break;
        case "For": names.add(s.varName); we(s.from); we(s.to); we(s.step); ws(s.body); break;
        case "While": we(s.cond); ws(s.body); break;
        case "If": we(s.cond); ws(s.then); if (s.else) ws(s.else); break;
        case "Call": s.call.args.forEach((a) => we(a.expr)); break;
        case "Return": we(s.expr); break;
        case "Builtin": for (const p of s.parts) if (p.kind === "expr") we(p.expr); break;
        case "On": we(s.arg); break;
      }
    }
  };
  for (const f of program.functions) { for (const p of f.params) names.add(p.name); ws(f.body); }
  ws(program.toplevel);
  return names;
}

export function transform(program: Program, opts: TransformOptions = {}): TransformResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (key: string, params: DiagParams = {}, pos: Position = ORIGIN) =>
    diagnostics.push(error(key, pos, params));

  // 変数名と組み込み（命令/関数）名の衝突検出（黙って誤変換しない）。
  diagnostics.push(...checkNameCollisions(program));

  // CONST のインライン展開（名前解決より前。定数参照はリテラル化し CONST 文は消える）。
  diagnostics.push(...inlineConsts(program));

  // 定数畳み込み最適化（オプトイン）。CONST 展開後に走らせ、生じた定数式も畳む。
  if (opts.optimize) foldProgram(program);
  // べき乗の強度低減（オプトイン）。畳み込みの後（定数べき乗は先に畳まれる）。
  if (opts.strengthReduce) reduceStrengthProgram(program);

  // 関数表
  const funcNames = new Set<string>();
  const funcTable = new Map<string, FunctionDef>();
  for (const fn of program.functions) {
    if (funcTable.has(fn.name)) fail("E_DUP_FUNCTION", { name: fn.name }, fn.pos);
    funcTable.set(fn.name, fn);
    funcNames.add(fn.name);
  }

  // サフィックス付きの関数呼び出し（ADD%() 等）を基底名（ADD）へ正規化する。
  // しないと funcTable（基底名キー）に当たらず配列参照に誤解釈される（無言の誤変換）。
  {
    const strip = (n: string) => (/[%!#$]$/.test(n) ? n.slice(0, -1) : n);
    const normName = (name: string) =>
      funcTable.has(name) ? name : funcTable.has(strip(name)) ? strip(name) : name;
    const ne = (e: Expr): void => {
      switch (e.type) {
        case "CallExpr":
          e.name = normName(e.name);
          e.args.forEach((a) => ne(a.expr));
          break;
        case "ArrayRef":
          e.indices.forEach(ne);
          break;
        case "Bin":
          ne(e.left);
          ne(e.right);
          break;
        case "Un":
          ne(e.operand);
          break;
        case "Group":
          e.items.forEach(ne);
          break;
      }
    };
    const ns = (stmts: Stmt[]): void => {
      for (const s of stmts) {
        switch (s.type) {
          case "Let":
            if (s.target.type === "ArrayRef") s.target.indices.forEach(ne);
            ne(s.expr);
            break;
          case "Call":
            ne(s.call);
            break;
          case "Return":
            if (s.expr) ne(s.expr);
            break;
          case "Builtin":
            s.parts.forEach((p) => p.kind === "expr" && ne(p.expr));
            break;
          case "Dim":
            s.decls.forEach((d) => d.dims.forEach(ne));
            break;
          case "If":
            ne(s.cond);
            ns(s.then);
            if (s.else) ns(s.else);
            break;
          case "For":
            ne(s.from);
            ne(s.to);
            if (s.step) ne(s.step);
            ns(s.body);
            break;
          case "While":
            ne(s.cond);
            ns(s.body);
            break;
          case "On":
            if (s.arg) ne(s.arg);
            break;
          default:
            break;
        }
      }
    };
    ns(program.toplevel);
    for (const fn of program.functions) ns(fn.body);
  }

  // STRICT モードなら静的型チェック（型サフィックス必須・完全一致）。変換自体は通常どおり行う。
  if (program.strict) diagnostics.push(...typeCheck(program));

  // 再帰検出（呼び出しグラフの循環）。再帰は GOSUB＋ソフトスタックでフレーム退避して対応する。
  const recursiveFns = detectRecursion(program, funcTable, funcNames);
  // 再帰関数の REF 引数は variant 展開と相性が悪く未対応 → 明示エラー
  for (const name of recursiveFns) {
    const fn = funcTable.get(name);
    if (fn && fn.params.some((p) => p.byRef)) fail("E_RECURSION_REF_UNSUPPORTED", { name });
  }

  // ---- 名前割当 ----
  const pool = new NamePool();
  // 再帰用ソフトスタック（数値=倍精度配列／文字列=文字列配列＋各ポインタ）。再帰がある時だけ確保。
  const recStack = recursiveFns.size > 0
    ? {
        numPtr: pool.next("%"),
        strPtr: pool.next("%"),
        numArr: pool.next("#"),
        strArr: pool.next("$"),
        depth: Math.max(1, Math.floor(opts.recursionDepth ?? 100)),
      }
    : null;
  const globalMap = new Map<string, string>(); // original → msxName
  const localMaps = new Map<string, Map<string, string>>(); // funcName → (orig→msx)
  const retVarOf = new Map<string, string>();
  const arraysGlobal = new Set<string>();
  const varNameMap: TransformResult["varNameMap"] = [];

  // グローバル変数: トップレベルで使う変数 ＋ 各関数の GLOBAL 宣言
  const gvars = new Set<string>();
  const garrays = new Set<string>();
  program.toplevel.forEach((s) => collectStmtVars(s, funcNames, gvars, garrays));
  for (const fn of program.functions)
    for (const n of globalNamesOf(fn)) gvars.add(n);
  for (const n of gvars) {
    const msx = pool.next(suffixOf(n));
    globalMap.set(n, msx);
    varNameMap.push({ original: n, scope: "GLOBAL", msxName: msx });
  }
  garrays.forEach((a) => arraysGlobal.add(a));

  // 各関数のローカル変数
  const refParamNamesOf = new Map<string, Set<string>>();
  const valParamNamesOf = new Map<string, string[]>();
  for (const fn of program.functions) {
    const gset = globalNamesOf(fn);
    const refParams = new Set(
      fn.params.filter((p) => p.byRef).map((p) => p.name),
    );
    const valParams = fn.params.filter((p) => !p.byRef).map((p) => p.name);
    refParamNamesOf.set(fn.name, refParams);
    valParamNamesOf.set(fn.name, valParams);

    const used = new Set<string>();
    const arr = new Set<string>();
    fn.body.forEach((s) => collectStmtVars(s, funcNames, used, arr));
    valParams.forEach((p) => used.add(p));

    const lmap = new Map<string, string>();
    for (const n of used) {
      if (gset.has(n) || refParams.has(n)) continue; // グローバル/REFは除外
      const msx = pool.next(suffixOf(n));
      lmap.set(n, msx);
      varNameMap.push({ original: n, scope: fn.name, msxName: msx });
    }
    localMaps.set(fn.name, lmap);
    retVarOf.set(fn.name, pool.next(fn.retSuffix));
  }

  // ---- スコープ解決 ----
  interface Scope {
    func?: string; // undefined=GLOBAL(MAIN)
    subst?: Map<string, string>; // REF置換（variant内）
  }
  const resolveVar = (name: string, sc: Scope): string => {
    if (sc.subst && sc.subst.has(name)) return sc.subst.get(name)!;
    if (sc.func) {
      const lm = localMaps.get(sc.func)!;
      if (lm.has(name)) return lm.get(name)!;
    }
    if (globalMap.has(name)) return globalMap.get(name)!;
    // 未割当（暗黙の新規変数）: グローバルへ割当
    const msx = pool.next(suffixOf(name));
    globalMap.set(name, msx);
    varNameMap.push({ original: name, scope: "GLOBAL", msxName: msx });
    return msx;
  };
  const isUserFunc = (name: string) => funcNames.has(name);
  const isArrayName = (name: string, sc: Scope): boolean => {
    if (sc.func) {
      // ローカルに同名配列があるか（簡易: arrays集合はグローバル中心。ローカル配列は将来）
    }
    return arraysGlobal.has(name) || garrays.has(name);
  };

  // ---- 式の出力 ----
  const opPrec = (op: string): number => {
    if (op === "XOR") return 1;
    if (op === "OR") return 2;
    if (op === "AND") return 3;
    if (["=", "<>", "<", ">", "<=", ">="].includes(op)) return 4;
    if (op === "+" || op === "-") return 5;
    if (op === "MOD") return 6;
    if (op === "\\") return 7;
    if (op === "*" || op === "/") return 8;
    if (op === "^") return 9;
    return 0;
  };
  const isWordOp = (op: string) =>
    ["AND", "OR", "NOT", "XOR", "MOD", "EQV", "IMP"].includes(op);

  const emitExpr = (e: Expr, sc: Scope, parentPrec = 0): string => {
    switch (e.type) {
      case "Num":
        return e.raw;
      case "Str":
        return '"' + e.value + '"';
      case "Var":
        // 組み込み"文"サブキーワード/括弧なし組み込み関数(INKEY$/CSRLIN/ERR/ERL/TIME 等)は
        // 予約語なのでそのまま。それ以外は2文字名へ。
        return isBuiltin(e.name) ? e.name : resolveVar(e.name, sc);
      case "ArrayRef": {
        const idx = e.indices.map((x) => emitExpr(x, sc)).join(",");
        const nm = isBuiltin(e.name) ? e.name : resolveVar(e.name, sc);
        return nm + "(" + idx + ")";
      }
      case "Un": {
        const inner = emitExpr(e.operand, sc, 10);
        return isWordOp(e.op) ? `${e.op} ${inner}` : `${e.op}${inner}`;
      }
      case "Bin": {
        const prec = opPrec(e.op);
        const l = emitExpr(e.left, sc, prec);
        const r = emitExpr(e.right, sc, prec + 1);
        const sep = isWordOp(e.op) ? ` ${e.op} ` : e.op;
        const s = `${l}${sep}${r}`;
        return prec < parentPrec ? `(${s})` : s;
      }
      case "Group":
        // 括弧はそのまま保持（優先順位 `(a+b)` も座標タプル `(x,y)` も）
        return "(" + e.items.map((x) => emitExpr(x, sc)).join(",") + ")";
      case "CallExpr": {
        if (isUserFunc(e.name)) {
          // 通常は prelower で一時変数へ lowering 済み。ここに来るのは内部不整合。
          fail("E_INTERNAL_LOWER", { name: e.name });
          return "0";
        }
        // 組み込み関数/括弧付き組み込み文(SPRITE(n)/KANJI(n) 等) or ユーザ配列
        const args = e.args.map((a) => emitExpr(a.expr, sc)).join(",");
        if (isBuiltin(e.name)) return `${e.name}(${args})`;
        return resolveVar(e.name, sc) + "(" + args + ")";
      }
    }
  };

  const emitLValue = (lv: LValue, sc: Scope): string =>
    lv.type === "Var"
      ? resolveVar(lv.name, sc)
      : (isBuiltin(lv.name) ? lv.name : resolveVar(lv.name, sc)) +
        "(" +
        lv.indices.map((x) => emitExpr(x, sc)).join(",") +
        ")";

  // ---- 文の出力（textの配列を返す。1要素=1 MSX行）----
  // 単純文（ブロックでない）を1行テキストへ
  const simpleStmtText = (s: Stmt, sc: Scope): string | null => {
    switch (s.type) {
      case "Comment":
        return s.text;
      case "Let":
        return `${emitLValue(s.target, sc)}=${emitExpr(s.expr, sc)}`;
      case "Dim":
        return (
          "DIM " +
          s.decls
            .map(
              (d) =>
                resolveVar(d.name, sc) +
                "(" +
                d.dims.map((x) => emitExpr(x, sc)).join(",") +
                ")",
            )
            .join(",")
        );
      case "Return": {
        const rv = sc.func ? retVarOf.get(sc.func) : undefined;
        if (s.expr && rv) return `${rv}=${emitExpr(s.expr, sc)}: RETURN`;
        return "RETURN";
      }
      case "Builtin": {
        let out = s.name;
        let prev = "name";
        // 拡張呼び出し（CALL <名> / _<名>）と KEY(n)/STRIG(n) のトラップ文は、
        // 命令名直後の "(...)" を詰めて出す: 例 "CALL VOICE(0)" / "KEY(1) ON"
        // （節キーワード TO の "TO (..)" とは別扱い）。
        const isExt = s.name === "CALL" || s.name.startsWith("_");
        const tightParen = isExt || s.name === "KEY" || s.name === "STRIG";
        const needSpace = (): boolean => prev !== "sep" && prev !== "op";
        for (const p of s.parts) {
          if (p.kind === "sep") {
            out += p.sep;
            prev = "sep";
          } else if (p.kind === "word") {
            if (/^[A-Za-z]/.test(p.word)) {
              // 節キーワード(TO/NEW 等)は語として空白で区切る: 例 "COPY ... TO ..."
              out += (needSpace() ? " " : "") + p.word;
              // CALL の拡張命令名（複数語可）は直後の "(" を詰めるため専用の状態にする
              prev =
                isExt && (prev === "name" || prev === "extname") ? "extname" : "expr";
            } else {
              // 記号(=,#)は隙間なく付ける: 例 "COLOR=(...)" / "PRINT #1"
              out += p.word;
              prev = "op";
            }
          } else {
            // 区切り(, ;)/記号直後以外（名前直後・式直後）は空白で区切る: 例 "PUT SPRITE 0"
            const txt = emitExpr(p.expr, sc);
            const tight =
              tightParen && (prev === "name" || prev === "extname") && txt.startsWith("(");
            out += (needSpace() && !tight ? " " : "") + txt;
            prev = "expr";
          }
        }
        return out;
      }
      case "On": {
        // 飛び先: ユーザ関数名は入口行へ解決（@@ENTRY:key@@）、リテラル(0等)はそのまま。
        const tgt = (t: { fn?: string; lit?: string }) =>
          t.fn != null ? `@@ENTRY:${t.fn}|@@` : String(t.lit);
        const list = s.targets.map(tgt).join(",");
        let head: string;
        if (s.event === "") head = `ON ${emitExpr(s.arg!, sc)}`;
        else if (s.event === "INTERVAL") head = `ON INTERVAL=${emitExpr(s.arg!, sc)}`;
        else head = `ON ${s.event}`;
        return `${head} ${s.dispatch} ${list}`;
      }
      case "Global":
        return null; // 出力なし
      default:
        return null;
    }
  };

  return finishTransform({
    program,
    diagnostics,
    fail,
    globalMap,
    retVarOf,
    valParamNamesOf,
    refParamNamesOf,
    funcTable,
    localMaps,
    resolveVar,
    emitExpr,
    simpleStmtText,
    varNameMap,
    opts,
    recursiveFns,
    recStack,
    pool,
    asmVars: collectVarNames(program),
  });
}

// 再帰検出。循環に含まれる（＝自分自身へ到達できる）関数名の集合を返す。
function detectRecursion(
  program: Program,
  funcTable: Map<string, FunctionDef>,
  funcNames: Set<string>,
): Set<string> {
  const callsOf = (fn: FunctionDef): Set<string> => {
    const out = new Set<string>();
    const we = (e: Expr) => {
      if (e.type === "CallExpr") {
        if (funcNames.has(e.name)) out.add(e.name);
        e.args.forEach((a) => we(a.expr));
      } else if (e.type === "Bin") {
        we(e.left);
        we(e.right);
      } else if (e.type === "Un") we(e.operand);
      else if (e.type === "ArrayRef") e.indices.forEach(we);
    };
    const ws = (s: Stmt) => {
      switch (s.type) {
        case "Let":
          we(s.expr);
          break;
        case "Return":
          if (s.expr) we(s.expr);
          break;
        case "Call":
          out.add(s.call.name);
          s.call.args.forEach((a) => we(a.expr));
          break;
        case "Builtin":
          s.parts.forEach((p) => p.kind === "expr" && we(p.expr));
          break;
        case "If":
          we(s.cond);
          s.then.forEach(ws);
          s.else?.forEach(ws);
          break;
        case "For":
          we(s.from);
          we(s.to);
          if (s.step) we(s.step);
          s.body.forEach(ws);
          break;
        case "While":
          we(s.cond);
          s.body.forEach(ws);
          break;
        default:
          break;
      }
    };
    fn.body.forEach(ws);
    return out;
  };
  const graph = new Map<string, Set<string>>();
  for (const fn of program.functions) graph.set(fn.name, callsOf(fn));

  // 各関数 F について、F の呼び出し先から F 自身へ到達できれば F は再帰（循環内）。
  const recursive = new Set<string>();
  for (const start of graph.keys()) {
    const seen = new Set<string>();
    const stack = [...(graph.get(start) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (n === start) { recursive.add(start); break; }
      if (seen.has(n) || !graph.has(n)) continue;
      seen.add(n);
      for (const m of graph.get(n) ?? []) stack.push(m);
    }
  }
  return recursive;
}

// 行番号割当・REF variant 展開・GOSUB解決をまとめる
function finishTransform(ctx: any): TransformResult {
  const {
    program,
    diagnostics,
    fail,
    retVarOf,
    valParamNamesOf,
    refParamNamesOf,
    funcTable,
    localMaps,
    globalMap,
    resolveVar,
    emitExpr,
    simpleStmtText,
    varNameMap,
    recursiveFns,
    recStack,
  } = ctx;
  const recSet: Set<string> = recursiveFns ?? new Set();
  // 関数ごとに作られた一時変数(temp)のMSX名。再帰のフレーム退避に必要。
  const tempVarsOf = new Map<string, Set<string>>();

  interface Line {
    text: string;
    gosubKey?: string; // 後でGOSUB番号に解決
  }
  // variant: funcName + REF実引数の並び
  const variantKeys = new Map<string, string[]>(); // funcName → keys
  const callVariant = new Map<object, string>(); // callNode → key
  const variantSubst = new Map<string, Map<string, string>>(); // key → param→actualMsx

  const callerScope = (func?: string) => ({ func });

  // REF実引数の解決名（呼び出し側スコープ）
  const refSig = (
    fnName: string,
    args: { byRef: boolean; expr: Expr }[],
    sc: { func?: string },
  ): { key: string; subst: Map<string, string> } | null => {
    const fn = funcTable.get(fnName);
    if (!fn) {
      fail("E_UNKNOWN_FUNCTION", { name: fnName });
      return null;
    }
    const subst = new Map<string, string>();
    const parts: string[] = [];
    fn.params.forEach((p: any, i: number) => {
      if (!p.byRef) return;
      const a = args[i];
      if (!a || (a.expr.type !== "Var" && a.expr.type !== "ArrayRef")) {
        fail("E_REF_NOT_VARIABLE", { fn: fnName });
        return;
      }
      const actual = resolveVar(a.expr.name, sc);
      subst.set(p.name, actual);
      parts.push(p.name + "=" + actual);
    });
    return { key: fnName + "|" + parts.join(","), subst };
  };

  // パス: 全呼び出しを走査して variant を確定
  // 式中の全ユーザ関数呼び出し（ネスト含む）を走査して variant 登録
  const scanExpr = (e: Expr, sc: { func?: string }) => {
    switch (e.type) {
      case "CallExpr":
        if (funcTable.has(e.name)) registerVariant(e.name, e.args, sc, e);
        e.args.forEach((a) => scanExpr(a.expr, sc));
        break;
      case "Bin":
        scanExpr(e.left, sc);
        scanExpr(e.right, sc);
        break;
      case "Un":
        scanExpr(e.operand, sc);
        break;
      case "ArrayRef":
        e.indices.forEach((x) => scanExpr(x, sc));
        break;
      case "Group":
        e.items.forEach((x) => scanExpr(x, sc));
        break;
      default:
        break;
    }
  };
  const scanCalls = (stmts: Stmt[], func?: string) => {
    const sc = { func };
    for (const s of stmts) {
      switch (s.type) {
        case "Let":
          if (s.target.type === "ArrayRef") s.target.indices.forEach((x) => scanExpr(x, sc));
          scanExpr(s.expr, sc);
          break;
        case "Call":
          scanExpr(s.call, sc);
          break;
        case "Return":
          if (s.expr) scanExpr(s.expr, sc);
          break;
        case "Builtin":
          s.parts.forEach((p) => p.kind === "expr" && scanExpr(p.expr, sc));
          break;
        case "On":
          if (s.arg) scanExpr(s.arg, sc);
          // 飛び先のユーザ関数を無引数 variant として登録（入口行を確保）。
          // ON … の飛び先は引数を渡せない＝引数つき FUNCTION は不可。
          for (const t of s.targets) {
            if (!t.fn) continue;
            const tf = funcTable.get(t.fn);
            if (tf && tf.params.length > 0) fail("E_HANDLER_PARAMS", { name: t.fn });
            registerVariant(t.fn, [], sc, t);
          }
          break;
        case "Dim":
          s.decls.forEach((d) => d.dims.forEach((x) => scanExpr(x, sc)));
          break;
        case "If":
          scanExpr(s.cond, sc);
          scanCalls(s.then, func);
          if (s.else) scanCalls(s.else, func);
          break;
        case "For":
          scanExpr(s.from, sc);
          scanExpr(s.to, sc);
          if (s.step) scanExpr(s.step, sc);
          scanCalls(s.body, func);
          break;
        case "While":
          scanExpr(s.cond, sc);
          scanCalls(s.body, func);
          break;
        default:
          break;
      }
    }
  };
  const registerVariant = (
    name: string,
    args: any[],
    sc: { func?: string },
    node: object,
  ) => {
    const r = refSig(name, args, sc);
    if (!r) return;
    if (!variantKeys.has(name)) variantKeys.set(name, []);
    const keys = variantKeys.get(name)!;
    if (!keys.includes(r.key)) {
      keys.push(r.key);
      variantSubst.set(r.key, r.subst);
    }
    callVariant.set(node, r.key);
  };

  scanCalls(program.toplevel, undefined);
  for (const fn of program.functions) scanCalls(fn.body, fn.name);

  // ---- 文ブロックの emit（Itemモデル: 行 or ラベル）----
  type Item =
    | { kind: "line"; text: string; no?: number }
    | { kind: "label"; id: number }
    | { kind: "frameop"; op: "push" | "pop"; func: string }; // 再帰: フレーム退避/復元（後で展開）
  let labelCounter = 0;
  const newLabel = (): number => ++labelCounter;
  const loopStack: { b: number; c: number }[] = [];
  const emittedLoops: { b: number; c: number }[] = []; // controlFlow用
  const labelLine = new Map<number, number>(); // labelId → MSX行番号
  const entryLineOf = new Map<string, number>(); // variant key → 先頭行番号

  const emitLValueText = (lv: LValue, sc: any): string =>
    lv.type === "Var"
      ? resolveVar(lv.name, sc)
      : resolveVar(lv.name, sc) +
        "(" +
        lv.indices.map((x: Expr) => emitExpr(x, sc)).join(",") +
        ")";

  // 単純文をインライン1要素テキストへ（呼び出し/ブロックは null）
  const stmtToInline = (s: Stmt, sc: any): string | null => {
    if (s.type === "If" || s.type === "For" || s.type === "While") return null;
    if (s.type === "Call") return null;
    if (s.type === "Let" && s.expr.type === "CallExpr" && funcTable.has(s.expr.name))
      return null;
    if (s.type === "Break") {
      const top = loopStack[loopStack.length - 1];
      return top ? `GOTO @@L:${top.b}@@` : null;
    }
    if (s.type === "Continue") {
      const top = loopStack[loopStack.length - 1];
      return top ? `GOTO @@L:${top.c}@@` : null;
    }
    return simpleStmtText(s, sc);
  };

  // else無し・本体が全てインライン可 → 1行IF
  const tryOneLineIf = (s: any, sc: any): string | null => {
    if (s.else) return null;
    for (const t of s.then) if (stmtHasUserCall(t)) return null; // ネスト呼び出しはGOTO形式へ
    const parts: string[] = [];
    for (const t of s.then) {
      const txt = stmtToInline(t, sc);
      if (txt === null) return null;
      parts.push(txt);
    }
    return `IF ${emitExpr(s.cond, sc)} THEN ${parts.join(": ")}`;
  };

  const emitCall = (
    items: Item[],
    name: string,
    args: any[],
    node: object,
    lhs: string | null,
    sc: any,
  ) => {
    const fn = funcTable.get(name);
    const key = callVariant.get(node);
    if (!fn || !key) {
      fail("E_UNRESOLVED_CALL", { name });
      return;
    }
    const lmap = localMaps.get(name);
    // 再帰呼び出し（呼び元・呼び先がともに循環内）なら、呼び元のフレームを退避/復元する。
    const isRec = sc.func && recSet.has(sc.func) && recSet.has(name);
    const valParams = fn.params.filter((p: any) => !p.byRef);

    if (isRec) {
      items.push({ kind: "frameop", op: "push", func: sc.func });
      const segs: string[] = [];
      if (valParams.length >= 2) {
        // 多引数の自己再帰は引数評価順のエイリアシングを避けるため一旦 temp へ。
        const tmps: string[] = [];
        valParams.forEach((p: any, i: number) => {
          const idx = fn.params.indexOf(p);
          const tn = resolveVar(`__A${++tempCounter}${suffixOf(p.name)}`, sc);
          tmps.push(tn);
          segs.push(`${tn}=${emitExpr(args[idx].expr, sc)}`);
        });
        valParams.forEach((p: any, i: number) => segs.push(`${lmap.get(p.name)}=${tmps[i]}`));
      } else {
        valParams.forEach((p: any) => {
          const idx = fn.params.indexOf(p);
          segs.push(`${lmap.get(p.name)}=${emitExpr(args[idx].expr, sc)}`);
        });
      }
      segs.push(`GOSUB @@ENTRY:${key}@@`);
      items.push({ kind: "line", text: segs.join(": ") });
      items.push({ kind: "frameop", op: "pop", func: sc.func });
      if (lhs) items.push({ kind: "line", text: `${lhs}=${retVarOf.get(name)}` });
      return;
    }

    const segs: string[] = [];
    fn.params.forEach((p: any, i: number) => {
      if (p.byRef) return;
      segs.push(`${lmap.get(p.name)}=${emitExpr(args[i].expr, sc)}`);
    });
    segs.push(`GOSUB @@ENTRY:${key}@@`);
    if (lhs) segs.push(`${lhs}=${retVarOf.get(name)}`);
    items.push({ kind: "line", text: segs.join(": ") });
  };

  // ---- ネスト呼び出しの lowering（式中ユーザ関数呼び出し → 一時変数）----
  let tempCounter = 0;
  const exprHasUserCall = (e: Expr): boolean => {
    switch (e.type) {
      case "CallExpr":
        return funcTable.has(e.name) || e.args.some((a) => exprHasUserCall(a.expr));
      case "Bin":
        return exprHasUserCall(e.left) || exprHasUserCall(e.right);
      case "Un":
        return exprHasUserCall(e.operand);
      case "ArrayRef":
        return e.indices.some(exprHasUserCall);
      case "Group":
        return e.items.some(exprHasUserCall);
      default:
        return false;
    }
  };
  const stmtHasUserCall = (s: Stmt): boolean => {
    switch (s.type) {
      case "Let":
        return exprHasUserCall(s.expr) ||
          (s.target.type === "ArrayRef" && s.target.indices.some(exprHasUserCall));
      case "Return":
        return !!s.expr && exprHasUserCall(s.expr);
      case "Builtin":
        return s.parts.some((p) => p.kind === "expr" && exprHasUserCall(p.expr));
      case "On":
        return !!s.arg && exprHasUserCall(s.arg);
      case "Call":
        return true;
      default:
        return false;
    }
  };
  // 式を lowering: ユーザ呼び出しを一時変数へ（GOSUB列を items に前置）
  const lowerExpr = (e: Expr, sc: any, items: Item[]): Expr => {
    switch (e.type) {
      case "Num":
      case "Str":
      case "Var":
        return e;
      case "ArrayRef":
        return { ...e, indices: e.indices.map((x) => lowerExpr(x, sc, items)) };
      case "Un":
        return { ...e, operand: lowerExpr(e.operand, sc, items) };
      case "Bin":
        return { ...e, left: lowerExpr(e.left, sc, items), right: lowerExpr(e.right, sc, items) };
      case "Group":
        return { ...e, items: e.items.map((x) => lowerExpr(x, sc, items)) };
      case "CallExpr": {
        const args = e.args.map((a) => ({ ...a, expr: lowerExpr(a.expr, sc, items) }));
        if (funcTable.has(e.name)) {
          const fn = funcTable.get(e.name)!;
          const t = `__T${++tempCounter}${fn.retSuffix}`;
          const tMsx = resolveVar(t, sc); // 一時変数を割当
          if (sc.func) {
            if (!tempVarsOf.has(sc.func)) tempVarsOf.set(sc.func, new Set());
            tempVarsOf.get(sc.func)!.add(tMsx);
          }
          emitCall(items, e.name, args, e, tMsx, sc);
          return { type: "Var", name: t };
        }
        return { ...e, args };
      }
    }
  };
  // 文のネスト呼び出しを前置 lowering（最外の whole-RHS / 文呼び出しは直接GOSUBのため温存）
  const prelower = (s: Stmt, sc: any, items: Item[]): Stmt => {
    const L = (e: Expr) => lowerExpr(e, sc, items);
    switch (s.type) {
      case "Let": {
        const target =
          s.target.type === "ArrayRef"
            ? { ...s.target, indices: s.target.indices.map(L) }
            : s.target;
        // whole-RHS のユーザ呼び出しはノード identity を保つ（引数の lowering は emit 時）
        if (s.expr.type === "CallExpr" && funcTable.has(s.expr.name))
          return { ...s, target };
        return { ...s, target, expr: L(s.expr) };
      }
      case "Call":
        return s; // 文呼び出しもノード identity を保つ（引数 lowering は emit 時）
      case "Return":
        return s.expr ? { ...s, expr: L(s.expr) } : s;
      case "Builtin":
        return { ...s, parts: s.parts.map((p) => (p.kind === "expr" ? { kind: "expr", expr: L(p.expr) } : p)) };
      case "If":
        return { ...s, cond: L(s.cond) };
      case "For":
        return { ...s, from: L(s.from), to: L(s.to), step: s.step ? L(s.step) : undefined };
      case "While":
        return { ...s, cond: L(s.cond) };
      default:
        return s;
    }
  };

  // ASM ブロックの一時変数（全ブロック共有・遅延確保）。
  let asmTemps: { S: string; SA: string; PT: string; Q: string } | null = null;
  const asmT = () =>
    (asmTemps ??= { S: ctx.pool.next("$"), SA: ctx.pool.next("!"), PT: ctx.pool.next("!"), Q: ctx.pool.next("!") });
  // インライン ASM をアセンブルし、文字列でML領域を確保→POKE配置→VARPTRパッチ→USR実行を生成。
  const emitAsm = (s: { lines: string[]; pos: any }, sc: any, items: Item[]) => {
    const r = assembleZ80(s.lines, ctx.asmVars);
    for (const e of r.errors) fail("E_ASM", { detail: `${e.line}: ${e.message}` }, s.pos);
    if (r.errors.length) return;
    const bytes = r.bytes.slice();
    if (bytes[bytes.length - 1] !== 0xc9) bytes.push(0xc9); // USR は RET で戻る
    const T = asmT();
    const push = (text: string) => items.push({ kind: "line", text });
    push(`' === ASM (${bytes.length} bytes) ===`);
    // 文字列で ML メモリを確保しその実体アドレスを得る（CLEAR 不要・安全）
    push(`${T.S}=STRING$(${bytes.length},0)`);
    push(`${T.SA}=PEEK(VARPTR(${T.S})+1)+PEEK(VARPTR(${T.S})+2)*256`);
    for (let i = 0; i < bytes.length; i += 8) {
      const seg: string[] = [];
      for (let j = i; j < Math.min(i + 8, bytes.length); j++) seg.push(`POKE ${T.SA}+${j},${bytes[j]}`);
      push(seg.join(":"));
    }
    // 変数オペランドを VARPTR でパッチ（負値は +65536 で 0..65535 に正規化）
    for (const p of r.patches) {
      const v = resolveVar(p.name, sc);
      push(`${T.PT}=VARPTR(${v}):IF ${T.PT}<0 THEN ${T.PT}=${T.PT}+65536`);
      push(`POKE ${T.SA}+${p.offset},${T.PT}-INT(${T.PT}/256)*256:POKE ${T.SA}+${p.offset + 1},INT(${T.PT}/256)`);
    }
    push(`DEFUSR=${T.SA}:${T.Q}=USR(0)`);
  };

  const emitInto = (stmts: Stmt[], sc: any, items: Item[]) => {
    for (const s0 of stmts) {
      const s = prelower(s0, sc, items);
      switch (s.type) {
        case "Global":
        case "Include":
          break;
        case "Comment":
          // ニーモニックコメント('@)は構造化側だけの注釈＝MSX出力からは除去
          if (!/^\s*'@/.test(s.text)) items.push({ kind: "line", text: simpleStmtText(s, sc)! });
          break;
        case "Let":
          if (s.expr.type === "CallExpr" && funcTable.has(s.expr.name)) {
            const args = s.expr.args.map((a) => ({ ...a, expr: lowerExpr(a.expr, sc, items) }));
            emitCall(items, s.expr.name, args, s.expr, emitLValueText(s.target, sc), sc);
          } else items.push({ kind: "line", text: simpleStmtText(s, sc)! });
          break;
        case "Call": {
          const args = s.call.args.map((a) => ({ ...a, expr: lowerExpr(a.expr, sc, items) }));
          emitCall(items, s.call.name, args, s.call, null, sc);
          break;
        }
        case "Return":
        case "Dim":
        case "Builtin":
        case "On":
          items.push({ kind: "line", text: simpleStmtText(s, sc)! });
          break;
        case "Asm":
          emitAsm(s, sc, items);
          break;
        case "Break": {
          const top = loopStack[loopStack.length - 1];
          if (top) items.push({ kind: "line", text: `GOTO @@L:${top.b}@@` });
          else fail("E_BREAK_OUTSIDE_LOOP");
          break;
        }
        case "Continue": {
          const top = loopStack[loopStack.length - 1];
          if (top) items.push({ kind: "line", text: `GOTO @@L:${top.c}@@` });
          else fail("E_CONTINUE_OUTSIDE_LOOP");
          break;
        }
        case "If": {
          const one = tryOneLineIf(s, sc);
          if (one !== null) {
            items.push({ kind: "line", text: one });
            break;
          }
          // GOTO平坦化: IF NOT(cond) THEN <else/end> ... [GOTO end] ... label
          const endId = newLabel();
          const elseId = s.else ? newLabel() : endId;
          items.push({
            kind: "line",
            text: `IF NOT(${emitExpr(s.cond, sc)}) THEN @@L:${elseId}@@`,
          });
          emitInto(s.then, sc, items);
          if (s.else) {
            items.push({ kind: "line", text: `GOTO @@L:${endId}@@` });
            items.push({ kind: "label", id: elseId });
            emitInto(s.else, sc, items);
          }
          items.push({ kind: "label", id: endId });
          break;
        }
        case "For": {
          const v = resolveVar(s.varName, sc);
          const step = s.step ? ` STEP ${emitExpr(s.step, sc)}` : "";
          items.push({
            kind: "line",
            text: `FOR ${v}=${emitExpr(s.from, sc)} TO ${emitExpr(s.to, sc)}${step}`,
          });
          const b = newLabel();
          const c = newLabel();
          emittedLoops.push({ b, c });
          loopStack.push({ b, c });
          emitInto(s.body, sc, items);
          loopStack.pop();
          items.push({ kind: "label", id: c }); // CONTINUE先 = NEXT行
          items.push({ kind: "line", text: `NEXT` });
          items.push({ kind: "label", id: b }); // BREAK先 = NEXT直後
          break;
        }
        case "While": {
          // MSX-BASIC には WHILE/WEND が無いため IF/GOTO に展開する。
          // 条件が偽(=0)のとき脱出。`WHILE 1` のような数値条件も正しく扱える。
          const top = newLabel(); // 条件評価（ループ先頭）
          const b = newLabel(); // BREAK先（ループ脱出）
          const c = newLabel(); // CONTINUE先（条件へ戻る）
          items.push({ kind: "label", id: top });
          items.push({
            kind: "line",
            text: `IF (${emitExpr(s.cond, sc)})=0 THEN GOTO @@L:${b}@@`,
          });
          emittedLoops.push({ b, c });
          loopStack.push({ b, c });
          emitInto(s.body, sc, items);
          loopStack.pop();
          items.push({ kind: "label", id: c }); // CONTINUE → 条件へ戻る
          items.push({ kind: "line", text: `GOTO @@L:${top}@@` });
          items.push({ kind: "label", id: b }); // BREAK → ループ後
          break;
        }
      }
    }
  };

  // ブロックを行番号付与し、ラベル位置を解決
  // 再帰フレーム（値引数＋ローカル＋call結果temp）のMSX変数列。
  const frameVarsOf = (func: string): string[] => {
    const lm = localMaps.get(func);
    const locals = lm ? [...lm.values()] : [];
    const temps = tempVarsOf.get(func) ? [...tempVarsOf.get(func)!] : [];
    return [...locals, ...temps];
  };
  // push/pop の文列を生成（数値は倍精度スタック、文字列は文字列スタックへ）。
  const frameSeq = (func: string, op: "push" | "pop"): string => {
    if (!recStack) return "";
    let vars = frameVarsOf(func);
    if (op === "pop") vars = [...vars].reverse();
    const { numPtr, strPtr, numArr, strArr } = recStack;
    const parts: string[] = [];
    for (const v of vars) {
      const isStr = v.endsWith("$");
      const ptr = isStr ? strPtr : numPtr;
      const arr = isStr ? strArr : numArr;
      if (op === "push") parts.push(`${ptr}=${ptr}+1`, `${arr}(${ptr})=${v}`);
      else parts.push(`${v}=${arr}(${ptr})`, `${ptr}=${ptr}-1`);
    }
    return parts.join(":");
  };

  const numberBlock = (rawItems: Item[], start: number): MsxLine[] => {
    // 255バイト超過行を自動分割（番号付与の前なのでラベル/GOSUBは正しく解決される）
    const items: Item[] = [];
    for (const it of rawItems) {
      if (it.kind === "frameop") {
        const text = frameSeq(it.func, it.op);
        if (text) for (const t of splitLongLine(text)) items.push({ kind: "line", text: t });
        continue;
      }
      if (it.kind !== "line") {
        items.push(it);
        continue;
      }
      const pieces = splitLongLine(it.text);
      for (const text of pieces) items.push({ kind: "line", text });
    }
    let no = start;
    for (const it of items)
      if (it.kind === "line") {
        it.no = no;
        no += 10;
      }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== "label") continue;
      let j = i + 1;
      while (j < items.length && items[j].kind !== "line") j++;
      const target = items[j] as { no: number } | undefined;
      labelLine.set(it.id, target ? target.no : no);
    }
    return items
      .filter((it): it is { kind: "line"; text: string; no: number } => it.kind === "line")
      .map((it) => ({ lineNo: it.no, text: it.text }));
  };

  // MAIN
  const mainItems: Item[] = [{ kind: "line", text: "' === MAIN ===" }];
  emitInto(program.toplevel, { func: undefined }, mainItems);
  mainItems.push({ kind: "line", text: "END" });
  // 再帰スタックの DIM をMAIN先頭（ヘッダ直後）に挿入。最初の再帰呼び出しより前に確保する。
  if (recStack)
    mainItems.splice(1, 0, {
      kind: "line",
      text: `DIM ${recStack.numArr}(${recStack.depth}), ${recStack.strArr}(${recStack.depth})`,
    });
  const out: MsxLine[] = [...numberBlock(mainItems, 100)];

  // 関数 variant ブロック。最初の関数の開始セグメントは MAIN の実末尾の先（切りの良い千番台）
  // にする。MAIN が 90 行を超えて 1000 台へ食い込んでも、関数と行番号が衝突しない。
  // （関数同士は下の seg 再計算で常に前ブロックの実末尾の先へ進むので元から衝突しない。）
  const mainLast = out.length ? out[out.length - 1].lineNo : 100;
  let seg = Math.max(1000, (Math.floor(mainLast / 1000) + 1) * 1000);
  // ホット配置（オプトイン）: 呼び出しの多い関数から先に（＝低い行番号へ）並べる。
  // GOSUB 先はプレースホルダを entryLineOf で名前解決するので、順序を変えても正しい。
  const callCount = ctx.opts?.hotPlacement ? countCallSites(program) : null;
  const fnOrder = callCount
    ? [...program.functions].sort((a, b) => (callCount.get(b.name) ?? 0) - (callCount.get(a.name) ?? 0))
    : program.functions;
  for (const fn of fnOrder) {
    const keys = variantKeys.get(fn.name) ?? [];
    for (const key of keys) {
      const subst = variantSubst.get(key);
      const sc = { func: fn.name, subst };
      const refDesc = [...(subst?.entries() ?? [])]
        .map(([p, a]) => `${p}->${a}`)
        .join(", ");
      const items: Item[] = [
        {
          kind: "line",
          text: `' === FUNCTION ${fn.name}${refDesc ? " (" + refDesc + ")" : ""} ===`,
        },
      ];
      emitInto(fn.body, sc, items);
      // 関数末尾が明示 RETURN でなければ補う（戻り値の無い手続き等。無いと GOSUB が落ちる）
      const last = fn.body[fn.body.length - 1];
      if (!last || last.type !== "Return") {
        items.push({ kind: "line", text: "RETURN" });
      }
      const lines = numberBlock(items, seg);
      entryLineOf.set(key, seg);
      out.push(...lines);
      // 次のセグメントは「seg+1000」を基本とするが、この関数が 100 行(=1000番)を
      // 超えて使い切った場合は、実際に使った最終行を確実に超える 1000 の倍数へ進める
      // （関数同士で行番号が衝突しないように。1関数>100行でも壊れない）。
      const lastNo = lines.length ? lines[lines.length - 1].lineNo : seg;
      seg = Math.max(seg + 1000, (Math.floor(lastNo / 1000) + 1) * 1000);
    }
  }

  // プレースホルダ解決（GOSUB entry / ラベル）
  for (const l of out) {
    l.text = l.text
      .replace(/@@ENTRY:([^@]+)@@/g, (_, key) => String(entryLineOf.get(key) ?? 0))
      .replace(/@@L:(\d+)@@/g, (_, id) => String(labelLine.get(Number(id)) ?? 0));
  }

  // 行番号の健全性検査（安全ネット）: 厳密昇順・重複なし・MSX最大行番号(65529)以内。
  // セグメント割当や超巨大プログラムで万一崩れても「黙って壊れたコード」を出さない。
  const MSX_MAX_LINE = 65529;
  let prevNo = -1;
  for (const l of out) {
    if (l.lineNo <= prevNo) { fail("E_LINE_NUMBER_OVERFLOW", { lineNo: l.lineNo }); break; }
    if (l.lineNo > MSX_MAX_LINE) { fail("E_LINE_NUMBER_OVERFLOW", { lineNo: l.lineNo }); break; }
    prevNo = l.lineNo;
  }

  // 1行255バイト制限の検査（docs/05 §5.12）。自動分割は将来、まずは検出。
  for (const l of out) {
    if (estimateMsxBytes(l.text) > 255)
      fail("E_LINE_TOO_LONG", { lineNo: l.lineNo });
    // Shift-JIS 表現不能文字の検査（docs/08 §8.6.4）
    const bad = findNonSjis(l.text);
    if (bad.length > 0)
      fail("E_NON_SJIS", { lineNo: l.lineNo, chars: JSON.stringify(bad.join("")) });
  }

  // ---- MapTable 構築（逆変換用）----
  const controlFlow = emittedLoops.flatMap((lp) => [
    { kind: "Continue" as const, fromLine: 0, targetLine: labelLine.get(lp.c) ?? 0, loopId: "" },
    { kind: "Break" as const, fromLine: 0, targetLine: labelLine.get(lp.b) ?? 0, loopId: "" },
  ]);
  const lineMap = ctx.opts?.lineMap as Array<{ file: string; line: number }> | undefined;
  const fileOf = (posLine: number): string | undefined => lineMap?.[posLine - 1]?.file;
  const globalVarMap = varNameMap.filter((v: any) => v.scope === "GLOBAL");
  const functions = program.functions
    .filter((fn: FunctionDef) => (variantKeys.get(fn.name) ?? []).length > 0)
    .map((fn: FunctionDef) => ({
      name: fn.name,
      retSuffix: fn.retSuffix,
      retVar: retVarOf.get(fn.name)!,
      params: fn.params.map((p) => ({ name: p.name, byRef: p.byRef })),
      localVarMap: varNameMap.filter((v: any) => v.scope === fn.name),
      variants: (variantKeys.get(fn.name) ?? []).map((key: string) => ({
        entryLine: entryLineOf.get(key) ?? 0,
        refSubst: [...(variantSubst.get(key)?.entries() ?? [])].map(([param, actual]) => ({
          param,
          actual,
        })),
      })),
      sourceFile: fileOf(fn.pos.line),
    }));
  const map: MapTable = {
    version: "1.0",
    source: ctx.opts?.source ?? "",
    sources: ctx.opts?.sources ?? [],
    globalVarMap,
    functions,
    controlFlow,
  };

  const code = ctx.opts?.stripComments ? stripComments(out) : out;
  return { code, diagnostics, varNameMap, map };
}

export function renderMsx(lines: MsxLine[]): string {
  return lines.map((l) => `${l.lineNo} ${l.text}`).join("\r\n");
}

export { hasError };
