import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import {
  parseMmlDoc,
  songToMml,
  songToPlayBasic,
  lenToTicks,
  ticksToLen,
  type Song,
} from "../src/music/mml.ts";
import { programToSong } from "../src/music/decompile.ts";

function msxbToSong(src: string, func?: string): Song | null {
  const tk = tokenize(src);
  const ast = parse((tk as { tokens?: unknown }).tokens ?? tk);
  return programToSong((ast as { program?: unknown }).program ?? ast, { func }).song;
}

test("音長 <-> tick: 付点も対で戻る", () => {
  assert.equal(lenToTicks(4, 0), 48);
  assert.equal(lenToTicks(8, 0), 24);
  assert.equal(lenToTicks(4, 1), 72); // 付点4分
  assert.deepEqual(ticksToLen(48), { n: 4, dots: 0 });
  assert.deepEqual(ticksToLen(72), { n: 4, dots: 1 });
});

test("import: MML方言 → 読みやすいPLAY文（1小節=1 PLAY・3ch等長）", () => {
  const mml = "@tempo 120\n@timesig 4/4\nA: O4 L8 CDEF GAB>C | O5 CDEFGABC\nB: O2 L2 CG | FG\n";
  const { song } = parseMmlDoc(mml);
  const { code } = songToPlayBasic(song, { func: "BGM_TEST" });
  const playLines = code.split("\n").filter((l) => /PLAY /.test(l));
  assert.equal(playLines.length, 3); // T設定 + 2小節
  assert.ok(/PLAY "T120", "T120"/.test(playLines[0]));
  assert.ok(playLines[1].includes("O4") && playLines[1].includes("O2"));
});

test("生成した PLAY 文は FunctionBASIC で有効な MSX-BASIC に変換できる", async () => {
  const mml = "@tempo 120\nA: O4 L8 CDEFGAB>C\nB: O2 L4 CEGE\n";
  const { song } = parseMmlDoc(mml);
  const { code } = songToPlayBasic(song, { func: "BGM_TEST" });
  const { transform, renderMsx } = await import("../src/transform/transformer.ts");
  const src = "SCREEN 1\nBGM_TEST()\n" + code;
  const tk = tokenize(src);
  const ast = parse((tk as { tokens?: unknown }).tokens ?? tk);
  const tr = transform((ast as { program?: unknown }).program ?? ast, { stripComments: true });
  const errs = (tr.diagnostics ?? []).filter((d: { severity: string }) => d.severity === "error");
  assert.equal(errs.length, 0, "変換エラーなし");
  assert.ok(/PLAY /.test(renderMsx(tr.code)));
});

test("往復: MML → PLAY.msxb → デコンパイル で音程/音長が一致", () => {
  const mml = "@tempo 132\n@timesig 4/4\nA: O4 L8 CDEF GAB>C | O5 C4 <A4 G2\nB: O2 L4 C E G E | F1\n";
  const { song } = parseMmlDoc(mml);
  const norm1 = songToMml(song);
  const { code } = songToPlayBasic(song, { func: "BGM_RT" });
  const song2 = msxbToSong(code, "BGM_RT");
  assert.ok(song2, "デコンパイル成功");
  const norm2 = songToMml(song2!);
  assert.equal(norm2, norm1, "往復で MML 正規形が一致");
  assert.equal(song2!.tempo, 132);
});

test("デコンパイル: 非リテラルな PLAY 引数はスキップして警告", () => {
  const src = 'FUNCTION T()\n GLOBAL M$\n PLAY "O4L4CDEF", M$\nEND FUNCTION\n';
  const tk = tokenize(src);
  const ast = parse((tk as { tokens?: unknown }).tokens ?? tk);
  const { song, warnings } = programToSong((ast as { program?: unknown }).program ?? ast, { func: "T" });
  assert.ok(song, "リテラルchは復元される");
  assert.ok(warnings.some((w) => /非リテラル/.test(w)), "非リテラル警告あり");
  // ch A(melody) の音符は4つ
  const notes = song!.channels[0].events.filter((e) => e.t === "note");
  assert.equal(notes.length, 4);
});
