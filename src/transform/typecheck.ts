// STRICT モードの静的型チェック（rust 方式＝暗黙変換なし）。
// - 全ユーザ変数/配列/引数/FOR変数/GLOBAL/DIM・戻り値関数に型サフィックス必須。
// - 型は % 整数 / ! 単精度 / # 倍精度 / $ 文字列 の4種。境界（代入・引数・戻り値）で完全一致。
// - 変換は CINT/CSNG/CDBL/INT/FIX/ASC 等の関数で明示的に行う。
// program.strict のときだけ transform から呼ばれる。
import type {
  Program,
  Stmt,
  Expr,
  FunctionDef,
  LValue,
} from "../ast/nodes.ts";
import { suffixOf } from "../ast/nodes.ts";
import type { Diagnostic, DiagParams } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";
import { isBuiltin, BUILTIN_RETURN } from "../core/builtins.ts";
import type { Position } from "../core/position.ts";

// 値型: 具体型 %/!/#/$ ＋ リテラル（整数=どの数値にも可 / 小数=!,#のみ）＋ any（不明・抑制）
type VT = "%" | "!" | "#" | "$" | "intlit" | "fltlit" | "any";

const isNum = (t: VT) => t !== "$" && t !== "any";

// from を to に代入可能か（完全一致。リテラルのみ柔軟）
function assignable(from: VT, to: VT): boolean {
  if (from === "any" || to === "any") return true;
  if (to === "$") return from === "$";
  if (from === "$") return false; // 文字列→数値は不可
  // to は数値（%/!/#）
  if (from === "intlit") return true; // 整数リテラルは任意の数値へ
  if (from === "fltlit") return to === "!" || to === "#"; // 小数リテラルは % 不可
  return from === to; // 変数/式の具体型は完全一致のみ
}

const litToConcrete = (t: VT): VT => (t === "intlit" ? "%" : t === "fltlit" ? "#" : t);
const rank = (t: VT): number => ({ "%": 1, "!": 2, "#": 3 } as Record<string, number>)[litToConcrete(t)] ?? 1;
const promote = (a: VT, b: VT): VT => (rank(a) >= rank(b) ? litToConcrete(a) : litToConcrete(b));

export function typeCheck(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const reportedUntyped = new Set<string>();
  const add = (key: string, pos: Position, params: DiagParams = {}) =>
    diags.push(error(key, pos, params));

  const funcs = new Map<string, FunctionDef>();
  for (const f of program.functions) funcs.set(f.name, f);

  // 関数の戻り値型（名前サフィックス）。"" は無し（手続き）。
  const fnRet = (f: FunctionDef): VT =>
    f.retSuffix === "" ? "any" : (f.retSuffix as VT);

  // 名前→型（サフィックスから）。サフィックス無しは STRICT 違反として報告し any を返す。
  const nameType = (name: string, pos: Position): VT => {
    const s = suffixOf(name);
    if (s === "") {
      if (!reportedUntyped.has(name)) {
        reportedUntyped.add(name);
        add("E_STRICT_UNTYPED", pos, { name });
      }
      return "any";
    }
    return s as VT;
  };

  // 式の型を求めつつ、未型変数・演算子の型不整合を報告する。
  const typeOf = (e: Expr, pos: Position): VT => {
    switch (e.type) {
      case "Num":
        return Number.isInteger(e.value) ? "intlit" : "fltlit";
      case "Str":
        return "$";
      case "Var":
        return nameType(e.name, pos);
      case "ArrayRef": {
        for (const ix of e.indices) {
          const it = typeOf(ix, pos);
          if (it === "$") add("E_TYPE_MISMATCH", pos, { ctx: "index", to: "num", from: "str" });
        }
        return nameType(e.name, pos);
      }
      case "Un": {
        const t = typeOf(e.operand, pos);
        if (e.op === "NOT") return "%";
        if (t === "$") add("E_TYPE_MISMATCH", pos, { ctx: "op", to: "num", from: "str" });
        return isNum(t) ? litToConcrete(t) : "any";
      }
      case "Bin": {
        const l = typeOf(e.left, pos);
        const r = typeOf(e.right, pos);
        const op = e.op;
        const COMPARE = ["=", "<>", "<", ">", "<=", ">="];
        if (op === "+") {
          if (l === "$" && r === "$") return "$";
          if (l === "$" || r === "$") {
            if (l !== "any" && r !== "any")
              add("E_TYPE_MISMATCH", pos, { ctx: "op", detail: "+", to: l === "$" ? "str" : "num", from: l === "$" ? "num" : "str" });
            return "any";
          }
          return promote(l, r);
        }
        if (COMPARE.includes(op)) {
          const lStr = l === "$", rStr = r === "$";
          if (lStr !== rStr && l !== "any" && r !== "any")
            add("E_TYPE_MISMATCH", pos, { ctx: "cmp", to: lStr ? "str" : "num", from: lStr ? "num" : "str" });
          return "%";
        }
        // 算術・論理: 文字列不可
        if (l === "$" || r === "$") {
          if (l !== "any" && r !== "any")
            add("E_TYPE_MISMATCH", pos, { ctx: "op", detail: op, to: "num", from: "str" });
          return "any";
        }
        if (op === "\\" || op === "MOD" || op === "AND" || op === "OR" || op === "XOR" || op === "EQV" || op === "IMP")
          return "%";
        if (op === "/") {
          // MSX の / は浮動小数（最低でも単精度）。% / % は ! になる。
          const p = promote(l, r);
          return p === "%" ? "!" : p;
        }
        if (op === "^") return "#"; // 累乗は倍精度
        return promote(l, r); // - * 等
      }
      case "Group":
        return e.items.length === 1 ? typeOf(e.items[0], pos) : "any";
      case "CallExpr": {
        const fn = funcs.get(e.name);
        if (fn) {
          // ユーザ関数: 引数の型を仮引数と完全一致チェック
          fn.params.forEach((p, i) => {
            const a = e.args[i];
            if (!a) return;
            const at = typeOf(a.expr, pos);
            const pt = nameType(p.name, pos);
            if (!assignable(at, pt))
              add("E_TYPE_MISMATCH", pos, { ctx: "arg", detail: p.name, to: pt, from: litToConcrete(at) });
          });
          return fnRet(fn);
        }
        // 組み込み関数: 引数は型チェックしない（再帰だけして未型変数等は拾う）
        for (const a of e.args) typeOf(a.expr, pos);
        if (e.name.endsWith("$")) return "$";
        if (e.name === "ABS") return e.args[0] ? litToConcrete(typeOf(e.args[0].expr, pos)) : "#";
        return BUILTIN_RETURN.get(e.name) ?? "#";
      }
    }
  };

  const lvalueType = (lv: LValue, pos: Position): VT => {
    if (lv.type === "ArrayRef") for (const ix of lv.indices) typeOf(ix, pos);
    return nameType(lv.name, pos);
  };

  const walk = (stmts: Stmt[], fn?: FunctionDef): void => {
    for (const s of stmts) {
      switch (s.type) {
        case "Let": {
          const lt = lvalueType(s.target, s.pos);
          const rt = typeOf(s.expr, s.pos);
          if (!assignable(rt, lt))
            add("E_TYPE_MISMATCH", s.pos, { ctx: "assign", to: lt, from: litToConcrete(rt) });
          break;
        }
        case "Return":
          if (s.expr && fn) {
            const rt = typeOf(s.expr, s.pos);
            const ft = fnRet(fn);
            if (ft !== "any" && !assignable(rt, ft))
              add("E_TYPE_MISMATCH", s.pos, { ctx: "ret", to: ft, from: litToConcrete(rt) });
          } else if (s.expr) {
            typeOf(s.expr, s.pos);
          }
          break;
        case "Call":
          typeOf(s.call, s.pos);
          break;
        case "Builtin":
          for (const p of s.parts) if (p.kind === "expr") typeOf(p.expr, s.pos);
          break;
        case "Dim":
          for (const d of s.decls) {
            nameType(d.name, s.pos); // 配列名も型サフィックス必須
            d.dims.forEach((x) => typeOf(x, s.pos));
          }
          break;
        case "Global":
          for (const n of s.names) nameType(n, s.pos);
          break;
        case "If":
          typeOf(s.cond, s.pos);
          walk(s.then, fn);
          if (s.else) walk(s.else, fn);
          break;
        case "For":
          nameType(s.varName, s.pos); // ループ変数も型必須
          typeOf(s.from, s.pos);
          typeOf(s.to, s.pos);
          if (s.step) typeOf(s.step, s.pos);
          walk(s.body, fn);
          break;
        case "While":
          typeOf(s.cond, s.pos);
          walk(s.body, fn);
          break;
        case "On":
          if (s.arg) typeOf(s.arg, s.pos);
          break;
        default:
          break;
      }
    }
  };

  for (const f of program.functions) {
    for (const p of f.params) nameType(p.name, f.pos); // 仮引数の型必須
    walk(f.body, f);
  }
  walk(program.toplevel, undefined);

  return diags;
}
