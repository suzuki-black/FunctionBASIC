// FOR の範囲が「コンパイル時に空と確定する」場合だけ警告するパス。
// MSX-BASIC の FOR は限界判定が NEXT 側（下側判定）なので、開始>終了（正ステップ）/
// 開始<終了（負ステップ）の空範囲でも本体を必ず1回実行する。構造化言語の直感（0回）と
// 食い違い、範囲外アクセス等の静かなバグになりやすい（例: FOR I=32 TO 31 が PUT SPRITE 32 を
// 1回実行してクラッシュ）。コード生成は一切変えず（透明性維持）、定数で空と確定するものだけ
// 警告する。境界が実行時変数のもの（FOR I=N% TO 31 等）は畳めないので対象外＝各自ガードする。
import type { Program, Stmt, Expr } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { warning } from "../core/diagnostics.ts";

// 定数式の数値評価。畳めなければ null（＝実行時値なので判定しない）。
function evalNum(e: Expr): number | null {
  switch (e.type) {
    case "Num": return e.value;
    case "Group": return e.items.length === 1 ? evalNum(e.items[0]) : null;
    case "Un": {
      const v = evalNum(e.operand);
      if (v == null) return null;
      return e.op === "-" ? -v : e.op === "+" ? v : e.op === "NOT" ? ~v : null;
    }
    case "Bin": {
      const l = evalNum(e.left), r = evalNum(e.right);
      if (l == null || r == null) return null;
      switch (e.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? null : l / r;
        case "\\": return r === 0 ? null : Math.trunc(l / r);
        case "MOD": return r === 0 ? null : l % r;
        case "^": return l ** r;
        case "AND": return l & r;
        case "OR": return l | r;
        case "XOR": return l ^ r;
        default: return null;
      }
    }
    default: return null;
  }
}

export function checkForRanges(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const walk = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.type === "For") {
        const from = evalNum(s.from);
        const to = evalNum(s.to);
        const step = s.step ? evalNum(s.step) : 1;
        // 三値とも定数で確定し、ステップが 0 でない場合のみ空判定できる。
        if (from != null && to != null && step != null && step !== 0) {
          const empty = step > 0 ? from > to : from < to;
          if (empty) {
            const stepTxt = s.step && step !== 1 ? ` STEP ${step}` : "";
            diags.push(warning("W_FOR_EMPTY_RANGE", s.pos, { range: `${s.varName}=${from} TO ${to}${stepTxt}` }));
          }
        }
        walk(s.body);
      } else if (s.type === "If") {
        walk(s.then);
        if (s.else) walk(s.else);
      } else if (s.type === "While") {
        walk(s.body);
      }
    }
  };
  walk(program.toplevel);
  for (const fn of program.functions) walk(fn.body);
  return diags;
}
