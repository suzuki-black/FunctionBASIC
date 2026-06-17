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
import { isBuiltinFunction } from "../core/builtins.ts";
import { NamePool } from "./names.ts";

export interface MsxLine {
  lineNo: number;
  text: string;
}
export interface TransformResult {
  code: MsxLine[];
  diagnostics: Diagnostic[];
  varNameMap: Array<{ original: string; scope: string; msxName: string }>;
}

const ORIGIN = { line: 0, column: 0 };

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
      vars.add(e.name);
      return;
    case "ArrayRef":
      vars.add(e.name);
      arrays.add(e.name);
      e.indices.forEach((x) => collectExprVars(x, funcNames, vars, arrays));
      return;
    case "Un":
      collectExprVars(e.operand, funcNames, vars, arrays);
      return;
    case "Bin":
      collectExprVars(e.left, funcNames, vars, arrays);
      collectExprVars(e.right, funcNames, vars, arrays);
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
      if (s.target.type === "Var") vars.add(s.target.name);
      else {
        vars.add(s.target.name);
        arrays.add(s.target.name);
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

export function transform(program: Program): TransformResult {
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
        return resolveVar(e.name, sc);
      case "ArrayRef": {
        const idx = e.indices.map((x) => emitExpr(x, sc)).join(",");
        return resolveVar(e.name, sc) + "(" + idx + ")";
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
      case "CallExpr": {
        if (isUserFunc(e.name)) {
          fail(
            "E_NOT_IMPLEMENTED",
            `式中のユーザ関数呼び出しは未対応です: ${e.name}()（代入の右辺全体なら可）`,
          );
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
      : resolveVar(lv.name, sc) +
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
            out += (prev === "name" ? " " : "") + emitExpr(p.expr, sc);
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
  const scanCalls = (stmts: Stmt[], func?: string) => {
    const sc = { func };
    for (const s of stmts) {
      if (s.type === "Let" && s.expr.type === "CallExpr" && funcTable.has(s.expr.name)) {
        registerVariant(s.expr.name, s.expr.args, sc, s.expr);
      } else if (s.type === "Call" && funcTable.has(s.call.name)) {
        registerVariant(s.call.name, s.call.args, sc, s.call);
      } else if (s.type === "If") {
        scanCalls(s.then, func);
        if (s.else) scanCalls(s.else, func);
      } else if (s.type === "For" || s.type === "While") {
        scanCalls(s.body, func);
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

  const emitInto = (stmts: Stmt[], sc: any, items: Item[]) => {
    for (const s of stmts) {
      switch (s.type) {
        case "Global":
        case "Include":
          break;
        case "Comment":
          items.push({ kind: "line", text: simpleStmtText(s, sc)! });
          break;
        case "Let":
          if (s.expr.type === "CallExpr" && funcTable.has(s.expr.name))
            emitCall(items, s.expr.name, s.expr.args, s.expr, emitLValueText(s.target, sc), sc);
          else items.push({ kind: "line", text: simpleStmtText(s, sc)! });
          break;
        case "Call":
          emitCall(items, s.call.name, s.call.args, s.call, null, sc);
          break;
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
  const numberBlock = (items: Item[], start: number): MsxLine[] => {
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

  return { code: out, diagnostics, varNameMap };
}

export function renderMsx(lines: MsxLine[]): string {
  return lines.map((l) => `${l.lineNo} ${l.text}`).join("\r\n");
}

export { hasError };
