# TODO

Tracked follow-ups that are not yet done (or not yet verifiable here).

## Sound verification (FM / MSX-AUDIO)

The transpiler output for MSX-MUSIC (FM) is **confirmed correct**: pasting the
converted BASIC into MSXPen (MSX2+ America) plays the FM music. The limitation is
in our *embedded* player only.

- [ ] **FM (MSX-MUSIC) does not sound in the embedded WebMSX.** We embed
  webmsx.org as a **cross-origin iframe**, drivable only by rebooting with a
  data-ZIP URL each run. None of these made FM sound in the iframe (all tried
  and reverted): `MACHINE=MSX2PA` (MSX2+ America) + `PRESETS=MSXMUSIC`; typing
  the run after boot via `BASIC_ENTER=RUN"..."` instead of `BASIC_RUN`. The same
  program **does** play in MSXPen (MSX2+ America), so the transpiler output is
  correct. The run URL is back to the original `DISKA_FILES_URL` + `BASIC_RUN`.
  Verify FM in **MSXPen / openMSX / real hardware** for now; the real fix is the
  same-origin embedding below.
- [ ] **MSX-AUDIO (Y8950 / OPL1)** is not emulated by WebMSX at all → verify on
  **openMSX** or real hardware. (`CALL AUDIO` etc. transpile correctly.)
- [ ] **turbo R `_TURBO`**: the run machine is MSX2+, so `examples/turbo-r.msxb`
  needs the WebMSX machine switched to turbo R (gear menu) to run. **Note:**
  `_TURBO` / `CALL TURBO` is a directive of **MSXべーしっ君 (Basic-kun, ASCII's
  BASIC compiler)** — legit as a keyword, so the transpiler passes it through — but
  it is **not** an interpreted MSX-BASIC statement, so a plain `RUN` in the WebMSX
  interpreter reports `Syntax error`. See the turbo R samples section below.

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
