import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import type { Program } from "../src/ast/nodes.ts";

const parseSrc = (src: string) => {
  const { tokens, diagnostics: lexDiag } = tokenize(src);
  const { program, diagnostics } = parse(tokens);
  return { program, diagnostics: [...lexDiag, ...diagnostics] };
};

test("FIND_ZERO 全体をパースできる（エラーなし）", () => {
  const src = `' 配列の中から最初に 0 を見つけて返す
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
  const { program, diagnostics } = parseSrc(src);
  assert.deepEqual(diagnostics, []);
  assert.equal(program.functions.length, 1);
  const fn = program.functions[0];
  assert.equal(fn.name, "FIND_ZERO");
  assert.equal(fn.params.length, 1);
  assert.equal(fn.params[0].name, "IDX");
  assert.equal(fn.params[0].byRef, true);
  // 本体: GLOBAL, FOR(ネストしたIF), RETURN
  assert.equal(fn.body[0].type, "Global");
  assert.equal(fn.body[1].type, "For");
  // トップレベル: 先頭コメント, DIM, 配列代入, 代入(呼び出し), PRINT
  const tk = program.toplevel.map((s) => s.type);
  assert.deepEqual(tk, ["Comment", "Dim", "Let", "Let", "Builtin"]);
});

test("ネストした FOR の loopId と BREAK 対象", () => {
  const src = `FUNCTION F()
    FOR I = 1 TO 3
        FOR J = 1 TO 3
            BREAK
        NEXT J
    NEXT I
    RETURN 0
END FUNCTION`;
  const { program, diagnostics } = parseSrc(src);
  assert.deepEqual(diagnostics, []);
  const outer = program.functions[0].body[0];
  assert.equal(outer.type, "For");
  if (outer.type !== "For") return;
  const inner = outer.body[0];
  assert.equal(inner.type, "For");
  if (inner.type !== "For") return;
  const brk = inner.body[0];
  assert.equal(brk.type, "Break");
  if (brk.type !== "Break") return;
  // BREAK は最も内側ループ(inner)を指す
  assert.equal(brk.enclosingLoopId, inner.loopId);
  assert.notEqual(inner.loopId, outer.loopId);
});

test("ループ外 BREAK はエラー", () => {
  const { diagnostics } = parseSrc(`FUNCTION F()
    BREAK
    RETURN 0
END FUNCTION`);
  assert.ok(diagnostics.some((d) => d.code === "E_BREAK_OUTSIDE_LOOP"));
});

test("関数外 RETURN はエラー", () => {
  const { diagnostics } = parseSrc(`RETURN 1`);
  assert.ok(diagnostics.some((d) => d.code === "E_RETURN_OUTSIDE_FUNCTION"));
});

test("FUNCTION のネストはエラー", () => {
  const { diagnostics } = parseSrc(`FUNCTION A()
    FUNCTION B()
        RETURN 0
    END FUNCTION
    RETURN 0
END FUNCTION`);
  assert.ok(diagnostics.some((d) => d.code === "E_NESTED_FUNCTION"));
});

test("複数エラーをまとめて報告（panic-mode回復）", () => {
  // 2行とも壊れている
  const { diagnostics } = parseSrc(`X = = 1
Y = + `);
  assert.ok(diagnostics.length >= 2);
});

test("演算子優先順位: a + b * c は a + (b*c)", () => {
  const { program } = parseSrc(`X = A + B * C`);
  const let0 = program.toplevel[0];
  assert.equal(let0.type, "Let");
  if (let0.type !== "Let") return;
  const e = let0.expr;
  assert.equal(e.type, "Bin");
  if (e.type !== "Bin") return;
  assert.equal(e.op, "+");
  assert.equal(e.right.type, "Bin"); // B*C
  if (e.right.type !== "Bin") return;
  assert.equal(e.right.op, "*");
});

test("関数の戻り値型サフィックス", () => {
  const { program } = parseSrc(`FUNCTION GETNAME$()
    RETURN "x"
END FUNCTION`);
  assert.equal(program.functions[0].name, "GETNAME");
  assert.equal(program.functions[0].retSuffix, "$");
});

test("INCLUDE はトップレベルへ", () => {
  const { program, diagnostics } = parseSrc(`INCLUDE "lib.msxb"
X = 1`);
  assert.deepEqual(diagnostics, []);
  assert.equal(program.includes.length, 1);
  assert.equal(program.includes[0].path, "lib.msxb");
});
