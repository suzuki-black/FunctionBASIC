// 変数名の役割推測（逆変換）の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBasic } from "../src/reverse/basic-reader.ts";
import { renameVars } from "../src/reverse/rename-vars.ts";

const conv = (src: string) => renameVars(readBasic(src).lines).lines.flatMap((l) => l.stmts);

test("ループ変数 → I/J（入れ子）", () => {
  assert.deepEqual(
    conv("10 FOR AB=1 TO 3\n20 FOR CD=1 TO 2\n30 PRINT AB*CD\n40 NEXT CD,AB\n"),
    ["FOR I=1 TO 3", "FOR J=1 TO 2", "PRINT I*J", "NEXT J,I"],
  );
});

test("ループ変数の型サフィックスは保持", () => {
  assert.deepEqual(conv("10 FOR AB%=1 TO 2\n20 NEXT\n"), ["FOR I%=1 TO 2", "NEXT"]);
});

test("カウンタ +1 → COUNT、累算 +式 → SUM", () => {
  assert.deepEqual(conv("10 SC=SC+1\n"), ["COUNT=COUNT+1"]);
  assert.deepEqual(conv("10 TT=TT+N\n"), ["SUM=SUM+N"]);
});

test("座標 → X/Y（PUT SPRITE / PSET / LOCATE）", () => {
  assert.deepEqual(conv("10 PUT SPRITE 0,(PX,PY)\n"), ["PUT SPRITE 0,(X,Y)"]);
  assert.deepEqual(conv("10 PSET(AA,BB)\n"), ["PSET(X,Y)"]);
  assert.deepEqual(conv("10 LOCATE CX,CY\n"), ["LOCATE X,Y"]);
});

test("既存名との衝突を回避（X が既にある）", () => {
  assert.deepEqual(conv("10 X=1\n20 PSET(AA,BB)\n"), ["X=1", "PSET(X2,Y)"]);
});

test("文字列/DATA/コメント内は改名しない", () => {
  assert.deepEqual(
    conv('10 PRINT "AB":FOR AB=1 TO 2:NEXT\n20 DATA AB\n'),
    ['PRINT "AB"', "FOR I=1 TO 2", "NEXT", "DATA AB"],
  );
});

test("16進リテラル(&H..)は改名しない", () => {
  // AA はループ変数→I だが、&HAA の AA は触らない
  assert.deepEqual(conv("10 FOR AA=1 TO 2\n20 POKE &HAA,AA\n30 NEXT\n"),
    ["FOR I=1 TO 2", "POKE &HAA,I", "NEXT"]);
});
