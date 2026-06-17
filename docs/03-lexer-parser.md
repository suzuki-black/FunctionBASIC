# 03. 字句解析・構文解析・文法チェック

対応仕様: **【2. 文法チェック（パーサー）】** ／ 【7. Lexer, Parser】

---

## 3.1 Lexer（字句解析）

### 3.1.1 役割

ソース文字列を **トークン列** に分解する。位置情報（行・列）を全トークンに付与する。

### 3.1.2 トークン種別

| 種別 | 例 |
|------|----|
| `KEYWORD` | FUNCTION, END, IF, THEN, ELSE, FOR, TO, STEP, NEXT, WHILE, WEND, RETURN, BREAK, CONTINUE, LET, PRINT, REF |
| `IDENT` | 変数名・関数名（`A`, `MSG$`, `ADD`） |
| `NUMBER` | `123`, `3.14` |
| `STRING` | `"Hello"`（**大文字化対象外**） |
| `OP` | `+ - * / = < > <= >= <> ( ) ,` |
| `COMMENT` | `' ...`（**大文字化対象外**） |
| `NEWLINE` | 行末 |
| `EOF` | 終端 |

### 3.1.3 大文字化フック（仕様1-6）

Lexerは生トークンを返し、Formatter の `normalizeTokens()` が `KEYWORD`/`IDENT`/`OP` のみ大文字化する。
`STRING`/`COMMENT` は値を保持したまま通す。

```ts
function normalizeTokens(tokens: Token[]): Token[] {
  return tokens.map(t =>
    (t.kind === "STRING" || t.kind === "COMMENT")
      ? t
      : { ...t, value: t.value.toUpperCase() }
  );
}
```

### 3.1.4 字句エラー

- 閉じられていない文字列（`"abc`）→ `E_UNTERMINATED_STRING`
- 不正文字 → `E_ILLEGAL_CHAR`

字句エラーも ErrorReporter へ集約し、行・列を返す。

---

## 3.2 Parser（構文解析）

### 3.2.1 方式（仕様2-1）

**再帰下降（recursive descent）** によりASTを構築する。
各非終端記号に対し1つのパース関数を対応させる。

```
parseProgram
 ├─ parseFunctionDef
 │   ├─ parseParamList → parseParam
 │   └─ parseStatement*
 │       ├─ parseSimpleStmt (let/print/call/return/break/continue/comment)
 │       └─ parseBlockStmt  (if/for/while)  ← 本体は parseStatement* を再帰呼び出し（ネスト許可）
 └─ parseToplevelStmt*
```

### 3.2.2 エラー回復（仕様2-5: 複数エラーを全て返す）

- パース関数はエラー検出時に **panic-mode recovery** を行う。
- すなわち当該文を捨て、次の `NEWLINE`（または `END`/`NEXT`/`WEND`）まで読み飛ばして再同期し、
  以降のパースを継続する。これにより**1回のパスで全エラーを収集**する。

```ts
function synchronize() {
  while (!check("NEWLINE") && !checkAny(["END","NEXT","WEND","EOF"])) {
    advance();
  }
}
```

---

## 3.3 文法チェック規則

### 3.3.1 ブロックのネスト（仕様2-2：ネスト許可へ改訂）

> **【仕様変更】** 原仕様はネスト禁止だったが、方針転換により **ブロックの自由なネストを許可**する
> （[09](09-optimization.md#92-ネスト許可への方針転換と早期リターン)）。
> したがって `E_NESTED_BLOCK` チェックは行わない。代わりにブロック本体を再帰的にパースする。

- ブロック本体のパースは `parseStatement` を再帰的に呼ぶだけでよい（深さ制限なし）。
- 関数定義のみネスト禁止（`FUNCTION` の本体に `FUNCTION` が出たら `E_NESTED_FUNCTION`）。

```ts
function parseBlockBody(endKinds: string[]): Stmt[] {
  const body: Stmt[] = [];
  while (!atAny(endKinds) && !check("EOF")) {
    if (check("FUNCTION")) {                       // 関数のネストのみ禁止
      report("E_NESTED_FUNCTION", peek().pos,
        "FUNCTION の中に FUNCTION を定義することはできません");
      synchronize();
      continue;
    }
    body.push(parseStatement());                   // ← ブロックも再帰的に許可
  }
  return body;
}
```

### <a name="ループスタック"></a>3.3.2 BREAK / CONTINUE のループ内検査（ループスタック）

ネスト許可に伴い、BREAK/CONTINUE は **最も内側のループ** を対象とする。
パーサーは FOR/WHILE に入るたびにループIDを **スタックにpush**、`NEXT`/`WEND` で pop する。

```ts
const loopStack: string[] = [];

function parseForBlock(): ForBlock {
  expect("FOR"); /* ... */
  const loopId = newLoopId();
  loopStack.push(loopId);
  const body = parseBlockBody(["NEXT"]);
  expect("NEXT");
  loopStack.pop();
  return { type: "For", /* ... */, body, loopId };
}

function parseBreak(): BreakStmt {
  if (loopStack.length === 0) {
    report("E_BREAK_OUTSIDE_LOOP", peek().pos, "BREAK はループの内側でのみ使用できます");
  }
  expect("BREAK");
  return { type: "Break", enclosingLoopId: top(loopStack), pos };
}
```

- `enclosingLoopId` を AST ノードに記録しておくと、変換器が飛び先ループを即座に特定できる。
- `CONTINUE` も同様（`E_CONTINUE_OUTSIDE_LOOP`）。

### 3.3.3 REF引数チェック（仕様2-3）

- 関数 **定義** の `REF` 引数: 仮引数名（IDENT）であること。
- 関数 **呼び出し** の `REF` キーワードは **省略可**（`FIND_ZERO(POS)` でも `FIND_ZERO(REF POS)` でも可）。
  参照渡しか否かは **関数シグネチャ（仮引数の `byRef`）で決定** し、`REF` は明示用の任意マーカーとする。
- 仮引数が `byRef` の位置に来る実引数は **変数名（IDENT／配列要素）のみ許可**。
  式・即値・関数呼び出しなら `E_REF_NOT_VARIABLE`。この検査はシグネチャが必要なため **2パス目** で行う。

```ts
// 1パス目: REF キーワードの有無と式だけ取る（byRefは仮の値）
function parseArg(): Arg {
  const explicitRef = match("REF");
  const expr = explicitRef ? parsePrimary() : parseExpr();
  return { byRef: explicitRef, expr, explicitRef };
}

// 2パス目: シグネチャと突き合わせ、byRef位置の実引数が変数かを検査
function checkRefArgs(call: CallExpr, sig: FuncSig) {
  call.args.forEach((a, i) => {
    const paramByRef = sig.params[i]?.byRef ?? false;
    a.byRef = paramByRef;                       // 実際のbyRefはシグネチャで確定
    if (paramByRef && !isVariableOrElement(a.expr)) {
      report("E_REF_NOT_VARIABLE", posOf(a.expr),
        "参照渡し(REF)引数には変数名のみ指定できます（式・即値は不可）");
    }
  });
}
```

### 3.3.4 その他の構文チェック

| エラー種別 | 条件 |
|------------|------|
| `E_MISSING_END_FUNCTION` | `END FUNCTION` が無いまま EOF |
| `E_MISSING_END_IF` | `END IF` 欠落 |
| `E_MISSING_NEXT` / `E_MISSING_WEND` | ループ終端欠落 |
| `E_BREAK_OUTSIDE_LOOP` / `E_CONTINUE_OUTSIDE_LOOP` | ループ外の BREAK/CONTINUE |
| `E_RETURN_OUTSIDE_FUNCTION` | 関数外の RETURN |
| `E_NESTED_FUNCTION` | FUNCTION の中に FUNCTION を定義 |
| `E_DUP_FUNCTION` | 同名 FUNCTION の重複定義 |
| `E_UNKNOWN_FUNCTION` | 未定義関数の呼び出し（2パス目で検査。組み込み命令はパススルー） |
| `E_PAREN` | 括弧不一致 |
| `E_RECURSION_UNSUPPORTED` | **再帰**（直接/間接の呼び出し循環）。固定変数名のため非対応（2パス目/変換時に検出） |
| `E_VAR_NAMES_EXHAUSTED` | ある型の **2文字MSX名（約960個）を使い切った**（変換時検出。[05 §5.11](05-transformer.md#511-2文字msx名アロケータ全変数全型)） |
| `E_LINE_TOO_LONG` | 変換後の1行が **MSX-BASICの255バイト制限を超過**（変換時検出。自動分割不能時） |
| `E_NON_SJIS` | **Shift-JIS(JIS X 0201+0208)で表現できない文字**を含む（保存・変換時検出。[08 §8.6.4](08-file-save.md#864-shift-jis-表現不能文字の検査e_non_sjis)） |
| `E_INCLUDE_NOT_FOUND` | `INCLUDE` 先のファイルが見つからない（[01 §1.13](01-language-spec.md#113-include分割ファイル)） |
| `E_INCLUDE_CYCLE` | `INCLUDE` が循環している |
| `W_REF_MANY_VARIANTS`（warning） | REF名前置換で関数本体が**多数複製**（異なる配列が10個以上）。禁止せず警告（[05 §5.4.3](05-transformer.md#543-異なる配列で呼ぶ場合配列名ごとに本体を複製)） |
| `W_ARRAY_VALUE_COPY`（warning） | **配列の値渡しが大きい**（32要素以上、O(n)コピー）。禁止せず警告（[05 §5.4.5](05-transformer.md)・[09 §9.6](09-optimization.md#96-ref名前置換と配列値渡しのコスト)） |
| `W_MISSING_RETURN_VALUE`（warning） | **式の位置で使う関数**が値付きRETURN無しで落ちうる（暗黙RETURN 0。[01 §1.12](01-language-spec.md#112-戻り値の扱い補足)） |
| `W_BUILTIN_TARGET` / `W_BUILTIN_UNAVAILABLE`（warning） | ターゲット機種で**新しすぎる/使えない組み込み**（[12 §12.3](12-builtins.md#123-ターゲット機種フラグ)） |

> 文字列配列のREFは**許可**（名前置換で数値配列と同一。旧 `E_REF_STRING_ARRAY_NOT_SUPPORTED` は撤廃。理由は [05 §5.4.4](05-transformer.md#544-文字列配列のrefも許可特例なし)）。

> `W_*` は **警告（severity=warning）**。`transformErrors` に積むが**保存・変換はブロックしない**（エラーのみブロック）。詳細は [08 §8.4](08-file-save.md#84-savecontroller-実装02-と整合)。

> `E_VAR_NAMES_EXHAUSTED` / `E_LINE_TOO_LONG` / `E_RECURSION_UNSUPPORTED` は構文エラーではなく **変換段階** で検出するが、
> ユーザにはコンパイルエラーとして同じ `SyntaxError` 形で報告する（[05](05-transformer.md)・[README §9](README.md#msx-basic-の-1-行-255-バイト制限絶対制限)）。

### 3.3.5 INCLUDE 解決（パース前処理）

- パース前に **`INCLUDE` を再帰的に解決**し、全ファイルを1つのトークン列／ASTへ統合（[01 §1.13](01-language-spec.md#113-include分割ファイル)）。
- パス正規化で **同一ファイルは1回だけ**取り込み（dedup）。**循環検出**→`E_INCLUDE_CYCLE`、不在→`E_INCLUDE_NOT_FOUND`。
- 各トークン／ノードに **由来ファイル・行（provenance）** を付与（逆変換の分割復元用、[04](04-data-model.md)・[06](06-reverse-transformer.md)）。

### 3.3.6 字句の補足

- 数値リテラルは10進＋ **`&H`(16進)**／`&O`(8進)／`&B`(2進)（[01 §1.11.3](01-language-spec.md#1113-リテラルコメント)）。
- コメントは **`'` と `REM`** の両方（大文字化・変換の対象外）。

### 3.3.7 2パス構成

1. **1パス目**: 構文解析＋ローカル整合（ループスタック・ブロック終端・`GLOBAL`宣言収集）。関数シグネチャ表を構築。
2. **2パス目**: 呼び出し検査（未定義関数・引数個数・REF整合・**呼び出し循環＝再帰検出**・**組み込み解決**（[12](12-builtins.md)、組み込みでもユーザ関数でもなければ `E_UNKNOWN_FUNCTION`）・**戻り値検査**（式の位置で使う関数の値付きRETURN、§W_MISSING_RETURN_VALUE）・ターゲット機種チェック）。

---

## 3.4 エラー出力仕様（仕様2-4, 2-5）

各エラーは以下を保持する。

```ts
interface SyntaxError {
  line: number;     // 1始まり（エディタ行番号と一致）
  column: number;   // 1始まり
  kind: string;     // 例 "E_BREAK_OUTSIDE_LOOP"
  message: string;  // 日本語メッセージ
  severity: "error" | "warning";
}
```

- 複数エラーは配列で **全件返す**（仕様2-5）。
- 行・列・種別・メッセージを必ず含む（仕様2-4）。
- ErrorReporter が UI 表示用（行→×、ツールチップ文言）へ変換する
  （[07-editor-ui.md](07-editor-ui.md)）。

---

## 3.5 パーサー擬似コード（中核）

```ts
function parseFunctionDef(): FunctionDef {
  expect("FUNCTION");
  const name = expectIdent();
  expect("(");
  const params = check(")") ? [] : parseParamList();
  expect(")"); expect("NEWLINE");

  // 関数本体: parseStatement を繰り返すだけ。ブロックは parseStatement 内で
  // 再帰的に処理されるため、ネストは自然に許可される。
  const body = parseBlockBody(["END"]);   // FUNCTION のネストのみ内部で弾く（§3.3.1）
  expect("END"); expect("FUNCTION"); expect("NEWLINE");
  return { type: "FunctionDef", name, params, body, pos };
}

function parseStatement(): Stmt {
  if (check("IF"))    return parseIfBlock();      // 本体は parseBlockBody で再帰
  if (check("FOR"))   return parseForBlock();     // ループスタックに push/pop
  if (check("WHILE")) return parseWhileBlock();
  return parseSimpleStmt();                        // let/print/call/return/break/continue/comment
}
```

> 注意: ブロックの本体は `parseBlockBody` → `parseStatement` の再帰で構築されるため、
> IF/FOR/WHILE は同種・異種を問わず任意の深さにネストできる。禁止されるのは FUNCTION のネストのみ。
