// SPRITE name … END SPRITE：ドット絵パターン定義を CONST（パターン番号）＋ SPRITE$ 代入へ
// desugar し、素の PUT SPRITE で「番号の代わりに名前」を使える（SPRITE$ の罠を解消）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";
import { formatSource } from "../src/format/format.ts";

function compile(src: string, opts = {}) {
  const { tokens } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program, opts);
  return { code: r.code, text: renderMsx(r.code), diags: [...pd, ...r.diagnostics] };
}
const errs = (src: string, opts = {}) => compile(src, opts).diags.filter((d) => d.severity === "error");
const warns = (src: string, opts = {}) => compile(src, opts).diags.filter((d) => d.severity === "warning");

// 8×8: 1行 SPRITE$(0)=CHR$…（8バイト）＋ PUT SPRITE のパターン名が 0 に解決される。
test("8×8: SPRITE ブロックが SPRITE$ 代入へ展開され、名前がパターン番号にインラインされる", () => {
  const { text, diags } = compile(`SCREEN 1,0
SPRITE BALL
    "..####.."
    ".######."
    "########"
    "########"
    "########"
    "########"
    ".######."
    "..####.."
END SPRITE
PUT SPRITE 0, (100, 80), 15, BALL`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);
  // CONST は出力に残らない。SPRITE$(0)= が生成される。
  assert.ok(/SPRITE\$\(0\)=CHR\$\(/.test(text), text);
  // パターン名 BALL は番号 0 に解決（PUT SPRITE …,0）。BALL という変数は出力に現れない。
  assert.ok(/PUT SPRITE 0,\(100,80\),15,0/.test(text.replace(/\s/g, "")) || /PUT SPRITE 0, ?\(100, ?80\), ?15, ?0/.test(text), text);
  assert.ok(!/BALL/.test(text), "パターン名が出力に漏れている: " + text);
});

// バイト化の正しさ: 各行 8px を MSB 先頭で1バイトに詰める。
test("8×8: ドット絵が正しいバイト列（MSB=左端）になる", () => {
  const { text } = compile(`SCREEN 1,0
SPRITE T
    "#......."
    ".#......"
    "..#....."
    "...#...."
    "....#..."
    ".....#.."
    "......#."
    ".......#"
END SPRITE`);
  // 対角線: 128,64,32,16,8,4,2,1
  for (const b of [128, 64, 32, 16, 8, 4, 2, 1]) assert.ok(text.includes(`CHR$(${b})`), `${b} が無い: ${text}`);
});

// 16×16: 32バイト・4象限順（左上→左下→右上→右下）。255制限回避で一時変数へ分割連結。
test("16×16: 32バイトが象限順に並び、一時変数経由で SPRITE$ へ代入される", () => {
  const rows = [
    "#...............", // 左上 r0 -> 象限TL byte0 = 0x80 = 128
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................", // r8
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...............#", // r15 col15 -> 右下 byte7 の bit0 = 1
  ];
  const src = `SCREEN 1,2\nSPRITE BIG\n${rows.map((r) => `    "${r}"`).join("\n")}\nEND SPRITE`;
  const { text, diags } = compile(src);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0, JSON.stringify(diags));
  // 先頭バイト(左上 r0) = 128、末尾バイト(右下 r15) = 1。
  assert.ok(text.includes("CHR$(128)"), "左上先頭バイト128が無い: " + text);
  assert.ok(text.includes("CHR$(1)"), "右下末尾バイト1が無い: " + text);
  // 一時文字列変数への分割（複数行）→ SPRITE$(0)= で確定。
  assert.ok(/SPRITE\$\(0\)=/.test(text), text);
  // どの1行も255文字以内。
  for (const line of text.split(/\r?\n/)) assert.ok(line.length <= 255, "255文字超過: " + line);
});

// (b) SCREEN のサイズ引数と不一致は警告（エラーではない）。
test("SCREEN サイズ不一致は警告（16×16 定義に SCREEN ,0）", () => {
  const src = `SCREEN 1,0
SPRITE BIG
${Array.from({ length: 16 }, () => `    "${"#".repeat(16)}"`).join("\n")}
END SPRITE`;
  const w = warns(src);
  assert.ok(w.some((d) => d.code === "W_SPRITE_SCREEN"), "W_SPRITE_SCREEN 警告が出ていない: " + JSON.stringify(w));
  assert.equal(errs(src).length, 0);
});

// 8×8 と 16×16 の混在は警告。
test("8×8 と 16×16 の混在は警告 W_SPRITE_MIXED", () => {
  const src = `SPRITE A
${Array.from({ length: 8 }, () => `    "${"#".repeat(8)}"`).join("\n")}
END SPRITE
SPRITE B
${Array.from({ length: 16 }, () => `    "${"#".repeat(16)}"`).join("\n")}
END SPRITE`;
  assert.ok(warns(src).some((d) => d.code === "W_SPRITE_MIXED"), JSON.stringify(warns(src)));
});

// エラー系: サイズ不正 / 不正文字 / 重複名。
test("エラー: 行数が 8/16 でない・不正文字・名前重複", () => {
  assert.ok(errs(`SPRITE X\n    "###"\n    "###"\n    "###"\nEND SPRITE`).some((d) => d.code === "E_SPRITE_SIZE"));
  assert.ok(errs(`SPRITE X\n${Array.from({ length: 8 }, () => `    "..??...."`).join("\n")}\nEND SPRITE`).some((d) => d.code === "E_SPRITE_CHAR"));
  const dup = `SPRITE X\n${Array.from({ length: 8 }, () => `    "${".".repeat(8)}"`).join("\n")}\nEND SPRITE\nSPRITE X\n${Array.from({ length: 8 }, () => `    "${".".repeat(8)}"`).join("\n")}\nEND SPRITE`;
  assert.ok(errs(dup).some((d) => d.code === "E_SPRITE_DUP"), JSON.stringify(errs(dup)));
});

// SPRITE ON / SPRITE$ / PUT SPRITE は従来どおり（ブロックと誤認しない）。
test("SPRITE ON / SPRITE$ / PUT SPRITE は素通し（ブロック化しない）", () => {
  const { text, diags } = compile(`SCREEN 1,0
SPRITE DOT
${Array.from({ length: 8 }, () => `    "${"#".repeat(8)}"`).join("\n")}
END SPRITE
SPRITE ON
PUT SPRITE 0, (10, 10), 1, DOT
SPRITE OFF`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0, JSON.stringify(diags));
  assert.ok(/SPRITE ON/.test(text) && /SPRITE OFF/.test(text), text);
});

// STRICT モードでもパターン名は型サフィックス不要（コンパイラ生成の整数ラベル定数）。
test("STRICT: SPRITE 名は型サフィックス無しでも E_STRICT_UNTYPED にならない", () => {
  const src = `STRICT
SCREEN 1,0
SPRITE BALL
${Array.from({ length: 8 }, () => `    "${"#".repeat(8)}"`).join("\n")}
END SPRITE
PUT SPRITE 0, (10, 10), 15, BALL`;
  const { text, diags } = compile(src);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0, JSON.stringify(diags));
  assert.ok(/PUT SPRITE 0,\(10,10\),15,0/.test(text), text); // BALL がパターン番号 0 に解決
  assert.ok(!/BALL/.test(text), "パターン名が出力に漏れている: " + text);
});

// 整形: SPRITE ブロックは本体を1段インデント、END SPRITE で戻る。
test("フォーマッタ: SPRITE ブロックが正しくインデントされる", () => {
  const out = formatSource(`SPRITE BALL\n"..####.."\n"########"\n"########"\n"..####.."\n"..####.."\n"########"\n"########"\n"..####.."\nEND SPRITE`);
  const lines = out.split("\n");
  assert.equal(lines[0], "SPRITE BALL");
  assert.ok(lines[1].startsWith("    \""), "本体がインデントされていない: " + JSON.stringify(lines[1]));
  assert.equal(lines[lines.length - 1], "END SPRITE");
});
