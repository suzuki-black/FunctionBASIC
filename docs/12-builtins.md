# 12. MSX-BASIC 組み込み命令・関数（パススルー表）

対応: 言語の組み込み解決（[01](01-language-spec.md)・[03](03-lexer-parser.md)）／ターゲット機種（[09](09-optimization.md)・[10](10-tech-stack.md)）

---

## 12.1 方針

- `PRINT` `INPUT` `MID$` 等の **MSX-BASIC 組み込み命令・関数は、ユーザ FUNCTION ではなく「組み込み」として認識し、そのままパススルー**する。
- **組み込み名はユーザ FUNCTION で再定義不可**。未知の呼び出し（組み込みでもユーザ関数でもない）は `E_UNKNOWN_FUNCTION`（[03](03-lexer-parser.md)）。
- 組み込みは **大文字化の対象**（キーワード）。引数内の文字列・コメントは対象外（[01 §1.6](01-language-spec.md#16-自動大文字化仕様1-6)）。
- 各組み込みに **対応ターゲット機種フラグ**を持たせ、選択機種で使えない命令には警告を出す（§12.3）。

---

## 12.2 組み込み表（MSX2 Technical Handbook 準拠の中核）

出典: [MSX2 Technical Handbook Ch.2](https://konamiman.github.io/MSX2-Technical-Handbook/md/Chapter2.html) ／ [MSX Wiki: MSX-BASIC Instructions](https://www.msx.org/wiki/Category:MSX-BASIC_Instructions)。
最終校合は Sony MSX-BASIC リファレンスマニュアル等で行う。

| 分類 | キーワード |
|------|-----------|
| 制御（※構造化側はネイティブ構文。`GOTO`/`GOSUB` 等は生成専用） | `IF` `THEN` `ELSE` `FOR` `TO` `STEP` `NEXT` `WHILE` `WEND` `GOTO` `GOSUB` `RETURN` `ON…GOTO` `ON…GOSUB` `STOP` `END` |
| 画面/IO | `PRINT` `PRINT USING` `INPUT` `LINE INPUT` `LOCATE` `CLS` `SCREEN` `COLOR` `WIDTH` `BEEP` |
| プリンタ | `LPRINT` `LPRINT USING` `LLIST` `LFILES` `WIDTH LPRINT` |
| 図形 | `PSET` `PRESET` `LINE`（末尾 `B`/`BF` 対応） `CIRCLE` `PAINT` `COPY`（`… TO …`） `DRAW` `POINT`（関数） `PUT SPRITE` `COLOR SPRITE` `PUT KANJI` `COLOR=(…)`/`COLOR=NEW`（MSX2パレット） |
| 音 | `SOUND` `PLAY`（文・関数の両形） `BEEP` |
| メモリ/系 | `PEEK` `POKE` `VPEEK` `VPOKE` `DEF USR` `CALL`(`_`) `OUT` `INP` `BASE` `VDP` `WAIT` `SET` |
| ファイル | `OPEN` `CLOSE` `GET` `PUT` `FILES` `LOAD` `SAVE` `MERGE` `BLOAD` `BSAVE` `MAXFILES` `KILL` `NAME … AS` `FIELD … AS` `LSET` `RSET` |
| デバッグ | `TRON` `TROFF` |
| カセット（**turboR不可**） | `CLOAD` `CSAVE` `CALL MOTOR` `MOTOR` |
| turboR追加 | `CALL PCMPLAY` `CALL PCMREC` 等（機種フラグ=turboR） |
| 文字列関数 | `LEFT$` `RIGHT$` `MID$` `CHR$` `ASC` `LEN` `VAL` `STR$` `HEX$` `OCT$` `BIN$` `INSTR` `SPACE$` `STRING$` `INPUT$` `INKEY$` |
| 数学関数 | `ABS` `INT` `SQR` `SIN` `COS` `TAN` `ATN` `LOG` `EXP` `RND` `SGN` `FIX` |
| 型変換関数 | `CINT` `CSNG` `CDBL` `CVI` `CVS` `CVD` `MKI$` `MKS$` `MKD$` |
| 印字整形関数 | `TAB` `SPC`（`PRINT`/`LPRINT` 内） |
| ファイル/ディスク関数 | `EOF` `LOC` `LOF` `FPOS` `LPOS` `DSKF` `DSKI$` |
| 入力/特殊 | `STICK` `STRIG` `PAD` `PDL` `POS` `CSRLIN` `VARPTR` `FRE` `TIME` `ERR` `ERL` `USR`/`USR0`–`USR9` |
| データ | `DATA` `READ` `RESTORE`（[05 §5.13](05-transformer.md#513-data--read--restore)） |
| 宣言/変数 | `DIM` `DEFINT` `DEFSNG` `DEFDBL` `DEFSTR` `ERASE` `CLEAR` `LET` `SWAP` |

> `WHILE/WEND` `FOR/NEXT` `IF/THEN` は構造化側で**ネイティブ構文**として扱う（[01](01-language-spec.md)）。
> `GOTO`/`GOSUB`/`ON…` は構造化ソースでは原則使わず、変換器が生成に用いる。

### 12.2.1 節キーワード（改名禁止・文脈依存）

命令の途中にだけ現れ、それ自体は文の先頭にならない語は `BUILTIN_CLAUSE_WORDS`（[builtins.ts](../src/core/builtins.ts)）で管理し、**ユーザ変数として改名しない**。ただし `PAGE`/`TIME`/`B` 等は変数名にも使えるため、**文脈を限定**して曖昧さを避ける（パーサ `parseBuiltinStmt`）:

- `SET`/`GET` 命令の直後の語：`SET PAGE` `SET SCROLL` `SET ADJUST` `SET VIDEO` `SET TITLE` `SET TIME` `GET DATE` 等。
- `PRINT`/`LPRINT` 命令の直後の `USING` のみ：`PRINT USING …`（`PRINT PAGE` のような変数は対象外＝改名する）。
- `=` の直後：`COLOR=NEW` `COLOR=RESTORE`。
- `LINE` の**文末**に来る `B`/`BF`（箱・塗り箱）。

これら以外の位置（例：`PAGE = 5`、`PRINT PAGE`、`B = 4`）では通常のユーザ変数として一貫して2文字名へ割り当てる。命令中のキーワード（`COPY … TO …` の `TO`、`OPEN/NAME/FIELD … AS` の `AS`）や記号（`COLOR=` の `=`、ファイル番号 `#`）は AST 上 `word` パートとして素通しする。`AS` は予約語（[keywords.ts](../src/lexer/keywords.ts)）、`#` は字句解析で OP 化（[lexer.ts](../src/lexer/lexer.ts)）して扱う。

#### 括弧付きの組み込み名

`SPRITE(n)`（`COLOR SPRITE(0)=…`）や `KANJI(x,y)`（`PUT KANJI`）のように、組み込み"文"名が括弧を伴って式中に現れる場合も改名しない（transformer の `CallExpr`/`collectExprVars` は `isBuiltinFunction` ではなく `isBuiltin`＝文・関数の両方で判定）。`SPRITE$(n)` など `$` 付き組み込み配列も同様（ArrayRef は従来から `isBuiltin`）。

#### 予約システム変数

`TIME` は読み（`T=TIME`）・書き（`TIME=0`）とも改名しない予約名として `BUILTIN_STATEMENTS`／`BUILTIN_FUNCTIONS` の双方に掲載（MSX-BASIC でも `TIME` はユーザ変数に使えない）。`KANJI` も `PUT KANJI` 用に `BUILTIN_STATEMENTS` で予約。

---

## 12.3 ターゲット機種フラグ

各エントリは「最初に登場した世代」と「除外機種」を持つ。

```ts
interface Builtin {
  name: string;
  kind: "stmt" | "func";
  since: "MSX1" | "MSX2" | "MSX2P" | "turboR";  // 最低必要世代
  excludedOn?: ("turboR")[];                     // 例: カセット系は turboR で不可
  signature?: string;                            // 任意（引数チェック用）
}
```

- 既定ターゲット＝**turboR（MSX-BASIC 4.0、最も高機能）**（[10 §10.9](10-tech-stack.md#109-設定settings)）。
- 設定の「最低対応機種」より新しい `since` の命令を使うと **`W_BUILTIN_TARGET`（warning）**。
- 選択機種の `excludedOn` に該当（例：turboR でカセット命令）→ **`W_BUILTIN_UNAVAILABLE`（warning）**。

---

## 12.4 設定からの編集とリセット（要件）

組み込み表は **ユーザが設定画面から編集できる**。新機種・サードパーティ拡張・`CALL` 拡張などに追従するため。

- **追加/編集/削除**：`Builtin` エントリをユーザが追加・変更・無効化できる（例：拡張BASICの命令を登録）。
- **既定へリセット**：いつでも **「初期状態（本書の既定表）へリセット」** できる。編集内容は破棄され、出荷時の組み込み表に戻る。
- 永続化：ユーザ定義分は設定（[10 §10.9](10-tech-stack.md#109-設定settings)）に保存。**リセットは出荷時テーブルで上書き**。
- 編集はパーサの組み込み判定に即時反映（再変換時に有効）。

```ts
// 設定: builtins = 出荷時テーブル ∪ ユーザ追加 − ユーザ無効化
//      resetBuiltins() で出荷時テーブルのみへ戻す
interface BuiltinsConfig {
  userAdded: Builtin[];
  userDisabled: string[];     // 無効化した組み込み名
}
function resetBuiltins(): void;   // 既定（本書の表）へ戻す
```

---

## 12.5 関連

- パーサの組み込み解決・`E_UNKNOWN_FUNCTION`：[03-lexer-parser.md](03-lexer-parser.md)。
- `DATA/READ/RESTORE` の変換：[05 §5.13](05-transformer.md#513-data--read--restore)。
- ターゲット機種・設定：[10 §10.9](10-tech-stack.md#109-設定settings)・[09](09-optimization.md)。
