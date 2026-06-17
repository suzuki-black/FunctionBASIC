import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";
import { reverse } from "../src/reverse/reverse.ts";

const compile = (src: string) => {
  const { tokens } = tokenize(src);
  const { program } = parse(tokens);
  return transform(program);
};
// 往復: 構造化 → MSX → 逆変換(構造化) → MSX が一致するか
const roundTrip = (src: string) => {
  const fwd = compile(src);
  const rev = reverse(fwd.code, fwd.map);
  const re = compile(rev.source);
  return {
    ok: renderMsx(fwd.code) === renderMsx(re.code),
    restored: rev.source,
    revDiag: rev.diagnostics,
  };
};

const FIND_ZERO = `' 見つける
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
A(3) = 0
RESULT = FIND_ZERO(POS)
PRINT "FOUND="; RESULT; " AT "; POS`;

const SCAN = `FUNCTION SCAN(REF A, N)
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
R = SCAN(REF A, 5)`;

test("FIND_ZERO: 往復一致（変換→逆変換→再変換でMSX同一）", () => {
  const { ok, restored, revDiag } = roundTrip(FIND_ZERO);
  assert.deepEqual(revDiag, []);
  assert.ok(ok, "往復でMSXが一致");
  // 復元された構造化に主要素が含まれる
  assert.match(restored, /FUNCTION FIND_ZERO\(REF IDX\)/);
  assert.match(restored, /GLOBAL A/);
  assert.match(restored, /FIND_ZERO\(REF POS\)/);
  assert.match(restored, /IF A\(I\)=0 THEN/);
  assert.match(restored, /RETURN 1/);
});

test("SCAN: 往復一致（BREAK/CONTINUE を GOTO から復元）", () => {
  const { ok, restored, revDiag } = roundTrip(SCAN);
  assert.deepEqual(revDiag, []);
  assert.ok(ok, "往復でMSXが一致");
  assert.match(restored, /FUNCTION SCAN\(REF A, N\)/);
  assert.match(restored, /CONTINUE/);
  assert.match(restored, /BREAK/);
});

test("GOTO形式IF/ELSE: 往復一致＋ブロックIF/ELSE復元", () => {
  const { ok, restored, revDiag } = roundTrip(`LET X = 5
IF X > 0 THEN
    PRINT "POS"
    LET F = 1
ELSE
    PRINT "NONPOS"
END IF
PRINT F`);
  assert.deepEqual(revDiag, []);
  assert.ok(ok, "往復一致");
  assert.match(restored, /IF X>0 THEN/);
  assert.match(restored, /ELSE/);
  assert.match(restored, /END IF/);
});

test("ネストした IF in FOR: 往復一致", () => {
  const { ok, revDiag } = roundTrip(`LET S = 0
FOR I = 1 TO 5
    IF I > 2 THEN
        LET S = S + I
        PRINT I
    END IF
NEXT
PRINT S`);
  assert.deepEqual(revDiag, []);
  assert.ok(ok, "往復一致");
});

test("2文字名が元の変数名に戻る", () => {
  const { restored } = roundTrip(`FUNCTION DBL(N)
    LET RESULT = N * 2
    RETURN RESULT
END FUNCTION
PLAYER_SCORE = 0
PLAYER_SCORE = DBL(21)
PRINT PLAYER_SCORE`);
  assert.match(restored, /PLAYER_SCORE/);
  assert.match(restored, /FUNCTION DBL\(N\)/);
});
