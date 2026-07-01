// 行番号セグメント割当の健全性（重複/降順/上限）検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const build = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  const nums = r.code.map((l) => l.lineNo);
  return {
    nums,
    errs: [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "error").map((d) => d.code),
  };
};
const isAscendingUnique = (nums: number[]) => nums.every((n, i) => i === 0 || n > nums[i - 1]);

test("MAINが90行を超えても関数セグメントと衝突しない（行番号は昇順・重複なし）", () => {
  let src = "";
  for (let i = 0; i < 120; i++) src += `A${i % 9}=${i}\n`;
  src += "PRINT F()\nPRINT G()\nFUNCTION F()\nRETURN 1\nEND FUNCTION\nFUNCTION G()\nRETURN 2\nEND FUNCTION\n";
  const { nums, errs } = build(src);
  assert.ok(isAscendingUnique(nums), "行番号が厳密昇順・重複なし");
  assert.deepEqual(errs, []);
});

test("長い関数(150行超)でも次の関数と衝突しない", () => {
  let body = "";
  for (let i = 0; i < 150; i++) body += `  A${i % 9}=${i}\n`;
  const { nums, errs } = build(`PRINT F()\nPRINT G()\nFUNCTION F()\n${body}RETURN 1\nEND FUNCTION\nFUNCTION G()\nRETURN 2\nEND FUNCTION\n`);
  assert.ok(isAscendingUnique(nums));
  assert.deepEqual(errs, []);
});

test("行番号がMSX上限(65529)を超えると E_LINE_NUMBER_OVERFLOW", () => {
  let src = "";
  for (let i = 0; i < 70; i++) src += `PRINT F${i}()\n`;
  for (let i = 0; i < 70; i++) src += `FUNCTION F${i}()\nRETURN ${i}\nEND FUNCTION\n`;
  const { errs } = build(src);
  assert.ok(errs.includes("E_LINE_NUMBER_OVERFLOW"));
});
