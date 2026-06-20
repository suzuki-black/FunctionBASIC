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
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";
import { hasError } from "../core/diagnostics.ts";
import { isBuiltinFunction, isBuiltinStatement, isBuiltin } from "../core/builtins.ts";
import { NamePool } from "./names.ts";
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
      // 組み込み"文"のサブキーワード（PUT SPRITE の SPRITE 等）は変数ではない＝改名しない。
      // 組み込み"関数"名（POS/TIME 等）はユーザ変数として使われ得るので改名対象のまま。
      if (!isBuiltinStatement(e.name)) vars.add(e.name);
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
      const isCall = funcNames.has(e.name) || isBuiltinFunction(e.name);
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
        if (!isBuiltinStatement(s.target.name)) vars.add(s.target.name);
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
}

export function transform(program: Program, opts: TransformOptions = {}): TransformResult {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, msg: string) =>
    diagnostics.push(error(code, ORIGIN, msg));

  // 関数表
  const funcNames = new Set<string>();
  const funcTable = new Map<string, FunctionDef>();
  for (const fn of program.functions) {
    if (funcTable.has(fn.name)) fail("E_DUP_FUNCTION", `関数 ${fn.name} が重複`);
    funcTable.set(fn.name, fn);
    funcNames.add(fn.name);
  }

  // 再帰検出（呼び出しグラフの循環）
  detectRecursion(program, funcTable, funcNames, diagnostics);

  // ---- 名前割当 ----
  const pool = new NamePool();
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
        // 組み込み"文"サブキーワードはそのまま（PUT SPRITE の SPRITE 等）。それ以外は2文字名へ。
        return isBuiltinStatement(e.name) ? e.name : resolveVar(e.name, sc);
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
          fail("E_INTERNAL", `式中のユーザ関数呼び出しの lowering 漏れ: ${e.name}()`);
          return "0";
        }
        // 組み込み関数 or 配列
        const args = e.args.map((a) => emitExpr(a.expr, sc)).join(",");
        if (isBuiltinFunction(e.name)) return `${e.name}(${args})`;
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
        for (const p of s.parts) {
          if (p.kind === "sep") {
            out += p.sep;
            prev = "sep";
          } else {
            // 区切り(, ;)直後以外（名前直後・式直後）は空白で区切る: 例 "PUT SPRITE 0"
            out += (prev !== "sep" ? " " : "") + emitExpr(p.expr, sc);
            prev = "expr";
          }
        }
        return out;
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
  });
}

// 再帰検出
function detectRecursion(
  program: Program,
  funcTable: Map<string, FunctionDef>,
  funcNames: Set<string>,
  diagnostics: Diagnostic[],
): void {
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

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const visit = (n: string): boolean => {
    color.set(n, GRAY);
    for (const m of graph.get(n) ?? []) {
      if (!graph.has(m)) continue;
      const c = color.get(m) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(m)) return true;
    }
    color.set(n, BLACK);
    return false;
  };
  for (const fn of program.functions) {
    if ((color.get(fn.name) ?? WHITE) === WHITE && visit(fn.name)) {
      diagnostics.push(
        error("E_RECURSION_UNSUPPORTED", ORIGIN, `再帰は未対応です（${fn.name} を含む循環）`),
      );
      break;
    }
  }
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
  } = ctx;

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
      fail("E_UNKNOWN_FUNCTION", `未定義の関数: ${fnName}`);
      return null;
    }
    const subst = new Map<string, string>();
    const parts: string[] = [];
    fn.params.forEach((p: any, i: number) => {
      if (!p.byRef) return;
      const a = args[i];
      if (!a || (a.expr.type !== "Var" && a.expr.type !== "ArrayRef")) {
        fail("E_REF_NOT_VARIABLE", `${fnName}: REF引数には変数を渡してください`);
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
    | { kind: "label"; id: number };
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
      fail("E_UNKNOWN_FUNCTION", `未解決の呼び出し: ${name}`);
      return;
    }
    const lmap = localMaps.get(name);
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

  const emitInto = (stmts: Stmt[], sc: any, items: Item[]) => {
    for (const s0 of stmts) {
      const s = prelower(s0, sc, items);
      switch (s.type) {
        case "Global":
        case "Include":
          break;
        case "Comment":
          items.push({ kind: "line", text: simpleStmtText(s, sc)! });
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
          items.push({ kind: "line", text: simpleStmtText(s, sc)! });
          break;
        case "Break": {
          const top = loopStack[loopStack.length - 1];
          if (top) items.push({ kind: "line", text: `GOTO @@L:${top.b}@@` });
          else fail("E_BREAK_OUTSIDE_LOOP", "BREAK はループ内のみ");
          break;
        }
        case "Continue": {
          const top = loopStack[loopStack.length - 1];
          if (top) items.push({ kind: "line", text: `GOTO @@L:${top.c}@@` });
          else fail("E_CONTINUE_OUTSIDE_LOOP", "CONTINUE はループ内のみ");
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
          items.push({ kind: "line", text: `WHILE ${emitExpr(s.cond, sc)}` });
          const b = newLabel();
          const c = newLabel();
          emittedLoops.push({ b, c });
          loopStack.push({ b, c });
          emitInto(s.body, sc, items);
          loopStack.pop();
          items.push({ kind: "label", id: c }); // CONTINUE先 = WEND行
          items.push({ kind: "line", text: `WEND` });
          items.push({ kind: "label", id: b }); // BREAK先 = WEND直後
          break;
        }
      }
    }
  };

  // ブロックを行番号付与し、ラベル位置を解決
  const numberBlock = (rawItems: Item[], start: number): MsxLine[] => {
    // 255バイト超過行を自動分割（番号付与の前なのでラベル/GOSUBは正しく解決される）
    const items: Item[] = [];
    for (const it of rawItems) {
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
  const out: MsxLine[] = [...numberBlock(mainItems, 100)];

  // 関数 variant ブロック
  let seg = 1000;
  for (const fn of program.functions) {
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
      const lines = numberBlock(items, seg);
      entryLineOf.set(key, seg);
      out.push(...lines);
      seg += 1000;
    }
  }

  // プレースホルダ解決（GOSUB entry / ラベル）
  for (const l of out) {
    l.text = l.text
      .replace(/@@ENTRY:([^@]+)@@/g, (_, key) => String(entryLineOf.get(key) ?? 0))
      .replace(/@@L:(\d+)@@/g, (_, id) => String(labelLine.get(Number(id)) ?? 0));
  }

  // 1行255バイト制限の検査（docs/05 §5.12）。自動分割は将来、まずは検出。
  for (const l of out) {
    if (estimateMsxBytes(l.text) > 255)
      fail(
        "E_LINE_TOO_LONG",
        `行 ${l.lineNo} が255バイトを超過しました（式の簡略化/分割が必要）`,
      );
    // Shift-JIS 表現不能文字の検査（docs/08 §8.6.4）
    const bad = findNonSjis(l.text);
    if (bad.length > 0)
      fail(
        "E_NON_SJIS",
        `行 ${l.lineNo}: Shift-JISで表現できない文字 ${JSON.stringify(bad.join(""))}`,
      );
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

  return { code: out, diagnostics, varNameMap, map };
}

export function renderMsx(lines: MsxLine[]): string {
  return lines.map((l) => `${l.lineNo} ${l.text}`).join("\r\n");
}

export { hasError };
