// 変数名と組み込み（命令/関数）名の衝突検出。
// MSX では POS / LEN / SIN … は予約された関数名で、裸の識別子として変数に使うと実機で
// Syntax error になる。本ツールは「黙って誤変換しない」方針なので、スカラ変数として
// 組み込み名を使ったら E_NAME_IS_BUILTIN で明示する。
//   - 正しい関数呼び出し POS(0) は CallExpr、SPRITE$(n)= は ArrayRef なので対象外（合法）。
//   - INKEY$ / TIME / CSRLIN / ERR / ERL の裸読みは許可（システム変数）。代入は TIME のみ許可。
import type { Program, Stmt, Expr, FunctionDef, LValue } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";
import {
  isBuiltin, isBuiltinFunction, isBuiltinStatement, isBareReadBuiltin, isAssignableBuiltin,
} from "../core/builtins.ts";

// 衝突対象＝「純粋な組み込み関数名」（POS/LEN/SIN/MID$ 等。引数必須で裸では使えない）。
// 命令と二面を持つ名前（SPRITE/STRIG/TIME/PLAY 等）は文法上のサブキーワードとして裸で
// 現れるため対象外（PUT SPRITE / STRIG ON など合法）。
const collides = (name: string): boolean =>
  isBuiltinFunction(name) && !isBuiltinStatement(name);

export function checkNameCollisions(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const at = (name: string, pos: { line: number; column: number }) =>
    diags.push(error("E_NAME_IS_BUILTIN", pos, { name }));

  // 式中のスカラ Var 読みを検査（ArrayRef 名・CallExpr 名は対象外＝合法な組み込み用法）。
  const readExpr = (e: Expr, pos: any): void => {
    switch (e.type) {
      case "Var":
        if (collides(e.name) && !isBareReadBuiltin(e.name)) at(e.name, pos);
        break;
      case "Un": readExpr(e.operand, pos); break;
      case "Bin": readExpr(e.left, pos); readExpr(e.right, pos); break;
      case "Group": e.items.forEach((x) => readExpr(x, pos)); break;
      case "ArrayRef": e.indices.forEach((x) => readExpr(x, pos)); break; // 添字は読み。名前は配列なので除外
      case "CallExpr": e.args.forEach((a) => readExpr(a.expr, pos)); break; // 引数は読み。名前は呼び出しなので除外
      default: break; // Num / Str
    }
  };
  // 代入先（スカラ）を検査。ArrayRef 先（SPRITE$(n)= 等）は合法なので対象外。
  const writeTarget = (lv: LValue, pos: any): void => {
    if (lv.type === "Var") {
      if (collides(lv.name) && !isAssignableBuiltin(lv.name)) at(lv.name, pos);
    } else {
      lv.indices.forEach((x) => readExpr(x, pos)); // 添字は読み
    }
  };

  const walk = (stmts: Stmt[]): void => {
    for (const s of stmts) {
      const pos = (s as any).pos ?? { line: 0, column: 0 };
      switch (s.type) {
        case "Let":
          writeTarget(s.target, pos);
          readExpr(s.expr, pos);
          break;
        case "Const":
          readExpr(s.expr, pos);
          break;
        case "For":
          if (collides(s.varName) && !isAssignableBuiltin(s.varName)) at(s.varName, pos);
          readExpr(s.from, pos);
          readExpr(s.to, pos);
          if (s.step) readExpr(s.step, pos);
          walk(s.body);
          break;
        case "While":
          readExpr(s.cond, pos);
          walk(s.body);
          break;
        case "If":
          readExpr(s.cond, pos);
          walk(s.then);
          if (s.else) walk(s.else);
          break;
        case "Return":
          if (s.expr) readExpr(s.expr, pos);
          break;
        case "Call":
          s.call.args.forEach((a) => readExpr(a.expr, pos));
          break;
        case "Dim":
          for (const d of s.decls) {
            if (collides(d.name)) at(d.name, pos); // DIM POS(10) 等（組み込み名は配列にできない）
            d.dims.forEach((x) => readExpr(x, pos));
          }
          break;
        case "On":
          if (s.arg) readExpr(s.arg, pos);
          break;
        case "Builtin":
          for (const p of s.parts) if (p.kind === "expr") readExpr(p.expr, pos);
          break;
        default:
          break;
      }
    }
  };

  // 関数名・引数名の検査。関数名は呼び出しが組み込みと曖昧化する（FUNCTION LEN() が
  // 組み込み LEN を隠す）ため、命令/関数いずれの組み込み名も不可（isBuiltin）。
  const checkFunc = (fn: FunctionDef): void => {
    if (isBuiltin(fn.name)) at(fn.name, fn.pos);
    for (const p of fn.params) if (collides(p.name)) at(p.name, fn.pos);
  };

  walk(program.toplevel);
  for (const fn of program.functions) {
    checkFunc(fn);
    walk(fn.body);
  }
  return diags;
}
