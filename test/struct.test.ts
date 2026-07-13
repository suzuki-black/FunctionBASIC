// STRUCT v1（struct-of-arrays へ desugar。実行時コストは手書き並行配列と同一）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

function compile(src: string) {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return { code: r.code, text: renderMsx(r.code), diags: [...pd, ...r.diagnostics] };
}
const errCodes = (src: string) => compile(src).diags.filter((d) => d.severity === "error").map((d) => d.code);

test("STRUCT 配列: フィールドごとに配列へ、foe(i).f は array(i) の1アクセス（ゼロコスト）", () => {
  const { text, diags } = compile(`STRUCT Enemy
    X%, Y%, HP%
END STRUCT
DIM foe(3) AS Enemy
foe(0).X = 10
foe(0).HP = foe(0).HP - 5
PRINT foe(0).HP`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // 3フィールド → 3配列 DIM
  assert.match(text, /DIM [A-Z]+%\(3\),[A-Z]+%\(3\),[A-Z]+%\(3\)/);
  // 代入は1配列アクセス（余計な間接なし）
  assert.match(text, /^\d+ [A-Z]+%\(0\)=10$/m);
  assert.match(text, /[A-Z]+%\(0\)=[A-Z]+%\(0\)-5/);
});

test("STRUCT スカラ: DIM 不要でフィールドは単純変数", () => {
  const { text, diags } = compile(`STRUCT Point
    X%, Y%
END STRUCT
DIM p AS Point
p.X = 3
p.Y = p.X + 1`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.doesNotMatch(text, /DIM/); // スカラは DIM を生成しない
  assert.match(text, /^\d+ [A-Z]+%=3$/m);
  assert.match(text, /[A-Z]+%=[A-Z]+%\+1/);
});

test("STRUCT: GLOBAL インスタンスは全フィールドへ展開＝関数跨ぎで同じ配列を共有", () => {
  const { text, diags } = compile(`STRUCT Enemy
    X%, HP%
END STRUCT
DIM foe(2) AS Enemy
GLOBAL foe
FUNCTION HURT(I%)
    GLOBAL foe
    foe(I%).HP = foe(I%).HP - 1
END FUNCTION
foe(0).HP = 10
HURT(0)`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // MAIN の foe(0).HP と 関数内 foe(I%).HP が同じMSX配列名を指す（HP フィールド配列）
  const mainHp = text.match(/^\d+ ([A-Z]+%)\(0\)=10$/m);
  assert.ok(mainHp, "MAIN で HP フィールド配列へ代入");
  const hpArr = mainHp![1];
  assert.ok(new RegExp(`${hpArr}\\([A-Z]+%\\)=${hpArr}\\(`).test(text), "関数内も同じHP配列を使う");
});

test("STRUCT: エラー（未定義型 / 未知フィールド / 非インスタンス / 型なしフィールド）", () => {
  assert.ok(errCodes(`DIM x(2) AS NoSuch\nx(0).a=1`).includes("E_STRUCT_UNKNOWN"));
  assert.ok(errCodes(`STRUCT P\nX%\nEND STRUCT\nDIM p AS P\np.NOPE=1`).includes("E_STRUCT_FIELD"));
  assert.ok(errCodes(`GLOBAL Q%\nQ.X=1`).includes("E_STRUCT_NOT_INSTANCE"));
  assert.ok(errCodes(`STRUCT P\nX\nEND STRUCT\nDIM p AS P`).includes("E_STRUCT_FIELD_TYPE"));
});

test("STRUCT: 文字列フィールドも扱える", () => {
  const { text, diags } = compile(`STRUCT Item
    NAME$, COST%
END STRUCT
DIM inv(4) AS Item
inv(0).NAME$ = "SWORD"
inv(0).COST% = 50`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  assert.match(text, /DIM [A-Z]+\$\(4\),[A-Z]+%\(4\)/); // 文字列配列 + 整数配列
  assert.match(text, /[A-Z]+\$\(0\)="SWORD"/);
});
