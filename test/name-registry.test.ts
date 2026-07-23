// 統一名前レジストリ: FUNCTION/MACRO/STRUCT型名/CONST/DATASET/SPRITE のクロス種別衝突を
// 一貫して E_NAME_COLLISION で報告する。同種の重複は各既存チェック（E_DUP_FUNCTION 等）が担当。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const codes = (src: string) => {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program, {});
  return [...pd, ...r.diagnostics].filter((d) => d.severity === "error").map((d) => d.code);
};
const SP8 = Array.from({ length: 8 }, () => `    "########"`).join("\n"); // 8x8 スプライト本体

test("クロス種別の同名は E_NAME_COLLISION", () => {
  assert.deepEqual(codes(`STRUCT T\n  X%\nEND STRUCT\nFUNCTION T()\n  RETURN 1\nEND FUNCTION`), ["E_NAME_COLLISION"]);
  assert.deepEqual(codes(`STRUCT U\n  X%\nEND STRUCT\nMACRO U(A)=A\nB=U(1)`), ["E_NAME_COLLISION"]);
  assert.deepEqual(codes(`CONST FOO = 5\nFUNCTION FOO()\n  RETURN 1\nEND FUNCTION`), ["E_NAME_COLLISION"]);
  assert.deepEqual(codes(`CONST C = 5\nMACRO C(X)=X\nD=C(1)`), ["E_NAME_COLLISION"]);
  assert.deepEqual(codes(`DATASET NM\n  DATA 1,2\nEND DATASET\nSPRITE NM\n${SP8}\nEND SPRITE`), ["E_NAME_COLLISION"]);
});

test("MACRO×FUNCTION は E_NAME_COLLISION 単一（E_MACRO_DUP と二重報告しない）", () => {
  const c = codes(`MACRO G(X)=X\nFUNCTION G()\n  RETURN 1\nEND FUNCTION\nA=G(1)`);
  assert.deepEqual(c, ["E_NAME_COLLISION"]);
});

test("同種の重複は既存コードのまま（レジストリで二重にしない）", () => {
  assert.deepEqual(codes(`FUNCTION F()\n  RETURN 1\nEND FUNCTION\nFUNCTION F()\n  RETURN 2\nEND FUNCTION`), ["E_DUP_FUNCTION"]);
  assert.deepEqual(codes(`MACRO M(X)=X\nMACRO M(Y)=Y\nA=M(1)`), ["E_MACRO_DUP"]);
  assert.deepEqual(codes(`STRUCT S\n  X%\nEND STRUCT\nSTRUCT S\n  Y%\nEND STRUCT`), ["E_STRUCT_DUP"]);
});

test("偽陽性を出さない（別サフィックスCONST・ローカルスコープ・単独宣言）", () => {
  assert.deepEqual(codes(`CONST N% = 1\nCONST N! = 2.0\nPRINT N%`), []); // N%/N! は別物
  assert.deepEqual(codes(`FUNCTION G()\n  RETURN 1\nEND FUNCTION\nFUNCTION H()\n  CONST G = 5\n  RETURN G\nEND FUNCTION`), []); // ローカルCONSTはスコープ別
  assert.deepEqual(codes(`FUNCTION F()\n  RETURN 1\nEND FUNCTION\nA=F()`), []);
  assert.deepEqual(codes(`STRUCT S\n  X%\nEND STRUCT\nDIM P AS S\nP.X%=1`), []); // 型名とインスタンス名は別
});
