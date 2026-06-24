// Z80 逆アセンブラの既知バイト列検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { disassemble } from "../src/disasm/z80.ts";
import { MSX_BIOS } from "../src/disasm/msx-bios.ts";

// 単一命令: bytes → 期待ニーモニック（base 既定 0）
const ONE: Array<[number[], string, number?]> = [
  [[0x00], "NOP"],
  [[0x3e, 0x0a], "LD A,0Ah"],
  [[0xc9], "RET"],
  [[0xcd, 0xa2, 0x00], "CALL 00A2h"],
  [[0x21, 0x34, 0x12], "LD HL,1234h"],
  [[0x06, 0x05], "LD B,05h"],
  [[0x76], "HALT"],
  [[0xed, 0xb0], "LDIR"],
  [[0x3a, 0x00, 0xc0], "LD A,(0C000h)"],
  [[0x18, 0xfe], "JR 0100h", 0x100],
  [[0x10, 0xfe], "DJNZ 0100h", 0x100],
  [[0xdd, 0x21, 0x00, 0xc0], "LD IX,0C000h"],
  [[0xfd, 0x21, 0x00, 0xc0], "LD IY,0C000h"],
  [[0xdd, 0x7e, 0x05], "LD A,(IX+05h)"],
  [[0xdd, 0x77, 0xfb], "LD (IX-05h),A"],
  [[0xcb, 0x47], "BIT 0,A"],
  [[0xcb, 0xfe], "SET 7,(HL)"],
  [[0xdd, 0xcb, 0x05, 0x46], "BIT 0,(IX+05h)"],
  [[0xe6, 0xf0], "AND 0F0h"],
  [[0xd3, 0xa8], "OUT (0A8h),A"],
  [[0x08], "EX AF,AF'"],
  [[0x19], "ADD HL,DE"],
  [[0x23], "INC HL"],
  [[0xc5], "PUSH BC"],
  [[0xff], "RST 38h"],
  [[0xe9], "JP (HL)"],
  [[0xdd, 0xe9], "JP (IX)"],
  [[0x36, 0x00], "LD (HL),00h"],
  [[0xdd, 0x36, 0x02, 0x41], "LD (IX+02h),41h"],
];

for (const [bytes, want, base] of ONE) {
  test(`disasm: ${bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")} → ${want}`, () => {
    const lines = disassemble(bytes, base ?? 0);
    assert.equal(lines.length, 1, "1命令にデコードされる");
    assert.equal(lines[0].text, want);
    assert.equal(lines[0].bytes.length, bytes.length, "全バイト消費");
  });
}

test("disasm: BIOS シンボルで CALL が名前解決される", () => {
  const lines = disassemble([0xcd, 0xa2, 0x00], 0, MSX_BIOS);
  assert.equal(lines[0].text, "CALL CHPUT");
});

test("disasm: 連続した複数命令を順に分解する", () => {
  // LD A,1 / CALL CHPUT(00A2) / RET
  const lines = disassemble([0x3e, 0x01, 0xcd, 0xa2, 0x00, 0xc9], 0xc000, MSX_BIOS);
  assert.deepEqual(lines.map((l) => l.text), ["LD A,01h", "CALL CHPUT", "RET"]);
  assert.deepEqual(lines.map((l) => l.addr), [0xc000, 0xc002, 0xc005]);
});
