// 素のBASIC→構造化(GOSUB/IF/GOTO)の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBasic } from "../src/reverse/basic-reader.ts";
import { decompile } from "../src/reverse/decompile.ts";

const conv = (src: string) => decompile(readBasic(src).lines);

test("GOSUB → FUNCTION 抽出＋呼び出し", () => {
  const { source } = conv(`10 PRINT "START"
20 GOSUB 100
30 END
100 PRINT "SUB"
110 RETURN
`);
  assert.equal(source,
    'PRINT "START"\nSUB100()\nEND\nFUNCTION SUB100()\n    PRINT "SUB"\nEND FUNCTION');
});

test("関数が使う変数は GLOBAL 宣言", () => {
  const { source } = conv(`10 X=5
20 GOSUB 100
30 PRINT X
40 END
100 X=X*2
110 RETURN
`);
  assert.equal(source,
    "X=5\nSUB100()\nPRINT X\nEND\nFUNCTION SUB100()\n    GLOBAL X\n    X=X*2\nEND FUNCTION");
});

test("前方 IF…THEN 行 → IF NOT(...) ブロック", () => {
  const { source } = conv(`10 IF A=0 THEN 40
20 PRINT "NZ"
30 PRINT "STILL"
40 PRINT "DONE"
`);
  assert.equal(source,
    'IF NOT(A=0) THEN\n    PRINT "NZ"\n    PRINT "STILL"\nEND IF\nPRINT "DONE"');
});

test("IF…THEN GOSUB → ブロック＋呼び出し", () => {
  const { source } = conv(`10 IF A=1 THEN GOSUB 100
20 END
100 PRINT "S"
110 RETURN
`);
  assert.equal(source,
    'IF A=1 THEN\n    SUB100()\nEND IF\nEND\nFUNCTION SUB100()\n    PRINT "S"\nEND FUNCTION');
});

test("還元できない GOTO はコメント化＋警告", () => {
  // 前方の無条件GOTO（ループでもIFスキップでもない）→ 未対応フォールバック
  const { source, diagnostics } = conv('10 GOTO 30\n20 PRINT "SKIP"\n30 PRINT "HERE"\n');
  assert.match(source, /' \[未対応\] GOTO 30/);
  assert.equal(diagnostics.some((d) => d.severity === "warning"), true);
});

test("途中侵入のある範囲は前方スキップにしない（安全側）", () => {
  // 30 が 50 から GOTO されている → 10 の THEN 40 スキップは [20..30] に侵入先30を含む→不可
  const { source } = conv(`10 IF A THEN 40
20 PRINT "B"
30 PRINT "C"
40 PRINT "D"
50 GOTO 30
`);
  // 10 はブロック化されず素通しフォールバック（IF…THEN 行ジャンプ）
  assert.match(source, /' \[未対応\] IF A THEN 40/);
});

// ---- #18 後方GOTOループ ----
test("後方GOTO（無限ループ）→ WHILE 1", () => {
  const { source } = conv("10 A=A+1\n20 PRINT A\n30 GOTO 10\n");
  assert.equal(source, "WHILE 1\n    A=A+1\n    PRINT A\nWEND");
});

test("先頭テスト型ループ → WHILE NOT(...)", () => {
  const { source } = conv("10 IF A>9 THEN 40\n20 A=A+1\n30 GOTO 10\n40 PRINT A\n");
  assert.equal(source, "WHILE NOT(A>9)\n    A=A+1\nWEND\nPRINT A");
});

test("ループ内の条件脱出 → BREAK", () => {
  const { source } = conv('10 A=A+1\n20 IF A=5 THEN 50\n30 PRINT A\n40 GOTO 10\n50 PRINT "DONE"\n');
  assert.equal(source,
    'WHILE 1\n    A=A+1\n    IF A=5 THEN\n        BREAK\n    END IF\n    PRINT A\nWEND\nPRINT "DONE"');
});

// ---- コーパスで判明した改善の回帰 ----
test("ON …GOSUB はハンドラ関数化（イベントトラップ）", () => {
  const { source } = conv('10 ON SPRITE GOSUB 100\n20 SPRITE ON\n30 END\n100 PRINT "HIT"\n110 RETURN\n');
  assert.match(source, /ON SPRITE GOSUB SUB100/);
  assert.match(source, /FUNCTION SUB100\(\)/);
});

test("DEFINT 等はコメント化（構造化では型サフィックス）", () => {
  const { source } = conv("10 DEFINT A-Z\n20 PRINT 1\n");
  assert.match(source, /'\s*DEFINT A-Z/);
});

test("条件付きRETURNだけのサブルーチンも関数抽出（終端誤検出しない）", () => {
  const { source } = conv('10 GOSUB 100\n20 END\n100 READ A$\n110 IF A$="" THEN RETURN\n120 PRINT A$\n130 GOTO 100\n');
  assert.match(source, /FUNCTION SUB100\(\)/);
  assert.match(source, /SUB100\(\)/);
});

test("DEF FN → FUNCTION 巻き上げ＋FN呼び出し変換", () => {
  const { source } = conv("10 DEF FN SQ(X)=X*X\n20 Y=FN SQ(3)\n30 PRINT Y\n");
  assert.match(source, /FUNCTION FNSQ\(X\)/);
  assert.match(source, /RETURN X\*X/);
  assert.match(source, /Y=FNSQ\(3\)/);
});

test("双方向ジャンプ IF…THEN GOTO a ELSE GOTO b は不正生成せず未対応化", () => {
  const { source } = conv('10 IF A$="p" THEN GOTO 70 ELSE GOTO 20\n20 PRINT "X"\n70 PRINT "Y"\n');
  assert.doesNotMatch(source, /IF NOT\([\s\S]*\b(THEN|ELSE|GOTO)\b/); // 壊れた IF NOT(...) を出さない
  assert.match(source, /'\s*\[未対応\]/);
});

// ---- 関数抽出の深掘り回帰 ----
test("未定義SUB呼び出しは空スタブを生成（コンパイル可能に）", () => {
  const { source } = conv("10 GOSUB 999\n20 END\n");
  assert.match(source, /SUB999\(\)/);          // 呼び出し
  assert.match(source, /FUNCTION SUB999\(\)/);  // 空スタブ定義
});

test("関数外のRETURNはコメント化", () => {
  const { source } = conv("10 PRINT 1\n20 RETURN\n");
  assert.match(source, /'\s*\[未対応\] RETURN/);
});

test("制御語の残骸断片(GOTO/ELSE混在)はコメント化（FUNCTIONネスト防止）", () => {
  // 末尾に壊れた断片＋サブルーチン → サブルーチンが入れ子にならない
  const { source } = conv('10 GOSUB 100\n20 GOTO 3 ELSE SPRITE ON\n30 END\n100 PRINT "S"\n110 RETURN\n');
  assert.match(source, /'\s*\[未対応\] GOTO 3 ELSE SPRITE ON/);
  assert.doesNotMatch(source, /^\s+FUNCTION SUB100/m); // FUNCTION は字下げされない＝ネストしていない
});
