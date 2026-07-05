// 最小 Z80 アセンブラ（インライン ASM ブロック用）の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleZ80 } from "../src/asm/z80asm.ts";

const hex = (a: number[]) => a.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
const asm = (src: string, vars: string[] = []) =>
  assembleZ80(src.split("\n"), new Set(vars.map((v) => v.toUpperCase())));

test("代表命令が正しいバイト列にエンコードされる", () => {
  const cases: [string, string][] = [
    ["RET", "C9"], ["NOP", "00"], ["EI", "FB"], ["DI", "F3"], ["HALT", "76"],
    ["LD B,5", "06 05"], ["LD A,B", "78"], ["LD A,10", "3E 0A"],
    ["LD HL,&H1234", "21 34 12"], ["LD HL,4660", "21 34 12"], ["LD DE,0", "11 00 00"],
    ["OUT (&H98),A", "D3 98"], ["IN A,(&HA8)", "DB A8"],
    ["ADD A,B", "80"], ["SUB C", "91"], ["CP 10", "FE 0A"], ["AND 15", "E6 0F"],
    ["INC HL", "23"], ["DEC A", "3D"], ["INC A", "3C"],
    ["PUSH AF", "F5"], ["POP HL", "E1"], ["CALL &H00A2", "CD A2 00"], ["DB 1,2,3", "01 02 03"],
  ];
  for (const [src, want] of cases) {
    const r = asm(src);
    assert.deepEqual(r.errors, [], `${src} にエラー`);
    assert.equal(hex(r.bytes), want, src);
  }
});

test("BASIC変数参照 (VAR) は 0000 プレースホルダ＋パッチ情報になる", () => {
  const r = asm("LD A,(player_x)\nINC A\nLD (player_x),A", ["PLAYER_X"]);
  assert.deepEqual(r.errors, []);
  assert.equal(hex(r.bytes), "3A 00 00 3C 32 00 00");
  assert.deepEqual(r.patches, [
    { offset: 1, name: "PLAYER_X" },
    { offset: 5, name: "PLAYER_X" },
  ]);
});

test("直接メモリ (nnnn) はそのままアドレスを埋める（パッチ無し）", () => {
  const r = asm("LD A,(&HF3E0)");
  assert.deepEqual(r.errors, []);
  assert.equal(hex(r.bytes), "3A E0 F3");
  assert.deepEqual(r.patches, []);
});

test("未知変数・未対応命令はエラーを返す（黙って壊さない）", () => {
  assert.ok(asm("LD A,(nosuch)").errors.length > 0, "未知変数");
  assert.ok(asm("FOOBAR 1").errors.length > 0, "未対応命令");
});

test("ラベル＋相対ジャンプ（JR/JR cc/DJNZ）が正しく後埋めされる", () => {
  assert.equal(hex(asm("LD B,3\nLOOP:\nINC A\nDJNZ LOOP").bytes), "06 03 3C 10 FD"); // DJNZ 後方
  assert.equal(hex(asm("LOOP:\nDEC A\nJR NZ,LOOP").bytes), "3D 20 FD"); // JR cc 後方
  assert.equal(hex(asm("JR SKIP\nNOP\nSKIP:\nRET").bytes), "18 01 00 C9"); // JR 前方
});

test("条件付き絶対ジャンプ JP cc,nn / CALL cc,nn", () => {
  assert.equal(hex(asm("JP NZ,&H1234").bytes), "C2 34 12");
  assert.equal(hex(asm("CALL Z,&H00A2").bytes), "CC A2 00");
});

test("ADD HL,rr（16bit加算）", () => {
  assert.equal(hex(asm("ADD HL,BC").bytes), "09");
  assert.equal(hex(asm("ADD HL,DE").bytes), "19");
  assert.equal(hex(asm("ADD HL,HL").bytes), "29");
  assert.equal(hex(asm("ADD HL,SP").bytes), "39");
  // 8bit の ADD A,r と衝突しないこと
  assert.equal(hex(asm("ADD A,B").bytes), "80");
});

test("LD A,(BC)/(DE) と LD (BC)/(DE),A（レジスタ間接）", () => {
  assert.equal(hex(asm("LD A,(BC)").bytes), "0A");
  assert.equal(hex(asm("LD A,(DE)").bytes), "1A");
  assert.equal(hex(asm("LD (BC),A").bytes), "02");
  assert.equal(hex(asm("LD (DE),A").bytes), "12");
  // (DE) を未知変数扱いしないこと
  assert.deepEqual(asm("LD A,(DE)").errors, []);
});

test("LD A,(HL)/LD (HL),A は (nn) と誤認せずレジスタ間接になる", () => {
  assert.equal(hex(asm("LD A,(HL)").bytes), "7E");
  assert.equal(hex(asm("LD (HL),A").bytes), "77");
  assert.equal(hex(asm("LD H,(HL)").bytes), "66");
  assert.deepEqual(asm("LD A,(HL)").errors, [], "(HL) を未知変数扱いしない");
});

test("フレーム同期の定番 EI:HALT:RET（要所ASM用）", () => {
  assert.equal(hex(asm("EI\nHALT\nRET").bytes), "FB 76 C9");
});

test("未定義ラベルはエラー", () => {
  assert.ok(asm("JR NOWHERE").errors.length > 0);
});

test("コメント(; ')と空行は無視される", () => {
  const r = asm("  ; header\nLD A,1  ' set\n\nRET");
  assert.deepEqual(r.errors, []);
  assert.equal(hex(r.bytes), "3E 01 C9");
});
