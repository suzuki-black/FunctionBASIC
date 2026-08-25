// FunctionBASIC 音楽ツール CLI。中間フォーマット(MML方言) <-> 読みやすい PLAY文(.msxb) を相互変換。
// 使い方:
//   node --experimental-strip-types music.mjs import [song.mml] [--func NAME] [--min-state] > bgm.msxb
//   node --experimental-strip-types music.mjs export <file.msxb> [--func NAME] > song.mml
//   node --experimental-strip-types music.mjs roundtrip <file.msxb> [--func NAME]
// 既定出力=標準出力（パイプ/リダイレクトで受け渡し）。入力ファイル省略時は標準入力。
import { readFileSync } from "node:fs";
import { tokenize } from "./src/lexer/lexer.ts";
import { parse } from "./src/parser/parser.ts";
import { parseMmlDoc, songToMml, songToPlayBasic } from "./src/music/mml.ts";
import { programToSong } from "./src/music/decompile.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const VALUE_FLAGS = new Set(["--func"]); // 値を1つ取るフラグ（位置引数と混同しないため）
const flag = (name) => rest.includes(name);
const opt = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : null;
};
// 位置引数（=入力ファイル）を、フラグとその値を除いて拾う
const positionals = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith("--")) {
    if (VALUE_FLAGS.has(a)) i++; // 値を1つ読み飛ばす
    continue;
  }
  positionals.push(a);
}
const file = positionals[0];
const func = opt("--func") ?? undefined;

const usage = () => {
  console.error(
    [
      "usage:",
      "  node --experimental-strip-types music.mjs import [song.mml] [--func NAME] [--min-state] > bgm.msxb",
      "  node --experimental-strip-types music.mjs export <file.msxb> [--func NAME] > song.mml",
      "  node --experimental-strip-types music.mjs roundtrip <file.msxb> [--func NAME]",
    ].join("\n"),
  );
  process.exit(1);
};
const readInput = () => {
  try {
    return file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch (e) {
    console.error(`入力を読めません: ${file ?? "<stdin>"} (${e.message})`);
    process.exit(1);
  }
};
const warn = (ws) => {
  for (const w of ws ?? []) console.error(`warning: ${w}`);
};
const msxbToSong = (src) => {
  const tk = tokenize(src);
  const ast = parse(tk.tokens ?? tk);
  return programToSong(ast.program ?? ast, { func });
};

if (cmd === "import") {
  const { song, warnings } = parseMmlDoc(readInput());
  const { code, warnings: w2 } = songToPlayBasic(song, { func, minState: flag("--min-state") });
  warn([...warnings, ...w2]);
  process.stdout.write(code);
} else if (cmd === "export") {
  if (!file) usage();
  const { song, warnings } = msxbToSong(readInput());
  warn(warnings);
  if (!song) process.exit(1);
  process.stdout.write(songToMml(song));
} else if (cmd === "roundtrip") {
  if (!file) usage();
  const src = readInput();
  const { song, warnings } = msxbToSong(src);
  warn(warnings);
  if (!song) process.exit(1);
  // song -> PLAY -> song' の一致を MML 正規化して比較
  const { code } = songToPlayBasic(song, { func });
  const tk2 = tokenize(code);
  const ast2 = parse(tk2.tokens ?? tk2);
  const { song: song2 } = programToSong(ast2.program ?? ast2, { func });
  const a = songToMml(song);
  const b = song2 ? songToMml(song2) : "";
  if (a === b) {
    console.log("roundtrip OK");
  } else {
    console.log("roundtrip DIFF");
    console.log("--- from source ---\n" + a);
    console.log("--- after PLAY re-decompile ---\n" + b);
    process.exit(2);
  }
} else {
  usage();
}
