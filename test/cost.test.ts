import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { analyzeCost } from "../src/analyze/cost.ts";

function analyze(src: string) {
  const tk = tokenize(src);
  const ast = parse((tk as { tokens?: unknown }).tokens ?? tk);
  return analyzeCost((ast as { program?: unknown }).program ?? ast);
}

test("重い命令(LINE BF)を持つ関数は、整数代入だけの関数より高コスト", () => {
  const rep = analyze(
    "FUNCTION HEAVY()\n LINE (0,0)-(15,15),1,BF\nEND FUNCTION\n" +
    "FUNCTION LIGHT()\n GLOBAL A%\n A%=1\nEND FUNCTION\n",
  );
  const heavy = rep.functions.find((f) => f.name === "HEAVY")!;
  const light = rep.functions.find((f) => f.name === "LIGHT")!;
  assert.ok(heavy.inclusive > light.inclusive * 3, "LINE BF は整数代入より十分高い");
});

test("inclusive は self を下回らない（呼び先を展開して積み増す）", () => {
  const rep = analyze(
    "FUNCTION LEAF()\n GLOBAL A%\n A%=A%+1\nEND FUNCTION\n" +
    "FUNCTION CALLER()\n LEAF()\n LEAF()\nEND FUNCTION\n",
  );
  const caller = rep.functions.find((f) => f.name === "CALLER")!;
  assert.ok(caller.inclusive > caller.self, "呼び先2回ぶんが inclusive に乗る");
});

test("FOR ループは本体コストを反復数ぶん積算する（定数上限を畳み込む）", () => {
  const rep = analyze(
    "FUNCTION ONCE()\n GLOBAL A%\n A%=1\nEND FUNCTION\n" +
    "FUNCTION LOOP10()\n GLOBAL A%\n FOR I%=0 TO 9\n A%=1\n NEXT I%\nEND FUNCTION\n",
  );
  const once = rep.functions.find((f) => f.name === "ONCE")!;
  const loop = rep.functions.find((f) => f.name === "LOOP10")!;
  assert.ok(loop.inclusive > once.inclusive * 8, "10反復ぶん積み上がる");
});

test("RND は重い命令として突出（整数演算より桁が上）", () => {
  const rep = analyze(
    "FUNCTION USERND()\n GLOBAL A%\n A%=INT(RND(1)*10)\nEND FUNCTION\n" +
    "FUNCTION NORND()\n GLOBAL A%\n A%=A%+1\nEND FUNCTION\n",
  );
  const r = rep.functions.find((f) => f.name === "USERND")!;
  const n = rep.functions.find((f) => f.name === "NORND")!;
  assert.ok(r.inclusive > n.inclusive * 2, "RND を含む方が明確に高い");
});

test("毎フレーム木(トップレベルWHILE)が構築され、枝が分離される", () => {
  const rep = analyze(
    "GLOBAL A%\n A%=0\n" +
    "WHILE 1\n IF A%=0 THEN\n A%=1\n END IF\nWEND\n",
  );
  assert.ok(rep.frameTree, "frameTree が返る");
  assert.equal(rep.frameTree!.kind, "loop");
  assert.ok(rep.frameTree!.children.length >= 1);
});

test("インライン ASM: 後方分岐ループを持つ方が非ループより高コスト", () => {
  const rep = analyze(
    "FUNCTION ANOLOOP()\n ASM\n LD A,1\n LD B,2\n END ASM\nEND FUNCTION\n" +
    "FUNCTION ALOOP()\n ASM\n LD B,16\nLP:\n DEC A\n DJNZ LP\n END ASM\nEND FUNCTION\n",
  );
  const a = rep.functions.find((f) => f.name === "ALOOP")!;
  const b = rep.functions.find((f) => f.name === "ANOLOOP")!;
  assert.ok(a.inclusive > b.inclusive, "DJNZ ループぶん高い");
});
