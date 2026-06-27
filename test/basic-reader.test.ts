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

test("read: 無空白の命令+引数に空白を補う（MSX流）", () => {
  const f = (s: string) => readBasic(s).lines[0].stmts;
  assert.deepEqual(f("10 COLOR5,1,1\n"), ["COLOR 5,1,1"]);
  assert.deepEqual(f("10 DEFINTA-Z\n"), ["DEFINT A-Z"]);
  assert.deepEqual(f("10 LOCATE9,3\n"), ["LOCATE 9,3"]);
  assert.deepEqual(f("10 SCORE=5\n"), ["SCORE=5"]); // 変数は分割しない
  assert.deepEqual(f("10 PSET(2,3)\n"), ["PSET(2,3)"]); // 記号は字句側で区切れる＝そのまま
});

test("read: 完全に空白なしの行をMSX流に再トークン化", () => {
  const f = (s: string) => readBasic(s).lines[0].stmts;
  assert.deepEqual(f("10 FORI=0TO32\n"), ["FOR I=0 TO 32"]);
  assert.deepEqual(f("10 IFA<-16THENA=255\n"), ["IF A<-16 THEN A=255"]);
  assert.deepEqual(f("10 PUTSPRITE0,(X,Y),7\n"), ["PUT SPRITE 0,(X,Y),7"]);
  assert.deepEqual(f("10 SCORE=SCORE+1\n"), ["SCORE=SCORE+1"]); // 予約語を含む変数は割らない
  assert.deepEqual(f('10 PRINT"HELLO"\n'), ['PRINT "HELLO"']);
});

test("read: PRINT#1 等のファイル番号#を分離（型サフィックス誤読を回避）", () => {
  const f = (s: string) => readBasic(s).lines[0].stmts;
  assert.deepEqual(f('10 PRINT#1,"A"\n'), ['PRINT #1,"A"']);
  assert.deepEqual(f("10 A#=1.5\n"), ["A#=1.5"]); // 倍精度変数のサフィックスは保持
});

test("read: 識別子に埋もれた長制御語(THEN/GOTO)を区切る", () => {
  const f = (s: string) => readBasic(s).lines[0].stmts;
  assert.deepEqual(f("10 IFMCTHENMS=MS+1\n"), ["IF MC THEN MS=MS+1"]);
  assert.deepEqual(f("10 ONSTGOTO20,30\n"), ["ON ST GOTO 20,30"]);
  assert.deepEqual(f("10 DELAY=5\n"), ["DELAY=5"]); // キーワード始まりでない変数は割らない
});

test("read: 行末の未閉じ文字列を補完（MSXは閉じ忘れ可）", () => {
  const f = (s: string) => readBasic(s).lines[0].stmts;
  assert.deepEqual(f('10 PRINT "HELLO\n'), ['PRINT "HELLO"']);
  assert.deepEqual(f('10 A$="X":PRINT A$\n'), ['A$="X"', "PRINT A$"]); // 閉じている文字列は不変
});

test("read: MSX別表記 =< / => を <= / >= に正規化", () => {
  const f = (s: string) => readBasic(s).lines[0].stmts;
  assert.deepEqual(f("10 IF K=<127 THEN A=1\n"), ["IF K<=127 THEN A=1"]);
  assert.deepEqual(f("10 IF K=>0 THEN A=1\n"), ["IF K>=0 THEN A=1"]);
});
