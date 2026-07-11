// MsxLine.src（各MSX行の由来＝構造化ソース行）の健全性。エディタの行連動ハイライトの土台。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const build = (src: string) => transform(parse(tokenize(src).tokens).program).code;

test("provenance: 各MSX行に由来の構造化ソース行(src)が付く", () => {
  const src = `SCORE% = 0
FOR ENEMY% = 1 TO 3
    SCORE% = SCORE% + ENEMY%
NEXT ENEMY%
PRINT SCORE%`;
  const code = build(src);
  const bySrc = new Map<number, number[]>();
  for (const l of code) for (const s of l.src ?? []) (bySrc.get(s) ?? bySrc.set(s, []).get(s)!).push(l.lineNo);
  // 行1(代入) → 1つのMSX行、行3(累算) → 1つ
  assert.equal(bySrc.get(1)?.length, 1);
  assert.equal(bySrc.get(3)?.length, 1);
  // 行2(FOR) は FOR と NEXT の2行に対応する
  assert.equal(bySrc.get(2)?.length, 2);
  // 行5(PRINT) → 1つ
  assert.equal(bySrc.get(5)?.length, 1);
  // 合成行(MAIN ヘッダ/END)は src を持たない
  assert.ok(code.some((l) => /=== MAIN ===/.test(l.text) && (l.src ?? []).length === 0));
});

test("provenance: src の行番号はすべて元ソースの行範囲内", () => {
  const src = `A% = 1
B% = 2
PRINT A% + B%`;
  const code = build(src);
  const nSrcLines = src.split("\n").length;
  for (const l of code) for (const s of l.src ?? []) {
    assert.ok(s >= 1 && s <= nSrcLines, `src ${s} は 1..${nSrcLines} 内`);
  }
});
