// ML-DATA 特定（DATA→READ→POKE ローダ ＋ 実行痕跡）の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { findDataBlobs, collectData, evalConst } from "../src/disasm/detect.ts";
import { disassemble } from "../src/disasm/z80.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const prog = (src: string) => parse(tokenize(src).tokens).program;

test("transform: '@ ニーモニックコメントはMSX出力から除去、通常'コメントは残る", () => {
  const p = prog(`'@ C000  3E 0A      LD A,0Ah
' 普通のコメント
PRINT 1
`);
  const msx = renderMsx(transform(p).code);
  assert.ok(!/LD A,0Ah/.test(msx), "ニーモニックは出力から消える");
  assert.ok(/普通のコメント/.test(msx), "通常コメントは残る");
});

test("detect: READ→POKE ローダ＋USR呼び出し → 機械語と判定", () => {
  // 49152 = &HC000。62,10,201 = 3E 0A C9 = LD A,0Ah / RET
  const p = prog(`GLOBAL R%
FOR I = 0 TO 2
    READ V
    POKE 49152 + I, V
NEXT
R% = USR0(0)
DATA 62, 10, 201
`);
  const blobs = findDataBlobs(p);
  assert.equal(blobs.length, 1);
  assert.deepEqual(blobs[0].values, [62, 10, 201]);
  assert.equal(blobs[0].loadAddr, 49152);
  assert.equal(blobs[0].executed, true);
  assert.equal(blobs[0].kind, "machine-code");
  // ブロブを逆アセンブルすると意味のあるニーモニックになる
  assert.deepEqual(
    disassemble(blobs[0].values, blobs[0].loadAddr ?? 0).map((l) => l.text),
    ["LD A,0Ah", "RET"],
  );
});

test("detect: 実行痕跡なし(POKEのみ) → binary(機械語と断定しない)", () => {
  const p = prog(`FOR I = 0 TO 2
    READ V
    POKE 49152 + I, V
NEXT
DATA 1, 2, 3
`);
  const blobs = findDataBlobs(p);
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].kind, "binary");
  assert.equal(blobs[0].executed, false);
});

test("detect: USRベクタ(&HF7F8)へのPOKEも実行痕跡", () => {
  const p = prog(`FOR I = 0 TO 1
    READ V
    POKE 49152 + I, V
NEXT
POKE 63480, 0
DATA 201, 0
`);
  const blobs = findDataBlobs(p);
  assert.equal(blobs[0].kind, "machine-code");
});

test("detect: VPOKE ローダ(VRAM)は機械語ローダとして検出しない", () => {
  const p = prog(`FOR I = 0 TO 2
    READ V
    VPOKE 6144 + I, V
NEXT
DATA 1, 2, 3
`);
  assert.equal(findDataBlobs(p).length, 0);
});

test("detect: 普通のDATA(ローダなし)はブロブ無し", () => {
  const p = prog(`READ A
READ B
DATA 10, 20
`);
  assert.equal(findDataBlobs(p).length, 0);
  assert.deepEqual(collectData(p), [10, 20]);
});

test("evalConst: 定数式/16進/単純変数env", () => {
  const e = (s: string) => {
    const pr = prog(`X = ${s}`);
    return (pr.toplevel[0] as any).expr;
  };
  assert.equal(evalConst(e("1 + 2 * 3")), 7);
  assert.equal(evalConst(e("&HC000")), 0xc000);
  assert.equal(evalConst(e("10 \\ 3")), 3);
  assert.equal(evalConst(e("I + 5"), { I: 100 }), 105);
  assert.equal(evalConst(e("J + 1")), null); // 未知変数
});
