# TODO

Tracked follow-ups that are not yet done (or not yet verifiable here).

## Sound verification (FM / MSX-AUDIO)

The transpiler output for MSX-MUSIC (FM) is **confirmed correct**: pasting the
converted BASIC into MSXPen (MSX2+ America) plays the FM music. The remaining
limitation is in our *embedded* player only.

- [x] **FM (MSX-MUSIC) silent in the embedded WebMSX — root cause found, workaround
  shipped (v0.1.43).** The in-app player embeds webmsx.org as a **cross-origin
  iframe**, and WKWebView / cross-origin iframes start their **Web Audio context
  suspended (muted)**; the emulator can't unmute it and no WebMSX URL param
  (`MACHINE=MSX2PA` + `PRESETS=MSXMUSIC`, `BASIC_ENTER` vs `BASIC_RUN`, etc.)
  changes that. So the embedded iframe stays silent **by design**. Workaround:
  **Open in external browser** (Run menu) — a real browser tab has no such
  restriction. FM programs (`CALL MUSIC` / `PLAY #2`) auto-launch there as
  **MSX2+ with `PRESETS=MSXMUSIC` and `OPLL_VOL` raised**, so sound just plays.
  The `allow="autoplay"` on the iframe was removed (it never applied to the
  cross-origin AudioContext). True in-app FM still needs the same-origin
  embedding below. (Also plays in MSXPen / openMSX / real hardware.)
- [ ] **MSX-AUDIO (Y8950 / OPL1)** is not emulated by WebMSX at all → verify on
  **openMSX** or real hardware. (`CALL AUDIO` etc. transpile correctly.)
- [ ] **turbo R `_TURBO`**: the run machine is MSX2+, so `examples/turbo-r.msxb`
  needs the WebMSX machine switched to turbo R (gear menu) to run. **Note:**
  `_TURBO` / `CALL TURBO` is a directive of **MSXべーしっ君 (Basic-kun, ASCII's
  BASIC compiler)** — legit as a keyword, so the transpiler passes it through — but
  it is **not** an interpreted MSX-BASIC statement, so a plain `RUN` in the WebMSX
  interpreter reports `Syntax error`. See the turbo R samples section below.

## OPLL music tooling (external converter + BIN+ASM path)

- MML-PLAY route for reproducing a reference recording is **abandoned** (decision):
  MML `@`/`V` re-attack per note → clicks / metallic noise; it can't reproduce
  register-level expression (ADSR decay, mid-phrase timbre) cleanly. The route
  that matches the reference is **BIN + ASM**: replay the VGM register dump.
- [ ] **BIN+ASM snare cutoff.** A snare/percussion hit occasionally drops out
  mid-playback in the ASM register-replay player. The `.BIN` data is byte-identical
  to the source VGM (converter output is valid), so the issue is the ASM player's
  `$0E` (rhythm key-on) timing, not the data. Investigate when the BIN+ASM path is
  resumed.

## Recently shipped (v0.1.43)

- [x] **Open in external browser** (FM audio; auto MSX2+ + MSX-MUSIC + OPLL_VOL).
- [x] **BLOAD binary bundling** — `.BIN` next to the `.msxb` is read verbatim and
  bundled into the run payload and exported `.dsk` (multi-file FAT12 builder).
- [x] **Fast boot setting** (opt-in, default off) — fast-forwards the boot so
  sound/video start sooner; playback tempo unchanged.
- [x] **Line-length fix** — budget raw ASCII bytes **including the line number**
  (a >255-byte `DATA` line was losing its closing quote → spurious `Syntax error`).
- [x] **Security** — `read_binary` rejects path separators / `..` / absolute paths.

## Proposed ideas — candidates, prioritized (2026-07-31 brainstorm)

Low-cost (both to implement, and in MSX-side RAM/speed) ideas across five axes:
speedups, structured-BASIC language features, editor features, editor performance,
beginner-friendliness. **Priority:** P1 = high (recommended, best cost/impact),
P2 = medium, P3 = lower (risk or higher cost). Nothing here is committed yet.

### P1 — high priority

- [ ] **[speed] Hot-variable placement** — MSX looks up simple variables by a linear
  scan of a creation-ordered table, so variables created earliest resolve fastest.
  Emit the hottest variables' first-touch early (or order first assignments) so
  frequently-used names sit near the front. Variable-side analog of the existing
  hot-function placement; semantically inert. *Concern:* count usages accurately
  (loops weight more); keep it opt-in + guarded. *Accept:* a benchmark loop reads a
  hot var measurably faster; runtime results identical with/without.
- [ ] **[speed] Integer-suffix (`%`) performance hint (lint)** — Z80 integer math is
  several× faster than float. Flag FOR counters / accumulators that are only ever
  integer and suggest a `%` suffix. *Concern:* **hint only, never auto-convert** —
  `%` overflows at 32767 and changes `/` semantics. *Accept:* the demo shooter's
  float loop var raises the hint; no false positive on a var that takes a fractional value.
- [ ] **[lang] `ENUM`** — `ENUM STATE : IDLE, RUN, JUMP END ENUM` lowers to
  `CONST STATE_IDLE=0 …`. Pairs with SELECT CASE; makes state machines readable.
  *Concern:* namespacing (`STATE_IDLE` vs bare `IDLE`); explicit values + auto-increment.
  *Accept:* enum members fold as literals; duplicate/again-defined names error; SELECT CASE over an enum works.
- [ ] **[lang] Compound assignment `+= -= *= /=`** — `SCROLL% += 1` → `SCROLL% = SCROLL% + 1`.
  Pure sugar; big win against long descriptive names. *Concern:* parenthesize RHS;
  only for scalars / struct fields / array elements with a plain lvalue. *Accept:*
  `A(I) += F(X)` evaluates the index/RHS once and matches the expanded form.
- [ ] **[editor] Outline / structure panel** — list FUNCTION / STRUCT / DATASET /
  SPRITE / EVENT with click-to-jump (parser already has the spans). *Accept:* opening
  a large example lists every top-level construct; clicking scrolls to it.
- [ ] **[editor+beginner] SPRITE dot-art live preview** — render each `.`/`#` block as
  a real, color-swatched sprite (8×8 / 16×16) beside the block or in a panel.
  *Concern:* respect the SCREEN sprite size; light DOM/canvas only. *Accept:* editing a
  row updates the preview; a size mismatch is shown.
- [ ] **[perf] Move transpile/validate into a Web Worker** — run the zero-dependency
  core off the main thread so typing never janks on big projects (keeps the
  no-dependency stance). *Concern:* message-passing for the project graph; keep a sync
  fallback. *Accept:* typing in a large file stays smooth while validation runs.
- [ ] **[perf] Transpile-result cache (skip if source unchanged)** — hash inputs and
  reuse the last result. *Accept:* re-running with no edits does zero transpile work.
- [ ] **[beginner] Starter templates + sample gallery** — New → Hello / sprite-mover /
  sound demo, and open `examples/` from a menu. Shortens the first step. *Accept:*
  a new user reaches a running program in a couple of clicks.
- [ ] **[beginner] Searchable command reference** — reuse the built-in command table to
  offer a searchable "what's supported" list with one-line descriptions. *Accept:*
  searching `PLAY` shows it's supported with a short note.

### P2 — medium priority

- [ ] **[speed] Auto-inline single-use FUNCTION** — a function called from exactly one
  site inlines (MACRO-equivalent), dropping the `GOSUB`. Opt-in + guarded. *Concern:*
  recursion / address-taken cases must be excluded.
- [ ] **[speed] Loop-invariant hoisting** — lift side-effect-free invariant subexpressions
  (`LEN(A$)`, constant folds) out of `FOR`/`WHILE`. *Concern:* prove no side effects and
  no assignment to referenced vars inside the loop.
- [ ] **[lang] Built-in `TRUE` / `FALSE`** — predefined constants (`-1` / `0`) so
  beginners don't trip on MSX's truthiness. *Concern:* allow user shadowing? probably error under STRICT.
- [ ] **[lang] `WITH` block for STRUCT** — `WITH FOE(3): .HP%=100: .X%=…: END WITH`
  reduces field-access repetition (textual expansion). *Concern:* nested WITH; `.field` scoping.
- [ ] **[lang] `ASSERT cond`** — debug check lowering to `IF NOT(cond) THEN PRINT…:STOP`,
  stripped when optimizations are on. *Accept:* assert fires in debug, vanishes in optimized output.
- [ ] **[editor] Generated size / line-budget indicator** — surface the already-computed
  generated line count and "near 255B / line-number overflow" warnings before Run.
- [ ] **[editor] Hover tooltip (name → MSX 2-char name + line)** — reuse the conversion-table
  data on hover; more discoverable than the split-view highlight.
- [ ] **[editor] Snippet / template insertion** — FUNCTION / SELECT CASE / SPRITE skeletons
  (overlaps the beginner templates).
- [ ] **[perf] Idle-debounced validation** — batch the Problems-panel re-validation after
  typing stops instead of per-keystroke.
- [ ] **[beginner] Friendlier errors ("did you mean" + docs links)** — e.g. single-line
  `IF` → suggest the block form; link the "Not available" table from the error. Extends
  the existing diagnostics/quick-fixes.

### P3 — lower priority (risk or higher cost)

- [ ] **[perf] Viewport-only syntax highlighting** — re-highlight just the visible lines.
  Big win on huge files, **but** it touches `highlightHtml` / the overlay, which has a
  history of caret/line-drift bugs — must satisfy the project's caret-safety rule
  (prove overlay line count matches source) before landing. Defer until the Worker/cache
  wins are in and measured.

## 次期機能提案 v2（提案書マージ・2026-09-07）

外部AIからの提案書（リポジトリ照合済み）を反映。全文＝[`docs/next-features-v2-proposal.md`](docs/next-features-v2-proposal.md)（各提案の目的/仕様案/実装段階/制約/規模を詳述）。**net-new のみ下記に登録**し、既出は上の P1/P2/P3・FAST 設計ノート・同一オリジン WebMSX・BACON を参照（重複させない）。規模: S=数日 / M=1〜3週 / L=1ヶ月超。方針＝実行時コストゼロ・テキストが正・GUIは往復編集器・外部ツールは同梱せず在れば使う・診断は編集時。

### net-new 提案
- [ ] **1. `TILEMAP` ブロック＋マップエディタ** — `SPRITE` と同じ「見たまま」記法で背景/編隊データ。`AS DATASET|DATAFILE|RLE|MASK` で生成先切替（RLE は BASIC/ASM 双子）。`lower-tilemap.ts`。GUI は *Run→Map tool*。接点: `lower-sprite.ts`/`DATASET`/`FAST_TILES`/`FAST_TILEGRID`/データファイル。規模 S/M/M。
- [ ] **2. 画像インポート（PNG→SCREEN2/5 パターン・パレット・`.BIN`）** — `.png` を「アセット」欄へ→ SCREEN2 色数診断（どのブロックで何色）/SCREEN5 量子化/フォント/スプライトは `SPRITE` 逆生成。PNGデコードは Rust `image` or Canvas。接点: `.BIN`同梱/`M2_PAL`/`M2_DEFSPR`/`check-screen.ts`。規模 S/M/M。
- [ ] **3. スプライト行別色記法＋編集（MSX2）** — `SPRITE HERO SIZE 16 COLORS 15,9` ＋行末 `: 色`。`LAYER 2` で2枚重ね＋`HERO_PUT`(MACRO)。TODO P1「SPRITE ライブプレビュー」に**記法を足す**位置づけ。`lower-sprite.ts` 拡張。規模 S/S/M。
- [ ] **4. 音: FM作曲経路 / `SFX` ブロック / SFX デザイナ** — (4a) `music.mjs export --target fm`＝`PLAY #2` 生成（作曲用途。**参照音源の再現は BIN+ASM のまま**＝上の OPLL 決定と非競合）。(4b) `SFX … END SFX`＝`SFX_DROP` を一般化しレジスタ列を `DATASET`＋feeder駆動、`M2_SE` を薄いラッパへ。(4c) *Run→SFX tool* GUI。規模 S/M/M。
- [ ] **5. 変数インスペクタ（長名デバッガ）＋実測プロファイラ** — 段階0: `WATCH`/`ASSERT`（計装ビルド・リリースで消える。TODO P2 `ASSERT` を吸収）。段階1(本命): **openMSX に接続**（制御ソケット `debug read_block memory` で RAM 読み・`.map.json` で長名逆引き・STRUCT を1レコード再構成・`CURLIN` で現在行・実測プロファイラ）＝README ロードマップの「openMSX＋Tcl RUN」を包含。**ROM/エミュは同梱しない**。段階2(同一オリジン WebMSX)は推さない。規模 S/L/—。
- [ ] **6. `TABLE` コンパイル時テーブル生成** — `TABLE SIN_T%(256) = INT(SIN(I*..)*256)`。`fold-expr.ts` 評価器を `I`＋`CONST` 式に拡張。`AS DATASET|DATAFILE|BIN`＋`SEED`、`WITH MACRO` で参照マクロ自動生成。重命令 `SIN`/`RND` を実行時から追い出す。規模 S/S。
- [ ] **7. 言語小改善（TODO 未収録分のみ）** — ①STRUCT レコード丸ごと `REF` 渡し（v1制約解消）②inline ASM: ラベルへの絶対 `CALL`/`JP`＋`!`単精度参照（FAST拡張要望と一致）③構造化ASM（`REPEAT n…END`・レジスタ別名・`COPY src,dst,len`。TODO「Structured ASM #3」の言語仕様化）④`FORMAT$(値,桁,埋)` を標準 INCLUDE ⑤`DEBUG … END DEBUG`（提案5の一般形）。※`ENUM`/`ASSERT`/`+=`/`TRUE`/`FALSE`/`WITH`/`FOR`空範囲ガード は既出or方針外につき扱わない。規模 各 S〜M。
- [ ] **8. `lib/game.msxb`（汎用ゲーム基盤）** — FAST(ASM) と MSX2(SCREEN5) の間の機種非依存「毎回書く層」。`G_INPUT`(STICK統合+エッジ)/`G_SYNC`/`G_SCENE`/`G_HISCORE_LOAD/SAVE`(データファイル経路)/`FX_MUL`(8.8固定小数)/`G_RND`/`G_TIMER`。`G_` 接頭辞・GLOBAL最小。接点: `M2_WAIT`/`M2_SE`/feeder/`STICK`/双子方針。規模 S/S。
- [ ] **9. トークナイザ＋`.rom` エクスポート** — 段階0: MSX-BASIC トークナイザ(TS・依存ゼロ、機種別トークンは `builtins.ts` フラグ再利用)＝`.dsk`/`.sav` の読込高速化。段階1: BASIC-in-ROM 16/32KB `.rom`（openMSX `-cart` で検証・提案5の接続層流用）。段階2: 外部コンパイラ(MSXBAS2ROM)連携（同梱せず在れば）。規模 M/M/S。
- [ ] **10'. `TASK`（コルーチン風ふるまい記述）** — 敵AI/ボス/演出を「上から順」に書き、`WAIT`/`YIELD` 位置で**状態番号に分割**→`SELECT CASE E.PC%` へ降下（`PC%`/`WAIT%` を STRUCT に自動追加）。`RUN_TASK ENEMY_PATROL, FOE(I)`。ゼロコスト・降下を隠さない。`lower-task.ts`。接点: `lower-select.ts`/STRUCT/`EVENT TIMER`/`ENUM`。規模 M/M/S。
- [ ] **11. メモリ予算解析（静的 RAM 見積り）** — コスト解析の「容量」版。*Run→Memory budget*。機種別空きRAMから 本体/変数/配列/文字列(`CLEAR`)/`DATA`/ASMバッファ/`BLOAD`/再帰スタック を引いて残量表示、しきい値超過を Problems へ。「`AS DATAFILE`/`AS BIN` にすると n バイト空く」ヒント。TODO P2「生成サイズ/行予算」を RAM 全体へ拡張。規模 S/M。
- [ ] **12. `TEST` ブロック＋内蔵ミニ BASIC インタプリタ** — ROM/エミュ不要のロジック検証。`TEST … ASSERT … END TEST`（リリースで削除）。**変換後**MSX-BASIC のサブセット(数値/文字列/配列/`IF/FOR/WHILE/GOSUB/DATA`・VDP/PSG/入力は非対応と診断)を TS で実行＝2文字名/GOSUB展開/再帰スタック/255B分割まで検証。`reverse/basic-reader.ts` に読取器あり＝式評価＋文実行を足す形。規模 M/M/S。

### 進行中: 条件コンパイル `#IF`/`#IFDEF`（7-5 を格上げ）
提案 7-5（debug/release トグル）を一般化。`DEBUG` は組込みシンボル1個の特殊形。設計＝[`docs/conditional-compilation-design.md`](docs/conditional-compilation-design.md)。確定判断: ①未定義値参照=0+警告 ②UI構成がソース `#DEFINE` を上書き ③`#DEFINE` と `CONST` は分離。
- [x] **P0（エンジン）** — `src/preprocess/conditionals.ts`（`#DEFINE/#UNDEF/#IFDEF/#IFNDEF/#IF/#ELIF/#ELSE/#ENDIF`＋式評価 `DEFINED`/比較/論理）、`resolveIncludes` 統合（不採用枝の行・INCLUDE を除去・シンボル seed＋pinned）、診断 `E_PP_*`/`W_PP_UNDEFINED`。`test/conditionals.test.ts` 9件緑。ソース内 `#DEFINE/#IFDEF` は再バンドル後 in-editor で即動作。
- [ ] **P1（UI・組込み）** — 設定→Transpile「ビルド構成」UI（シンボル一覧の追加/トグル/値・UI上書きの明示）、組込み `DEBUG`（ビルドモード）と `MACHINE`（対象機種→数値）を run/変換/エクスポート経路の `resolveIncludes(pp)` へ配線、`ASSERT`/`WATCH` を `DEBUG` ゲートで。
- [ ] **P2** — ビルド情報の可視化（変換テーブルに有効シンボル＋採用枝）、任意「全構成まとめて検証」モード。

### 提案書由来の doc/整合 タスク
- [ ] **再帰の記述ドリフト修正** — `docs/00-msx-basic-diff.md`(英日)・`docs/01-language-spec.md` が「再帰不可 `E_RECURSION_UNSUPPORTED`」のままだが、実装は**再帰対応済み**（ソフトスタック、`README.md`・`test/recursion.test.ts` と一致）。docs を「対応（ソフトスタック・深さ設定可）」へ更新し、`E_RECURSION_UNSUPPORTED` が現在も emit されるか（デッド診断か）を確認して整理する。

### ロードマップ案（提案書 §13）
- **P1 言語の足場**: 6 `TABLE`-0 / 5-0(`WATCH`/`ASSERT`) / 7 `FORMAT$`・`DEBUG` / 11-0（TODO P1 の `ENUM`/`+=` と同時期）
- **P2 ゲーム基盤**: 1 `TILEMAP`-0/1 / 8 game lib / 10' `TASK`-0 / 4a（Runner/Shooter を書き直して効果実証）
- **P3 差別化**: 5-1（openMSX 接続）/ 12-0/1（ROM不要テスト）/ 9-0（トークナイザ）
- **P4 アセットGUI**: 2 / 3-1/2 / 1-2 / 4b・4c（テキスト記法が固まってから）
- **P5 配布**: 9-1/2（`.rom`）/ 11-1（需要を見て）

## FAST library — ASM-backed bulk speedups (design note + candidates)

**Positioning (decided).** Performance is an **opt-in escape-hatch layer**, never the
default. The identity is transparent, readable MSX-BASIC for *learning* — that stays
sacrosanct. FAST ships as an optional add-on (`INCLUDE "lib/fast.msxb"`, a *tool you
choose*, not part of the language), is **not hidden** (shown like ASM blocks in the
conversion table), and is teachable (compare the slow `FOR…PUT SPRITE` vs `FAST SPRITES`
to show *why* batching/ASM is faster). **No 1:1 per-command FAST** (`FAST PUT SPRITE` is
a trap — pays the BASIC↔ASM boundary cost per call and mis-teaches). The unit that wins
is the **batch**: internalize the loop in ASM so BASIC crosses the boundary once/frame.
Structured core = universal (all BASIC/learning); FAST = the game-builder tier on top.

**Candidate primitives** — scored on: (I)maginable / (F)its FunctionBASIC feel /
(G)eneric / (S)peedup. API is BASIC-shaped, `%`-typed, consumes arrays (ties to
STRUCT-of-arrays). On MSX2 `FILL`/`COPY` can dispatch to the **VDP hardware blitter**
(HMMV/HMMM) for a large extra win; the primitive hides the machine difference.

- [ ] **`FAST SPRITES foe, n%`** — flush the whole sprite attribute table (≤32 × Y/X/pat/col)
  from a STRUCT-of-arrays in one VRAM burst (VDP auto-increment). I◎ F◎ G◎ S◎.
  Flagship; the generalized space-shooter fleet redraw (10→27fps proven).
- [ ] **`FAST FILL page,x,y,w,h,val` / `FAST CLS`** — fill a VRAM region / clear screen.
  I◎ F◎ G◎ S◎ (MSX2 = hardware fill).
- [ ] **`FAST COPY srcpage,sx,sy,w,h TO dstpage,dx,dy`** — block move RAM→VRAM / VRAM→VRAM
  (backgrounds, tile stamps). I○ (a fast `COPY`) F◎ G◎ S◎ (MSX2 = hardware blit).
- [ ] **`FAST SCROLL region,dx`** — shift a VRAM/nametable region (soft scroll where no HW
  scroll). I◎ F◎ G○ S◎.
- [ ] **`hit% = FAST HITTEST(x%,y%,w%,h%, bx%,by%,bw%,bh%, n%)`** — AABB overlap scan of one
  box vs an array; returns first hit / bitmask. I○ F○ G◎ (collision is everywhere) S◎
  (BASIC nested loops are brutal).
- [ ] **`FAST TEXT x%,y%, a$`** — write a string into the nametable at a cell (score/HUD).
  I◎ F◎ G◎ S○.
- [ ] **`FAST VMOVE dst,src,vel,n%`** — bulk integer array update (`X()=X()+VX()` for all)
  for physics/particles. I○ F○ G○ S◎ *only when n% is large enough to amortize the crossing*.
- [ ] **`FAST VWRITE / VREAD page,addr, arr, n%`** — block VRAM↔`%`-array/buffer; the
  low-level building block the others compose from. I○ (bulk VPOKE/VPEEK) F○ G◎ S◎.

**First library = core 4:** `FAST SPRITES`, `FAST FILL`/`CLS`, `FAST COPY`, `FAST HITTEST`
(best on all four criteria; covers move-sprites / draw-bg / clear / collide — the spine of
most 2D games). Ships within today's ASM-block constraints (`%`-int vars, VARPTR patch,
HIMEM buffer): pass array first-element VARPTRs, ASM iterates internally. Extensions that
would help: absolute CALL/JP to labels, auto buffer allocation, MSX2 VDP-command dispatch.

**Chosen direction (decided 2026-08-01).** After comparing against whole-program
compilation (BACON — see below), the **ASM-library path is chosen** for playable action:
no external dependency, works today (proven in the space-shooter), normal `RUN`, and the
speedup lives *visibly in your source* rather than being concealed by a compiler. The
hard part = making ASM blocks give a beginner (someone who bounced off even BASIC) a sense
of *understanding* (納得感). Comments alone are not enough. Three layers to build:

1. **BASIC "twin" (the key move)** — every FAST routine ships beside its exact *slow but
   readable* BASIC equivalent, shown side-by-side in the editor: "this scary ASM just does
   what this `FOR … PUT SPRITE` loop does, only in machine code." Anchors the unknown (ASM)
   to the known (BASIC); doubles as the slow-vs-fast teaching moment.
2. **Structured ASM (writeability, #3)** — bring structured-BASIC thinking to ASM: named
   count loops (`REPEAT n … END`), register *aliases* (`COUNT = B`, `SPRADR = HL`) so you
   follow the data not the opcodes, and named helpers for MSX idioms (`COPY src,dst,len`,
   `VDPWRITE addr`). Turns opcode-soup into readable intent; makes ASM easier to write too.
3. **Auto-annotation (peek-and-understand, #2)** — thorough JP/EN comments + editor glosses
   each instruction in plain language with BIOS names (reuse the existing machine-code
   disassembly-annotation feature).

- [ ] **Exemplar: build `FAST_SPRITES` with all three layers** (clean BASIC API + BASIC-twin
  + structured/annotated ASM), drop it into the T2 template, and measure the before/after.
  This establishes the "納得感" pattern that the other FAST primitives copy.

## 縦スクロールSTG（3肝スクロール primitive の実証 → 公開サンプル）

設計: [docs/fast-scroll-primitives-design.md](docs/fast-scroll-primitives-design.md)。3肝＝
`FAST_VSCROLL`(R#23) / `FAST_TILEFEED`(増分供給) / `FAST_COPY`+`FAST_VFILL`(HMMM/HMMV)。
research 試作 `research/fast-scroll.msxb` ＋ `research/vstg-demo.msxb`（gitignored）で
WebMSX 実機挙動まで確認済み（フル幅・VSYNC・1タイル/frame 増分供給で滑らかスクロール実証）。

- [x] 3肝を実装・VDP実測（HMMM 511us/LMMM 1871us・座標はドット・増分供給必須）・WebMSXで目視確認。
- [x] **(1) INCLUDE版の修正反映**：`examples/lib/fast-scroll.msxb`（ドット座標修正版）を `build.mjs` で
  LIBS 同梱済。※`.app` 再インストールは未（都度ユーザー確認・反復はブラウザ版優先の方針）。
- [x] **(2) フルSTG化**：`research/vstg-game.msxb`（gitignored）で自機/弾/敵/当たり＋背景に大きい戦艦
  （tile を2x3で配置）を実装。**毎フレ複数GOSUB=9fps → 統合ASM `FAST_STGFRAME`=~48fps**（turbo R/MSXPen 実測）。
  重要実測則: 細かい primitive を毎フレ多数呼ぶと GOSUB 線形探索で ~25fps 天井 → memory `msx-gosub-linear-search-fast-perf`。
- [x] **(3) 公開昇格**：3肝を `examples/lib/fast-scroll.msxb`、統合フレームエンジン `FAST_STGFRAME`＋`FEED1` を
  `examples/lib/fast-stg.msxb` へ昇格（SoA契約を先頭に文書化）。`build.mjs` で LIBS 同梱、設計メモ
  ([docs/fast-scroll-primitives-design.md](docs/fast-scroll-primitives-design.md)) 確定、単体変換の回帰テスト2件追加（test/examples.test.ts）。
- [ ] **(完成時) README にサンプル追加＋零の咆哮リンク**：英日README にこの縦STGサンプルを載せ、
  「これが **零の咆哮** の元となったゲームを公開用に改良したものです」と明記し、**零の咆哮へのリンク**を張る
  （元リポジトリ候補: https://github.com/suzuki-black/BattleshipProtoR ／公開URLは着手時にユーザー確認）。
  ※デモ本体は research/（gitignored・TAITO系IP同様に非公開素材）なので、公開用の縦STGサンプルを
  `examples/` に別途用意するか要判断（ライブラリ=fast-stg/fast-scroll は公開済、サンプルゲームは未公開）。

## ESERAMair 連携（WiFi付き似非RAMディスク実機へ curl 配信）

**同人ハード（交換不能・壊れやすい）。** 取扱いは [[eseramair-fragile-irreplaceable-hw]] と
グローバル `~/.claude/CLAUDE.md`「物理ハードウェア・実機の取扱い」を厳守: curl相当・keep-alive無し・
連打しない・破壊操作はバックアップ付き。REST(http:8080): `/ram`・`/ram/fill`・`/fat/*`、reset非対応(物理)。

- [x] **解析＋curlクライアント**：`eseramair.mjs`（依存ゼロ・**curl subprocess**で keep-alive無し＝
  `--http1.1 -H "Connection: close"`、POSTは`--data-binary @file`）。ローカルモックで connections==requests 検証済。
- [x] **FAST出力圧縮（コア）**：ASM を 1バイトPOKE羅列 → DATA+READ一括（34KB→20.8KB、トークン化25151→18302）。
  これで実機turboRのBASIC空きRAMに収まり起動可能に（openMSX My_FS-A1ST_512K で実証）。
- [x] **実機デプロイ成功**：Nextor ROM復元(`ram-write`)→`format`→`put GAME.BAS`→RESET→`RUN"GAME.BAS"`で
  縦STGが実機turboRで起動（2026-10-03）。SRAM全体バックアップ `~/turbor_dump/eseram_current_1M.bin`。
- [x] **自動起動プロトタイプ（openMSX）**：ブートセクタ(sector0 @0x1E)でKEYBUFへ`RUN"GAME.BAS"`注入→
  boot時に自動実行、を小プログラムで実証（R0=6=SCREEN5到達）。
- [ ] **ワンコマンド化**：`.msxb → GAME.BAS（stripComments＋CRLF＋Ctrl-Z）→ eseramair put` を1発に。
- [ ] **(重要) 転送前の安全確認UI**：FunctionBASICに取り込む際、転送ボタン押下時に
  「**MSXがディスクにアクセス中でないことを確認しましたか？**」の注意文言を出し、「続行」で転送開始。
  公式注意（Introduction.md: MSXアクセス中のPC操作は競合でデータ破損/暴走の恐れ）に対応。
- [ ] **(任意) 実機で自動起動**：Nextorディスクのブートセクタに注入コードを仕込む。※Nextor独自の起動
  コードを壊さぬよう慎重に。`/fat` APIでは書けず生SRAM書き込み＝リスク高。まず手打ち`RUN"GAME.BAS"`運用で可。
  また大プログラムはRAMが逼迫気味（自作.dsk構成では Out of memory 実例）＝さらなる縮小も検討。
- [ ] **運用フロー（リセット不要の反復）**：ゲーム中はRAM実行なので、PCから`put`で差し替え→MSX側
  Ctrl-STOP→`RUN"GAME.BAS"`で新版再ロード（ESERAMair公式ユースケース＝.BAS転送して実行）。

## FunctionBASIC Runtime 連携（別プロジェクト: BasicPureInterpreter）

`~/work/BasicPureInterpreter`（remote `git@github.com:suzuki-black/FunctionBasicRuntime.git`）は
**webMSX の代替**となる純 MSX-BASIC＋最小マシン語インタプリタ（TS・依存ゼロ・Tauri アプリ、v0.0.1）。
本体（このリポジトリ＝トランスパイラ＋エディタ）から**別エンジンとして駆動**する連携が予定されている。
現状把握（2026-09-19 調査、Runtime 側 commit `8fffd11` 時点）に基づくタスク。

> **方針（確定・2026-09-19）**：**Runtime は FunctionBASIC＋FAST が生成するものを「全て動く」ように
> していくのが目標**。実 MSX/webMSX との後方互換は**一切気にしない**（Runtime が実装追従先＝
> FunctionBASIC＋FAST の出力が事実上の仕様）。動かなければ**Runtime 側を何度でも直す**。
> ＝下記「FAST の穴」は基本すべて **Runtime 側に実装する**課題であり、本体側にフォールバックや
> 互換分岐を入れる方向では**ない**（本体は Runtime に合わせて劣化させない）。連携チャネル(IPC)の
> 作法だけは両者ですり合わせる。実装は Runtime リポジトリで行うが、追従漏れ防止に本体側からも列挙する。

### 連携チャネル（IPC。Runtime 側 `docs/IPC-DESIGN.md` で設計・一部実装済）

- [ ] **本体→Runtime のクライアント実装（macOS 先行）**。Unix domain socket / named pipe ＋
  **JSON Lines** で `run` リクエスト（`source`=**平文 MSX-BASIC テキスト** ≤1MiB、`name?`/`debug?`/
  `machineProbe?`(sealed|allow)/`charset?`/`focus?`）を送り、`subscribe` で状態イベントを受ける。
  **`.msxb` は渡さない**（トランスパイル後の MSX-BASIC 文字列を送る）。Runtime 起動は Tauri アプリ
  id `dev.functionbasic.runtime`（`fbrun://open` は前面化のみ・ソースは載せない）。
- [ ] **エディタからの起動導線**：既存の「WebMSX で実行」の隣に「Runtime で実行」を用意。
  旧 iframe 埋め込み案は Runtime 側で**廃案**（socket アプリに一本化）。埋め込みたい場合は
  Runtime の `createRuntime()`/`load`/`run`/`step` API を直接叩く選択肢もあるが、当面は socket。
- [ ] **protocol-2 のデバッガ連携（Runtime 側 未実装・要すり合わせ）**：本体の
  `MsxLine.src`（変換後行→構造化ソース file+line）と変数名マップを **line-map / varNameMap** として
  添付し、Runtime のブレーク位置・エラーを**構造化ソース側の行/名前**へ逆写像する。`setBreakpoints`、
  仮想ディスク送信もこのフェーズ。→ 本体側で line-map/varName を IPC 用に serialize する口が要る。
- [ ] **共有フォーマットは `.dsk`**（FAT12 720KB）。Runtime の `virtualDiskToDsk` は本体の
  `build_dsk_files` を移植したもの。相互運用（本体で作った .dsk を Runtime で開く等）を確認。
- [ ] Windows / ブラウザ起動（Runtime の I-4/I-6）は Runtime 側で保留中。macOS 連携が固まってから。

### Runtime 側で実装すべき FAST（ASM）対応（＝Runtime を追従させる項目）

Runtime は実 Z80 を実行し（USR/DEFUSR/POKE→CALL、ZEXDOC/ZEXALL 通過）、VDP **ポート I/O の一部**
（`&H98`/`&H99`/`&H9A`）、**R#23 縦スクロール**、**OAM `&H7600` 直書き（SC5/6）**、PSG、一部 BIOS を解釈する。
以下は現状未対応で **FAST 系が Runtime で動かない箇所＝すべて Runtime 側に実装して追従させる**
（本体は変えない）。実装は Runtime リポジトリ、ここは追従漏れ防止の対向リスト：

- [ ] **VDP コマンドエンジン（HMMM/HMMV/LMMM/LMMC/YMMM …）を Runtime に実装**。今は R#32-46 が
  「格納するだけで無反応」。R#46 書込を検出し、R#32-45（SX/SY/DX/DY/NX/NY/CLR/ARG）から state 画面へ
  矩形 copy/fill/move を実行する command executor を追加する。→ これが無いと新設の縦スクロール肝
  ([[docs/fast-scroll-primitives-design.md]] の FAST_COPY=HMMM / FAST_VFILL=HMMV / FAST_TILEFEED) と
  既存 `COPY` 相当が Runtime で無反応。**最優先**（縦STG系の要）。
- [ ] **ポート `&H9B`（VDP 間接レジスタ）を Runtime に実装**。今は `OUT`/`IN &H9B` が fault。
  R#17 ポインタ＋オートインクリメントで R#32-46 をストリームする FAST の発行経路を通す。
- [ ] **テーブルベースレジスタ R#2-6/10/11 を実効化**（今は格納のみ無視）。FAST/例が pattern/name/
  sprite テーブルを VRAM 内で移動したら state 側レイアウトも追従させる。
- [ ] **割り込み/`HALT` を Runtime に実装**（今は `EI`/`HALT` がエラー、S#0 は常に vblank）。VBLANK 同期
  ASM（`EI`+`HALT` 待ち）が通るようにする。当面 busy-poll で回避可能だが、最終的には Runtime 側対応。
- [ ] **任意 VRAM アドレスの読み書きを実 VRAM 化 or マップ拡張**（今は state ベースで `vram-map.ts` 外は
  fault）。FAST/ASM が触る領域が増えたら Runtime のマップを広げる（＝バイト単位 VRAM に寄せる検討）。
- [ ] **回帰の当て方**：FAST 例を昇格するたびに Runtime で実行して「無反応/ fault」が出ないことを確認し、
  出たら Runtime 側に不足機能として起票→実装。FAST が Runtime の対応範囲を牽引する運用にする。

> まとめ：**純 BASIC＋ポート I/O/R#23/OAM 直書きレベルの FAST は Runtime で動く見込み**。
> **VDP コマンドエンジン依存（＝今回の縦スクロール3肝）は Runtime 拡張かフォールバックが要る**。
> 縦スクロール肝を公開ライブラリへ昇格する際は、この Runtime 制約を昇格条件に含める。

## Future option (low priority): whole-program compilation via BACON

De-risked 2026-08-01 and **kept as a future escape valve only** (not the primary path).
Finding: FunctionBASIC's output (T2) compiles cleanly to Z80 with **MSX-BACON**
(hra1129, MIT, PC cross-compiler) — 0 errors, incl PUT SPRITE / SPRITE$ / STICK / STRIG /
TIME; machine-code speed (べーしっ君-class 15–100×). The full pipeline works for simple
programs (`hello.bas` → `.bin`). **Why deferred:** (a) it *conceals* the speedup entirely
(you never see or own the machine code — counter to the "learn/own it" identity), (b)
external dependency (BACON + ZMA) with real version-matching friction (T2's asm needs
BACON's bundled ZMA v1.0.18; public source v1.0.17/18/19 reject it; no wine here to run the
bundled exe), (c) changed run model (BLOAD machine code + BACONLDR, not `RUN`), (d) not
100% compatible / reduced float precision. Revisit only if the ASM-library ceiling is hit
and a "compile the whole thing" button becomes worth the dependency.

## Future: same-origin WebMSX (MSXPen-style runner)

- [ ] Embedding WebMSX **same-origin** (loading `wmsx.js` and driving the `WMSX`
  JS API) would fix both the FM-sound issue and the slow reboot-per-run: start
  the machine **once**, then type/RUN the source without rebooting (like MSXPen).
  Deferred for now (kept the cross-origin iframe) — it needs linking/hosting
  WebMSX's JS, which touches the "link only, do not bundle" licensing stance.

## Transpiler robustness: MAIN line-number collision — RESOLVED

- [x] **A long MAIN colliding with the function segments is fixed.** The first
  function base is now chosen dynamically above MAIN's last line
  (`seg = max(1000, (⌊mainLast/1000⌋+1)·1000)`), and later functions advance past
  each prior block's real end; a safety-net check emits `E_LINE_NUMBER_OVERFLOW`
  on any non-ascending/duplicate/over-65529 line. Verified: a 120-statement MAIN
  places the first function at 2000 with zero duplicates. Regression tests:
  `test/line-numbering.test.ts` (>90-line MAIN, >150-line function, 65529 overflow).

## turbo R samples: approach TBD (deferred)

- [ ] **Decide how "turbo R only" samples gate/run.** Two clean options, not yet
  chosen (see the `_TURBO` note above):
  - **Machine-detect** — `IF PEEK(&H2D) < 3 THEN ... : END` (0=MSX1, 1=MSX2,
    2=MSX2+, 3=turbo R). Runs in the WebMSX **interpreter**, gates to turbo R,
    no compiler dependency. (turbo R already boots BASIC on R800, so no CPU
    switch is needed for speed.)
  - **`CALL TURBO ON`** — natural if the sample is meant to be **compiled with
    MSXべーしっ君 (Basic-kun)**, but errors under a plain interpreter `RUN`.
  Committed as `examples/space-shooter-turbor.msxb` using the machine-detect
  approach (with redefined 8×8 tiles: cannon / invader / bolt / bomb). The
  machine-detect vs `CALL TURBO` choice above is still open for that sample.
  Also revisit `examples/turbo-r.msxb`, which uses `_TURBO ON/OFF` (Basic-kun
  form) and whose test only asserts the transpiled text, not a real run.
- [ ] **`examples/runner-turbor.msxb` (SCROLL RUNNER): keep or revert the
  uncommitted `SETUP_TILES` edit** (made 2026-09-17 while getting it to run on
  BasicPureInterpreter; decision pending). The edit:
  - writes the tile shapes to `BASE(7)` (SCREEN 1 pattern generator) instead of
    `BASE(5)` (the name table — the original wrote into the screen text, not the
    tile shape);
  - also redefines the ground tile 219 as solid, so both tiles look the same on
    the Japanese (katakana) and international (graphic) character sets.
  Reverting still runs without errors, but the obstacle tile is not drawn solid.

## MSX0 (IoT BASIC) support: TBD

- [ ] **MSX0 IoT statements (`_IOTGET` / `_IOTPUT` / `_IOTFIND`) in
  BasicPureInterpreter.** Found in the OSS corpus (hra1129 `test_iot.asc`:
  `_IOTGET("host/battery/level",L)`). The runtime now stops them with an explicit
  reason ("MSX0 の IoT 命令です。まだ対応していません", decision N-67) instead of a
  generic sealed error. To support them we need the MSX0 device-path semantics
  (value types, missing paths, errors) — confirm from MSX0 documentation or a real
  MSX0 before implementing; decide whether the host supplies fake/real values.
  (Basic-kun extensions such as `_SCOLOR` / `_LSTYLE` are deliberately **not**
  supported — they need the compiler.)

## Roadmap (see README for the full list)

- [ ] Event traps end-to-end check: `ON SPRITE GOSUB` / `ON KEY GOSUB` /
  `INTERVAL` actually firing in WebMSX (transpile is covered by tests).
