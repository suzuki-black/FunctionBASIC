// べき乗の強度低減（オプトイン）。X^2 → X*X のように、小さな整数べき乗を反復乗算へ展開する。
// MSX の ^ は EXP/LOG ベースで非常に遅いため、乗算化で大幅に高速化できる。
// 安全のため、底が「副作用なく安価に複製できる」スカラ変数または数値で、指数が 2〜4 の整数の
// ときだけ展開する。式中の配列参照(A(i)) はこの段階では CallExpr（配列/関数が未解決）であり、
// 関数呼び出しの底を複製すると二重評価になるため対象外（＝安全側）。
import type { Program, Stmt, Expr } from "../ast/nodes.ts";

const MIN_EXP = 2;
const MAX_EXP = 4;

// 底が複製してよい（副作用なし・安価）か。スカラ変数または数値のみ。
const simpleBase = (e: Expr): boolean => e.type === "Var" || e.type === "Num";

// 底を複製（共有参照を避けて独立ノードにする）。
function cloneBase(e: Expr): Expr {
  return e.type === "Num"
    ? { type: "Num", value: e.value, raw: e.raw }
    : { type: "Var", name: (e as Extract<Expr, { type: "Var" }>).name };
}

// 式を強度低減（子を先に処理した上で、自身が小整数べき乗なら反復乗算へ）。
export function reduceExpr(e: Expr): Expr {
  switch (e.type) {
    case "Un":
      e.operand = reduceExpr(e.operand);
      return e;
    case "Bin": {
      e.left = reduceExpr(e.left);
      e.right = reduceExpr(e.right);
      if (
        e.op === "^" &&
        e.right.type === "Num" &&
        Number.isInteger(e.right.value) &&
        e.right.value >= MIN_EXP &&
        e.right.value <= MAX_EXP &&
        simpleBase(e.left)
      ) {
        const n = e.right.value;
        let acc: Expr = cloneBase(e.left);
        for (let i = 1; i < n; i++) {
          acc = { type: "Bin", op: "*", left: acc, right: cloneBase(e.left) };
        }
        return acc;
      }
      return e;
    }
    case "Group":
      e.items = e.items.map(reduceExpr);
      return e;
    case "ArrayRef":
      e.indices = e.indices.map(reduceExpr);
      return e;
    case "CallExpr":
      e.args = e.args.map((a) => ({ ...a, expr: reduceExpr(a.expr) }));
      return e;
    default:
      return e; // Num / Str / Var
  }
}

function reduceStmts(stmts: Stmt[]): void {
  for (const s of stmts) {
    switch (s.type) {
      case "Let":
        if (s.target.type === "ArrayRef") s.target.indices = s.target.indices.map(reduceExpr);
        s.expr = reduceExpr(s.expr);
        break;
      case "For":
        s.from = reduceExpr(s.from);
        s.to = reduceExpr(s.to);
        if (s.step) s.step = reduceExpr(s.step);
        reduceStmts(s.body);
        break;
      case "While":
        s.cond = reduceExpr(s.cond);
        reduceStmts(s.body);
        break;
      case "If":
        s.cond = reduceExpr(s.cond);
        reduceStmts(s.then);
        if (s.else) reduceStmts(s.else);
        break;
      case "Return":
        if (s.expr) s.expr = reduceExpr(s.expr);
        break;
      case "Call":
        s.call.args = s.call.args.map((a) => ({ ...a, expr: reduceExpr(a.expr) }));
        break;
      case "Dim":
        for (const d of s.decls) d.dims = d.dims.map(reduceExpr);
        break;
      case "On":
        if (s.arg) s.arg = reduceExpr(s.arg);
        break;
      case "Builtin":
        for (const p of s.parts) if (p.kind === "expr") p.expr = reduceExpr(p.expr);
        break;
      default:
        break;
    }
  }
}

// プログラム全体のべき乗を強度低減する（破壊的）。
export function reduceStrengthProgram(program: Program): void {
  reduceStmts(program.toplevel);
  for (const fn of program.functions) reduceStmts(fn.body);
}
