// FOR の空範囲（コンパイル時に確定）を警告するパスの検証。
// MSX-BASIC は空範囲でも本体を1回実行するため、定数で空と分かるものを警告で拾う。
// コード生成は変えない（警告であってエラーではない＝コンパイルは通る）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const diagsOf = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return [...ld, ...pd, ...r.diagnostics];
};
const codes = (src: string, sev: "error" | "warning") =>
  diagsOf(src).filter((d) => d.severity === sev).map((d) => d.code);

test("定数で空の FOR（開始>終了）は警告（ただしエラーではない）", () => {
  const ds = diagsOf("FOR I=32 TO 31\nPRINT I\nNEXT\n");
  assert.ok(ds.some((d) => d.code === "W_FOR_EMPTY_RANGE" && d.severity === "warning"), "空範囲警告が出る");
  assert.equal(ds.filter((d) => d.severity === "error").length, 0, "エラーにはしない（コンパイルは通る）");
});

test("非空の FOR（0 TO 5）は警告なし", () => {
  assert.deepEqual(codes("FOR I=0 TO 5\nPRINT I\nNEXT\n", "warning").filter((c) => c === "W_FOR_EMPTY_RANGE"), []);
});

test("負ステップで非空（5 TO 0 STEP -1）は警告なし", () => {
  assert.deepEqual(codes("FOR I=5 TO 0 STEP 0-1\nPRINT I\nNEXT\n", "warning").filter((c) => c === "W_FOR_EMPTY_RANGE"), []);
});

test("負ステップで空（0 TO 5 STEP -1）は警告", () => {
  assert.ok(codes("FOR I=0 TO 5 STEP 0-1\nPRINT I\nNEXT\n", "warning").includes("W_FOR_EMPTY_RANGE"));
});

test("CONST 由来で空と確定する範囲も警告（インライン後）", () => {
  const src = "CONST N% = 32\nFOR I%=N% TO 31\nPRINT I%\nNEXT\n";
  assert.ok(codes(src, "warning").includes("W_FOR_EMPTY_RANGE"));
});

test("境界が実行時変数なら畳めないので警告しない（FOR I=N% TO 31, N%はパラメータ）", () => {
  const src = [
    "FUNCTION HIDEFROM(FROMN%)",
    "    FOR HI% = FROMN% TO 31",
    "        PRINT HI%",
    "    NEXT HI%",
    "END FUNCTION",
    "HIDEFROM(0)",
  ].join("\n");
  assert.deepEqual(codes(src, "warning").filter((c) => c === "W_FOR_EMPTY_RANGE"), []);
});
