# 04. データモデル

対応仕様: **【2】【3-7】【7】** ／ AST・変換テーブル・エラー・トークン

本書では実装の中核となるデータ構造を TypeScript 型として定義する。

---

## 4.1 Token

```ts
type TokenKind =
  | "KEYWORD" | "IDENT" | "NUMBER" | "STRING"
  | "OP" | "COMMENT" | "NEWLINE" | "EOF";

interface Position { line: number; column: number; }

interface Token {
  kind: TokenKind;
  value: string;     // 大文字化後の値（STRING/COMMENTは原文保持）
  raw: string;       // 大文字化前の原文（逆変換・整形で使用）
  pos: Position;     // 開始位置
}
```

---

## 4.2 AST（抽象構文木）

### 4.2.1 ルート

```ts
interface Program {
  type: "Program";
  functions: FunctionDef[];
  toplevel: Stmt[];          // MAIN相当（FUNCTION外の文）
}
```

### 4.2.2 関数定義・引数

```ts
interface FunctionDef {
  type: "FunctionDef";
  name: string;
  params: Param[];
  body: Stmt[];
  pos: Position;
}

interface Param {
  name: string;
  byRef: boolean;            // REF 引数か（仕様1-3）。
                             // REF=「名前置換による参照渡し」: 仮引数を呼び出し側の実変数名へ直接置換する
                             // （ゼロコピー）。スカラ・配列（数値/文字列）・多次元すべて共通（特例なし, §5.4）。
}
```

### 4.2.3 文（Stmt）

```ts
type Stmt =
  | LetStmt | PrintStmt | CallStmt | ReturnStmt
  | BreakStmt | ContinueStmt | CommentStmt
  | DimStmt
  | IfBlock | ForBlock | WhileBlock;
// 注: ネスト許可のため、ブロックの本体(Stmt[])は IfBlock/ForBlock/WhileBlock を
//     再帰的に含み得る。「ガード節(GuardStmt)」は方針転換により廃止した。

// 代入の左辺。変数(ident)または配列要素 A(i,j,…)。
type LValue = VarRef | ArrayRef;

interface LetStmt      { type: "Let"; target: LValue; expr: Expr; hadLet: boolean; pos: Position; }
// hadLet: 原文で LET を書いていたか（整形・逆変換で原文寄りに再現するため。省略可）
interface DimStmt      { type: "Dim"; decls: ArrayDecl[]; pos: Position; }
interface ArrayDecl    { name: string; dims: Expr[]; }   // DIM A(10) → {name:"A", dims:[10]}
interface PrintStmt    { type: "Print"; args: Expr[]; pos: Position; }
interface CallStmt     { type: "Call"; call: CallExpr; pos: Position; }
interface ReturnStmt   { type: "Return"; expr?: Expr; pos: Position; }
interface BreakStmt    { type: "Break"; pos: Position; }
interface ContinueStmt { type: "Continue"; pos: Position; }
interface CommentStmt  { type: "Comment"; text: string; pos: Position; }

interface IfBlock {
  type: "If"; cond: Expr;
  then: Stmt[];              // ネスト許可: 任意の Stmt（ブロック含む）
  else?: Stmt[];
  pos: Position;
}
interface ForBlock {
  type: "For"; varName: string;
  from: Expr; to: Expr; step?: Expr;
  body: Stmt[];             // ネスト許可: 任意の Stmt（ブロック含む）
  pos: Position;
}
interface WhileBlock {
  type: "While"; cond: Expr;
  body: Stmt[];             // ネスト許可: 任意の Stmt（ブロック含む）
  pos: Position;
}

// BreakStmt / ContinueStmt は「最も内側のループ」を対象とする（4.2.3 参照）。
// パース時に各ノードへ enclosingLoopId を付与すると変換が容易（任意）。
```

### 4.2.4 式（Expr）

```ts
type Expr = NumLit | StrLit | VarRef | ArrayRef | BinaryExpr | UnaryExpr | CallExpr;

interface NumLit    { type: "Num"; value: number; }
interface StrLit    { type: "Str"; value: string; }       // 原文保持
interface VarRef    { type: "Var"; name: string; }
interface ArrayRef  { type: "ArrayRef"; name: string; indices: Expr[]; }  // A(i,j,…)
interface BinaryExpr{ type: "Bin"; op: string; left: Expr; right: Expr; }
interface UnaryExpr { type: "Un"; op: string; operand: Expr; }
interface CallExpr  { type: "CallExpr"; name: string; args: Arg[]; }

interface Arg { byRef: boolean; expr: Expr; }
```

> `A(i)` は `ArrayRef`（DIM宣言済み）か `CallExpr`（FUNCTION名）かを、宣言情報で解決する
> （[01](01-language-spec.md#19-代入let省略配列dim)）。`LetStmt.target` が `ArrayRef` の場合は配列要素代入。

---

## 4.3 MSX-BASIC 中間表現

変換結果は「MSX行」の配列として保持する。レンダリング前に行番号最適化を行う（仕様8-3）。

```ts
interface MsxLine {
  lineNo: number;       // 100,110,… （割当後）
  text: string;         // 行の本文（":"による複文を含みうる）
  origin?: OriginRef;   // 逆変換用: 由来情報
}

interface OriginRef {
  funcName?: string;    // どの FUNCTION 由来か
  stmtKind?: string;    // "Return" | "Break" | "Continue" | "Call" ...
  sourceFile?: string;  // 由来ファイル（INCLUDE 分割復元用 provenance, §1.13）
  srcLine?: number;     // 構造化BASIC側の行（そのファイル内の行）
}
```

> **INCLUDE provenance**：`MapTable` は取り込んだ全ファイル一覧（`sources: string[]`）を持ち、各 `MsxLine.origin` に
> `sourceFile`/`srcLine` を記録する。逆変換は これを使って **元の複数ファイルへ分割復元**する（[06 §6.12](06-reverse-transformer.md)）。

レンダリング（最終文字列化）:

```ts
function renderMsx(lines: MsxLine[]): string {
  return lines.map(l => `${l.lineNo} ${l.text}`).join("\r\n");
}
```

---

## 4.4 変換テーブル MapTable（仕様3-7）

逆変換（[06-reverse-transformer.md](06-reverse-transformer.md)）を可能にするための対応情報。

```ts
interface MapTable {
  version: string;                 // "1.0"
  source: string;                  // 変換前ファイル名（エントリ）
  sources: string[];               // INCLUDE で統合した全ファイル（分割復元用 provenance, §1.13）
  functions: FuncMap[];            // 関数 ↔ GOSUBブロック対応
  varNameMap: VarName[];           // 全変数 ↔ 2文字MSX名（旧varRenames+stringVarMapを統合, §4.4.1）
  controlFlow: FlowMap[];          // BREAK/CONTINUE/RETURN の GOTO 対応
  lineLabels: LineLabel[];         // MSX行番号 ↔ 構造化ラベル
  variants: FuncVariant[];         // REF名前置換で複製された関数ブロック ↔ 元関数（§5.4.3）
}

// 全変数の 2文字MSX名 割当（旧 varRenames / stringVarMap を統合）。
// MSX変数名は先頭2文字のみ有効（_不可）。型別プール（% ! # $）で約960個/型。
// 再帰禁止＝非再入なので生存区間が重ならないローカルは名前を使い回す（§5.11）。
interface VarName {
  original: string;                // 構造化での変数名 例 "SCORE" / "player_name$"
  scope: string;                   // "GLOBAL" or 関数名（"DRAW" 等）。逆引きの単位
  type: "%" | "!" | "#" | "$";     // 型プール
  msxName: string;                 // 割当先2文字名 例 "S0" / "A$"
  liveFrom?: number;               // 生存区間（構造化ソース行。再利用・逆変換補助）
  liveTo?: number;
}

interface FuncMap {
  name: string;                    // 構造化での関数名
  entryLine: number;               // GOSUB先の先頭MSX行番号
  exitLine: number;                // ブロック末尾(RETURN)のMSX行番号
  retVar: string;                  // 戻り値の2文字名 例 "FR"（仕様3-2）
  params: ParamMap[];
}

interface ParamMap {
  name: string;                    // 仮引数名（構造化）
  byRef: boolean;                  // true=名前置換による参照渡し（§5.4）／false=値渡し
  // 値渡し: 関数ローカルに割り当てた2文字名 / 参照渡し(REF): 置換した呼び出し側の実変数の2文字名
  msxVar: string;
}

// REF=名前置換のため、同じ関数を異なる実引数名で呼ぶと本体が複製される（§5.4.3）。
// どの (関数, 実引数名群) から生成された複製かを記録し、逆変換で元の1関数へ統合する。
interface FuncVariant {
  funcName: string;                // 元の関数名（構造化）
  entryLine: number;               // この複製ブロックの先頭MSX行
  refSubst: { param: string; actual: string }[];  // 例 [{param:"A", actual:"SCORE"}]
}

interface FlowMap {
  kind: "Break" | "Continue" | "Return";
  msxLine: number;                 // GOTO/RETURN を出した行
  targetLine: number;              // 飛び先（BREAK=NEXT直後, CONTINUE=NEXT直前）
  loopId?: string;                 // 対応ループの識別子
}

interface LineLabel {
  msxLine: number;                 // 100
  label: string;                   // "@ADD" や "@MAIN_3"（仕様4-2）
}
```

### 永続化形式（仕様3-7, 6-1）

`MapTable` は JSON で保存する。拡張子は `.map.json` を推奨。

```json
{
  "version": "1.0",
  "source": "game.msxb",
  "functions": [
    { "name": "ADD", "entryLine": 1000, "exitLine": 1030,
      "retVar": "AR",
      "params": [
        { "name": "A", "byRef": false, "msxVar": "AA" },
        { "name": "B", "byRef": false, "msxVar": "AB" }
      ] }
  ],
  "varNameMap": [
    { "original": "SCORE",        "scope": "GLOBAL", "type": "%", "msxName": "S0" },
    { "original": "player_name$", "scope": "GLOBAL", "type": "$", "msxName": "A$" },
    { "original": "A",            "scope": "ADD",    "type": "!", "msxName": "AA" },
    { "original": "B",            "scope": "ADD",    "type": "!", "msxName": "AB" }
  ],
  "controlFlow": [
    { "kind": "Break", "msxLine": 240, "targetLine": 280, "loopId": "L1" }
  ],
  "lineLabels": [ { "msxLine": 1000, "label": "@ADD" } ],
  "variants": []
}
```

---

## 4.5 エラーモデル

パーサー由来（[03](03-lexer-parser.md)）の `SyntaxError` と、UI表示用モデルを分離する。

```ts
interface SyntaxError {
  line: number; column: number;
  kind: string; message: string;
  severity: "error" | "warning";
}

// ErrorReporter が生成するUI用
interface EditorErrorModel {
  line: number;                 // ×を表示するエディタ行
  markers: SyntaxError[];       // 同一行に複数あり得る
  tooltip: string;              // 改行連結したツールチップ文言
}
```

---

## 4.6 保存成果物モデル（FileManager I/O）

```ts
interface ProjectArtifacts {
  sourceName: string;           // 例 "game.msxb"
  source: string;               // 構造化BASIC本文（仕様6-1）
  map?: MapTable;               // 変換テーブル（変換成功時のみ）
  msx?: string;                 // MSX-BASIC本文（変換成功時のみ）
}
```

- 文法エラー時は `source` のみ保存（仕様6-2）。
- 詳細は [08-file-save.md](08-file-save.md)。

---

## 4.7 命名規約（変換で使用）

| 対象 | 規約 | 例 |
|------|------|----|
| 全変数（戻り値・ローカル・グローバル） | **2文字MSX名アロケータ**が割当（型別プール・生存解析、`varNameMap`） | `SCORE`→`S0`, `I`→`FI`, 戻り値→`FR` |
| ラベル（内部用・出力には残さない） | `@<関数名>` / `@<関数名>_<連番>` | `@ADD`, `@MAIN_3` |
| ループID（内部用） | `L<連番>` | `L1` |

> **重要**：MSX変数名は**先頭2文字のみ有効・`_`不可**。旧 `<関数>_<名前>`（`AD_A`）方式と「文字列26スロット」は
> **廃止**し、全変数を2文字名へ割り当てる単一アロケータに統合した（[05 §5.11](05-transformer.md#511-2文字msx名アロケータ全変数全型)・[01 §1.10](01-language-spec.md#110-変数スコープ)）。
> ラベル/ループIDは割当計算用の内部識別子で、最終出力（数値行番号）には残らない。

---

## 4.8 シンボルインデックス（エディタ・ナビゲーション用）

エディタの定義へ移動／関数の呼び元・呼び先往復（Find Usages）／変数初期化箇所ジャンプ（[11 §11.10](11-editor-features.md#1110-ナビゲーション)、JetBrains風）のため、
Parser は AST から **シンボルインデックス**を生成する。すべて **エディタ行番号**（MSX行番号ではない）で位置を持つ。

```ts
interface SymbolIndex {
  functions: FuncSymbol[];
  variables: VarSymbol[];
}

interface FuncSymbol {
  name: string;
  defLine: number;          // FUNCTION 定義のエディタ行
  params: string[];
  callSites: number[];      // 呼び出し箇所のエディタ行（複数）
}

interface VarSymbol {
  name: string;
  scope: string;            // 所属関数名 or "MAIN"（トップレベル）
  defLine: number;          // 初期化（最初の代入 LET / DIM / REF引数）のエディタ行
  refLines: number[];       // 参照箇所のエディタ行
  isString: boolean;        // 文字列変数（$）か（A$〜Z$ スロット対象, §4.4）
}
```

- **変数の `defLine`** ＝ 当該スコープでその変数を**最初に初期化している行**（`LET`／`DIM`／`REF`仮引数）。
- 入力停止時のデバウンス解析（[07 §7.6](07-editor-ui.md)）で増分更新し、ジャンプ機能へ供給する。
- 変換テーブル（`MapTable`）とは別物（こちらは編集支援専用で、永続化は任意）。
