# 02. 全体アーキテクチャ

対応仕様: **【7. 全体アーキテクチャ】**

---

## 2.1 モジュール構成（仕様7-1）

| モジュール | 役割 | 主入力 | 主出力 |
|------------|------|--------|--------|
| **Lexer** | 字句解析。ソース文字列をトークン列に分解。大文字化のフック点 | ソース文字列 | `Token[]` |
| **Parser** | 構文解析。再帰下降でASTを生成。ネスト構造の構築・REF制約・BREAK/CONTINUEのループ内検査 | `Token[]` | `AST`, `Error[]` |
| **AST** | 抽象構文木のデータ型定義（ノード群） | — | 型定義 |
| **Transformer** | AST → MSX-BASIC コード生成。行番号割当・GOSUB/GOTO展開 | `AST` | `MsxCode`, `MapTable` |
| **ReverseTransformer** | MSX-BASIC → 構造化BASIC 復元 | `MsxCode`, `MapTable` | 構造化BASIC文字列 |
| **Formatter** | 大文字化・整形。文字列/コメント保護 | トークン or AST | 整形済テキスト |
| **ErrorReporter** | エラー収集・整形・UI連携 | `Error[]` | 表示用エラーモデル |
| **EditorUI** | 行番号表示・エラー×表示・モード切替・タブ | ユーザ操作 | 画面 |
| **FileManager** | 3種ファイルの保存／読込（Tauri `fs`/`dialog` 経由） | 各成果物 | ファイル |
| **PlatformBridge** | プラットフォーム抽象（ファイルI/O・外部起動）。Tauriコマンドを薄くラップ | UI要求 | OSネイティブ呼出 |
| **PlayerProvider** | 再生連携の抽象。A:ネイティブMSXプレイヤー(Win) / B:WebMSXリンク(Win/Mac) / C:外部エミュレータ＋仮想FD(.dsk)(Win/Mac)の3方式（[10](10-tech-stack.md)） | MSXコード | 再生 |

> Lexer〜ReverseTransformer・Formatter・ErrorReporter は **プラットフォーム非依存（TSコア）**。
> OS差は **FileManager / PlatformBridge / PlayerProvider** に閉じ込める（[10-tech-stack.md](10-tech-stack.md)）。

---

## 2.2 レイヤ構成

```
┌─────────────────────────────────────────────┐
│ Presentation 層   : EditorUI                 │
├─────────────────────────────────────────────┤
│ Application 層    : SaveController            │
│                     (保存フロー統括)           │
├─────────────────────────────────────────────┤
│ Domain 層         : Lexer / Parser / AST /    │
│                     Transformer / Reverse /   │
│                     Formatter / ErrorReporter │
├─────────────────────────────────────────────┤
│ Infrastructure 層 : FileManager (File I/O)    │
└─────────────────────────────────────────────┘
```

Domain層は副作用を持たない純粋関数群とし、テスト容易性を確保する。
File I/O・DOM操作は Application/Infrastructure に閉じ込める。

---

## 2.3 データフロー（仕様7-2）

### 2.3.1 正常系（文法エラーなし → 変換）

```
[ソース文字列]
   │  Lexer.tokenize()
   ▼
[Token[]]  ──(大文字化: Formatter.normalizeTokens)──▶ [Token[](正規化済)]
   │  Parser.parse()
   ▼
[AST] ＋ [Error[](空)]
   │  Transformer.transform(AST)
   ▼
[MsxCode] ＋ [MapTable]
   │  FileManager.saveAll()
   ▼
.msxb（変換前）/ .map.json（変換テーブル）/ .bas（変換後）
```

### 2.3.2 異常系（文法エラーあり）

```
[ソース文字列] ─Lexer─▶ [Token[]] ─Parser─▶ [AST(部分)] ＋ [Error[](>0)]
                                                  │
                                ErrorReporter.collect()
                                                  ▼
                                  EditorUI（×表示・ツールチップ）
                                                  │
                            FileManager.saveSourceOnly()  ← 変換前のみ保存
```

### 2.3.3 逆変換系

```
.bas（MSX-BASIC）＋ .map.json
   │  ReverseTransformer.restore()
   ▼
[構造化BASIC文字列]
   │  Formatter.prettyPrint()
   ▼
EditorUI（構造化BASICタブに表示）
```

---

## 2.4 モジュール間インタフェース（TypeScript シグネチャ）

```ts
// Lexer
function tokenize(source: string): Token[];

// Formatter
function normalizeTokens(tokens: Token[]): Token[];   // 大文字化（文字列/コメント除外）
function prettyPrint(ast: Program): string;           // 構造化BASIC整形出力

// Parser
interface ParseResult { ast: Program; errors: SyntaxError[]; }
function parse(tokens: Token[]): ParseResult;

// Transformer
interface TransformResult { code: MsxLine[]; map: MapTable; transformErrors: SyntaxError[]; }
function transform(ast: Program): TransformResult;   // 文字列スロット枯渇等の変換時エラーを含む

// ReverseTransformer
function restore(code: string, map: MapTable): string;

// ErrorReporter
function toEditorErrors(errors: SyntaxError[]): EditorErrorModel[];

// FileManager
function saveSourceOnly(name: string, source: string): Promise<void>;
function saveAll(name: string, source: string, map: MapTable, msx: string): Promise<void>;
```

データ型（`Token` / `Program` / `MapTable` / `SyntaxError` 等）は
[04-data-model.md](04-data-model.md) で定義する。

---

## 2.5 処理パイプラインの統括（SaveController）

保存ボタン押下時の制御は `SaveController` が一手に担う（保存フローの単一責務化）。

```ts
async function onSave(name: string, source: string): Promise<SaveResult> {
  const tokens = normalizeTokens(tokenize(source));
  const { ast, errors } = parse(tokens);

  // ① 文法エラー → 変換前のみ保存
  if (errors.length > 0) {
    await saveSourceOnly(name, source);            // 仕様6-2 / 1-8
    return { ok: false, errors };                  // 「誤りがあります。確認してください」
  }

  // ② 変換（transform は code, map に加え transformErrors を返す。errors と warnings を含む）
  const { code, map, transformErrors } = transform(ast);

  // ③ severity=error のみブロック（E_VAR_NAMES_EXHAUSTED / E_LINE_TOO_LONG /
  //    E_RECURSION_UNSUPPORTED / E_NON_SJIS 等）。warning（W_*）は止めない。
  const hardErrors = transformErrors.filter(e => e.severity === "error");
  if (hardErrors.length > 0) {
    await saveSourceOnly(name, source);            // 変換前のみ保存（仕様6-2）
    return { ok: false, errors: hardErrors };      // 「誤りがあります。確認してください」
  }

  // ④ 成功 → 3種すべて保存
  const msx = renderMsx(code);
  await saveAll(name, source, map, msx);           // 仕様5-3
  return { ok: true, msx };                         // 「保存しました」
}
```

> `transform()` の戻り値型は [§2.4](#24-モジュール間インタフェースtypescript-シグネチャ) の `TransformResult`
> （`code` / `map` / `transformErrors`）に対応する。詳細な保存フローは [08-file-save.md](08-file-save.md)。

---

## 2.6 状態管理（EditorUI）

| 状態 | 説明 |
|------|------|
| `source` | 構造化BASICの編集中テキスト |
| `errors` | 直近の文法チェック結果 |
| `msxCode` | 変換成功時のMSX-BASIC（変換後タブ表示用） |
| `activeTab` | `"structured"` または `"msx"` |
| `dirty` | 未保存変更フラグ |

文法チェックは「入力停止後デバウンス（例:400ms）」で増分実行し、`errors`/`×`表示を更新する
（保存時にも必ず再実行する）。詳細は [07-editor-ui.md](07-editor-ui.md)。

---

## 2.7 ディレクトリ構成（実装時の推奨）

```
src/
  lexer/        token.ts, lexer.ts
  parser/       parser.ts, grammar.ts
  ast/          nodes.ts
  transform/    transformer.ts, lineAllocator.ts, mapTable.ts
  reverse/      reverseTransformer.ts
  format/       formatter.ts, normalize.ts
  error/        errorReporter.ts, errors.ts
  io/           fileManager.ts
  ui/           Editor.tsx, Tabs.tsx, Gutter.tsx, ErrorMark.tsx
  app/          saveController.ts
  optimize/     lineOpt.ts            (仕様8: 行番号/最適化)
docs/           本設計書
test/           各モジュール単体テスト
```
