# 01. 言語仕様（構造化BASIC）

対応仕様: **【1. 言語仕様】**

---

## 1.1 概要

構造化BASICは、MSX-BASIC を生成するためのフロントエンド言語である。
旧来のBASICにおける `GOTO`/行番号を排除し、`FUNCTION`・ブロック構造・参照渡しを導入する。
ブロック構造（IF/FOR/WHILE）は **任意のネスト（入れ子）を許可** する。

> **【仕様変更】** 原仕様1-4の「ブロックのネスト禁止」は撤回した。MSX-BASIC が FOR/NEXT・1行IFを
> ネイティブに入れ子できるため、ネストを許可する方が変換後コードの行数・メモリが小さくなる。
> 詳細な根拠は [README のネスト許可に関する節](README.md)（設計判断：なぜネストを許可するのか）を参照。
> ネストできないのは **FUNCTION の入れ子のみ**（FUNCTIONはトップレベル定義限定）。

---

## 1.2 ソース構造

ソースは「関数定義の並び」と「トップレベル文（メイン）」から成る。

```basic
' コメントは ' で開始
FUNCTION ADD(A, B)
    RETURN A + B
END FUNCTION

FUNCTION MAIN()
    LET X = ADD(1, 2)
    PRINT X
    RETURN 0
END FUNCTION
```

- エントリポイントは `MAIN()` とする（無い場合はトップレベル文をメインとみなす）。
- 1行に1文を基本とする（`:` による複文は構造化側では禁止。MSX変換時のみ使用）。

---

## 1.3 FUNCTION（仕様1-1, 1-2, 1-3）

### 1.3.1 定義

```basic
FUNCTION <名前>(<引数リスト>)
    <文の並び>
END FUNCTION
```

- **SUB は存在しない。** すべて FUNCTION で表現する（仕様1-1）。
- 戻り値を返さない処理も FUNCTION として定義し、`RETURN 0` 等で明示終了する。
- **FUNCTION はトップレベルのみ**（ネスト不可、[§1.4](#14-ブロック構造とネスト仕様1-4ネスト許可へ改訂)）。
- **再帰は未対応**。直接・間接を問わず呼び出しが循環するとエラー（`E_RECURSION_UNSUPPORTED`）。
  GOSUB展開＋固定変数名のため再入で値が壊れるため（[03](03-lexer-parser.md)）。
- **MSX-BASIC組み込み命令・関数**（`PRINT` `INPUT` `LOCATE` `CLS` `MID$` `CHR$` `RND` `PEEK` `POKE` 等）は
  ユーザFUNCTIONではなく**組み込みとして認識し、そのままパススルー**する。組み込み名はユーザ関数で再定義不可。
  未知の呼び出しは `E_UNKNOWN_FUNCTION`（[03](03-lexer-parser.md)）。

### 1.3.2 戻り値と RETURN（仕様1-2）

- `RETURN <式>` で戻り値を返す。
- **RETURN は関数内のどこでも使用可能**（早期リターンを許可）。
- 戻り値の型は数値／文字列（MSX-BASICの `$` 命名規則に従う）。

```basic
FUNCTION ABS(N)
    IF N < 0 THEN
        RETURN -N
    END IF
    RETURN N
END FUNCTION
```

### 1.3.3 引数渡し（仕様1-3）

| 修飾（定義側） | 渡し方 | 実引数の制約 |
|------|--------|------|
| なし | 値渡し（デフォルト） | 式・即値・変数いずれも可 |
| `REF` | 参照渡し | **変数名（スカラ・数値配列）のみ許可**（式・即値はエラー、仕様2-3。文字列配列は不可） |

**呼び出し側の `REF` は省略可。** 参照渡しかどうかは関数定義（仮引数の `REF`）で決まり、
呼び出し側の `REF` は読みやすさのための任意マーカーである。
よって `R = EXCHANGE(REF X, REF Y)` と `R = EXCHANGE(X, Y)` はどちらも同じ参照渡しになる
（[03](03-lexer-parser.md#333-ref引数チェック仕様2-3)）。

### REF の意味論：名前置換方式（ゼロコピー）

> REF は **「呼び出し側の実変数名へ直接置換する」名前置換方式**で実装する（コピー無し）。
> MSXは全変数グローバルなので、関数本体が呼び出し側の実変数を**そのまま使う**＝真の参照渡し。

- **スカラも配列も完全に同一規則**（特例なし）。数値配列・**文字列配列**・多次元配列、すべて名前置換でREF可能。
- 呼び出し側で `REF X` と書けば、関数本体の仮引数は `X` に置換され、`X` を直接読み書きする。
  これにより「速度のためにREFを付ける／コピーコストを払わない」がプログラマの選択になる。
- 同じ関数を**異なる配列名で呼ぶ**と、変換器が**配列名ごとに関数本体を複製**する（ゼロコピー維持のため。[05 §5.4.3](05-transformer.md#543-異なる配列で呼ぶ場合配列名ごとに本体を複製)）。これは変換の実装詳細で、言語の意味論は一貫。
- **配列の値渡し（REF無し）も可**だが全要素コピー（O(n)）で重い。大きい配列は警告（[05 §5.4.5](05-transformer.md)）。

```basic
FUNCTION EXCHANGE(REF A, REF B)   ' 関数名は組み込み命令と別名に（SWAP/DRAW 等は E_NAME_IS_BUILTIN）
    LET T = A
    LET A = B
    LET B = T
    RETURN 0
END FUNCTION

FUNCTION MAIN()
    LET X = 1                  ' 構造化BASICは1行1文（複文 ":" は禁止）
    LET Y = 2
    LET R = EXCHANGE(REF X, REF Y) ' X,Y が入れ替わる
    RETURN 0
END FUNCTION
```

> **補足（`LET` 省略）**：構造化BASICでは `LET` を省略できる（§1.9）。よって上記は
> `X = 1` / `Y = 2` / `R = EXCHANGE(X, Y)` のように書いても同じ意味で合法である。
> 本書ではキーワードを明示するため `LET` を付けて記述しているが、どちらの書き方も等価。

---

## 1.4 ブロック構造とネスト（仕様1-4：ネスト許可へ改訂）

サポートするブロック:

| 構文 | 形式 |
|------|------|
| IF | `IF <条件> THEN` … `END IF`（`ELSE` 可） |
| FOR | `FOR <var> = <from> TO <to> [STEP <s>]` … `NEXT` |
| WHILE | `WHILE <条件>` … `WEND` |

### ネストは許可する（設計変更）

> **【重要・仕様変更】** 原仕様1-4は「ブロックの中に別のブロックを置くことを禁止」していたが、
> 本プロジェクトでは方針を転換し、**ブロックの任意のネスト（入れ子）を許可**する。
> 理由は [09-optimization.md](09-optimization.md#92-ネスト許可への方針転換と早期リターン) を参照
> （MSX-BASICはFOR/NEXT・1行IFをネイティブで入れ子可能なため、ネストを許す方が変換後の行数・メモリが小さくなる）。
> 旧仕様1-4および「ガード節」「後置IF脱出文」案は本決定により破棄する。

- **IF / FOR / WHILE は、同種・異種を問わず自由にネスト可能**とする。
- ブロック本体には、単純文・他のブロック・BREAK/CONTINUE/RETURN を任意に記述できる。
- ネスト段数の上限は設けない（ただし実装上の推奨上限・MSXのFOR/GOSUBスタック制約は [09](09-optimization.md) を参照）。
- **FUNCTION のネストのみ禁止**（関数定義の中に関数定義は置けない。これは従来通り）。

#### ネスト許可マトリクス（すべて OK）

| 外側 ＼ 内側 | IFブロック | FORブロック | WHILEブロック |
|--------------|:---------:|:----------:|:-------------:|
| **IFブロック**    | OK | OK | OK |
| **FORブロック**   | OK | OK | OK |
| **WHILEブロック** | OK | OK | OK |

```basic
' OK: FOR の中に IF ブロック（ネスト）
FOR I = 1 TO 10
    IF A(I) > 0 THEN
        PRINT A(I)
        LET SUM = SUM + A(I)
    END IF
NEXT

' OK: IF の中に FOR、さらにその中で条件分岐（多段ネスト）
IF MODE = 1 THEN
    FOR I = 1 TO N
        IF A(I) < 0 THEN
            LET A(I) = 0
        END IF
    NEXT
END IF
```

> 処理を整理したい場合は従来どおり FUNCTION へ切り出してもよいが、**必須ではない**。
> ネスト解消のためだけに関数化する必要はなくなった。

### 1.4.1 SELECT CASE（多分岐）

`ELSEIF` の代わりの読みやすい多分岐。`SELECT CASE <式>` … `CASE …` … `CASE ELSE` … `END SELECT`。

```basic
SELECT CASE STATE%
    CASE 0
        TITLE()
    CASE 1, 2, 3          ' 値のリスト
        PLAYING()
    CASE ELSE
        GAMEOVER()
END SELECT
```

- **セレクタは一度だけ評価**される（副作用のある関数呼び出しでも安全。内部で一時変数へ退避）。
- **フォールスルー無し**・**最初に一致した CASE のみ実行**して `END SELECT` の次へ。C の `switch` と違い `break` は不要。
- `CASE ELSE` は任意・**最後に1つだけ**（違反は `E_SELECT_ELSE_LAST`）。
- CASE 本体内の `BREAK`/`CONTINUE` は **外側のループ**に係る（SELECT はループではない）。
- **v1 スコープ**：`CASE 値`／`CASE a, b, c`（リスト）／`CASE ELSE`。範囲 `CASE lo TO hi` と関係 `CASE IS <演算子> 値` は **v2 予定**（今は `E_SELECT_UNSUPPORTED`）。
- 変換方式は [05 §5.15](05-transformer.md) を参照（一時Let＋ネスト IF へ desugar）。

---

## 1.5 BREAK / CONTINUE（仕様1-5）

- `BREAK` … **最も内側の囲みループ**を脱出する。
- `CONTINUE` … 最も内側の囲みループの次の反復へ進む。
- ネストを許可したため、対応ループは「最も内側（innermost）の FOR/WHILE」と定義する。
- BREAK/CONTINUE はネストした IF ブロックの内部からでも使用できる（対象は常に最も内側のループ）。

```basic
FUNCTION FINDPOS(REF ARR, N, KEY)
    FOR I = 1 TO N
        IF ARR(I) = KEY THEN
            RETURN I        ' 早期リターン（ネストしたIF内から）
        END IF
    NEXT
    RETURN -1
END FUNCTION

FUNCTION SCAN(REF A, N)
    FOR I = 1 TO N
        IF A(I) = 0 THEN
            CONTINUE        ' 最も内側のFORの次反復へ
        END IF
        IF A(I) < 0 THEN
            BREAK           ' 最も内側のFORを脱出
        END IF
        PRINT A(I)
    NEXT
    RETURN 0
END FUNCTION
```

> 多重ループでの BREAK/CONTINUE の飛び先解決（最も内側のループの NEXT 位置）は
> [05-transformer.md](05-transformer.md#56-break--continue--goto仕様3-4-3-5) を参照。

---

## 1.6 自動大文字化（仕様1-6）

- 大文字化の対象は **キーワード・変数名・関数名（＝コードのトークン）のみ**。
- **文字列リテラル（`"..."`）とコメント（`'...` / `REM`）は一切変換しない。**
  あえて小文字で書いた文字列・コメントは **そのまま小文字で保持**する（大文字化されない）。

```basic
let msg$ = "Hello world"   ' あいさつ message
   ↓ 大文字化（コード部のみ）
LET MSG$ = "Hello world"   ' あいさつ message
'              ^^^^^^^^^^^ 文字列の中身は原文のまま（小文字保持）
'                            コメントも原文のまま（小文字保持）
```

### 大文字化のタイミング（エディタUX）

> **【方針確定】** 入力中に毎キー大文字化すると**カーソル位置や日本語IME変換がちらつく**ため、
> **タイプ中は素のまま**とし、**保存時・フォーマット実行時にまとめて大文字化**する。

- 入力中：ユーザが打った通り（小文字含む）をそのまま表示。
- 保存／フォーマット（[11 §11.14 A](11-editor-features.md#a-自動フォーマッタ)）時：コードのトークンのみ大文字化。
  **文字列リテラル・コメントの大小はこの時も変更しない**（上記）。
- 変換（Transformer）は大文字化後のトークンを前提とする。実装は Formatter（[02-architecture.md](02-architecture.md)）が担当。

---

## 1.7 エラー時の扱い（仕様1-7, 1-8）

- **文法エラーがある場合は変換不可**とし、エラー行（複数可）を返す（仕様1-7）。
- **文法エラーがあっても「変換前ファイル」は保存可能**とする（仕様1-8）。

詳細は [08-file-save.md](08-file-save.md) を参照。

---

## 1.8 文法（EBNF 概要）

```ebnf
program        = { function_def | toplevel_stmt } ;

function_def   = "FUNCTION" ident "(" [ param_list ] ")" newline
                 { statement }
                 "END" "FUNCTION" newline ;

param_list     = param { "," param } ;
param          = [ "REF" ] ident ;

statement      = simple_stmt | block_stmt ;

simple_stmt    = let_stmt | dim_stmt | global_stmt | print_stmt | call_stmt
               | return_stmt | break_stmt | continue_stmt | comment ;

global_stmt    = "GLOBAL" ident { "," ident } ;   (* 関数内でグローバルを使う宣言。§1.10 *)

block_stmt     = if_block | select_block | for_block | while_block ;   (* 内部に statement を任意ネスト可 *)

(* ブロック本体は statement を再帰的に含む = 自由なネストを許可 *)
if_block       = "IF" expr "THEN" newline
                 { statement }
                 [ "ELSE" newline { statement } ]
                 "END" "IF" newline ;

select_block   = "SELECT" "CASE" expr newline
                 { case_clause }
                 [ "CASE" "ELSE" newline { statement } ]   (* 末尾に1つだけ *)
                 "END" "SELECT" newline ;
case_clause    = "CASE" case_test { "," case_test } newline { statement } ;
case_test      = expr [ "TO" expr ]        (* v2: 範囲 lo TO hi *)
               | "IS" rel_op expr ;        (* v2: 関係。IS は文脈依存で非予約 *)
rel_op         = "=" | "<>" | "<" | "<=" | ">" | ">=" ;
(* v1 は case_test = expr（＋カンマ区切りのリスト）のみ。TO / IS は E_SELECT_UNSUPPORTED *)

for_block      = "FOR" ident "=" expr "TO" expr [ "STEP" expr ] newline
                 { statement }
                 "NEXT" [ ident ] newline ;     (* NEXT の変数名は省略可。書く場合は対応FORと一致 *)

while_block    = "WHILE" expr newline
                 { statement }
                 "WEND" newline ;

return_stmt    = "RETURN" [ expr ] ;
break_stmt     = "BREAK" ;       (* 最も内側のループを脱出。ループ外はエラー *)
continue_stmt  = "CONTINUE" ;    (* 最も内側のループの次反復へ。ループ外はエラー *)
let_stmt       = [ "LET" ] lvalue "=" expr ;     (* LET は省略可 *)
dim_stmt       = "DIM" array_decl { "," array_decl } ;
array_decl     = ident "(" expr { "," expr } ")" ;
lvalue         = ident | array_ref ;
array_ref      = ident "(" expr { "," expr } ")" ;   (* 添字付き参照。多次元可 *)
call_stmt      = ident "(" [ arg_list ] ")" ;
arg_list       = arg { "," arg } ;
arg            = [ "REF" ] ( ident | expr ) ;   (* REF時は ident のみ妥当 *)

(* expr の primary には array_ref も含む。詳細な式文法は 04-data-model.md。
   注: array_ref と call_stmt は字面が同じ ident "(" … ")"。
   DIM 宣言済み or 配列既知なら配列参照、FUNCTION 名なら関数呼び出しとして解決する。 *)
```

完全な文法定義とパーサー実装は [03-lexer-parser.md](03-lexer-parser.md)。

---

## <a name="19-代入let省略配列dim"></a>1.9 代入（LET省略）・配列・DIM

READMEの最小例で使用する基本要素を補足する。

### LET の省略

- 代入は `LET X = 1` でも、**`LET` を省略して `X = 1`** でもよい（どちらも合法）。
- 省略時も意味は同一。MSX-BASICへ変換する際は LET を出力しない（短く・高速）。

### 配列と DIM

- 配列は `DIM <名前>(<上限> [, <上限> …])` で宣言する（多次元可）。例：`DIM A(10)`, `DIM M(8,8)`。
- 添字付き参照 `A(I)` は **代入の左辺（lvalue）・式の中** の両方で使える。例：`A(3) = 0`、`PRINT A(I)`。
- `A(I)` は字面上 関数呼び出しと同形のため、**DIM 宣言済みの名前は配列**、FUNCTION 名は呼び出しとして区別する。

### NEXT の変数名

- `NEXT` は変数名を省略してもよい（`NEXT`）。明示する場合（`NEXT I`）は対応する FOR の変数と一致させる。
- ネストした FOR では `NEXT J : NEXT I` のように内側から閉じる（変換器は対応関係を保って出力する）。

> これらは構造化BASICの利便機能であり、AST・変換・逆変換でも一貫して扱う
> （[04-data-model.md](04-data-model.md)・[05-transformer.md](05-transformer.md)）。

---

## <a name="110-変数スコープ"></a>1.10 変数スコープ（ローカル既定 ＋ `GLOBAL` 宣言）

> モデルは **QuickBASIC／PHP と同じ「既定ローカル＋明示宣言で共有」**。MSXは全変数グローバルなので、
> 変換器が**2文字MSX名アロケータ**（§1.10.3）でスコープを疑似実現する。

### 1.10.1 規則

1. **トップレベル（FUNCTION の外）と MAIN の変数＝グローバルの置き場**。
2. **FUNCTION 内の変数は既定でローカル**（その関数専用）。`I` `J` `TMP` 等を各関数で気軽に使え、衝突しない。
3. **関数内からグローバルを読み書きするときだけ、関数先頭で `GLOBAL <名前>` と宣言**する（PHPの `global $x;` 相当）。
   - 宣言した名前 → グローバルを指す。宣言しない名前 → 常にローカル。
   - **宣言しない限り関数からグローバルは見えない**（暗黙共有による事故を防ぐ）。
4. 配列も同じ。トップレベルの `DIM` はグローバル配列、関数内の `DIM` はローカル配列。
   関数からグローバル配列を使うなら `GLOBAL A` を宣言する。

```basic
DIM A(10)                  ' トップレベル → グローバル配列
SCORE = 0                  ' トップレベル → グローバル

FUNCTION ADDSCORE(N)
    GLOBAL SCORE           ' グローバル SCORE を使う宣言（PHP流）
    SCORE = SCORE + N      ' グローバルを更新
    RETURN SCORE
END FUNCTION

FUNCTION DRAW()
    GLOBAL A
    FOR I = 1 TO 10        ' I は宣言してない → ローカル（事故らない）
        PRINT A(I)
    NEXT I
    RETURN 0
END FUNCTION
```

### 1.10.2 REF引数との関係

- `REF` は呼び出し側の実変数（ローカルでもグローバルでも可）を**名前置換で参照**する（[§1.3.3](#133-引数渡し仕様1-3)）。
- グローバルを関数で使う手段は2つ：**`GLOBAL` 宣言で直接触る**／**`REF` 引数で受け取る**。用途で選ぶ。

### 1.10.3 2文字MSX名アロケータ（実装）

- MSX-BASIC変数名は **先頭2文字のみ有効**（`COUNT`=`CO`）。`_` は使えない。実質予算は **約960個／型**
  （先頭英字×2文字目英数字、予約語除外）。
- 変換器は全変数を **型別プール（`%` `!` `#` `$`）の2文字名**へ割り当てる。
  - **グローバル**：プログラム全体で固定の名前。
  - **ローカル**：再帰禁止＝非再入なので、**生存区間が重ならなければ他関数と名前を使い回す**（生存解析）。
- 予算を使い切ると **`E_VAR_NAMES_EXHAUSTED`**（型別）。
- 旧「文字列26スロット（A$〜Z$）」は誤り（文字列も2文字＝約960個）。この一般アロケータに**統合・廃止**した。
- 詳細は [05 §5.11](05-transformer.md#511-2文字msx名アロケータ全変数全型)・[04 §4.4](04-data-model.md#44-変換テーブル-maptable仕様3-7)。

---

## 1.11 データ型・演算子・リテラル

### 1.11.1 型とサフィックス

- `%`(整数) / `!`(単精度) / `#`(倍精度) / `$`(文字列)。**既定型は単精度**（速度重視。`DEFINT` 等での調整は変換最適化、[09](09-optimization.md)）。
- **関数の戻り値型は関数名サフィックスで表す**：`FUNCTION NAME$(...)` は文字列を返す、`FUNCTION F%(...)` は整数を返す。サフィックス無しは単精度。
- ループ変数・添字は `%` 推奨（[09 §9.4](09-optimization.md)）。

### 1.11.2 演算子（MSX-BASIC準拠・優先順位もMSX準拠）

- 算術：`^`（べき乗） > 単項`-` > `* /` > `\`(整数除算) > `MOD` > `+ -`
- 比較：`= <> < > <= >=`（結果は MSX 流に真=-1/偽=0）
- 論理：`NOT` > `AND` > `OR` > `XOR`（`EQV` `IMP` も可）
- 文字列：連結は `+`。

### 1.11.3 リテラル・コメント

- 数値：10進、**16進 `&H`**（例 `&HFF`）。`&O`(8進)/`&B`(2進) も可。
- 文字列：`"..."`（ASCIIダブルクォートのみ、[README §9](README.md#9-変換後コードの品質要件)）。
- コメント：**`'` と `REM` の両方**。どちらも大文字化・変換の対象外。

### 1.11.4 配列の基数

- **base 0**（MSX既定）。`DIM A(10)` は `A(0)`〜`A(10)` の11要素。

---

## 1.12 戻り値の扱い（補足）

[§1.3](#13-function仕様1-1-1-2-1-3) の補足。**戻り値を使う＝式の位置の呼び出し**（`X=F()`, `F()+1`, `PRINT F()`, 引数 `G(F())`）。
**戻り値を捨てる＝文の位置の単独呼び出し**（行頭に `F()` のみ）。

- 関数末尾まで `RETURN <値>` 無しで落ちた場合は **暗黙 `RETURN 0`（文字列関数は `""`）**。
- ただし **式の位置で使われる関数が、値付き RETURN 無しで落ちうる**経路を持つ場合は `W_MISSING_RETURN_VALUE`（warning）。
- 文の位置でしか呼ばれない関数は `RETURN`（値無し）でよい（手続き的）。

---

## <a name="113-include分割ファイル"></a>1.13 INCLUDE（分割ファイル）

複数ファイルへの分割を許可する。

```basic
INCLUDE "graphics.msxb"
INCLUDE "lib/math.msxb"
```

- **トップレベルにのみ記述**。プリプロセッサが**パース前に解決**し、全ファイルを**1つのコンパイル単位**へ統合する。
- パスは取り込み元からの相対。設定 `includePaths`（[10 §10.9](10-tech-stack.md#109-設定settings)）の探索パスも使う。取り込みファイルも **Shift-JIS**。
- **名前空間は単位全体で共有**：FUNCTION名（重複は `E_DUP_FUNCTION`）、`GLOBAL` 変数（どのファイルの `GLOBAL X` も同一実体）。
- **同一ファイルの二重 include は1回に統合**（パス正規化で自動 dedup）。**循環 include は `E_INCLUDE_CYCLE`**、見つからなければ `E_INCLUDE_NOT_FOUND`。
- **⚠ 2文字名予算（約960/型）は全 include 合算で消費**（§1.10.3）。大規模分割では `E_VAR_NAMES_EXHAUSTED` に注意。
- 逆変換は変換テーブルの **由来（provenance）** を使い、**元の複数ファイルへ分割復元**する（[06 §6.12](06-reverse-transformer.md)）。

---

## <a name="114-const定数"></a>1.14 CONST（コンパイル時定数）

名前付き定数を宣言する。**変数ではなく、コンパイル時にリテラルへインライン展開**される（MSX変数を生成しない＝速度・サイズに有利）。実装は [const-inline.ts]（`transform` 冒頭のプリパス）。

```basic
CONST MAX_HP% = 100          ' 型サフィックスは任意
CONST TITLE$ = "READY"
CONST AREA% = 8 * 24         ' 定数式は畳み込む（= 192 に確定）
```

### 規則

- **トップレベルに宣言**する。使用箇所は全て畳み込んだリテラルへ置換される。
- **`GLOBAL` 宣言は不要**。定数は変数ではないので、どの関数からでも宣言なしで参照できる（[§1.10](#110-変数スコープ) のスコープ規則の対象外）。
- **再代入は不可**（初期化以外の `=`、`FOR` 変数、`INPUT`/`READ`/`GET`/`SWAP` 等の書込み対象にするとエラー）。
- 型サフィックス（`% ! # $`）は任意。付けると初期値の型を検証する（`CONST N% = 1.5` は型不一致）。**`STRICT`（[§1.15](#115-strict静的型付け)）では必須**。
- 初期化式は定数畳み込みできること。他の `CONST` を参照してもよい。

### エラー

| コード | 条件 |
| --- | --- |
| `E_CONST_ASSIGN` | 初期化以外で `CONST` に代入した |
| `E_CONST_NOT_CONSTANT` | 初期化式が定数畳み込みできない |
| `E_CONST_TYPE` | 宣言サフィックスと初期値の型が不一致 |
| `E_DUP_CONST` | 同名 `CONST` の重複宣言 |

> **変数（`GLOBAL`）との違い**：`GLOBAL` は実体のある可変変数で、関数内で使うには各関数で再宣言が必要・2文字MSX名を1つ消費する。`CONST` は不変・宣言不要・変数を生成しない。可変な共有状態は `GLOBAL`、不変値は `CONST`。

---

## <a name="115-strict静的型付け"></a>1.15 STRICT（任意の静的型付け）

ソース先頭に `STRICT` と書くと、**オプトインの静的型チェック**（Rust方式＝暗黙変換なし）が有効になる。既定はオフ（非strictでは従来どおりMSXの暗黙数値変換）。

```basic
STRICT
FUNCTION ADD%(A%, B%)
    RETURN A% + B%
END FUNCTION
TOTAL% = 0
FOR I% = 1 TO 10
    TOTAL% = ADD%(TOTAL%, I%)
NEXT I%
AVG! = CSNG(TOTAL%) / 10        ' % → ! は明示変換
```

### 規則

- **全ての変数・配列・引数・`FOR`変数・`CONST` に型サフィックス必須**（`% ! # $`）。無いと `E_STRICT_UNTYPED`。
- **代入・引数・戻り値は型が完全一致**。暗黙変換なし（`A% = B#`・`A% = 1.5`・文字列/数値の混在は `E_TYPE_MISMATCH`）。変換は `CINT`/`CSNG`/`CDBL`/`INT`/`FIX`/`ASC`/`STR$`/`VAL` 等で明示する。
- 数値リテラルは柔軟（`5` は `%`/`!`/`#` 可、`1.5` は `!`/`#`）。演算子はMSXの型昇格に従い、完全一致判定は**代入・引数・戻り値の境界**で行う。
- Z80は整数(`%`)演算が速いので、ゲームロジックは `%` へ寄せると有利。座標・三角関数は `!`/`#` に統一するか境界で明示変換。

例：[`examples/strict-demo.msxb`](../examples/strict-demo.msxb)。

> ⚠ **1文1行の原則は STRICT でも同じ**：`FOR I% = 1 TO 10 : ... : NEXT`（`:`複文）は STRICT でも非strictでも `E_SYNTAX`。上例のように改行で分ける（[§1.2](#12-ソース構造)）。
