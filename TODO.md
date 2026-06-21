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
  needs the WebMSX machine switched to turbo R (gear menu) to run.

## Future: same-origin WebMSX (MSXPen-style runner)

- [ ] Embedding WebMSX **same-origin** (loading `wmsx.js` and driving the `WMSX`
  JS API) would fix both the FM-sound issue and the slow reboot-per-run: start
  the machine **once**, then type/RUN the source without rebooting (like MSXPen).
  Deferred for now (kept the cross-origin iframe) — it needs linking/hosting
  WebMSX's JS, which touches the "link only, do not bundle" licensing stance.

## Roadmap (see README for the full list)

- [ ] Event traps end-to-end check: `ON SPRITE GOSUB` / `ON KEY GOSUB` /
  `INTERVAL` actually firing in WebMSX (transpile is covered by tests).
