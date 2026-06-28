// べき乗の強度低減（オプトイン）の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string, strengthReduce = false, optimize = false) => {
  const { tokens } = tokenize(src);
  const { program } = parse(tokens);
  const r = transform(program, { strengthReduce, optimize });
  return renderMsx(r.code).replace(/\r/g, "");
};

test("既定(OFF)では ^ のまま", () => {
  assert.match(compile("A=X^2\n"), /A=[A-Z]+\^2/);
});

test("ON: X^2→X*X, X^4→X*X*X*X（スカラ変数）", () => {
  assert.match(compile("A=X^2\n", true), /A=([A-Z]+)\*\1/);
  assert.match(compile("A=X^4\n", true), /A=([A-Z]+)\*\1\*\1\*\1/);
});

test("ON: 指数5以上は展開しない（^のまま）", () => {
  assert.match(compile("A=X^5\n", true), /\^5/);
});

test("ON: 関数/配列の底（CallExpr）は二重評価回避のため展開しない", () => {
  assert.match(compile("A=SIN(X)^2\n", true), /SIN\([A-Z]+\)\^2/);
  assert.match(compile("A=B(I)^2\n", true), /\^2/); // 配列/関数未解決の底は対象外
});

test("ON: 複雑な底は展開しない", () => {
  assert.match(compile("A=(X+1)^2\n", true), /\^2/);
});

test("ON: 負指数・非整数指数は展開しない", () => {
  assert.match(compile("A=X^-2\n", true), /\^-2|\^\(-2\)/);
});

test("ON: 加算項の中でも展開（優先順位は保たれる）", () => {
  assert.match(compile("A=Y+X^2\n", true), /A=[A-Z]+\+([A-Z]+)\*\1/);
});

test("畳み込みと併用: 定数べき乗は畳み込みが先に処理", () => {
  assert.match(compile("A=2^3\n", true, true), /A=8/);
});
