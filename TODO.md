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
