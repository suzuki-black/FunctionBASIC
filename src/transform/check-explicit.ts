// OPTION EXPLICIT: 「一度も代入・宣言されないスカラ変数の READ」をエラーにする（宣言強制）。
// FunctionBASIC はスカラ変数を代入で暗黙生成する（未宣言でも 0）ため、`RADUIS` のような綴り
// 間違いが黙って 0 になる。これを静的に捕まえる。配列/関数名のタイポは呼び出し解決
// （E_UNKNOWN_FUNCTION 等）で既に捕まるので、ここではスカラ（Var ノード）の読取だけを見る。
//
// スコープ単位（トップレベル／各 FUNCTION）で「宣言/書込みされた名前」を集め、その集合に
// 無い名前の READ を報告する。式ノードは位置を持たないので、含む文の位置で報告する。
// expandMacros の後・lowerStruct の前に走らせる（マクロ展開後の読取も対象／STRUCT フィールドは
// まだ Field ノードで、インスタンス名は DIM 済みなのでここでは触らない）。
import type { Program, Stmt, Expr, LValue, Position } from "../ast/nodes.ts";
import type { Diagnostic } from "../core/diagnostics.ts";
import { error } from "../core/diagnostics.ts";

// 変数へ書き込む組み込み命令（その Var 引数は代入対象＝宣言扱い、READ 検査しない）。
const WRITE_BUILTINS = new Set(["INPUT", "LINE INPUT", "LINEINPUT", "READ", "GET", "SWAP"]);

export function checkExplicit(program: Program): Diagnostic[] {
  if (!program.optionExplicit) return [];
  const diags: Diagnostic[] = [];

  const checkScope = (stmts: Stmt[], params: string[]): void => {
    const declared = new Set<string>(params);

    // pass 1: このスコープで宣言/書込みされる全名前を集める
    const collect = (ss: Stmt[]): void => {
      for (const s of ss) {
        switch (s.type) {
          case "Let": if (s.target.type === "Var") declared.add(s.target.name); break;
          case "For": declared.add(s.varName); collect(s.body); break;
          case "Dim": for (const d of s.decls) declared.add(d.name); break;
          case "Global": for (const n of s.names) declared.add(n); break;
          case "Const": declared.add(s.name); break;
          case "ReadInto": for (const t of s.targets) if (t.type === "Var") declared.add(t.name); break;
          case "If": collect(s.then); if (s.else) collect(s.else); break;
          case "While": collect(s.body); break;
          case "Event": collect(s.body); break;
          case "Builtin":
            if (WRITE_BUILTINS.has(s.name.toUpperCase()))
              for (const p of s.parts) if (p.kind === "expr" && p.expr.type === "Var") declared.add(p.expr.name);
            break;
        }
      }
    };
    collect(stmts);

    // pass 2: READ を検査（未宣言のスカラ Var を報告）
    const seen = new Set<string>(); // 同名の重複報告を抑制（スコープ内で1回）
    const readExpr = (e: Expr | undefined, pos: Position): void => {
      if (!e) return;
      switch (e.type) {
        case "Var":
          if (!declared.has(e.name) && !seen.has(e.name)) {
            seen.add(e.name);
            diags.push(error("E_UNDECLARED_VAR", pos, { name: e.name }));
          }
          break;
        case "ArrayRef": e.indices.forEach((x) => readExpr(x, pos)); break; // 配列名は既存解決で検査
        case "Field": e.indices.forEach((x) => readExpr(x, pos)); break;    // フィールドは lowerStruct が検査
        case "Bin": readExpr(e.left, pos); readExpr(e.right, pos); break;
        case "Un": readExpr(e.operand, pos); break;
        case "Group": e.items.forEach((x) => readExpr(x, pos)); break;
        case "CallExpr": e.args.forEach((a) => readExpr(a.expr, pos)); break; // 呼び名は関数/配列/マクロ
      }
    };
    const targetIndices = (lv: LValue, pos: Position): void => {
      if (lv.type === "ArrayRef" || lv.type === "Field") lv.indices.forEach((x) => readExpr(x, pos));
    };
    const readStmts = (ss: Stmt[]): void => {
      for (const s of ss) {
        switch (s.type) {
          case "Let": targetIndices(s.target, s.pos); readExpr(s.expr, s.pos); break;
          case "Dim": for (const d of s.decls) d.dims.forEach((x) => readExpr(x, s.pos)); break;
          case "For": readExpr(s.from, s.pos); readExpr(s.to, s.pos); readExpr(s.step, s.pos); readStmts(s.body); break;
          case "If": readExpr(s.cond, s.pos); readStmts(s.then); if (s.else) readStmts(s.else); break;
          case "While": readExpr(s.cond, s.pos); readStmts(s.body); break;
          case "Return": readExpr(s.expr, s.pos); break;
          case "Call": s.call.args.forEach((a) => readExpr(a.expr, s.pos)); break;
          case "On": readExpr(s.arg, s.pos); break;
          case "Event": readExpr(s.arg, s.pos); readStmts(s.body); break;
          case "Builtin": {
            const isWrite = WRITE_BUILTINS.has(s.name.toUpperCase());
            for (const p of s.parts)
              if (p.kind === "expr") {
                if (isWrite && p.expr.type === "Var") continue; // 書込み対象は READ 検査しない
                readExpr(p.expr, s.pos);
              }
            break;
          }
        }
      }
    };
    readStmts(stmts);
  };

  checkScope(program.toplevel, []);
  for (const fn of program.functions) checkScope(fn.body, fn.params.map((p) => p.name));
  return diags;
}
