# 00. MSX-BASIC → 構造化BASIC 差分ガイド

> 🌐 English: [00-msx-basic-diff.en.md](00-msx-basic-diff.en.md)
>
> **この資料の目的**
> MSX-BASIC を知っている人が読めば「何が変わったか」だけで書き始められ、
> AI（バイブコーディング）が読めば構造化BASICを正しく生成できる——両方を満たす**差分チートシート**。
> 記述は仕様書の丸写しではなく、**実装（lexer / parser / transformer）と `examples/` に照合して裏取り**した内容。
> フル仕様は [01-language-spec.md](01-language-spec.md)、組み込み命令は [12-builtins.md](12-builtins.md)。

構造化BASIC（`.msxb`）は **MSX-BASIC を生成するフロントエンド言語**。ソースは人間向けに書き、
トランスパイラが行番号付き・2文字変数名の MSX-BASIC へ変換する。**実行時の意味論は MSX-BASIC のまま**（演算子・真偽値・組み込み命令はそのまま）。違うのは「書き方」だけ。

---

## 0. 30秒サマリ

| 観点 | MSX-BASIC | 構造化BASIC |
| --- | --- | --- |
| 制御構造 | 行番号＋`GOTO`/`GOSUB` | `FUNCTION`／ブロック `IF`・`FOR`・`WHILE`（自由ネスト）／`BREAK`・`CONTINUE` |
| サブルーチン | `GOSUB 行番号` | `FUNCTION 名(...)`＋`RETURN 値`（早期リターン可・トップレベル定義のみ・**再帰不可**） |
| 変数スコープ | 全部グローバル | **既定ローカル＋`GLOBAL`宣言で共有**（PHP流） |
| 変数名 | 先頭2文字のみ有効・`_`不可 | **任意長・`_`可**（`PLAYER_X%`）→ 変換時に一意な2文字へ自動圧縮 |
| 定数 | なし（変数で代用） | `CONST`（コンパイル時にリテラルへインライン展開・変数を生成しない） |
| 型 | 既定単精度・`DEFxxx`で既定変更 | 名前サフィックス（`% ! # $`）。任意で `STRICT`＝静的型チェック |
| 1行1文 | `:` で複文可 | **1行1文のみ（`:`複文はソースでは禁止）** |
| IF | 単行 `IF … THEN 文` 可 | **ブロック `IF … THEN` … `END IF` のみ**（単行IF不可） |
| 機械語 | `DATA`＋`POKE`＋`USR` | `ASM … END ASM`（インラインZ80） |
| ファイル分割 | なし | `INCLUDE "..."` |
| コメント | `'` / `REM` | `'` / `REM`（同じ） |

**鉄則（これだけ守れば動く）**：①行番号を書かない ②`GOTO`を使わない ③1行1文（`:`禁止） ④IFは必ず`END IF`まで書く ⑤関数内でグローバルを使うなら先頭で`GLOBAL 名` ⑥`CONST`は宣言だけでどこでも使える。

---

## 1. 消えたもの（使うとエラー）

トランスパイラは**黙って誤変換せず、必ずエラーで知らせる**。左を右に置き換える。

| 使えない（MSX-BASIC） | エラー | 構造化での代替 |
| --- | --- | --- |
| 行番号（`10 PRINT`） | — | 書かない。順に実行される |
| `GOTO 行` / `GOSUB 行` | `E_GOTO` ほか | `FUNCTION`・`IF`/`FOR`/`WHILE`・`BREAK`/`CONTINUE` |
| `ON x GOTO/GOSUB 行` | `E_ON_LINE_TARGET` | `ON x GOTO/GOSUB 関数名`（ハンドラは**無引数**、`E_HANDLER_PARAMS`） |
| `ON ERROR GOTO 行` | — | `ON ERROR GOTO 関数`、無効化は `ON ERROR GOTO 0` |
| `RESUME 行` | `E_RESUME_LINE` | `RESUME` / `RESUME NEXT` / `RESUME 0` |
| `RESTORE 行` | `E_RESTORE_LINE` | 引数なし `RESTORE`（先頭`DATA`へ） |
| `DEFINT/DEFSNG/DEFDBL/DEFSTR` | `E_DEF_UNSUPPORTED` | 名前サフィックス `% ! # $`（例 `COUNT%`・`LABEL$`） |
| `DEF FN` / `DEF USR` | — | `FUNCTION`（機械語は`ASM`か USRベクタへ`POKE`） |
| 直接モード命令 `RUN` `LIST` `AUTO` `RENUM` `NEW` `CONT` `DELETE` `EDIT` | — | プログラム文ではない（対話専用） |
| 単行 `IF … THEN 文`（`END IF`無し） | `E_SYNTAX` | ブロック `IF … THEN` … `END IF` |
| `:` による複文（`A=1 : B=2`） | `E_SYNTAX` | 1行1文に分ける |

> ⚠ **`:` と単行IFはソースでは常に不可**（代入でもPRINTでも）。ただし**変換後のMSX-BASICには`:`が出る**（例 `C%=10: GOSUB 1000`）。これはトランスパイラが生成するもので、あなたは書かない。

---

## 2. 変わったもの

### 2.1 変数スコープ（既定ローカル ＋ `GLOBAL`）

MSX-BASIC は全変数グローバル。構造化BASICは**関数内は既定ローカル**、共有したい変数だけ関数先頭で `GLOBAL 名` と宣言する（**PHP の `global $x;` と同型**）。

```basic
GLOBAL SCORE%                 ' トップレベル＝グローバルの置き場
DIM MAP%(31)                  ' トップレベルの DIM ＝グローバル配列

FUNCTION ADD_SCORE%(POINTS%)
    GLOBAL SCORE%             ' このグローバルを使う宣言（配列は GLOBAL MAP% と書く／括弧なし）
    SCORE% = SCORE% + POINTS%
    RETURN SCORE%
END FUNCTION

FUNCTION RENDER()            ' 関数名は組み込み命令と同名にできない（DRAW/SWAP等は不可・§5）
    FOR I% = 0 TO 31          ' I% は宣言してない＝ローカル（他関数と衝突しない）
        PRINT I%
    NEXT I%
    RETURN 0
END FUNCTION
```

- 宣言しない名前は**常にローカル**。宣言しない限り関数からグローバルは見えない（暗黙共有の事故防止）。
- 配列も同じ。関数からグローバル配列を使うなら `GLOBAL A`（括弧なし）。

### 2.2 変数名（任意長・`_`可 → 2文字へ自動圧縮）

MSX-BASIC は名前の先頭2文字しか区別せず（`COUNT`と`COUNTER`は衝突）`_`も不可。構造化BASICは**長い説明的な名前・アンダースコアを許可**し、変換時に**一意な2文字MSX名**へ自動割り当てる。**実行コスト・メモリ増はゼロ**。

- プールは型別（`% ! # $` 各約960個・予約語除外）。生存区間が重ならないローカルは名前を再利用。
- 使い切ると `E_VAR_NAMES_EXHAUSTED`。`INCLUDE` は全ファイル合算で消費。
- → だから**グローバル・定数ほど説明的な名前**にしてよい（`SCROLL_OFFSET%` `NAME_TABLE_BASE%`）。

### 2.3 その他

- **`LET` は省略可**（`X = 1` でも `LET X = 1` でも同じ）。
- **関数は `GOSUB` へ展開**：呼び出しは引数を専用変数へ入れて `GOSUB`、直後に戻り値変数をコピー（[6章](#6-変換前→変換後の実例)）。

---

## 3. 増えたもの

### 3.1 FUNCTION

```basic
FUNCTION 名前(引数リスト)      ' SUB は無い。手続きも FUNCTION で書き RETURN 0 で終える
    ...
    RETURN 値                 ' 関数内のどこでも可（早期リターン可）
END FUNCTION
```

- **トップレベル定義のみ**（関数の入れ子は不可・`E_NESTED_FUNCTION`）。
- **再帰は不可**（直接・間接とも・`E_RECURSION_UNSUPPORTED`）。
- 戻り値型は**関数名のサフィックス**で表す：`FUNCTION ADD%(...)`＝整数を返す、`FUNCTION GREET$(...)`＝文字列。サフィックス無し＝単精度。
- **呼び出しはサフィックス有無どちらでも可**：`ADD(1,2)` も `ADD%(1,2)` も同じ関数を呼ぶ。
- 組み込み命令（`PRINT` `LOCATE` `VPOKE` `MID$` `RND` …）は**そのままパススルー**。ユーザ関数で組み込み名を再定義は不可（`E_NAME_IS_BUILTIN`）。未知呼び出しは `E_UNKNOWN_FUNCTION`。

### 3.2 ブロック構造とネスト

```basic
IF 条件 THEN
    ...
ELSE          ' 任意
    ...
END IF

FOR I% = a TO b STEP s   ' STEP 省略可
    ...
NEXT I%       ' NEXT の変数名は省略可

WHILE 条件
    ...
WEND
```

- **IF / FOR / WHILE は同種・異種を問わず自由にネスト可**（旧仕様の「ネスト禁止」は撤回済み）。
- ネスト上限なし（MSXの FOR/GOSUB スタック制約は実運用の範囲で）。
- ブロック条件は `AND`/`OR` 等の複合条件可（`WHILE A% < 10 AND B% = 0`）。

### 3.3 BREAK / CONTINUE

- `BREAK`＝**最も内側のループ**を脱出、`CONTINUE`＝最も内側のループの次反復へ。
- ネストした IF の内側からでも使える（対象は常に最も内側のループ）。ループ外で使うと `E_BREAK_OUTSIDE_LOOP` / `E_CONTINUE_OUTSIDE_LOOP`。

### 3.4 REF（参照渡し・ゼロコピー）

```basic
FUNCTION EXCHANGE(REF A%, REF B%)   ' SWAP は組み込み命令なので関数名に使えない（§5）
    T% = A%
    A% = B%
    B% = T%
    RETURN 0
END FUNCTION
' 呼び出し。REF は付けても付けなくても同じ（付ける/付けないは定義側で決まる）
R% = EXCHANGE(X%, Y%)
```

- 既定は**値渡し**。仮引数に `REF` を付けると**参照渡し**（呼び出し側の実変数名へ直接置換＝コピー無し・真の参照）。
- REF の実引数は**変数名のみ**（式・即値は `E_REF_NOT_VARIABLE`）。スカラ・数値/文字列配列・多次元、すべて可。
- 配列の**値渡し（REF無し）も可**だが全要素コピー（O(n)）で重い。速度が要るなら `REF`。

### 3.5 CONST（コンパイル時定数・インライン展開）

```basic
CONST MAX_HP% = 100          ' 型サフィックスは任意（付けると値の型を検証）
CONST TITLE$ = "READY"
CONST AREA% = 8 * 24         ' 定数式は畳み込まれる
```

- **変数ではない**：使用箇所が**リテラルに置換**され、MSX変数を生成しない（速度・サイズに有利）。
- したがって**`GLOBAL`宣言は不要**。どの関数からでも宣言なしで参照できる。
- **再代入はエラー**（`E_CONST_ASSIGN`）。畳み込めない式は `E_CONST_NOT_CONSTANT`、型不一致は `E_CONST_TYPE`、重複名は `E_DUP_CONST`。
- `STRICT` では型サフィックス必須。

### 3.6 STRICT（任意の静的型付け）

先頭に `STRICT` と書くと、オプトインの静的型チェック（Rust方式＝暗黙変換なし）が有効。既定オフ。

- **全ての変数・配列・引数・`FOR`変数・`CONST` に型サフィックス必須**（無いと `E_STRICT_UNTYPED`）。
- **代入・引数・戻り値は型が完全一致**。暗黙変換なし（`A% = 1.5` や `%`と`#`混在は `E_TYPE_MISMATCH`）。変換は `CINT`/`CSNG`/`CDBL`/`INT`/`FIX`/`STR$`/`VAL` 等で明示。
- 数値リテラルは柔軟（`5`は`%`/`!`/`#`可、`1.5`は`!`/`#`）。演算はMSXの昇格に従い、一致判定は代入/引数/戻り値の境界で行う。
- Z80では整数(`%`)演算が速い。ゲームロジックは`%`へ寄せると速い。

### 3.7 ASM（インライン Z80）

```basic
ASM
    LD A,42
    CALL &H00A2      ' CHPUT
    RET
END ASM
```

- `HIMEM` 直下のバッファへアセンブルし `DEFUSR`/`USR` で実行。
- `(NAME)` で `%`整数のBASIC変数を参照（`VARPTR` で1回パッチ）。ラベル＋相対ジャンプ（`JR`/`DJNZ`）対応。**`%`整数のみ**。
- 詳細は [asm ドキュメント/実装] と `examples/space-shooter-turbor.msxb`。

### 3.8 INCLUDE（分割ファイル）

```basic
INCLUDE "lib/math.msxb"
```

- **トップレベルのみ**。パース前に解決し**1つのコンパイル単位**へ統合。名前空間は単位全体で共有（FUNCTION名重複は `E_DUP_FUNCTION`）。
- 循環は `E_INCLUDE_CYCLE`、未発見は `E_INCLUDE_NOT_FOUND`。取り込みファイルも Shift-JIS。

---

## 4. 踏襲するもの（MSX-BASIC と同じ）

ここは**変わらない**ので MSX-BASIC の知識がそのまま使える。

- **演算子と優先順位**：`^` > 単項`-` > `* /` > `\`(整数除算) > `MOD` > `+ -`／比較 `= <> < > <= >=`／論理 `NOT` > `AND` > `OR` > `XOR`（`EQV`/`IMP`も可）。
- **真偽値**：真 = `-1`、偽 = `0`（`IF A%` は `A% <> 0`）。
- **リテラル**：10進、`&H`(16進)、`&O`(8進)、`&B`(2進)。文字列は `"..."`。
- **配列は base 0**（`DIM A(10)` は 0〜10 の11要素）。
- **組み込み命令・関数はそのまま**（`PRINT` `LOCATE` `CLS` `VPOKE`/`VPEEK` `PEEK`/`POKE` `PUT SPRITE` `SET SCROLL` `SOUND` `STICK` `STRIG` `MID$` `CHR$` `RND` `USR` …）。挙動・引数はMSX-BASIC準拠。
- **コメント** `'` と `REM`（大文字化・変換の対象外。中身は原文のまま保持）。
- **文字列は最大255バイト**（全MSX共通）。

---

## 5. 落とし穴とベストプラクティス（重要）

実際に踏んだ罠。AIが生成する際はここを守ると事故らない。

| 症状 / 誤り | 原因 | 正しい書き方 |
| --- | --- | --- |
| `E_SYNTAX`（IF行） | 単行 `IF X% > 0 THEN Y% = 1` | ブロックIFにする（`IF …` 改行 `Y% = 1` 改行 `END IF`） |
| `E_SYNTAX`（`:`） | 1行に複数文（`A=1 : B=2`） | 1文ずつ改行 |
| 関数内でグローバルが0/未定義に見える | 関数で `GLOBAL 名` を宣言し忘れ | 使う全グローバルを関数先頭で `GLOBAL` 宣言（配列も `GLOBAL A`） |
| `Illegal function call`（実行時） | `STRING$(300,0)` 等 >255バイト文字列 | 文字列は255バイト以内。長い機械語は`ASM`＋HIMEM配置 |
| `Illegal function call`（`VARPTR`） | 未代入変数に `VARPTR` | 先に `=0` 等で代入してから `VARPTR` |
| `E_NAME_IS_BUILTIN` | 関数名が組み込み命令と同名（`DRAW` `SWAP` `PLAY` `LINE` 等） | 別名にする（`RENDER` `EXCHANGE` 等） |
| `E_RECURSION_UNSUPPORTED` | 関数が直接/間接に自分を呼ぶ | ループ or 明示スタック配列に展開 |
| `E_REF_NOT_VARIABLE` | `REF` に式/即値を渡した | `REF` には変数名のみ |
| `E_VAR_NAMES_EXHAUSTED` | 生存する変数が型別約960個超 | ローカル化（生存区間を分けて再利用させる）／変数削減 |
| `E_STRICT_UNTYPED` | `STRICT`下でサフィックス無し | 全変数・引数・配列・FOR変数・CONSTに `% ! # $` |
| `E_TYPE_MISMATCH` | `STRICT`下で型混在（`A% = B#`） | `CINT`/`CSNG`/`CDBL` 等で明示変換 |

ベストプラクティス：
- **1行1文・ブロックIF**を徹底（`:`と単行IFは常に不可）。
- **グローバルとCONSTは説明的な名前**（`_`区切り・略語なし）。2文字へ圧縮されるのでコスト無し。可変な共有状態＝`GLOBAL`、不変＝`CONST`。
- ループ変数・添字は `%`（Z80は整数が速い）。
- 手続き（値を返さない関数）は末尾 `RETURN 0`。

---

## 6. 変換前 → 変換後の実例

構造化BASIC（人間が書く）:

```basic
CONST MAX_HP% = 100          ' 未使用なら変換後は消える（インライン）
GLOBAL SCORE%

FUNCTION ADD_SCORE%(POINTS%)
    GLOBAL SCORE%
    SCORE% = SCORE% + POINTS%
    RETURN SCORE%
END FUNCTION

SCORE% = 0
FOR ENEMY% = 1 TO 3
    IF ADD_SCORE%(10) >= 20 THEN
        PRINT "BONUS"
    END IF
NEXT ENEMY%
PRINT SCORE%
```

変換後の MSX-BASIC（トランスパイラ生成・行番号は最終描画で MAIN=100〜／関数=1000〜 が付与される）:

```basic
' === MAIN ===
A%=0                         ' SCORE% → A%
FOR B%=1 TO 3                ' ENEMY% → B%（ローカル）
C%=10: GOSUB 1000: E%=D%     ' ADD_SCORE%(10): 引数を C% へ→GOSUB→戻り値 D% を E% へ
IF E%>=20 THEN PRINT "BONUS" ' ブロックIF（単一文なら単行に畳まれる）
NEXT
PRINT A%
END
' === FUNCTION ADD_SCORE ===
A%=A%+C%                     ' SCORE%(A%) += POINTS%(C%)
D%=A%: RETURN                ' 戻り値を D% に入れて RETURN
```

読みどころ：
- `CONST MAX_HP%` は**変数として存在しない**（インライン展開・未使用なら痕跡なし）。
- `GLOBAL SCORE%` → 固定の `A%`。ローカル `ENEMY%` → `B%`。
- 関数呼び出しは **引数を専用変数へ→`GOSUB`→戻り値変数をコピー**。
- 出力側では `:` を使う（あなたはソースで書かない）。

---

## 7. AI 向けチェックリスト（生成時に守る）

構造化BASIC（`.msxb`）を書くときの必須ルール:

1. **行番号を書かない。`GOTO`/`GOSUB 行番号` を使わない。**
2. **1行に1文だけ。`:` で複数文を並べない。**
3. **`IF` は必ずブロック**（`IF 条件 THEN` 改行 … 改行 `END IF`）。単行 `IF … THEN 文` は不可。
4. **関数内でグローバル変数/配列を使うなら、関数先頭で `GLOBAL 名`（配列も括弧なし）**。宣言しない名前はローカル。
5. **不変値は `CONST`**（宣言だけでどこでも使え、`GLOBAL`不要、再代入不可）。
6. **関数はトップレベルのみ・再帰不可。** 戻り値型は関数名サフィックス（`FUNCTION F%`）。呼び出しは `F(...)` でも `F%(...)` でも可。
7. **参照渡しは仮引数に `REF`、実引数は変数名のみ。**
8. **型サフィックス** `% ! # $`。`STRICT` を付けたら全識別子に必須＆暗黙変換禁止（`CINT`等で明示）。
9. **文字列は255バイト以内。`VARPTR` は代入済み変数にのみ。**
10. **組み込み命令（`PRINT` `VPOKE` `SET SCROLL` `SOUND` `STICK` 等）はMSX-BASICのまま使う**（挙動同一）。
11. 変数名は**長い説明的名でよい**（`_`可・2文字へ自動圧縮）。特にグローバル・CONSTは記述的に。

エラーが出たら**エラーコード**（`E_*`）で原因を特定できる。黙って誤変換はしない設計なので、コードを信頼して自己修正してよい。

---

関連: [01-language-spec.md](01-language-spec.md)（フル仕様） / [12-builtins.md](12-builtins.md)（組み込み） / [09-optimization.md](09-optimization.md)（速度） / [05-transformer.md](05-transformer.md)（変換の内部）
