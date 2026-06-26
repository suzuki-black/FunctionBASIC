// 素のMSX-BASICリーダの検証（行番号抽出・: 分割・文字列/REM/' 保護）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBasic, splitStatements } from "../src/reverse/basic-reader.ts";

test("split: : で文分割", () => {
  assert.deepEqual(splitStatements("A=1:B=2:PRINT A"), ["A=1", "B=2", "PRINT A"]);
});
test("split: 文字列内の : は保護", () => {
  assert.deepEqual(splitStatements('PRINT "A:B":C=1'), ['PRINT "A:B"', "C=1"]);
});
test("split: REM は行末まで1文（: を含む）", () => {
  assert.deepEqual(splitStatements("A=1:REM x:y"), ["A=1", "REM x:y"]);
});
test("split: ' コメントは行末まで1文", () => {
  assert.deepEqual(splitStatements("A=1:'c:d"), ["A=1", "'c:d"]);
});
test("split: REMARK は REM と誤認しない", () => {
  assert.deepEqual(splitStatements("REMARK=1"), ["REMARK=1"]);
});
test("split: DATA の : は文を終端（MSX準拠）／引用内は保護", () => {
  assert.deepEqual(splitStatements("DATA 1,2:PRINT 3"), ["DATA 1,2", "PRINT 3"]);
  assert.deepEqual(splitStatements('DATA "a:b",3'), ['DATA "a:b",3']);
});

test("read: 行番号付き複数行を分解", () => {
  const { lines, diagnostics } = readBasic(`10 SCREEN 1
20 FOR I=1 TO 10:PRINT I:NEXT I
30 GOSUB 100
100 PRINT "SUB":RETURN
`);
  assert.equal(diagnostics.length, 0);
  assert.deepEqual(lines.map((l) => l.lineNo), [10, 20, 30, 100]);
  assert.deepEqual(lines[1].stmts, ["FOR I=1 TO 10", "PRINT I", "NEXT I"]);
  assert.deepEqual(lines[3].stmts, ['PRINT "SUB"', "RETURN"]);
});
test("read: 番号のみの行は文なしで保持（ジャンプ先）", () => {
  const { lines } = readBasic("100\n110 RETURN\n");
  assert.deepEqual(lines.map((l) => [l.lineNo, l.stmts.length]), [[100, 0], [110, 1]]);
});
test("read: 行番号なし行は警告してスキップ・空行は無視", () => {
  const { lines, diagnostics } = readBasic("10 PRINT 1\n\nPRINT 2\n");
  assert.deepEqual(lines.map((l) => l.lineNo), [10]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "warning");
});

test("split: 行末インラインコメントを文と分離", () => {
  assert.deepEqual(splitStatements("GOSUB 660 ' note"), ["GOSUB 660", "' note"]);
  assert.deepEqual(splitStatements("A=1:B=2 'c"), ["A=1", "B=2", "'c"]);
  assert.deepEqual(splitStatements("X=5 REM hi"), ["X=5", "REM hi"]);
});
