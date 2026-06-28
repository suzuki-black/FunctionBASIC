// 変数名と組み込み名の衝突検出（E_NAME_IS_BUILTIN）の検証。
// 「黙って誤変換しない」: POS 等の純粋な組み込み関数名を変数に使ったら弾く。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const errs = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "error").map((d) => d.code);
};
const hasBuiltinErr = (src: string) => errs(src).includes("E_NAME_IS_BUILTIN");

test("純粋な組み込み関数名を裸の変数に使うとエラー（POS/LEN/POINT…）", () => {
  assert.ok(hasBuiltinErr("X=POS\n"));
  assert.ok(hasBuiltinErr("X=LEN\n"));
  assert.ok(hasBuiltinErr("X=POINT\n"));
});

test("代入先・FORループ変数・引数名でも検出", () => {
  assert.ok(hasBuiltinErr("LEN=5\n"));
  assert.ok(hasBuiltinErr("FOR POS=1 TO 3\nNEXT\n"));
  assert.ok(hasBuiltinErr("FUNCTION F(POS)\nRETURN POS\nEND FUNCTION\nPRINT F(1)\n"));
});

test("正しい関数呼び出し POS(0) はエラーにしない", () => {
  assert.ok(!hasBuiltinErr("X=POS(0)\n"));
  assert.ok(!hasBuiltinErr("X=LEN(A$)\n"));
});

test("裸で読めるシステム変数は許可（INKEY$/TIME/CSRLIN/ERR/ERL）", () => {
  assert.ok(!hasBuiltinErr("K$=INKEY$\n"));
  assert.ok(!hasBuiltinErr("T=TIME\n"));
  assert.ok(!hasBuiltinErr("R=CSRLIN\n"));
  assert.ok(!hasBuiltinErr("TIME=0\n")); // TIME は代入可
});

test("命令・二面名のサブキーワードは誤検出しない（PUT SPRITE / STRIG ON / SPRITE$(n)=）", () => {
  assert.ok(!hasBuiltinErr("PUT SPRITE 0,(10,20),7\n"));
  assert.ok(!hasBuiltinErr("STRIG(0) ON\n"));
  assert.ok(!hasBuiltinErr('SPRITE$(0)=STRING$(8,255)\n'));
});

test("POS を REF 実引数・PRINT に使う旧サンプルはエラーになる（回帰）", () => {
  const src = 'FUNCTION FIND_ZERO(REF IDX)\nGLOBAL A\nFOR I=1 TO 10\nIF A(I)=0 THEN\nIDX=I\nRETURN 1\nEND IF\nNEXT I\nRETURN 0\nEND FUNCTION\nDIM A(10)\nA(3)=0\nR=FIND_ZERO(POS)\nPRINT "AT ";POS\n';
  assert.ok(hasBuiltinErr(src));
});
