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
    CASE 10 TO 19         ' 範囲
        BOSS()
    CASE IS >= 100        ' 関係（= <> < <= > >=）
        DEBUG()
    CASE ELSE
        GAMEOVER()
END SELECT
```

- **セレクタは一度だけ評価**される（副作用のある関数呼び出しでも安全。内部で一時変数へ退避）。
- **フォールスルー無し**・**最初に一致した CASE のみ実行**して `END SELECT` の次へ。C の `switch` と違い `break` は不要。
- **CASE の書き方**：`CASE 値`／`CASE a, b, c`（リスト）／`CASE lo TO hi`（範囲）／`CASE IS <演算子> 値`（関係。演算子は `= <> < <= > >=`）／`CASE ELSE`。1つの CASE に複数指定は **OR**（例 `CASE 1, 5 TO 9, IS > 100`）。`IS` の後に演算子が無ければ `E_SELECT_IS_OP`。
- `CASE ELSE` は任意・**最後に1つだけ**（違反は `E_SELECT_ELSE_LAST`）。
- CASE 本体内の `BREAK`/`CONTINUE` は **外側のループ**に係る（SELECT はループではない）。
- 文字列セレクタも可（`CASE "A" TO "M"` は文字列比較へ）。変換方式は [05 §5.15](05-transformer.md) を参照（一時Let＋ネスト IF へ desugar）。

### 1.4.2 DATASET（名前付きデータブロック）

`READ`/`DATA` を名前付きにして「どのデータを読んでいるか」を明示する。`DATASET name … END DATASET` で定義し、`READ name INTO 変数` で順に読む。

```basic
DATASET ALIEN_A
    DATA "..####..", ".######."
END DATASET

FOR I% = 0 TO 15
    READ ALIEN_A INTO ROW$    ' ALIEN_A から順に読む
NEXT I%
RESTORE ALIEN_A               ' そのブロックを先頭へ巻き戻す
```

- **本体は `DATA` 行のみ**（＋注釈）。値は数値・文字列を混在可（MSX の DATA と同じ）。本体に他の文があれば `E_DATASET_BODY`、名前重複は `E_DATASET_DUP`。
- **`READ name INTO t1, t2, …`**：そのブロックから次の値を読む（複数ターゲット可）。未定義名は `E_DATASET_UNKNOWN`。
- **`RESTORE name`**：そのブロックの読み取り位置を先頭へ戻す（引数なし RESTORE と違い、**ブロック指定で巻き戻せる**＝現状に無い能力）。
- **方式A（v1）の制限**：MSX のデータポインタは1本なので、実装は「**別ブロックへ切り替わる時だけ自動 `RESTORE`**」。したがって——
  - **各ブロックは“読み切ってから”次へ**が前提。**一度離れたブロックに戻ると先頭から読み直し**（途中位置は保存されない）。交互アクセスは非対応（必要なら明示 `RESTORE name`）。
  - 追加RAMゼロ・O(1)。ゲームの起動時ロード（敵/マップ/パターンをブロック単位で読む）にそのまま合う。将来ランダムアクセス用に配列バッキング方式(B)を opt-in で足す余地あり。
- 素の `READ`/`DATA` とも併存可（ポインタは共有なので、どちらかに統一推奨）。変換方式は [05 §5.16](05-transformer.md)。

### 1.4.3 STRUCT（構造体）

敵・弾・アイテム等の「まとまったデータ」を構造体で書き、MSX の配列文化を内部で吸収する。

```basic
STRUCT Enemy
    X%, Y%, HP%, Pattern$      ' 平坦な型付きフィールド（% ! # $）
END STRUCT

DIM foe(20) AS Enemy           ' 配列インスタンス
DIM p AS Point                 ' スカラインスタンス
GLOBAL foe                     ' 関数から使うなら宣言（全フィールドへ展開される）

foe(i).HP = foe(i).HP - 1      ' 配列は () 添字＋ . フィールド
p.X = 10
```

- **struct-of-arrays へ desugar**：フィールドごとに配列（または変数）へ機械展開するだけ。**実行時のRAM・速度は手書き並行配列と完全に同一**（追加ゼロ）。`foe(i).HP` は配列アクセス1回で、間接参照・オフセット計算は無い。
- **配列は `()`／フィールドは `.`**。宣言は `DIM 名 [(N)] AS 型`。
- **`GLOBAL 名`** はインスタンス名で書けば**全フィールドへ展開**され、関数を跨いで同じ配列を共有する。
- **v1 の制限**（正直に）：フィールドは**平坦な基本型のみ**（ネスト構造体は非対応）。**1レコード丸ごとの関数受け渡し／戻り値は不可**（MSX にレコード型が無いため。添字＋`GLOBAL 名`で扱う）。2文字名予算はフィールド数ぶん消費（手書きと同じ）。
- エラー：未定義型で `DIM` → `E_STRUCT_UNKNOWN`／未知フィールド → `E_STRUCT_FIELD`／`.` を非インスタンスに → `E_STRUCT_NOT_INSTANCE`／型サフィックス無しフィールド → `E_STRUCT_FIELD_TYPE`。変換方式は [05 §5.17](05-transformer.md)。

### 1.4.4 EVENT TIMER（周期イベント）

一定間隔で実行される周期ハンドラ。MSX の `ON INTERVAL=n GOSUB` に対応。

```basic
EVENT TIMER 60          ' 60割り込み(≒1秒)ごとに本体を実行
    TICK% = TICK% + 1
END EVENT
```

- **意味**：宣言位置でタイマーを設置（`ON INTERVAL=n GOSUB … : INTERVAL ON`）。以後、本体が周期的に実行される。
- **⚠️ 協調的・粗い割り込み**：`ON INTERVAL` は**BASIC の文の切れ目で発火**するため、長い文があると遅延する（真のプリエンプティブ割り込みではない）。本体は**割り込み安全な短い処理**を推奨。
- 本体の変数は **MAIN と同じ**（同名なら同じ2文字MSX名を共有）。本体は MAIN の `END` の後にラベル付きで配置され `RETURN` で戻る。
- **v1 の制限**：INTERVAL は MSX に1系統なので **`EVENT TIMER` は1つだけ**（2つ目 → `E_EVENT_TIMER_DUP`）。**トップレベル（MAIN）専用**（関数内 → `E_EVENT_NOT_TOPLEVEL`）。
- **`EVENT VBLANK` は非対応**（`E_EVENT_VBLANK`）：真の VBLANK 割り込みから **BASIC インタプリタへ安全に再入できない**ため。毎フレーム処理は `HALT`/`WAIT_FRAME` によるメインループ同期（シューター参照）か、ASM フックがフラグを立てて BASIC がポーリングする形で。変換方式は [05 §5.18](05-transformer.md)。

### 1.4.5 ELSEIF（多段分岐）

`IF … ELSEIF cond THEN … ELSE … END IF`。`ELSEIF` は何段でも書ける（FunctionBASIC には従来 `ELSEIF` が無く、多段分岐は深いネスト IF が必要だった）。

```basic
IF N% = 1 THEN
    PRINT "ONE"
ELSEIF N% = 2 THEN
    PRINT "TWO"
ELSEIF N% >= 3 THEN
    PRINT "MANY"
ELSE
    PRINT "OTHER"
END IF
```

- **意味**：上から順に判定し、**最初に真になった枝だけ**を実行して `END IF` へ抜ける（フォールスルー無し）。`ELSE` は省略可。
- **変換**：パース時に **入れ子 IF へ脱糖**（`IF c1 … ELSE (IF c2 … ELSE …)`）。以降は通常のブロック IF と同じ＝実行時コストは素の IF チェーンと同じ（ゼロコスト）。値の等価比較を並べたいだけなら [`SELECT CASE`](#141-select-case多分岐) も検討。

### 1.4.6 DO … LOOP（前判定 / 後判定 / 無限）

`WHILE … WEND` は前判定のみ。`DO … LOOP` は**後判定**（最低1回実行）や**無限ループ**も書ける。

```basic
DO WHILE I% < 3      ' 前判定（WHILE と同じ）
    I% = I% + 1
LOOP

DO                   ' 後判定（本体を必ず1回実行してから判定）
    LINE INPUT K$
LOOP UNTIL K$ = "Y"

DO                   ' 無限ループ（BREAK で脱出）
    IF DONE% THEN BREAK
LOOP
```

- 条件は **`DO` 側（前判定）か `LOOP` 側（後判定）のどちらか一方**に付ける（両方は `E_DO_BOTH_COND`）。`WHILE`=真の間くり返す／`UNTIL`=真になるまでくり返す。
- `BREAK` はループ脱出、`CONTINUE` は次の反復（後判定では **`LOOP` 条件の再評価**）へ。
- **変換**：前判定・無限は素の `While` へ脱糖（ゼロコスト）。後判定のみ「最低1回実行」と CONTINUE 意味論を保つため**一時フラグ変数を1つ**使う。詳細は [05 §5.19](05-transformer.md)。

### 1.4.7 MACRO（コンパイル時インライン展開）

`MACRO name(params) = 式`。呼び出し `name(args)` を**コンパイル時に本体式へ展開**する。`FUNCTION` と違い GOSUB/関数呼び出しを生成しない＝**実行時コストゼロ**の小関数。

```basic
MACRO SQ(X)      = X * X
MACRO LERP(A,B,T)= A + (B - A) * T
MACRO HI(V)      = (V \ 256)

GLOBAL D%
D% = SQ(DX%) + SQ(DY%)        ' → (DX%*DX%)+(DY%*DY%) に展開
```

- **意味**：実引数は**式のまま**代入（call-by-name）。優先順位事故を防ぐため各実引数と展開結果は括弧で包まれる（例：`SQ(A+B)` → `((A+B)*(A+B))`）。
- 本体は別マクロを呼んでよい（入れ子展開）。**再帰は不可**（自己・相互とも `E_MACRO_RECURSION`）。引数の数不一致は `E_MACRO_ARITY`、名前重複（他 MACRO/FUNCTION と衝突）は `E_MACRO_DUP`。
- 0 引数でも呼び出しは `name()` と書く（定数だけなら [`CONST`](#) の方が適切）。定義は使用より後でもよい。
- **変換**：`expand-macros` パスで全式を走査して置換。展開後は MSX 変数も行も生成しない。詳細は [05 §5.20](05-transformer.md)。

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

block_stmt     = if_block | select_block | for_block | while_block | dataset_block ;   (* 内部に statement を任意ネスト可 *)

dataset_block  = "DATASET" ident newline
                 { data_stmt | comment }        (* 本体は DATA 行のみ *)
                 "END" "DATASET" newline ;
read_into      = "READ" ident "INTO" lvalue { "," lvalue } ;   (* 名前付きブロックから読む *)
restore_ds     = "RESTORE" ident ;              (* 名前付きブロックを先頭へ巻き戻す *)

struct_decl    = "STRUCT" ident newline
                 { typed_ident { "," typed_ident } newline }    (* 平坦フィールド *)
                 "END" "STRUCT" newline ;
struct_dim     = "DIM" ident [ "(" expr { "," expr } ")" ] "AS" ident ;   (* インスタンス宣言 *)
field_access   = ident [ "(" expr { "," expr } ")" ] "." ident ;   (* lvalue/式の両方 *)

event_block    = "EVENT" "TIMER" expr newline      (* v1 は TIMER のみ *)
                 { statement }
                 "END" "EVENT" newline ;

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
case_test      = expr [ "TO" expr ]        (* 値、または範囲 lo TO hi *)
               | "IS" rel_op expr ;        (* 関係。IS は文脈依存で非予約 *)
rel_op         = "=" | "<>" | "<" | "<=" | ">" | ">=" ;

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

## 1.16 OPTION EXPLICIT（未宣言変数の検出）

ソース先頭に `OPTION EXPLICIT` と書くと、**一度も代入・宣言されていないスカラ変数を読んだ箇所をコンパイルエラー**にする（`E_UNDECLARED_VAR`）。既定はオフ。

```basic
OPTION EXPLICIT
INPUT RADIUS
CIRCUMFERENCE = RADUIS * 2 * 3.14   ' ← RADUIS は綴り違い → E_UNDECLARED_VAR
PRINT "circumference="; CIRCUMFERENCE
```

- **なぜ必要か**：BASIC（MSX-BASIC も FunctionBASIC も）は未宣言の変数を使うと自動生成し、数値なら **0** になる。上の `RADUIS`（`RADIUS` のタイプミス）は黙って 0 になり、結果が 0 になっても気づけない。`OPTION EXPLICIT` はこれを静的に捕まえる。
- **STRICT とは別軸**：`STRICT` は*型*（全部16bit整数など）を厳格化する。`OPTION EXPLICIT` は*宣言*（未代入の読取＝タイポ）を検出する。併用できる。
- **「宣言済み」とみなすもの**：代入（`X = …`）、`GLOBAL` / `DIM` / `CONST` 宣言、`FUNCTION` の引数、`FOR` 変数、`INPUT`/`READ` などの書込み対象。FunctionBASIC はスカラを代入で暗黙生成するため、これらのどれかで**書かれていれば宣言済み**とみなす（＝どこでも一度も書かれない読取だけがエラー）。
- **対象はスカラ変数のみ**：配列名・関数名のタイプミスは呼び出し解決（`E_UNKNOWN_FUNCTION` 等）で既に捕まるため、ここでは黙って 0 になるスカラだけを見る。`MACRO` 展開後の読取も検査対象。
