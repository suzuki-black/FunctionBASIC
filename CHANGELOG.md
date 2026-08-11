# Changelog

本ファイルは主要な変更を記録する。書式は [Keep a Changelog](https://keepachangelog.com/) 準拠、
バージョンは `editor/app.js` の `APP_VERSION` と `src-tauri/tauri.conf.json` の `version` に一致させる。
0.1.44 以前の詳細は git 履歴を参照。

## [0.1.44] - 2026-08-11

### Added
- **FAST ライブラリ（`examples/lib/fast.msxb`）**: 速度が要る所だけ使う opt-in のバッチ・プリミティブ集。
  「描く／動かす／当てる」の3系統:
  - 描く: `FAST_SPRITES`（OAM一括）/ `FAST_TILES`（タイル列挙）/ `FAST_TILEGRID`（生存マスク直走査）
  - 動かす: `FAST_DRIFT`（群を等速移動＋X/Y軸リングラップ）/ `FAST_STREAM`（弾・粒子を active だけ移動し画面外で自動 deactivate、生存数を返す）
  - 当てる: `FAST_COLLIDE`（全弾×全敵の AABB 当たりを1回のASMで）
- **適用ガイド（`examples/lib/fast-guide.md`）**: turbo R 実測ベースの性能モデルと判断ガイド。
  「動かす」系の交差点 N≒7（8体以上でFAST有利、7体以下は素のBASICが速い）を実測で明記。
- **Z80 インラインアセンブラの命令拡張**: `EX`（DE,HL / (SP),HL / AF,AF）、CB系シフト・ビット
  （`BIT`/`RES`/`SET`/`RLC`…）、ブロック転送（`LDIR` 等）、`ADC/SBC HL,rr`、16bitメモリLD、`JP (HL)` ほか。
- **`W_FOR_EMPTY_RANGE` 警告**: 定数で空と確定する `FOR`（例 `FOR I=32 TO 31`）を検出。
  MSX-BASIC は空範囲でも本体を1回実行するため（下側判定）、静かなバグを未然に知らせる。コード生成は無変更。

### Fixed
- **const-inline のスコープ修正**: 呼び出し側スコープの `CONST` が、同名の `FUNCTION` パラメータを
  const-inline で上書きしていたバグを修正（パラメータが同名グローバル `CONST` をシャドウ）。
- **パーサ**: `BLOAD`/`BSAVE` の `,S`（VRAM）フラグを変数化・改名しないよう修正（従来 `,R` のみ保護）。
- **字句解析（checkSjis）**: 双方向/斜め矢印（`↔↕↖↗↘↙` = U+2194..2199）を Shift-JIS 外として
  ソース位置つきに検出（従来は近似レンジを素通りし、保存時のSJISエンコードで初めて失敗していた）。

### Chore
- `research/`（版権物クローン等・ローカル限定の研究用）を gitignore に追加。
