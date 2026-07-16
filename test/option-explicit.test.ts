// OPTION EXPLICIT：一度も代入・宣言されないスカラ変数の READ をエラーにする（タイポ検出）。
// FunctionBASIC は未宣言スカラを代入で暗黙生成する（未宣言でも 0）ため、綴り間違いが黙って
// 0 になる。check-explicit パスで検査（OPTION EXPLICIT 宣言時のみ）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

function errCodes(src: string, opts = {}) {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program, opts);
  return [...pd, ...r.diagnostics].filter((d) => d.severity === "error").map((d) => d.code);
}

test("OPTION EXPLICIT: 未宣言スカラの読取（タイポ）を E_UNDECLARED_VAR に", () => {
  // ユーザーが実際に踏んだケース：RADIUS を入力し RADUIS（綴り違い）で計算 → 黙って 0
  assert.deepEqual(
    errCodes(`OPTION EXPLICIT
INPUT RADIUS
CIRCUMFERENCE = RADUIS * 2 * 3.14
PRINT "c="; CIRCUMFERENCE`),
    ["E_UNDECLARED_VAR"],
  );
});

test("OPTION EXPLICIT: 正しく綴れば通る", () => {
  assert.equal(
    errCodes(`OPTION EXPLICIT
INPUT RADIUS
CIRCUMFERENCE = RADIUS * 2 * 3.14
PRINT CIRCUMFERENCE`).length,
    0,
  );
});

test("OPTION EXPLICIT 無し: 検査しない（既存コードは無傷）", () => {
  assert.equal(
    errCodes(`INPUT RADIUS
CIRCUMFERENCE = RADUIS * 2 * 3.14
PRINT CIRCUMFERENCE`).length,
    0,
  );
});

test("OPTION EXPLICIT: 関数ローカルのタイポも検出", () => {
  assert.deepEqual(
    errCodes(`OPTION EXPLICIT
FUNCTION F(A%)
    RETURN A% + B%
END FUNCTION
PRINT F(1)`),
    ["E_UNDECLARED_VAR"],
  );
});

test("OPTION EXPLICIT: GLOBAL 宣言した変数は誤検出しない", () => {
  assert.equal(
    errCodes(`OPTION EXPLICIT
GLOBAL SCORE%
FUNCTION ADD()
    GLOBAL SCORE%
    SCORE% = SCORE% + 1
END FUNCTION
SCORE% = 0
ADD()
PRINT SCORE%`).length,
    0,
  );
});

test("OPTION EXPLICIT: FOR 変数 / INPUT・READ 対象は宣言扱い", () => {
  assert.equal(
    errCodes(`OPTION EXPLICIT
DIM A%(3)
FOR I% = 0 TO 3
    A%(I%) = I%
NEXT
INPUT NAME$
READ K%
PRINT A%(2); NAME$; K%
DATA 7`).length,
    0,
  );
});

test("OPTION EXPLICIT: 配列添字のタイポも検出", () => {
  // A(J%) で J% が未宣言 → 添字の読取として検出
  assert.deepEqual(
    errCodes(`OPTION EXPLICIT
DIM A%(3)
A%(1) = 5
PRINT A%(J%)`),
    ["E_UNDECLARED_VAR"],
  );
});

test("OPTION EXPLICIT: 同名の未宣言はスコープ内で1回だけ報告", () => {
  const codes = errCodes(`OPTION EXPLICIT
X% = BADVAR% + BADVAR% + BADVAR%
PRINT X%`);
  assert.deepEqual(codes, ["E_UNDECLARED_VAR"]);
});

test("OPTION EXPLICIT: MACRO 展開後の読取も検査（本体の未宣言参照）", () => {
  // マクロ本体が未宣言のグローバルを参照 → 展開後に検出
  assert.ok(
    errCodes(`OPTION EXPLICIT
MACRO SCALED(V) = (V) * MISSING_GAIN%
GLOBAL Y%
Y% = SCALED(10)`).includes("E_UNDECLARED_VAR"),
  );
});

test("未知の OPTION は E_OPTION_UNKNOWN（余分な構文エラーを出さない）", () => {
  assert.deepEqual(errCodes(`OPTION FOO
PRINT 1`), ["E_OPTION_UNKNOWN"]);
});
