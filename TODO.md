# TODO

Tracked follow-ups that are not yet done (or not yet verifiable here).

## Verification

- [ ] **MSX-AUDIO (Y8950 / OPL1) runtime check.** The transpiler passes the
  MSX-AUDIO `CALL AUDIO` / `_AUDIO` extended statements through correctly, but
  **WebMSX does not emulate MSX-AUDIO**, so the sound cannot be verified in the
  in-app player. Verify on real hardware or **openMSX** (which emulates the
  Y8950), then add a convert-tested example like the FM one
  (`examples/msx-music-fm.msxb`).
  - MSX-MUSIC (FM / YM2413) *is* verifiable in WebMSX — the run machine is set
    to turbo R (`WEBMSX_MACHINE` in `editor/app.js`), which has built-in FM.

## Roadmap (see README for the full list)

- [ ] Event traps end-to-end check: `ON SPRITE GOSUB` / `ON KEY GOSUB` /
  `INTERVAL` actually firing in WebMSX (transpile is covered by tests).
