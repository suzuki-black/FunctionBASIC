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

test("provenance: FUNCTION 宣言行は その関数の見出し行に対応する", () => {
  const src = `A% = 0
FUNCTION DBL%(N%)
    RETURN N% * 2
END FUNCTION
A% = DBL%(3)`;
  const code = build(src);
  // 2行目 = FUNCTION 宣言 → '=== FUNCTION DBL ===' 見出し行が src=2 を持つ
  const header = code.find((l) => /=== FUNCTION DBL ===/.test(l.text));
  assert.ok(header, "関数見出し行がある");
  assert.deepEqual(header!.src, [2]);
});

test("provenance: 1行に畳まれたIFは内側の文の行も由来に含む", () => {
  // IF/LOCATE/PRINT が 1行に畳まれる。内側(LOCATE/PRINT)行をクリックしても対応が出るよう
  // 畳んだMSX行に IF・内側の全ソース行が付くこと。
  const src = `X% = 2
IF X% = 2 THEN
    LOCATE 1, 1
    PRINT "HI"
END IF
PRINT X%`;
  const code = build(src);
  // 畳まれた IF 行を特定（THEN を含む単一MSX行）
  const folded = code.find((l) => /\bTHEN\b/.test(l.text) && /PRINT/.test(l.text));
  assert.ok(folded, "IFが1行に畳まれている");
  // IF(2)・LOCATE(3)・PRINT(4) すべてがこの行の由来に含まれる
  for (const ln of [2, 3, 4]) assert.ok((folded!.src ?? []).includes(ln), `src に ${ln} を含む`);
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
