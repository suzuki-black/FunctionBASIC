# 08. ファイル保存仕様・保存処理フロー

対応仕様: **【6. ファイル保存仕様】** ／ 【5-3, 5-4, 1-8】

---

## 8.1 保存対象（仕様6-1）

| 種類 | 内容 | 推奨拡張子 | 生成条件 |
|------|------|-----------|----------|
| 変換前ファイル | 構造化BASIC ソース | **`.msxb`** | 常に保存可能（仕様1-8） |
| 変換テーブル | 逆変換用 MapTable（JSON） | `.map.json` | 変換成功時のみ |
| 変換後ファイル | MSX-BASIC ソース | **`.bas`** | 変換成功時のみ |

> 拡張子は任意（仕様6-3）だが、`.msxb`（構造化）/`.bas`（MSX）を推奨。
> 変換テーブルは変換前ファイル名を基底に `<basename>.map.json` とする。

例: `game.msxb` → `game.map.json`, `game.bas`

---

## 8.2 文法エラー時の挙動（仕様6-2, 1-8）

- **文法エラーがある場合は変換前ファイルのみ保存**する。
- 変換テーブル・変換後ファイルは生成・保存しない。
- 既存の `.map.json` / `.bas` がある場合は **更新せず温存**（古い変換結果を壊さない）。
  - ただし「変換前と変換後が不整合」である旨をステータスに表示する。
- **変換段階のコンパイルエラーも同様に扱う** — 文法は正しくても変換時に
  `E_VAR_NAMES_EXHAUSTED`（2文字MSX名を使い切り、[05 §5.11](05-transformer.md#511-2文字msx名アロケータ全変数全型)）、
  `E_LINE_TOO_LONG`（1行255バイト超過、[05](05-transformer.md#512-1行255バイト制限の検査と自動分割)）、
  `E_RECURSION_UNSUPPORTED`（再帰）、`E_NON_SJIS`（Shift-JISで表現できない文字、§8.6.4）が出た場合は、
  文法エラーと同じく**変換前のみ保存**し「誤りがあります。確認してください」を表示する。
  （`W_*` 警告は保存をブロックしない。）

---

## 8.3 保存処理フロー（仕様5-3）

```
                         ┌─────────────┐
   [保存ボタン押下] ─────▶│ 文法チェック │
                         └──────┬──────┘
                  errors>0 ◀────┴────▶ errors=0
                     │                   │
                     ▼                   ▼
         ┌───────────────────┐   ┌──────────────────────┐
         │ 変換前(.msxb)保存   │   │ ① 変換 (Transformer)  │
         │ 変換: 不可          │   │ ② 変換前(.msxb)保存    │
         │ ×表示 / エラー表示  │   │ ③ 変換テーブル(.map)保存│
         └─────────┬─────────┘   │ ④ 変換後(.bas)保存     │
                   │             └──────────┬───────────┘
                   ▼                        ▼
        「誤りがあります。確認        変換後タブにMSX反映
         してください」(5-4)         「保存しました」(5-4)
```

### 正常系の保存順序（仕様5-3）

1. 文法チェック（再実行・確定）
2. 変換（AST → MSX-BASIC ＋ MapTable）
3. **変換前** `.msxb` 保存
4. **変換テーブル** `.map.json` 保存
5. **変換後** `.bas` 保存

> 変換前を先に保存することで、後続I/Oが失敗してもソースは確実に残す。

---

## 8.4 SaveController 実装（[02](02-architecture.md#25-処理パイプラインの統括savecontroller) と整合）

```ts
async function onSave(name: string, source: string): Promise<SaveResult> {
  // 1. 文法チェック
  const tokens = normalizeTokens(tokenize(source));
  const { ast, errors } = parse(tokens);

  // 2. 文法エラーあり → 変換前のみ保存
  if (errors.length > 0) {
    await fileManager.saveSourceOnly(name, source);     // .msxb のみ（仕様6-2）
    ui.showErrors(toEditorErrors(errors));              // ×表示・ツールチップ
    ui.disableMsxTab();
    return { ok: false, message: "誤りがあります。確認してください", errors };
  }

  // 3. 変換（変換段階でも E_VAR_NAMES_EXHAUSTED 等のコンパイルエラー／警告が出うる）
  const { code, map, transformErrors } = transform(ast);  // errors と warnings を含む
  ui.showErrors(toEditorErrors(transformErrors));          // warning(△)も含めて行マーカー表示

  // エラー（severity=error）があるときのみブロック。warning は保存を止めない。
  const hardErrors = transformErrors.filter(e => e.severity === "error");
  if (hardErrors.length > 0) {
    await fileManager.saveSourceOnly(name, source);     // 文法エラー時と同様、変換前のみ保存
    ui.disableMsxTab();
    return { ok: false, message: "誤りがあります。確認してください", errors: hardErrors };
  }
  // warning のみ（例 W_REF_MANY_VARIANTS / W_ARRAY_VALUE_COPY）なら変換は成功扱いで続行。
  const msx = renderMsx(code);

  // 4. 3種保存（順序: 前→テーブル→後／拡張子は §8.1 に対応）
  await fileManager.saveSource(name, source);           // ③ 変換前（構造化BASIC）を .msxb で保存
  await fileManager.saveMap(name, map);                 // ④ 変換テーブルを .map.json で保存
  await fileManager.saveMsx(name, msx);                 // ⑤ 変換後（MSX-BASIC）を .bas で保存

  // 5. UI反映
  ui.setMsxView(msx);
  return { ok: true, message: "保存しました", msx };
}
```

---

## 8.5 FileManager I/F

```ts
interface FileManager {
  // 文法エラー時：変換前のみ
  saveSourceOnly(name: string, source: string): Promise<void>;

  // 正常時の各保存
  saveSource(name: string, source: string): Promise<void>;   // .msxb
  saveMap(name: string, map: MapTable): Promise<void>;       // .map.json
  saveMsx(name: string, msx: string): Promise<void>;         // .bas

  // 読込
  loadSource(): Promise<{ name: string; source: string }>;
  loadProject(name: string): Promise<ProjectArtifacts>;      // 逆変換用に3種読込
}
```

### 保存先

- **Tauriデスクトップ（Win/Mac）**：Tauri の `fs` / `dialog` プラグイン（`save` ダイアログ＋`writeTextFile`）で
  ローカルへ保存する。FileManager は PlatformBridge（[02](02-architecture.md#21-モジュール構成仕様7-1)・[10](10-tech-stack.md)）経由でこれを呼ぶ。
- 3ファイルは同一フォルダ・同一 basename で揃える（例 `game.msxb` / `game.map.json` / `game.bas`）。

---

## 8.6 ファイルフォーマット詳細

> **【エンコーディング方針】** MSXへ渡すファイルは **Shift-JIS（JIS X 0201 ＋ JIS X 0208）** で保存する。
> これは MSX の実機エンコード（漢字=JIS X 0208 / 半角カナ=JIS X 0201、MSX-BASIC の `CALL SJIS` が示す Shift-JIS）に
> 最も忠実なため。エディタ内部はUnicodeで扱い、**保存時に Shift-JIS へ変換／読込時に Shift-JIS から復元**する
> （[11 §11.13](11-editor-features.md#1113-エンコーディング改行)）。
>
> **CP932 は採用しない（既定では）**：CP932（Windows-31J）は Shift-JIS の拡張だが、NEC特殊文字・IBM拡張など
> **MSXに存在しないベンダ拡張**を含み、`0x5C` の扱い（JIS X 0201では¥、CP932ではバックスラッシュ）も異なる。
> MSXに無い文字を通してしまうより、**素のShift-JISに制限する方が安全で忠実**。CP932は設定で任意選択できる逃げ道として残す（[10 §10.9](10-tech-stack.md#109-設定settings)）。

### 8.6.1 変換前 `.msxb`

- 文字コード: **Shift-JIS**（JIS X 0201 ＋ JIS X 0208）。
- 改行: LF（編集容易性優先）。
- 内容: 構造化BASIC原文（大文字化適用後のソースを保存。ただしコメント/文字列は原文）。

### 8.6.2 変換後 `.bas`

- 文字コード: **Shift-JIS**（MSX実機・WebMSX・エミュレータに最も忠実）。
- 改行: **CRLF**（MSX-BASIC リスト互換、貼り付け実行の安定性）。
- 内容: 行番号付き MSX-BASIC（仕様3-8, 3-6）。

### 8.6.3 変換テーブル `.map.json`

- JSON（**UTF-8**, LF）。JSON標準（RFC 8259）に従い、メタデータのみ例外的にUTF-8とする。スキーマは [04-data-model.md](04-data-model.md#44-変換テーブル-maptable仕様3-7)。
- `version` を必須とし、将来のスキーマ変更に備える。

### 8.6.4 Shift-JIS 表現不能文字の検査（`E_NON_SJIS`）

- 保存・変換の前に、ソース／出力に **Shift-JIS（JIS X 0201＋JIS X 0208）で符号化できない文字**
  （CP932固有のベンダ拡張・絵文字・MSX非対応の特殊記号等）が無いか検査する。
- 含まれる場合は **`E_NON_SJIS`** を報告し、該当行に×を表示。変換後は生成せず、**変換前のみ保存**（§8.2 と同様）。
- これにより「MSXで表示できない文字の混入・文字化け・変換失敗」を未然に防ぐ。
- 設定で `encoding=cp932` を選んだ場合は CP932 の範囲で検査する（既定は Shift-JIS）。

---

## 8.7 整合性・バージョン管理

- `.map.json` に変換元 `.msxb` の **ハッシュ（任意）** を持たせ、逆変換時に
  「テーブルとソースの不一致」を検出可能にする（推奨・任意項目）。
- 変換後 `.bas` を手で編集した場合、`.map.json` と乖離する。逆変換時の扱いは
  [06-reverse-transformer.md](06-reverse-transformer.md#610-逆変換の限界と注意)。

---

## 8.8 エラーハンドリング

| 事象 | 挙動 |
|------|------|
| ディスク/権限エラー（変換前保存失敗） | 「保存に失敗しました」表示、dirty維持 |
| テーブル/変換後の保存失敗 | 変換前は保存済の旨を明示し、再試行を促す |
| 文法エラー | 変換前のみ保存（仕様6-2）、「誤りがあります。確認してください」 |
| キャンセル（保存ダイアログ） | 何も保存せず編集状態維持 |
