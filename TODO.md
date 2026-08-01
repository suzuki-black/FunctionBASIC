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

## Roadmap (see README for the full list)

- [ ] Event traps end-to-end check: `ON SPRITE GOSUB` / `ON KEY GOSUB` /
  `INTERVAL` actually firing in WebMSX (transpile is covered by tests).
