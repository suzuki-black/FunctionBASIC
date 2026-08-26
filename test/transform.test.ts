import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const { code, diagnostics: td } = transform(program);
  return { code, diagnostics: [...ld, ...pd, ...td], msx: renderMsx(code) };
};

// examples/find-zero.msxb と同一の正しいデモ。MSX-BASIC は DIM 直後、数値配列の全要素が 0 なので
// まず 1..10 で埋めてから 3 番目だけ 0 に戻す（そうしないと最初の 0 は既定値の要素＝index 1 になる）。
const FIND_ZERO = `' find the first zero in an array
FUNCTION FIND_ZERO(REF IDX)
    GLOBAL A
    FOR I = 1 TO 10
        IF A(I) = 0 THEN
            IDX = I
            RETURN 1
        END IF
    NEXT I
    RETURN 0
END FUNCTION

DIM A(10)
' arrays start all-zero on DIM, so fill 1..10 first, then plant one 0
FOR I = 1 TO 10
    A(I) = I
NEXT I
A(3) = 0
RESULT = FIND_ZERO(WHERE)
PRINT "FOUND="; RESULT; " AT "; WHERE`;

test("FIND_ZERO ゴールデン出力", () => {
  const { msx, diagnostics } = compile(FIND_ZERO);
  assert.deepEqual(diagnostics, []);
  const expected = [
    "100 ' === MAIN ===",
    "110 ' find the first zero in an array",
    "120 DIM A(10)",
    "130 ' arrays start all-zero on DIM, so fill 1..10 first, then plant one 0",
    "140 FOR B=1 TO 10",
    "150 A(B)=B",
    "160 NEXT",
    "170 A(3)=0",
    "180 GOSUB 1000: C=F",
    '190 PRINT "FOUND=";C;" AT ";D',
    "200 END",
    "1000 ' === FUNCTION FIND_ZERO (IDX->D) ===",
    "1010 FOR E=1 TO 10",
    "1020 IF A(E)=0 THEN D=E: F=1: RETURN",
    "1030 NEXT",
    "1040 F=0: RETURN",
  ].join("\r\n");
  assert.equal(msx, expected);
});

test("行番号は昇順・重複なし、GOSUBは数値解決済み", () => {
  const { code, msx } = compile(FIND_ZERO);
  for (let i = 1; i < code.length; i++)
    assert.ok(code[i].lineNo > code[i - 1].lineNo, "行番号は厳密昇順");
  assert.ok(!msx.includes("@@"), "GOSUBプレースホルダが残っていない");
  assert.match(msx, /GOSUB 1000/);
});

test("REF名前置換: 呼び出し側の実変数を関数内で直接書き換える（ゼロコピー）", () => {
  const { msx } = compile(FIND_ZERO);
  // IDX は WHERE の割当名 D に置換され、関数内で D= が直接現れる（受渡変数やコピーバックは無い）
  assert.match(msx, /THEN D=E/);
  // 実行コードに IDX= のような構造化名の代入は残らない（コメント内の "IDX->D" 注記は可）
  assert.ok(!/\bIDX=/.test(msx), "IDX への代入は出力に残らない");
  // REF 実引数名 WHERE は割当名へ置換され、受渡変数/コピーバックとして残らない
  assert.ok(!/\bWHERE\b/.test(msx.replace(/'.*/g, "")), "受渡変数/コピーバックが無い");
});

test("再帰はソフトスタックで変換される（エラーにしない）", () => {
  const { diagnostics, msx } = compile(`FUNCTION F(N)
    LET X = F(N)
    RETURN X
END FUNCTION
LET Y = F(1)`);
  assert.ok(!diagnostics.some((d) => d.code === "E_RECURSION_UNSUPPORTED"));
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /DIM /);   // 再帰スタックの DIM が生成される
});

test("未定義関数の文呼び出しは E_UNKNOWN_FUNCTION", () => {
  // 文の位置の NOPE(1) は呼び出しとして解決される（式の位置は暗黙配列扱い）
  const { diagnostics } = compile(`NOPE(1)`);
  assert.ok(diagnostics.some((d) => d.code === "E_UNKNOWN_FUNCTION"));
});

test("2文字名アロケータ: 長い名前も2文字へ、グローバル/ローカルで一意", () => {
  const { msx } = compile(`FUNCTION DOUBLE(N)
    LET RESULT = N * 2
    RETURN RESULT
END FUNCTION
LET PLAYER_SCORE = 0
LET PLAYER_SCORE = DOUBLE(21)
PRINT PLAYER_SCORE`);
  // PLAYER_SCORE/RESULT のような長い名前が出力に残らない
  assert.ok(!/PLAYER_SCORE|RESULT/.test(msx));
});
