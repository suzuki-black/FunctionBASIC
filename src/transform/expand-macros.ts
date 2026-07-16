// MACRO name(params) = expr のコンパイル時インライン展開（AST→AST 前処理パス）。
// 呼び出し name(args) を「本体式に実引数を代入したもの」へ置換する＝GOSUB/関数呼び出しの
// オーバーヘッドが無い（ゼロコスト）。lowerSelect の後・lowerStruct の前に走らせるので、
// SELECT/DO 由来の式も対象になり、本体・引数中の STRUCT フィールドは後段 lowerStruct で処理される。
//
// 意味論: 引数は「式のまま」代入（call-by-name）。優先順位事故を避けるため代入した実引数と
// 展開結果は Group（括弧）で包む。本体が別マクロを含めば再展開する（自己/相互参照は深さ上限で検出）。
import { suffixOf } from "../ast/nodes.ts";
import type { Program, Stmt, Expr, MacroDef, LValue, Position } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";

export function expandMacros(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const macros = new Map<string, MacroDef>();
  const fnNames = new Set(program.functions.map((f) => f.name));
  for (const m of program.macros ?? []) {
    const bare = suffixOf(m.name) ? m.name.slice(0, -1) : m.name;
    if (macros.has(m.name) || fnNames.has(bare)) {
      diags.push(error("E_MACRO_DUP", m.pos, { name: m.name }));
      continue;
    }
    macros.set(m.name, m);
  }
  if (macros.size === 0) {
    program.macros = [];
    return diags;
  }

  // 式の deep-clone（置換で構造を共有しないため）
  const clone = (e: Expr): Expr => {
    switch (e.type) {
      case "Group": return { ...e, items: e.items.map(clone) };
      case "Un": return { ...e, operand: clone(e.operand) };
      case "Bin": return { ...e, left: clone(e.left), right: clone(e.right) };
      case "ArrayRef": return { ...e, indices: e.indices.map(clone) };
      case "Field": return { ...e, indices: e.indices.map(clone) };
      case "CallExpr": return { ...e, args: e.args.map((a) => ({ ...a, expr: clone(a.expr) })) };
      default: return { ...e }; // Num / Str / Var
    }
  };

  // 本体式中の仮引数(Var) を実引数へ置換（deep）。実引数は Group で包み優先順位事故を防ぐ。
  const substitute = (e: Expr, args: Map<string, Expr>, pos: Position): Expr => {
    switch (e.type) {
      case "Var": {
        const a = args.get(e.name);
        return a ? ({ type: "Group", items: [clone(a)], pos } as Expr) : e;
      }
      case "Group": return { ...e, items: e.items.map((x) => substitute(x, args, pos)) };
      case "Un": return { ...e, operand: substitute(e.operand, args, pos) };
      case "Bin": return { ...e, left: substitute(e.left, args, pos), right: substitute(e.right, args, pos) };
      case "ArrayRef": return { ...e, indices: e.indices.map((x) => substitute(x, args, pos)) };
      case "Field": return { ...e, indices: e.indices.map((x) => substitute(x, args, pos)) };
      case "CallExpr": return { ...e, args: e.args.map((a) => ({ ...a, expr: substitute(a.expr, args, pos) })) };
      default: return e; // Num / Str
    }
  };

  // 式を内側から展開。CallExpr が macro なら実引数を展開→代入→本体を再展開。
  // active = 現在展開中のマクロ名集合。呼び出し名が既に active なら自己/相互再帰＝エラーで打ち切り。
  const expand = (e: Expr, active: Set<string>, pos: Position): Expr => {
    switch (e.type) {
      case "Group": e.items = e.items.map((x) => expand(x, active, pos)); return e;
      case "Un": e.operand = expand(e.operand, active, pos); return e;
      case "Bin": e.left = expand(e.left, active, pos); e.right = expand(e.right, active, pos); return e;
      case "ArrayRef": e.indices = e.indices.map((x) => expand(x, active, pos)); return e;
      case "Field": e.indices = e.indices.map((x) => expand(x, active, pos)); return e;
      case "CallExpr": {
        e.args = e.args.map((a) => ({ ...a, expr: expand(a.expr, active, pos) }));
        const m = macros.get(e.name);
        if (!m) return e; // 配列/関数呼び出し等はそのまま
        if (active.has(e.name)) { diags.push(error("E_MACRO_RECURSION", pos, { name: e.name })); return e; }
        if (e.args.length !== m.params.length) {
          diags.push(error("E_MACRO_ARITY", pos, { name: e.name, expected: m.params.length, got: e.args.length }));
          return e;
        }
        const argMap = new Map<string, Expr>();
        m.params.forEach((p, i) => argMap.set(p, e.args[i].expr));
        const sub = substitute(clone(m.body), argMap, pos);
        const wrapped: Expr = { type: "Group", items: [sub], pos };
        active.add(e.name);
        const out = expand(wrapped, active, pos); // 本体に別マクロがあれば再展開
        active.delete(e.name);
        return out;
      }
      default: return e; // Num / Str / Var
    }
  };

  const expandLValue = (lv: LValue, pos: Position): void => {
    if (lv.type === "ArrayRef" || lv.type === "Field") lv.indices = lv.indices.map((x) => expand(x, new Set(), pos));
  };

  const walk = (stmts: Stmt[]): void => {
    const ex = (e: Expr, pos: Position) => expand(e, new Set<string>(), pos);
    for (const s of stmts) {
      switch (s.type) {
        case "Let": expandLValue(s.target, s.pos); s.expr = ex(s.expr, s.pos); break;
        case "Const": s.expr = ex(s.expr, s.pos); break;
        case "Dim": for (const d of s.decls) d.dims = d.dims.map((x) => ex(x, s.pos)); break;
        case "For": s.from = ex(s.from, s.pos); s.to = ex(s.to, s.pos); if (s.step) s.step = ex(s.step, s.pos); walk(s.body); break;
        case "While": s.cond = ex(s.cond, s.pos); walk(s.body); break;
        case "If": s.cond = ex(s.cond, s.pos); walk(s.then); if (s.else) walk(s.else); break;
        case "Return": if (s.expr) s.expr = ex(s.expr, s.pos); break;
        case "Call": s.call.args = s.call.args.map((a) => ({ ...a, expr: ex(a.expr, s.pos) })); break;
        case "On": if (s.arg) s.arg = ex(s.arg, s.pos); break;
        case "Builtin": for (const p of s.parts) if (p.kind === "expr") p.expr = ex(p.expr, s.pos); break;
        case "Event": s.arg = ex(s.arg, s.pos); walk(s.body); break;
        default: break;
      }
    }
  };

  walk(program.toplevel);
  for (const fn of program.functions) walk(fn.body);
  program.macros = [];
  return diags;
}
