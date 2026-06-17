import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const { code, diagnostics: td } = transform(program);
  return { code, diagnostics: [...ld, ...pd, ...td], msx: renderMsx(code).replace(/\r/g, "") };
};

test("SCAN: CONTINUE→NEXT行, BREAK→NEXT直後, 配列REF(ゼロコピー)", () => {
  const { msx, diagnostics } = compile(`FUNCTION SCAN(REF A, N)
    FOR I = 1 TO N
        IF A(I) = 0 THEN
            CONTINUE
        END IF
        IF A(I) < 0 THEN
            BREAK
        END IF
        PRINT A(I)
    NEXT
    RETURN 0
END FUNCTION
DIM A(5)
LET R = SCAN(REF A, 5)`);
  assert.deepEqual(diagnostics, []);
  const expected = [
    "100 ' === MAIN ===",
    "110 DIM A(5)",
    "120 D=5: GOSUB 1000: B=E",
    "130 END",
    "1000 ' === FUNCTION SCAN (A->A) ===",
    "1010 FOR C=1 TO D",
    "1020 IF A(C)=0 THEN GOTO 1050",
    "1030 IF A(C)<0 THEN GOTO 1060",
    "1040 PRINT A(C)",
    "1050 NEXT",
    "1060 E=0: RETURN",
  ].join("\n");
  assert.equal(msx, expected);
  // CONTINUE は NEXT 行(1050)へ、BREAK は NEXT 直後(1060)へ
  assert.match(msx, /A\(C\)=0 THEN GOTO 1050/);
  assert.match(msx, /A\(C\)<0 THEN GOTO 1060/);
});

test("IF/ELSE: GOTO平坦化（IF NOT(cond) THEN else, GOTO endif）", () => {
  const { msx, diagnostics } = compile(`LET X = 5
IF X > 0 THEN
    PRINT "POS"
    LET F = 1
ELSE
    PRINT "NONPOS"
END IF
PRINT F`);
  assert.deepEqual(diagnostics, []);
  const expected = [
    "100 ' === MAIN ===",
    "110 A=5",
    "120 IF NOT(A>0) THEN 160",
    '130 PRINT "POS"',
    "140 B=1",
    "150 GOTO 170",
    '160 PRINT "NONPOS"',
    "170 PRINT B",
    "180 END",
  ].join("\n");
  assert.equal(msx, expected);
});

test("多重ループ: BREAK は最内ループのみ脱出", () => {
  const { msx, diagnostics } = compile(`FUNCTION F()
    FOR I = 1 TO 3
        FOR J = 1 TO 3
            IF J = 2 THEN
                BREAK
            END IF
            PRINT J
        NEXT
        PRINT 99
    NEXT
    RETURN 0
END FUNCTION
LET R = F()`);
  assert.deepEqual(diagnostics, []);
  // 内側ループのNEXTが2つ、BREAKは内側NEXT直後（外側のPRINT 99側）へ飛ぶ
  const lines = msx.split("\n");
  const brk = lines.find((l) => /THEN GOTO/.test(l));
  assert.ok(brk, "BREAK の GOTO 行がある");
  // 内側の NEXT と 外側の NEXT が両方出力される
  assert.equal(lines.filter((l) => /\bNEXT\b/.test(l)).length, 2);
});

test("ガード節: IF cond THEN RETURN/CONTINUE/BREAK は1行化", () => {
  const { msx } = compile(`FUNCTION ABS(N)
    IF N < 0 THEN
        RETURN 0 - N
    END IF
    RETURN N
END FUNCTION
LET Y = ABS(0 - 3)`);
  // 単一RETURNのIFは1行 IF…THEN …:RETURN に畳み込む
  assert.match(msx, /IF .*<0 THEN .*RETURN/);
});
