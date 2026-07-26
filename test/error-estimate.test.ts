// MSX ランタイムエラーの原因推測エンジン（アルゴリズム・AIなし）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";
import { estimateError } from "../src/analyze/error-estimate.ts";

function build(src: string) {
  const { program } = parse(tokenize(src).tokens);
  return { code: transform(program, {}).code, srcLines: src.split("\n") };
}
const lineOf = (code: any[], re: RegExp) => code.find((l) => re.test(l.text)).lineNo;

test("IFC: CHR$ の行で 0〜255 制約を候補提示＋由来ソース行", () => {
  const { code, srcLines } = build(`GLOBAL X%\nX% = 300\nPRINT CHR$(X%)`);
  const r = estimateError(code, srcLines, "IFC", lineOf(code, /CHR\$/));
  assert.ok(r.found);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].op, "CHR$");
  assert.match(r.hits[0].constraint, /0〜255/);
  assert.deepEqual(r.srcTexts, ["PRINT CHR$(X%)"]); // 元の変数名で見える
});

test("IFC: VPOKE / PUT SPRITE を文として検出", () => {
  const { code, srcLines } = build(`GLOBAL X%\nX% = 5\nVPOKE &H1800, X%\nPUT SPRITE 0, (X%, 50), 15, 0`);
  const v = estimateError(code, srcLines, "IFC", lineOf(code, /VPOKE/));
  assert.ok(v.hits.some((h) => h.op === "VPOKE"));
  const p = estimateError(code, srcLines, "IFC", lineOf(code, /PUT SPRITE/));
  assert.ok(p.hits.some((h) => h.op === "PUT SPRITE" && /0〜31/.test(h.constraint)));
});

test("SUBSCRIPT: 配列参照を候補提示（組み込みは除外）", () => {
  const { code, srcLines } = build(`GLOBAL X%\nDIM A(10)\nX% = 20\nA(X%) = 1`);
  const r = estimateError(code, srcLines, "SUBSCRIPT", lineOf(code, /^[A-Z]\(/));
  assert.ok(r.hits.some((h) => /添字/.test(h.constraint)));
});

test("DIV0: /・\\・MOD を検出", () => {
  const { code, srcLines } = build(`GLOBAL X%\nX% = 0\nY = 5 / X%`);
  const r = estimateError(code, srcLines, "DIV0", lineOf(code, /\//));
  assert.ok(r.hits.some((h) => h.op === "/"));
});

test("該当命令が無い行は hits=0 で他行を nearby 提示", () => {
  const { code, srcLines } = build(`GLOBAL X%\nX% = 300\nPRINT CHR$(X%)`);
  const r = estimateError(code, srcLines, "IFC", lineOf(code, /^A%=/));
  assert.equal(r.hits.length, 0);
  assert.ok(r.nearby.some((n) => /CHR\$/.test(n.text)));
});

test("存在しない行番号は found=false で候補行を提示", () => {
  const { code, srcLines } = build(`GLOBAL X%\nPRINT CHR$(X%)`);
  const r = estimateError(code, srcLines, "IFC", 99999);
  assert.equal(r.found, false);
  assert.ok(r.nearby.length > 0);
});
