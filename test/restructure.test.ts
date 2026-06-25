// 素のBASIC→構造化(明示構造の復元)の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBasic } from "../src/reverse/basic-reader.ts";
import { restructure } from "../src/reverse/restructure.ts";

const conv = (src: string) => restructure(readBasic(src).lines).source;

test("FOR/NEXT: 行番号除去＋インデント＋NEXT裸化", () => {
  assert.equal(
    conv("10 FOR I=1 TO 3\n20 PRINT I\n30 NEXT I\n"),
    "FOR I=1 TO 3\n    PRINT I\nNEXT",
  );
});

test("入れ子FOR＋NEXT J,I（多段クローズ）", () => {
  assert.equal(
    conv("10 FOR I=1 TO 2\n20 FOR J=1 TO 2\n30 PRINT I*J\n40 NEXT J,I\n"),
    "FOR I=1 TO 2\n    FOR J=1 TO 2\n        PRINT I*J\n    NEXT\nNEXT",
  );
});

test("WHILE/WEND", () => {
  assert.equal(
    conv("10 WHILE A<10\n20 A=A+1\n30 WEND\n"),
    "WHILE A<10\n    A=A+1\nWEND",
  );
});

test("多文行は展開", () => {
  assert.equal(conv("10 A=1:B=2:PRINT A\n"), "A=1\nB=2\nPRINT A");
});

test("単行IF→ブロック化（複数文THEN）", () => {
  assert.equal(
    conv('10 IF A=1 THEN PRINT 1:PRINT 2\n'),
    "IF A=1 THEN\n    PRINT 1\n    PRINT 2\nEND IF",
  );
});

test("単行IF/ELSE→ブロック化", () => {
  assert.equal(
    conv("10 IF A THEN B=1 ELSE B=2\n"),
    "IF A THEN\n    B=1\nELSE\n    B=2\nEND IF",
  );
});

test("THEN先が行番号(GOTO)は素通し（#15領域）", () => {
  assert.equal(conv("10 IF A THEN 100\n"), "IF A THEN 100");
});

test("REM/' → コメント", () => {
  assert.equal(conv("10 REM hello\n20 'note\n"), "' hello\n'note");
});

test("IF内の文字列にあるTHEN/:/ELSEは保護", () => {
  assert.equal(
    conv('10 IF A THEN PRINT "X:Y ELSE Z"\n'),
    'IF A THEN\n    PRINT "X:Y ELSE Z"\nEND IF',
  );
});
