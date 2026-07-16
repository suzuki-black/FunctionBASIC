// DO … LOOP → WhileBlock への desugar（AST→AST 前処理パス）。lowerSelect より前に走らせるので
// 下流（名前検査/CONST展開/畳み込み/型検査/emit）は DoLoop を一切見ない＝既存の While lowering・
// BREAK/CONTINUE ラベル・折り畳み・provenance(src)・最適化を丸ごと再利用する。
//
// 前判定 / 無限（ゼロコスト。素の While にするだけ）:
//   DO WHILE c … LOOP → While(c)
//   DO UNTIL c … LOOP → While(NOT c)
//   DO … LOOP        → While(1)   （BREAK で脱出）
// 後判定（最低1回実行し、CONTINUE は「LOOP 側の条件評価」へ戻る意味論）: 一時フラグを1つ使う。
//   DO … LOOP WHILE c →  __doN%=0 : While((__doN%=0) OR c){ __doN%=1 ; body }
//   DO … LOOP UNTIL c →  同上（c を NOT c に）
//   初回は __doN%=0 でガードが真になり必ず1回入る。以後 __doN%=1 なので LOOP 条件だけで判定。
//   CONTINUE は While の continue ラベル（本体末尾）へ飛び、ループ先頭で条件を再評価する。
import type { Program, Stmt, Expr, DoLoop, WhileBlock, LetStmt } from "../ast/nodes.ts";

export function lowerDo(program: Program): void {
  let counter = 0;
  const NOT = (e: Expr): Expr => ({ type: "Un", op: "NOT", operand: e });
  const num = (n: number): Expr => ({ type: "Num", value: n, raw: String(n) });
  const varRef = (name: string): Expr => ({ type: "Var", name });
  const letOf = (name: string, expr: Expr, pos: DoLoop["pos"]): LetStmt => ({
    type: "Let", target: { type: "Var", name }, expr, hadLet: false, pos,
  });

  const lowerDoLoop = (d: DoLoop): Stmt[] => {
    const body = lowerList(d.body);
    const t = d.test;
    // 前判定 / 無限
    if (!t || t.at === "pre") {
      const cond: Expr = !t ? num(1) : t.kind === "while" ? t.cond : NOT(t.cond);
      const wb: WhileBlock = { type: "While", cond, body, loopId: d.loopId, pos: d.pos };
      return [wb];
    }
    // 後判定: 一時フラグで「最低1回」と CONTINUE→条件 を両立
    const flag = `__do${counter++}%`;
    const cont: Expr = t.kind === "while" ? t.cond : NOT(t.cond);
    const enter: Expr = {
      type: "Bin", op: "OR",
      left: { type: "Bin", op: "=", left: varRef(flag), right: num(0) }, // 初回のみ真
      right: cont,
    };
    const wb: WhileBlock = {
      type: "While", cond: enter,
      body: [letOf(flag, num(1), d.pos), ...body],
      loopId: d.loopId, pos: d.pos,
    };
    return [letOf(flag, num(0), d.pos), wb];
  };

  const lowerStmt = (s: Stmt): Stmt[] => {
    switch (s.type) {
      case "DoLoop":
        return lowerDoLoop(s as DoLoop);
      case "If": {
        const ib = s as { then: Stmt[]; else?: Stmt[] };
        ib.then = lowerList(ib.then);
        if (ib.else) ib.else = lowerList(ib.else);
        return [s];
      }
      case "For":
      case "While":
      case "Event":
        (s as { body: Stmt[] }).body = lowerList((s as { body: Stmt[] }).body);
        return [s];
      case "Select": {
        const sb = s as { cases: { body: Stmt[] }[]; else?: Stmt[] };
        for (const c of sb.cases) c.body = lowerList(c.body);
        if (sb.else) sb.else = lowerList(sb.else);
        return [s];
      }
      default:
        return [s];
    }
  };
  const lowerList = (stmts: Stmt[]): Stmt[] => stmts.flatMap(lowerStmt);

  program.toplevel = lowerList(program.toplevel);
  for (const fn of program.functions) fn.body = lowerList(fn.body);
}
