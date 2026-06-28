// 定数畳み込み最適化（オプトイン）。式中の定数部分式だけを安全に畳む（部分畳み込み）。
// CONST のインライン用 fold（全か無か）とは別物で、X*2+3*4 → X*2+12 のように残せる部分は残す。
// MSX 実機との差異を避けるためのガード：
//  - 指数表記になる/有効桁が多すぎる浮動小数結果は畳まない（誤差膨張を出さない）。
//  - 整数演算(\ MOD AND OR XOR EQV IMP NOT)は被演算子が16bit整数域のときだけ畳む。
//  - 0 除算は畳まない（実行時エラーをそのまま残す）。
import type { Program, Stmt, Expr } from "../ast/nodes.ts";

const INT_MIN = -32768;
const INT_MAX = 32767;
const isInt16 = (n: number): boolean => Number.isInteger(n) && n >= INT_MIN && n <= INT_MAX;

// 数値リテラルの raw を作る。畳むと不利/危険な値は null（=畳まない）。
function fmtNum(v: number): string | null {
  if (!isFinite(v)) return null;
  if (Number.isInteger(v)) return String(v);
  const s = String(v);
  if (/[eE]/.test(s)) return null; // 指数表記は MSX 表記差を生むので避ける
  if (s.replace(/[-.]/g, "").length > 9) return null; // 浮動小数の誤差膨張を避ける
  return s;
}
const numLit = (v: number): Expr | null => {
  const raw = fmtNum(v);
  return raw == null ? null : { type: "Num", value: v, raw };
};
const strLit = (v: string): Expr => ({ type: "Str", value: v });

// 式を部分畳み込み（破壊的に子を畳んだ上で、可能なら自身をリテラル化）。
export function foldExpr(e: Expr): Expr {
  switch (e.type) {
    case "Un": {
      const x = foldExpr(e.operand);
      e.operand = x;
      if (x.type === "Num") {
        if (e.op === "-") return numLit(-x.value) ?? e;
        if (e.op === "+") return numLit(x.value) ?? e;
        if (e.op === "NOT") return isInt16(x.value) ? (numLit(~x.value) ?? e) : e;
      }
      return e;
    }
    case "Bin": {
      const l = foldExpr(e.left);
      const r = foldExpr(e.right);
      e.left = l;
      e.right = r;
      if (l.type === "Str" && r.type === "Str" && e.op === "+") return strLit(l.value + r.value);
      if (l.type !== "Num" || r.type !== "Num") return e;
      const a = l.value, b = r.value;
      const bothInt = isInt16(a) && isInt16(b);
      switch (e.op) {
        case "+": return numLit(a + b) ?? e;
        case "-": return numLit(a - b) ?? e;
        case "*": return numLit(a * b) ?? e;
        case "/": return b === 0 ? e : (numLit(a / b) ?? e); // 0除算は残す
        case "^": return numLit(a ** b) ?? e;
        case "\\": return bothInt && b !== 0 ? (numLit(Math.trunc(a / b)) ?? e) : e;
        case "MOD": return bothInt && b !== 0 ? (numLit(a % b) ?? e) : e;
        case "AND": return bothInt ? (numLit(a & b) ?? e) : e;
        case "OR": return bothInt ? (numLit(a | b) ?? e) : e;
        case "XOR": return bothInt ? (numLit(a ^ b) ?? e) : e;
        case "EQV": return bothInt ? (numLit(~(a ^ b)) ?? e) : e;
        case "IMP": return bothInt ? (numLit(~a | b) ?? e) : e;
        default: return e; // 比較演算子は対象外（v1）
      }
    }
    case "Group":
      e.items = e.items.map(foldExpr);
      return e;
    case "ArrayRef":
      e.indices = e.indices.map(foldExpr);
      return e;
    case "CallExpr":
      e.args = e.args.map((a) => ({ ...a, expr: foldExpr(a.expr) }));
      return e;
    default:
      return e; // Num / Str / Var
  }
}

// 文配下の全式を畳む（破壊的）。
function foldStmts(stmts: Stmt[]): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Let":
        if (s.target.type === "ArrayRef") s.target.indices = s.target.indices.map(foldExpr);
        s.expr = foldExpr(s.expr);
        break;
      case "For":
        s.from = foldExpr(s.from);
        s.to = foldExpr(s.to);
        if (s.step) s.step = foldExpr(s.step);
        foldStmts(s.body);
        break;
      case "While":
        s.cond = foldExpr(s.cond);
        foldStmts(s.body);
        break;
      case "If":
        s.cond = foldExpr(s.cond);
        foldStmts(s.then);
        if (s.else) foldStmts(s.else);
        break;
      case "Return":
        if (s.expr) s.expr = foldExpr(s.expr);
        break;
      case "Call":
        s.call.args = s.call.args.map((a) => ({ ...a, expr: foldExpr(a.expr) }));
        break;
      case "Dim":
        for (const d of s.decls) d.dims = d.dims.map(foldExpr);
        break;
      case "On":
        if (s.arg) s.arg = foldExpr(s.arg);
        break;
      case "Builtin":
        for (const p of s.parts) if (p.kind === "expr") p.expr = foldExpr(p.expr);
        break;
      default:
        break;
    }
  }
}

// プログラム全体の式を定数畳み込みする（破壊的）。
export function foldProgram(program: Program): void {
  foldStmts(program.toplevel);
  for (const fn of program.functions) foldStmts(fn.body);
}
