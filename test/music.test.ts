import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import {
  parseMmlDoc,
  songToMml,
  songToPlayBasic,
  songToFeederBasic,
  songToNotes,
  notesToSong,
  expandGlides,
  sfxSweepBasic,
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

test("BGMフィーダ生成: 非ブロック(PLAY(0))＋DATASET で有効なMSXに変換できる", async () => {
  const { song } = parseMmlDoc("@tempo 132\nA: O4 L8 CDEFGAB>C\nB: O2 L4 CEGE\n");
  const { code } = songToFeederBasic(song, { func: "BGM" });
  assert.match(code, /FUNCTION BGM_TICK\(\)/);
  assert.match(code, /IF PLAY\(0\) <> 0 THEN/); // 非ブロック（キューが空いた時だけ積む）
  assert.match(code, /DATASET BGM_DATA/);
  assert.match(code, /T132/); // 各小節にテンポ確立
  const { transform, renderMsx } = await import("../src/transform/transformer.ts");
  const main = "SCREEN 1\nBGM_LOAD()\nBGM_START()\nWHILE 1\n BGM_TICK()\nWEND\n";
  const tk = tokenize(main + code);
  const ast = parse((tk as { tokens?: unknown }).tokens ?? tk);
  const tr = transform((ast as { program?: unknown }).program ?? ast);
  const errs = (tr.diagnostics ?? []).filter((d: { severity: string }) => d.severity === "error");
  assert.equal(errs.length, 0, "変換エラーなし");
  assert.match(renderMsx(tr.code), /PLAY [A-Z]\$\([A-Z]%?\)/); // 配列からの PLAY
});

test("グライド(方式A): glideTo音符が半音下降ランへ展開される", () => {
  // O5C(60) → O4C(48) を1拍でグライド
  const song = notesToSong(
    [{ id: "A", name: "melody", notes: [{ start: 0, dur: 48, pitch: 60, vol: 8, glideTo: 48 }], ctrls: [] }],
    { tempo: 120, timesig: [4, 4] },
  );
  const notes = expandGlides(song).channels[0].events.filter((e) => e.t === "note");
  assert.ok(notes.length >= 8, "多数の刻み音符に展開");
  assert.equal(notes[0].pitch, 60);
  assert.equal(notes[notes.length - 1].pitch, 48, "最後は glideTo に着地");
  // MML 出力にも下降ランが出る
  assert.match(songToMml(song), /A: .*O5C.*C/);
});

// 回帰: グライドは「音階の再現」を優先して「音の長さ」を落としてはいけない。
// 旧実装は刻み長に floor(dur/n) を使い(グリッド外の半端が発生)、emit が単一MML長へ丸めて
// 端数を捨てていたため、グライド音符が最大~10%短くなり3声の等長化(同期)が崩れた。
// 刻みを L64グリッド(3tick)に量子化＋端数を連結(tie)で出し切ることで合計tickを厳密保存する。
test("グライド: 展開後の合計tickが元の音符長と完全一致(音長を落とさない)", () => {
  const durs = [24, 36, 48, 72, 96, 144, 192];
  for (const dur of durs) {
    for (const semis of [1, 2, 4, 6, 9, 10, 12]) {
      const song = notesToSong(
        [{ id: "A", name: "A", notes: [{ start: 0, dur, pitch: 48, glideTo: 48 + semis }], ctrls: [] }],
        { tempo: 120, timesig: [4, 4] },
      );
      // (1) 展開後イベントの合計tick
      const expanded = expandGlides(song).channels[0].events;
      const sumExpanded = expanded.reduce((a, e) => a + (e.t === "ctrl" ? 0 : e.dur), 0);
      assert.equal(sumExpanded, dur, `expandGlides 合計tick (dur=${dur}, semis=${semis})`);
      // (2) MML へ出力→再パースした合計tick(emit の丸めで落ちないこと)
      const { song: back } = parseMmlDoc(songToMml(song));
      const sumBack = back.channels[0].events.reduce((a, e) => a + (e.t === "ctrl" ? 0 : e.dur), 0);
      assert.equal(sumBack, dur, `MML往復 合計tick (dur=${dur}, semis=${semis})`);
    }
  }
});

test("急降下SFX(方式B): PSGスイープが有効なMSXに変換できる", async () => {
  const { code, warnings } = sfxSweepBasic(72, 36, { func: "SFX_DROP" }); // O6C→O3C
  assert.equal(warnings.length, 0);
  assert.match(code, /FUNCTION SFX_DROP\(\)/);
  assert.match(code, /SOUND 7,/); // ミキサ
  assert.match(code, /FOR P = 107 TO 855 STEP/); // 高音(小period)→低音(大period)へスイープ
  const { transform, renderMsx } = await import("../src/transform/transformer.ts");
  const tk = tokenize("SCREEN 1\nSFX_DROP()\n" + code);
  const ast = parse((tk as { tokens?: unknown }).tokens ?? tk);
  const tr = transform((ast as { program?: unknown }).program ?? ast);
  assert.equal((tr.diagnostics ?? []).filter((d: { severity: string }) => d.severity === "error").length, 0);
  assert.match(renderMsx(tr.code), /SOUND 0,\w+ AND 255/);
});

test("Song ⇄ 絶対ノート(GUI用): 休符が隙間になり戻せる", () => {
  const { song } = parseMmlDoc("@tempo 120\nA: O4 L4 C R E G\n");
  const grid = songToNotes(song);
  const notes = grid.channels[0].notes;
  assert.equal(notes.length, 3); // C, E, G（Rは隙間）
  assert.equal(notes[0].start, 0);
  assert.equal(notes[1].start, 96); // C(48)+R(48)=96
  const back = notesToSong(grid.channels, { tempo: grid.tempo, timesig: grid.timesig });
  assert.equal(songToMml(back), songToMml(song));
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
