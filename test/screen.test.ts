// SCREEN まわりの静的落とし穴の警告（check-screen.ts）の回帰テスト。
//  W_SPRITE_BEFORE_SCREEN : SPRITE 定義が後続 SCREEN で消える（トップレベル実行順）
//  W_TEXT_IN_BITMAP_SCREEN: ビットマップ画面(>=2)で素の PRINT は表示されない
// いずれも誤検知ほぼゼロを狙う設計なので「出る/出ない」の両方を固定する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform } from "../src/transform/transformer.ts";

const warnCodes = (src: string): string[] => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "warning").map((d) => d.code);
};

const SPR8 = ['SPRITE BALL', '"########"', '"########"', '"########"', '"########"',
  '"########"', '"########"', '"########"', '"########"', 'END SPRITE'].join("\n");

test("SPRITE 定義が後続 SCREEN より前だと W_SPRITE_BEFORE_SCREEN", () => {
  const src = `${SPR8}\nSCREEN 1\nPUT SPRITE 0,(0,0),15,BALL`;
  assert.ok(warnCodes(src).includes("W_SPRITE_BEFORE_SCREEN"));
});

test("SPRITE 定義が SCREEN の後なら警告は出ない", () => {
  const src = `SCREEN 1\n${SPR8}\nPUT SPRITE 0,(0,0),15,BALL`;
  assert.ok(!warnCodes(src).includes("W_SPRITE_BEFORE_SCREEN"));
});

test("SCREEN が全く無ければ（既定テキスト面で消えない）警告は出ない", () => {
  const src = `${SPR8}\nPUT SPRITE 0,(0,0),15,BALL`;
  assert.ok(!warnCodes(src).includes("W_SPRITE_BEFORE_SCREEN"));
});

test("ビットマップ画面(SCREEN 2)で素の PRINT は W_TEXT_IN_BITMAP_SCREEN", () => {
  assert.ok(warnCodes(`SCREEN 2,2\nPRINT "HI"`).includes("W_TEXT_IN_BITMAP_SCREEN"));
});

test("SCREEN 2 でも PRINT #1（グラフィック文字）なら警告は出ない", () => {
  const src = `SCREEN 2,2\nOPEN "GRP:" AS #1\nPRESET(0,0)\nPRINT #1,"HI"`;
  assert.ok(!warnCodes(src).includes("W_TEXT_IN_BITMAP_SCREEN"));
});

test("テキスト画面(SCREEN 1)の素の PRINT は警告なし（誤検知防止）", () => {
  assert.ok(!warnCodes(`SCREEN 1\nPRINT "HI"`).includes("W_TEXT_IN_BITMAP_SCREEN"));
});

test("SCREEN が無い素の PRINT は警告なし（既定テキスト面）", () => {
  assert.ok(!warnCodes(`PRINT "HI"`).includes("W_TEXT_IN_BITMAP_SCREEN"));
});

test("SCREEN モードが変数で確定できないときは警告を出さない（誤検知防止）", () => {
  const src = `GLOBAL M%\nM% = 2\nSCREEN M%\nPRINT "HI"`;
  assert.ok(!warnCodes(src).includes("W_TEXT_IN_BITMAP_SCREEN"));
});

test("テキスト画面が混ざる（SCREEN 1 と SCREEN 5）ときは PRINT 警告を出さない", () => {
  const src = `SCREEN 1\nPRINT "MENU"\nSCREEN 5`;
  assert.ok(!warnCodes(src).includes("W_TEXT_IN_BITMAP_SCREEN"));
});
