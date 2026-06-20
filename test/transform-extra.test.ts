import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return { ...r, diagnostics: [...ld, ...pd, ...r.diagnostics], msx: renderMsx(r.code).replace(/\r/g, "") };
};

test("配列REF複数variant: 別配列ごとに本体を複製", () => {
  const { msx, diagnostics } = compile(`FUNCTION SUM(REF A, N)
    LET S = 0
    FOR I = 1 TO N
        LET S = S + A(I)
    NEXT
    RETURN S
END FUNCTION
DIM SCORE(10)
DIM DAMAGE(5)
LET T1 = SUM(REF SCORE, 10)
LET T2 = SUM(REF DAMAGE, 5)
PRINT T1
PRINT T2`);
  assert.deepEqual(diagnostics, []);
  // SUM が SCORE版(A->A) と DAMAGE版(A->B) の2ブロックに複製される
  assert.match(msx, /FUNCTION SUM \(A->A\)/);
  assert.match(msx, /FUNCTION SUM \(A->B\)/);
  // 各ブロックが対応する配列を直接参照（コピー無し。局所変数名は2文字割当）
  assert.match(msx, /\+A\(/);
  assert.match(msx, /\+B\(/);
  // 1000番台と2000番台の別セグメント
  assert.match(msx, /1000 ' === FUNCTION SUM/);
  assert.match(msx, /2000 ' === FUNCTION SUM/);
});

test("分割不能な単一文字列(>255)は E_LINE_TOO_LONG", () => {
  const { diagnostics } = compile(`PRINT "${"x".repeat(300)}"`);
  assert.ok(diagnostics.some((d) => d.code === "E_LINE_TOO_LONG"));
});

test("長いPRINTは自動分割される（エラーにならない・各行≤255）", () => {
  const parts = Array.from({ length: 50 }, (_, i) => `"part${i}"`).join("; ");
  const { code, diagnostics } = compile(`PRINT ${parts}`);
  assert.ok(!diagnostics.some((d) => d.code === "E_LINE_TOO_LONG"));
  const printLines = code.filter((l) => /PRINT/.test(l.text));
  assert.ok(printLines.length >= 2, "複数行に分割");
  // 連続表示のため最後以外は末尾 ; で改行抑制
  for (let i = 0; i < printLines.length - 1; i++)
    assert.match(printLines[i].text, /;$/);
});

test("短い行は E_LINE_TOO_LONG にならない（キーワードは1バイト換算）", () => {
  const { diagnostics } = compile(`PRINT "hello"`);
  assert.ok(!diagnostics.some((d) => d.code === "E_LINE_TOO_LONG"));
});

test("式中のネストしたユーザ関数呼び出しを一時変数へlowering", () => {
  const { msx, diagnostics } = compile(`FUNCTION ADD(A, B)
    RETURN A + B
END FUNCTION
LET Z = ADD(ADD(1, 2), 3)
PRINT Z`);
  assert.deepEqual(diagnostics, []);
  // 2回の GOSUB（内側→一時変数、外側→Z）
  assert.equal((msx.match(/GOSUB 1000/g) ?? []).length, 2);
  // E_NOT_IMPLEMENTED が出ない
  assert.ok(!diagnostics.some((d) => d.code === "E_NOT_IMPLEMENTED"));
});

test("MapTable: グローバル/ローカル/variant/refSubst を保持", () => {
  const { map } = compile(`FUNCTION F(REF X)
    GLOBAL G
    LET X = G
    RETURN 0
END FUNCTION
G = 5
F(POS)`);
  assert.ok(map.globalVarMap.some((v) => v.original === "G"));
  const f = map.functions.find((x) => x.name === "F");
  assert.ok(f, "関数Fがマップにある");
  assert.equal(f.params[0].name, "X");
  assert.equal(f.params[0].byRef, true);
  assert.equal(f.variants.length, 1);
  assert.equal(f.variants[0].refSubst[0].param, "X");
});

test("座標タプル(x,y)と組み込み命令の保持: PUT SPRITE / SPRITE$", () => {
  const { msx, diagnostics } = compile(`SCREEN 5, 2
P$ = ""
SPRITE$(0) = P$
X = 100
Y = 50
PUT SPRITE 0, (X, Y), 15, 0`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 組み込み命令名・座標タプルは保持（変数のみ2文字名へ）
  assert.match(msx, /PUT SPRITE 0,\([A-Z]+,[A-Z]+\),15,0/);
  assert.match(msx, /SPRITE\$\(0\)=/); // SPRITE$ は改名されない
});

test("優先順位の括弧は保持される: (A+B)*C", () => {
  const { msx } = compile(`A = 1
B = 2
C = 3
R = (A + B) * C`);
  assert.match(msx, /\([A-Z]+\+[A-Z]+\)\*/); // (..+..)* の括弧が残る
});

test("MSX2: COPY のブロック転送（TO 節キーワードを保持）", () => {
  const { msx, diagnostics } = compile(`SCREEN 5
COPY (0,0)-(15,15) TO (100,100)`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.ok(!diagnostics.some((d) => d.code === "E_UNKNOWN_FUNCTION"));
  assert.match(msx, /COPY \(0,0\)-\(15,15\) TO \(100,100\)/);
});

test("MSX2: POINT 関数は改名されず素通しされる", () => {
  const { msx, diagnostics } = compile(`SCREEN 5
C = POINT(10, 20)
PRINT C`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /=POINT\(10,20\)/);
});

test("BGM: PLAY は文(演奏)でも関数(残数)でも使える", () => {
  const { msx, diagnostics } = compile(`PLAY "CDEFG"
WHILE PLAY(0)
WEND`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /PLAY "CDEFG"/); // 文形
  assert.match(msx, /PLAY\(0\)/); // 関数形（WHILE 条件内）
});

test("MSX2: SET PAGE / SET SCROLL の節キーワードを保持", () => {
  const { msx, diagnostics } = compile(`SET PAGE 0,1
SET SCROLL 0,0`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /SET PAGE 0,1/);
  assert.match(msx, /SET SCROLL 0,0/);
});

test("MSX2: COLOR= パレット設定（= と NEW を保持）", () => {
  const { msx, diagnostics } = compile(`COLOR=(1,7,7,7)
COLOR=NEW`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /COLOR=\(1,7,7,7\)/);
  assert.match(msx, /COLOR=NEW/);
});

test("グラフィック: LINE の末尾 B/BF（箱・塗り箱）は改名されない", () => {
  const { msx, diagnostics } = compile(`LINE (0,0)-(10,10),15,B
LINE (0,0)-(20,20),4,BF`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /LINE \(0,0\)-\(10,10\),15,B\b/);
  assert.match(msx, /LINE \(0,0\)-\(20,20\),4,BF\b/);
});

test("BF はLINE末尾以外では通常のユーザ変数として改名される", () => {
  const { msx, diagnostics } = compile(`BF = 3
PRINT BF`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 2文字名へ割り当てられ、代入と参照が同じ名前に解決される（生の BF は残らない）
  assert.ok(!/\bBF\b/.test(msx), "BF が改名される");
  const m = msx.match(/(\b[A-Z]{1,2})=3/);
  assert.ok(m, "BF が変数名へ");
  assert.match(msx, new RegExp(`PRINT ${m![1]}\\b`));
});

test("節キーワードと同名のユーザ変数は文脈で区別される（PAGE）", () => {
  // SET の外で使う PAGE は通常のユーザ変数として一貫して改名される
  const { msx, diagnostics } = compile(`PAGE = 5
PRINT PAGE`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 代入先と参照が同じ2文字名に解決される（不整合で壊れない）
  const m = msx.match(/(\b[A-Z]{1,2})=5/);
  assert.ok(m, "PAGE が2文字名へ");
  assert.match(msx, new RegExp(`PRINT ${m![1]}\\b`));
  assert.ok(!/\bPAGE\b/.test(msx), "生の PAGE は残らない");
});

test("戻り値の無い手続きFUNCTIONの末尾にRETURNが補われる", () => {
  const { msx, diagnostics } = compile(`FUNCTION SETUP()
    GLOBAL X
    X = 5
END FUNCTION
SETUP()
PRINT X`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 関数ブロックの最後が RETURN で終わる（GOSUB が落ちない）
  const fnPart = msx.slice(msx.indexOf("=== FUNCTION SETUP"));
  assert.match(fnPart.trim(), /RETURN\s*$/);
});
