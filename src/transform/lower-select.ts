// SELECT CASE → 「一時Let + ネストIfBlock連鎖」への desugar（AST→AST 前処理パス）。
// transform() の最初に走らせるため、下流（名前検査/CONST展開/畳み込み/型検査/emit）は
// SelectBlock を一切見ない＝既存の IF lowering・folding・provenance(src)・最適化を丸ごと再利用。
//
// 意味論: セレクタは一度だけ評価（一時変数へ退避）／フォールスルー無し／最初に一致した
// CASE のみ実行／CASE ELSE は else 連鎖の末尾。CASE 本体内の BREAK/CONTINUE は外側ループに係る
// （SELECT はループ境界ではなく、desugar 後は普通の IF なので既存挙動のまま）。
import { suffixOf } from "../ast/nodes.ts";
import type { Program, Stmt, Expr, SelectBlock, IfBlock, LetStmt, CaseTest } from "../ast/nodes.ts";

// セレクタ式の型サフィックスを構文的に推定（一時変数の型に使う）。
// STRICT では明示サフィックスが付くのでそれを使う。未指定の数値は単精度(!)を既定（整数値でも
// 誤差なく保持でき安全）。文字列が絡めば $。
function selSuffix(e: Expr): "%" | "!" | "#" | "$" {
  switch (e.type) {
    case "Str":
      return "$";
    case "Var":
    case "ArrayRef":
    case "CallExpr": {
      const s = suffixOf(e.name);
      return s === "" ? "!" : s;
    }
    case "Num":
      return "!";
    case "Group":
      return e.items.length === 1 ? selSuffix(e.items[0]) : "!";
    case "Un":
      return selSuffix(e.operand);
    case "Bin": {
      const l = selSuffix(e.left);
      const r = selSuffix(e.right);
      return l === "$" || r === "$" ? "$" : "!";
    }
    default:
      return "!";
  }
}

export function lowerSelect(program: Program): void {
  let counter = 0;
  const v = (name: string): Expr => ({ type: "Var", name });

  // 1つの CASE テストを条件式へ
  const testCond = (sel: Expr, t: CaseTest): Expr => {
    if (t.kind === "range")
      return {
        type: "Bin",
        op: "AND",
        left: { type: "Bin", op: ">=", left: sel, right: t.lo },
        right: { type: "Bin", op: "<=", left: sel, right: t.hi },
      };
    if (t.kind === "rel") return { type: "Bin", op: t.op, left: sel, right: t.expr };
    return { type: "Bin", op: "=", left: sel, right: t.expr }; // val
  };
  // CASE のテスト並び（複数）は OR 結合
  const clauseCond = (tmp: string, tests: CaseTest[]): Expr =>
    tests.map((t) => testCond(v(tmp), t)).reduce((a, b) => ({ type: "Bin", op: "OR", left: a, right: b }));

  const lowerStmt = (s: Stmt): Stmt[] => {
    switch (s.type) {
      case "Select": {
        const sb = s as SelectBlock;
        const tmp = `__sel${counter++}${selSuffix(sb.selector)}`;
        const letStmt: LetStmt = {
          type: "Let",
          target: { type: "Var", name: tmp },
          expr: sb.selector,
          hadLet: false,
          pos: sb.pos,
        };
        // 末尾（CASE ELSE）から先頭 CASE へ向けて else にネストして連鎖を作る
        let chain: Stmt[] | undefined = sb.else ? lowerList(sb.else) : undefined;
        for (let i = sb.cases.length - 1; i >= 0; i--) {
          const c = sb.cases[i];
          const ifb: IfBlock = {
            type: "If",
            cond: clauseCond(tmp, c.tests),
            then: lowerList(c.body),
            else: chain,
            pos: c.pos, // 行対応（#1）用に CASE 行を由来として持たせる
          };
          chain = [ifb];
        }
        return chain ? [letStmt, ...chain] : [letStmt];
      }
      case "If": {
        const ib = s as IfBlock;
        ib.then = lowerList(ib.then);
        if (ib.else) ib.else = lowerList(ib.else);
        return [ib];
      }
      case "For":
      case "While": {
        (s as { body: Stmt[] }).body = lowerList((s as { body: Stmt[] }).body);
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
