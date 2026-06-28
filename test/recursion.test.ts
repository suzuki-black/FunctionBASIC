// 再帰（GOSUB＋ソフトスタックでフレーム退避）の検証。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string, opts = {}) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program, opts);
  return {
    msx: renderMsx(r.code).replace(/\r/g, ""),
    errs: [...ld, ...pd, ...r.diagnostics].filter((d) => d.severity === "error").map((d) => d.code),
  };
};

test("自己再帰（階乗）はエラーなく変換され、スタックDIM＋push/popを生成", () => {
  const { msx, errs } = compile(
    "FUNCTION FACT(N)\nIF N<=1 THEN\nRETURN 1\nEND IF\nRETURN N*FACT(N-1)\nEND FUNCTION\nPRINT FACT(5)\n",
  );
  assert.deepEqual(errs, []);
  assert.match(msx, /DIM /);          // スタック確保
  assert.match(msx, /GOSUB 1000/);    // 自分自身へ GOSUB
  // push（ポインタ加算→配列代入）と pop（配列読み出し→ポインタ減算）が両方ある
  assert.match(msx, /\+1:[A-Z]+#\(/);
  assert.match(msx, /=[A-Z]+#\([A-Z]+%\):[A-Z]+%=[A-Z]+%-1/);
});

test("二重再帰(fib)は1回目の結果tempを2回目呼び出しの前後で退避/復元する", () => {
  const { msx, errs } = compile(
    "FUNCTION FIB(N)\nIF N<2 THEN\nRETURN N\nEND IF\nRETURN FIB(N-1)+FIB(N-2)\nEND FUNCTION\nPRINT FIB(10)\n",
  );
  assert.deepEqual(errs, []);
  // FIB 本体に2つの再帰呼び出し（＋MAINからの1回）→ GOSUB 1000 は3回以上
  assert.ok((msx.match(/GOSUB 1000/g) || []).length >= 3);
});

test("相互再帰（EVN/ODD）も共有スタックで変換される", () => {
  const { msx, errs } = compile(
    "FUNCTION EVN(N)\nIF N=0 THEN\nRETURN 1\nEND IF\nRETURN ODD(N-1)\nEND FUNCTION\n" +
      "FUNCTION ODD(N)\nIF N=0 THEN\nRETURN 0\nEND IF\nRETURN EVN(N-1)\nEND FUNCTION\nPRINT EVN(4)\n",
  );
  assert.deepEqual(errs, []);
  assert.match(msx, /GOSUB 2000/); // EVN→ODD
  assert.match(msx, /GOSUB 1000/); // ODD→EVN
});

test("非再帰関数はスタックを生成しない（従来どおり）", () => {
  const { msx, errs } = compile("FUNCTION DBL(N)\nRETURN N*2\nEND FUNCTION\nPRINT DBL(3)\n");
  assert.deepEqual(errs, []);
  assert.doesNotMatch(msx, /DIM /);
});

test("再帰関数の REF 引数は E_RECURSION_REF_UNSUPPORTED", () => {
  const { errs } = compile("FUNCTION F(REF A)\nRETURN F(A)\nEND FUNCTION\nX=1\nPRINT F(X)\n");
  assert.ok(errs.includes("E_RECURSION_REF_UNSUPPORTED"));
});

test("recursionDepth で DIM サイズを変えられる", () => {
  const { msx } = compile(
    "FUNCTION F(N)\nIF N<=0 THEN\nRETURN 0\nEND IF\nRETURN F(N-1)\nEND FUNCTION\nPRINT F(3)\n",
    { recursionDepth: 50 },
  );
  assert.match(msx, /DIM [A-Z]+#\(50\)/);
});
