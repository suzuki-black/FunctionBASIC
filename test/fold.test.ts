// 定数畳み込み最適化（オプトイン）の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string, optimize = false) => {
  const { tokens } = tokenize(src);
  const { program } = parse(tokens);
  const r = transform(program, { optimize });
  return renderMsx(r.code).replace(/\r/g, "");
};

test("既定(OFF)では畳まない", () => {
  assert.match(compile("A=2*3+4*5\n"), /A=2\*3\+4\*5/);
});

test("ON: 定数式を畳む（部分畳み込み・変数は残す）", () => {
  assert.match(compile("A=2*3+4*5\n", true), /A=26/);
  assert.match(compile("A=X*2+3*4\n", true), /A=[A-Z]+\*2\+12/); // 変数項は保持
});

test("ON: 整数除算と浮動小数除算をMSX流に畳む", () => {
  assert.match(compile("A=10\\3\n", true), /A=3/);   // 整数除算
  assert.match(compile("A=7/2\n", true), /A=3\.5/);  // 浮動小数除算
});

test("ON: 浮動小数の誤差膨張は畳まない（安全側）", () => {
  assert.match(compile("A=0.1+0.2\n", true), /A=0\.1\+0\.2/);
});

test("ON: 16bit整数域のビット演算のみ畳む", () => {
  assert.match(compile("A=&H0F AND &H03\n", true), /A=3/);
  assert.match(compile("A=70000 AND 1\n", true), /A=70000 AND 1/); // 範囲外は残す
});

test("ON: 0除算は畳まず実行時エラーを残す", () => {
  assert.match(compile("A=5/0\n", true), /A=5\/0/);
});

test("ON: 文字列リテラルの連結を畳む", () => {
  assert.match(compile('A$="AB"+"CD"\n', true), /A\$="ABCD"/);
});

test("ON: FOR の範囲式も畳む", () => {
  assert.match(compile("FOR I=1 TO 8*4\nNEXT\n", true), /FOR [A-Z]+=1 TO 32/);
});

test("ON: CONST インライン後に生じた定数式も畳む", () => {
  // CONST は畳み込みOFFでも初期化時に畳むが、参照式は fold で更に畳む
  assert.match(compile("CONST K=10\nA=K*2+5\n", true), /A=25/);
});

// ---- 可換再結合（定数畳み込みトグルに統合） ----
test("ON: + 連鎖の離れた定数をまとめる（1+X+2→X+3）", () => {
  assert.match(compile("A=1+X+2\n", true), /A=[A-Z]+\+3/);
  assert.match(compile("A=1+X+Y+4\n", true), /A=[A-Z]+\+[A-Z]+\+5/);
});

test("ON: * 連鎖の離れた定数をまとめる（2*X*3→X*6）", () => {
  assert.match(compile("A=2*X*3\n", true), /A=[A-Z]+\*6/);
});

test("ON: 恒等の簡約 X+0→X, X*1→X", () => {
  assert.match(compile("A=X+0\n", true), /A=[A-Z]+$/m);
  assert.match(compile("A=X*1\n", true), /A=[A-Z]+$/m);
});

test("ON: X*0 は副作用喪失回避のため簡約しない", () => {
  assert.match(compile("A=X*0\n", true), /A=[A-Z]+\*0/);
});

test("ON: 文字列連結(+)は非可換なので再結合しない", () => {
  assert.match(compile('A$="x"+B$+"y"\n', true), /A\$="x"\+[A-Z]+\$\+"y"/);
});

test("ON: 単一定数は無意味に並べ替えない（1+X のまま）", () => {
  assert.match(compile("A=1+X\n", true), /A=1\+[A-Z]+/);
});
