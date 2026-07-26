# FunctionBASIC — プロジェクト固有ガイド

構造化BASIC → MSX-BASIC トランスパイラ ＋ Tauri デスクトップ/ブラウザエディタ。
TypeScript を `node --experimental-strip-types` で直接実行（依存ゼロ方針）。

グローバルの監査ルール（`~/.claude/CLAUDE.md`）に**加えて**、本プロジェクトでは以下を適用する。

## コミット前 監査（プロジェクト固有）

- **テスト**：`npm test`（`node --experimental-strip-types --test`）。全 pass を確認。
- **ビルド**：コア（`src/**`）を変更したら `node build.mjs` で `editor/core/**` を再バンドル（ブラウザ/デスクトップが古い変換器で動く事故を防ぐ）。デスクトップ配布は `npm run app:build`。
- **バージョン整合**：リリース時、`editor/app.js` の `APP_VERSION` と `src-tauri/tauri.conf.json` の `version` を同値に更新する（`package.json` / `Cargo.toml` の version は追随しない既存仕様）。
- **逆変換の往復検証（必須）**：変換器コア（`src/transform/**` ・ `src/reverse/**`）に触れた変更では、decompile ↔ transform の round-trip が壊れていないことを確認する。
- **キャレット安全性**：`editor/app.js` の highlight / overlay 描画（`highlightHtml` など）に触れる変更は、キャレット/入力行ズレの再発防止のため、無改変であること（差分がバージョン行のみ等）または overlay 行数がソースと一致することを証明してからコミットする。
- **README 英日両更新**：ユーザー向け機能を追加/変更したら、README の英語・日本語の両方に反映する。

## 開発上の定石・落とし穴

- **一次資料主義**：MSX-BASIC の仕様（命令の有無・引数範囲・予約語）は憶測で判断せず、一次資料で裏取りする。
- **机上検証の定石**：変換結果はライブエミュより「変換後コードを読む」で速く確認する。リポジトリ直下に一時 `.mjs` を置き `import { tokenize } from './src/lexer/lexer.ts'` 等で `renderMsx(transform(parse(tokenize(src)).program).code)` を出す（相対 import 必須・`/tmp` 不可）。検証後は一時ファイルを削除する。
- **ブラウザ確認**：`serve.mjs` は `Cache-Control: no-store` を付与（再ビルドした `editor/core/*.js` の古いキャッシュ事故防止）。公開ルートは `editor/` なので正 URL は `http://localhost:8123/`（`/editor/` ではない）。
- **`esc()` 注意**：`editor/app.js` の `esc()` は文字列前提（`String.prototype.replace` を呼ぶ）。数値を渡すと例外になるので `esc(String(n))` か、数値はそのまま埋め込む。
- **デスクトップ .app の再インストール**：勝手に再インストールせず、都度ユーザーに確認する。反復検証はブラウザ版エディタを優先する。
