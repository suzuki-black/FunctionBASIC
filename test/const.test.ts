// CONST（名前付き定数・コンパイル時インライン）の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return {
    msx: renderMsx(r.code).replace(/\r/g, ""),
    errs: [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "error").map((d) => d.code),
  };
};

test("数値CONSTは参照箇所にリテラルとしてインライン（MSX変数を作らない）", () => {
  const { msx, errs } = compile("CONST MAX = 100\nFOR I=1 TO MAX\nPRINT I\nNEXT\n");
  assert.deepEqual(errs, []);
  assert.match(msx, /FOR [A-Z]+=1 TO 100/); // MAX→100
  assert.doesNotMatch(msx, /=100\s*$/m);     // MAX を保持する代入行は出ない
});

test("定数式はコンパイル時に畳み込む（W*H→32）", () => {
  const { msx, errs } = compile("CONST W=4\nCONST H=8\nCONST AREA=W*H\nPRINT AREA\n");
  assert.deepEqual(errs, []);
  assert.match(msx, /PRINT 32/);
});

test("文字列CONSTもインライン", () => {
  const { msx, errs } = compile('CONST MSG$="HELLO"\nPRINT MSG$\n');
  assert.deepEqual(errs, []);
  assert.match(msx, /PRINT "HELLO"/);
});

test("負数・単項も畳み込む", () => {
  const { msx, errs } = compile("CONST MIN=-5\nX=MIN\n");
  assert.deepEqual(errs, []);
  assert.match(msx, /=-5/);
});

test("初期化以外の再代入は E_CONST_ASSIGN", () => {
  const { errs } = compile("CONST MAX=10\nMAX=20\n");
  assert.ok(errs.includes("E_CONST_ASSIGN"));
});

test("FORのループ変数にCONSTを使うのも再代入として弾く", () => {
  const { errs } = compile("CONST I=5\nFOR I=1 TO 3\nNEXT\n");
  assert.ok(errs.includes("E_CONST_ASSIGN"));
});

test("INPUT 等の書込み命令でCONSTを書き換えるのも弾く", () => {
  const { errs } = compile("CONST V=1\nINPUT V\n");
  assert.ok(errs.includes("E_CONST_ASSIGN"));
});

test("折り畳めない初期化式は E_CONST_NOT_CONSTANT", () => {
  const { errs } = compile("CONST X = Y + 1\n");
  assert.ok(errs.includes("E_CONST_NOT_CONSTANT"));
});

test("型サフィックスと初期値型の不一致は E_CONST_TYPE", () => {
  assert.ok(compile('CONST N% = "abc"\n').errs.includes("E_CONST_TYPE"));
  assert.ok(compile('CONST S$ = 1\n').errs.includes("E_CONST_TYPE"));
});

test("同名CONSTの重複は E_DUP_CONST", () => {
  const { errs } = compile("CONST A=1\nCONST A=2\n");
  assert.ok(errs.includes("E_DUP_CONST"));
});

test("関数内CONSTは関数内でインライン（グローバルCONSTも参照可）", () => {
  const { msx, errs } = compile("CONST G=3\nFUNCTION F()\nCONST K=7\nRETURN K+G\nEND FUNCTION\nPRINT F()\n");
  assert.deepEqual(errs, []);
  assert.match(msx, /=7\+3|=10/); // K+G がインライン（畳み込みは加算のみなので 7+3）
});
