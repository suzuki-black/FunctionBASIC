// MACRO name(params)=expr：コンパイル時インライン展開（ゼロコスト）。expand-macros パスで
// 呼び出し name(args) を本体式（実引数を代入）へ置換。GOSUB/関数呼び出しを生成しない。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

function compile(src: string, opts = {}) {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program, opts);
  return { code: r.code, text: renderMsx(r.code), diags: [...pd, ...r.diagnostics] };
}
const errCodes = (src: string, opts = {}) =>
  compile(src, opts).diags.filter((d) => d.severity === "error").map((d) => d.code);

test("MACRO: 基本の展開（呼び出しを本体式に置換）", () => {
  const { text, diags } = compile(`GLOBAL Y%
MACRO SQ(X) = X * X
Y% = SQ(3)`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /=\(+3\)+\*\(+3\)+/); // (3)*(3) 相当（括弧の数は問わない）
  assert.doesNotMatch(text, /GOSUB|DEF ?FN/); // 呼び出しコードを生成しない（ゼロコスト）
});

test("MACRO: 実引数は括弧で包まれ優先順位事故が起きない", () => {
  const { text } = compile(`GLOBAL Z%
MACRO DBL(X) = X + X
Z% = DBL(1 + 2) * 10`);
  // (1+2) が二回、外側 *10 が保たれる（(1+2)+(1+2) が先、その後 *10）
  assert.match(text, /\(1\+2\)\+\(1\+2\)\)\*10/);
});

test("MACRO: 複数引数", () => {
  const { diags, text } = compile(`GLOBAL R%
MACRO LERP(A, B, T) = A + (B - A) * T
R% = LERP(0, 100, 1)`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /100/);
});

test("MACRO: マクロ本体が別マクロを呼べる（入れ子展開）", () => {
  const { diags, text } = compile(`GLOBAL S%
MACRO SQ(X) = X * X
MACRO SUMSQ(A, B) = SQ(A) + SQ(B)
S% = SUMSQ(3, 4)`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /3/);
  assert.match(text, /4/);
  assert.doesNotMatch(text, /SQ|SUMSQ/); // 展開済みで呼び名は残らない
});

test("MACRO: 0 引数（NAME() で呼ぶ）", () => {
  const { text, diags } = compile(`GLOBAL T%
MACRO TWO() = 2
T% = TWO() + TWO()`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /\(2\)\+\(2\)/);
});

test("MACRO: 前方参照（使用より後に定義してよい）", () => {
  const { diags } = compile(`GLOBAL Y%
Y% = SQ(5)
MACRO SQ(X) = X * X`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
});

test("MACRO: 関数本体の中でも展開される", () => {
  const { text, diags } = compile(`MACRO SQ(X) = X * X
FUNCTION HYP2%(A%, B%)
    RETURN SQ(A%) + SQ(B%)
END FUNCTION
GLOBAL R%
R% = HYP2%(3, 4)`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.doesNotMatch(text, /\bSQ\b/); // 関数内でも SQ は展開済み
});

test("MACRO: 引数の数が違う → E_MACRO_ARITY", () => {
  assert.deepEqual(
    errCodes(`GLOBAL Y%
MACRO SQ(X) = X * X
Y% = SQ(1, 2)`),
    ["E_MACRO_ARITY"],
  );
});

test("MACRO: 自己再帰 → E_MACRO_RECURSION", () => {
  assert.ok(errCodes(`GLOBAL Y%
MACRO R(X) = R(X) + 1
Y% = R(1)`).includes("E_MACRO_RECURSION"));
});

test("MACRO: 相互再帰 → E_MACRO_RECURSION", () => {
  assert.ok(errCodes(`GLOBAL Y%
MACRO A(X) = B(X) + 1
MACRO B(X) = A(X) + 1
Y% = A(1)`).includes("E_MACRO_RECURSION"));
});

test("MACRO: 名前重複 → E_MACRO_DUP", () => {
  assert.ok(errCodes(`GLOBAL Y%
MACRO SQ(X) = X * X
MACRO SQ(X) = X + X
Y% = SQ(1)`).includes("E_MACRO_DUP"));
});

test("MACRO: マクロは MSX 変数/行を一切生成しない（ゼロコスト）", () => {
  const { code } = compile(`GLOBAL Y%
MACRO SQ(X) = X * X
Y% = SQ(3)`);
  // 出力は Y% への代入 1 行のみ（＋MAIN見出し/END）。マクロ用の定義行は無い。
  const real = code.filter((l) => l.text && !l.text.startsWith("'") && l.text !== "END");
  assert.equal(real.length, 1, "本体は代入 1 行だけ");
});
