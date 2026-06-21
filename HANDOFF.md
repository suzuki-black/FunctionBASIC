# 引き継ぎメモ — Windows版ビルド + MSXPLAYer `.sav` 書き出し

このファイルは、**Windows側の Claude Code が行った作業を Mac側の Claude Code に引き継ぐ**ためのものです。
Mac側で「エディタとしての完成」など続きの開発を行う際に、まずこれを読んでください。

作業日: 2026-06-21 / 環境: Windows 11 + Tauri 2 desktop build

---

## 1. 今回やったこと（具体）

### A. MSXPLAYer `.sav`（仮想フロッピー）書き出し機能 ＝ 新機能の本体
ロードマップの「ネイティブMSXプレイヤー連携」を、**エミュレータ起動ではなくファイル書き出し**として実現。
ユーザ提供の設計指示書（SAVList / MakeBlankSav のフォーマット仕様）に基づく。

- **新規 `src-tauri/src/sav.rs`**
  - `dsk_to_sav(image: &[u8]) -> Result<Vec<u8>, SavError>`
  - 既存 `build_dsk()` が出す **720KB FAT12 フルイメージ（1440×512=737280B）をそのまま `.sav` へ詰め替える**だけ。
  - `.sav` 物理形式 = 516B ブロック `[セクタ番号 u32 LE][512B]` の連続。**全1440セクタ出力（案1）**。
  - FAT は一切解釈しない（容れ物の変換のみ）。フォーマット仕様は SAVList/MakeBlankSav (MIT, Tatsuhiko Shoji) から確定、**逐語移植ではなく Rust 再実装**＋冒頭に帰属表示。
- **`src-tauri/src/lib.rs`（変更）**
  - `save_dsk` のイメージ生成部を共通関数 **`build_disk_image(base, msx)`** に切り出し、`.dsk`/`.sav` で共有。
  - **`save_sav` Tauri コマンド**を追加（`save_dsk` をミラー。保存ダイアログ→`.sav`書き出し）。
  - **上書き前の自動バックアップ**: `backup_existing()` ＋ `timestamp_utc()`。既存ファイルがあれば
    `<元名>.sav.<UTC時刻>.bak` にコピーしてから書き込む。**バックアップ失敗時は書き込まず中断**（データ保全優先）。
    同名 .bak があれば連番で衝突回避。
  - `invoke_handler` に `save_sav` 登録、ネイティブメニュー（File）に項目追加。
- **フロント `editor/app.js` / `editor/index.html`（変更）**
  - `onMakeSav()`（`onMakeDsk` を手本に。ただし **WebMSX は開かない** ＝ .sav は MSXPLAYer 用データ受け渡し）。
  - `runAction` に `case "sav"`、アプリ内メニュー(File)に項目、i18n 日英キー（`sav`, `sav.ok`/`err`/`cancel`/`noerr`/`desktoponly`、バックアップ先表示込み）。

### B. Windows 移植性バグ修正（ついで）
- `src-tauri/src/lib.rs` の既存テストが書き出し先を **`/tmp/fbe_test.dsk` とハードコード**していた
  （Windows に `/tmp` が無く落ちる）→ **`std::env::temp_dir().join("fbe_test.dsk")`** に修正。

### C. テスト
- Rust: **4 pass**（`.sav` ラウンドトリップ、不正長拒否、バックアップ保全、既存 .dsk 構造）。
- コア JS: **79 pass**（変更なし、リグレッションなし）。

### D. Windows リリースビルド
- `npm run app:build` で生成（`src-tauri/target/release/` 配下）:
  - `bundle/msi/FunctionBASIC_0.1.0_x64_en-US.msi`
  - `bundle/nsis/FunctionBASIC_0.1.0_x64-setup.exe`
  - スタンドアロン `functionbasic-editor.exe`（インストール不要）

---

## 2. 設計判断（Mac側でも踏襲してほしい）

- **メディア記述子は 0xF9 を流用**（`build_dsk` 既存値）。`sav.rs` は FAT 非解釈の純バイト変換。
  指示書の表は 0xF8 と記載があるが、0xF9 が MSX 720KB の正規値で内部整合も取れているため採用。
  **MSXPLAYer 実機で読めなければ 0xF8 へ切替**、が退避策。
- **出力は案1（全1440セクタ・約740KB固定）**。案2（使用セクタのみの省サイズ版）は後回し。
- **タスクB `make_blank_sav`（空sav）は未実装**（任意のため）。

---

## 3. Mac版の動作に影響すること

- `save_sav` / `build_disk_image` / `backup_existing` / `timestamp_utc` は**全て OS 非依存の std/Tauri コード**。
  macOS でも同一挙動。**`.sav` の出力バイト列はプラットフォーム間で完全一致**（ラウンドトリップ単体テストが保証、Macでも走る）。
- `/tmp` → `temp_dir()` のテスト修正は **Mac でも正の影響**（macOS でも温度ディレクトリで動作）。
- **UI 変更（メニュー項目・i18n）は Mac にも出る**（ネイティブメニュー `build_native_menu`／アプリ内メニュー共通）。
- **依存追加ゼロ**（`Cargo.lock` 無変更）＝ Mac の依存ツリーに影響なし。
- **D-3（MSXPLAYer 実機確認）は Windows 専用**。MSXPLAYer は Windows エミュレータのため **Mac では検証不可**。
  ただし `.sav` のバイト形式正当性は Mac でも走る単体テストで担保済み。

---

## 4. Mac版で開発継続するにあたって気を付けること

- **コミット用メールの保護**: 本リポジトリは過去コミットも含め `suzuki-black <suzuki-black@users.noreply.github.com>`
  で統一されている。Windows側では**ローカル設定**でこの noreply に固定した（個人メールを載せないため）。
  **Mac の clone でも `git config --local user.email suzuki-black@users.noreply.github.com` を設定**してから commit すること。
- **`.sav` は起動ディスクではない**（MSXPLAYer はこれをブートに使わない）。「保存→ワークドライブに置く→`FILES`/`RUN`」の
  データ受け渡し用途。**自動RUNの実行フローに組み込まない**こと（`.dsk`/WebMSX 経路とは役割が違う）。
- **保存系はデスクトップ専用**: `onMakeSav`/`onMakeDsk` は `isDesktop()` ガードあり。ブラウザ配信（`npm run serve`）版では出ない。
- **ビルド環境（Windows 固有の注意・参考）**: この Windows 機では VS2022 **Community の VC++ が破損**しており
  （`vcvarsall.bat` / `msvcrt.lib` 欠落）、**BuildTools の `vcvars64.bat` 読込が必須**だった。Mac には無関係
  （clang/Xcode CLT を使用）だが、ロードマップの「Windows対応 / CI」整備時に「完全な MSVC ツールチェイン必須」と明記推奨。
- **エディタ完成の作業対象**: 現エディタは依存ゼロの軽量版（`editor/app.js` / `index.html` / `style.css`）。
  コアは `build.mjs` が `editor/core/` へ型ストリップ。ロードマップは CodeMirror 移行を想定。

---

## 5. 触り方（コマンド）

- コアテスト: `npm test`
- Rust テスト: `cargo test`（`src-tauri/` を manifest に。**Windows では BuildTools の vcvars 読込後**に実行）
- 開発起動: `npm run app:dev`
- リリースビルド: `npm run app:build`

新規/変更の中心は `src-tauri/src/sav.rs` と `src-tauri/src/lib.rs` の `save_sav` / バックアップ節、
および `editor/app.js`・`editor/index.html` の `sav` 導線。
