# Changelog

本ファイルは主要な変更を記録する。書式は [Keep a Changelog](https://keepachangelog.com/) 準拠、
バージョンは `editor/app.js` の `APP_VERSION` と `src-tauri/tauri.conf.json` の `version` に一致させる。
0.1.44 以前の詳細は git 履歴を参照。

## [0.1.46] - 2026-08-22

### Added
- **静的コストプロファイラ（`src/analyze/cost.ts` / CLI `cost.mjs` / エディタ統合）**:
  MSX BASIC を実行せずに「毎フレームの重い所」を推定する静的解析。
  - 実機較正した turbo R (R800) の命令別コスト（`research/calib.msxb` で計測。整数/配列/実数/
    文字列/制御/数学/VDP/描画/GRP出力）を AST に付与して積算。
  - 関数の self / inclusive、ループ反復数の畳み込み（CONST＋単一定数グローバル）、
    到達可能性（DCE 集合＝変換後に出る関数）判定、インライン ASM の Z80 T-state 概算＋
    後方分岐ループ検出。トップレベル WHILE をツリー化し状態分岐を分離表示。
  - エディタ「実行 → コスト解析（重い所）… / Run → Cost analysis (hotspots)…」：毎フレーム木・
    関数順位・未使用(DCE)・関数ドリルダウンをモーダル表示、突出箇所は `◆` 注記、
    テキストコピー / JSON 保存。文法エラー時・フレームループ無し時・内部例外は安全表示。
  - FAST ライブラリ対応：`INCLUDE` を既存の解決経路で展開し、未使用のライブラリ関数は
    「DCE 除去」と明示して計上しない。
  - 仕様書 `docs/15-cost-analyzer.md`、テスト `test/cost.test.ts`（6件）、README 英日に追記。

## [0.1.45] - 2026-08-20

### Added
- **車よけレース例（`examples/highway-nofast.msxb` / `examples/highway-fast.msxb`）**:
  FAST ライブラリの有用性を「同じゲームの before/after」で見せる題材。
  - nofast＝純BASIC：OAM へ Y だけ `VPOKE` 直書き、路面マーカーが共有する1文字の8バイト
    パターンを毎フレームずらして路面全体をスクロール、敵車はスロット別6色。低fpsでも大きく
    飛ばして「スピード感」を出す割り切り。
  - fast＝全ASMホットループ `HWFRAME`：移動＋OAM描画＋画面端の折返し＋乱数レーン＋当たり＋
    路面スクロールを1本のASMに畳み、配列 `VARPTR` は起動時に1回だけキャッシュ。BASIC は入力と
    スコアだけ。真の60fps・ピクセル単位のぬるぬる、2枚重ねの2色カラフルな車。
- **ブロック崩し例（`examples/blocks.msxb`）**: 10面（DATA）＋ブロック耐久度（1〜3）＋壊れない
  金ブロック（クリア条件は金を除外）＋文字エンディング。SCREEN 2 ＋グラフィック文字（`OPEN "GRP:"`）。
- **`FAST_MOVEDRAW`（`examples/lib/fast.msxb`）**: 移動（`FAST_MOVEV`）と描画（`FAST_SPRITES`）を
  1パスに束ねたプリミティブ。
- **`FAST_BIGSPRITES`（32x32合成スプライト）** / **`FAST_MOVEV`（per-object 速度の一括移動）**。
- **`W_SPRITE_BEFORE_SCREEN` / `W_TEXT_IN_BITMAP_SCREEN` 警告**: (1) トップレベルで `SCREEN` より
  前の `SPRITE` 定義（後続 `SCREEN` がパターンテーブルを消す）、(2) ビットマップ画面（`SCREEN>=2`）
  での素の `PRINT`（表示されない）を検出。誤検知ほぼゼロ狙いの高確度ケースのみ。コード生成は無変更。
- **ドキュメント（`docs/fast-library.md`）**: FAST ライブラリの有用性を車よけレースで測る英日ガイド。
  速度化の2段階（差し込むバッチ命令 → ホットループ丸ごとASM）と使い分けを解説。README からリンク。

### Fixed
- **1行IF化（tryOneLineIf）のコメント破壊**: `THEN` 本体にコメントを含むネスト `IF` を `:` 連結で
  1行化すると、`:'コメント` 以降が全部コメント扱いになり後続の文が消える／長い日本語コメントで
  物理255バイト超（`E_LINE_TOO_LONG`）になる不具合を修正（本体にコメントがあればブロック形式で出力）。

### Perf
- **DCE**: 呼ばれない `FUNCTION` の ASM をプロローグに出力しない（未使用の FAST 関数が `INCLUDE` で
  全展開される無駄を解消）。

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
