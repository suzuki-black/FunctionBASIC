# 06. 逆変換アルゴリズム（MSX-BASIC → 構造化BASIC）

対応仕様: **【4. 逆変換仕様】**

---

## 6.1 目的と前提

MSX-BASIC コードと **変換テーブル（MapTable）** を入力に、構造化BASICを復元する。
逆変換は MapTable に強く依存する（テーブル無しの完全復元は不可能なため、テーブル必須）。

```
.bas (MSX-BASIC) ＋ .map.json
        │ ReverseTransformer.restore()
        ▼
構造化BASIC文字列
        │ Formatter.prettyPrint()
        ▼
整形済み構造化BASIC
```

---

## 6.2 逆変換ステップ

```
① 行のパース        : "100 X=1 : GOSUB 1000" → {lineNo, stmts[]}
② 行番号→ラベル復元  : lineLabels で @ADD 等へ（仕様4-2）
③ 関数ブロック復元   : functions の entry/exit で FUNCTION…END FUNCTION に再構成（仕様4-1）
④ GOSUB→呼び出し復元 : retVar 受け取りを LET R = F(args) に統合（仕様4-1）
⑤ REF復元           : 名前置換された変数名を REF <変数名> へ復元、複製ブロックは元関数へ統合（仕様4-1, §6.5）
⑥ 変数名復元         : 2文字MSX名 → 元名（varNameMap 逆引き、スコープ・型・生存範囲で選択, §6.6）
⑦ 制御フロー復元     : GOTO を BREAK/CONTINUE/RETURN へ（controlFlow の loopId で内側ループ特定, 仕様4-1）
⑧ ネスト構造再構築   : ネイティブ FOR/WHILE の入れ子・IF分岐範囲を再帰解析（§6.7a, ネスト許可対応）
⑨ IF1行化の復元      : IF…THEN …:… / IF NOT()…GOTO を IF…THEN / END IF ブロックへ（仕様4-4）
⑩ 整形              : インデント（ネスト段数に応じて）・空行・コメント整理（仕様4-5）
```

---

## 6.3 行番号 → ラベル（仕様4-2）

`MapTable.lineLabels` を用いて、参照されている行番号をラベルに置換する。

```
1000 ' === FUNCTION ADD ===     →   FUNCTION ADD(...)
GOSUB 1000                      →   （呼び出し復元へ, §6.4）
IF ... THEN 230                 →   ラベル @MAIN_3 等を介して IF ブロックへ（§6.7）
```

参照されない行番号は単純に削除する（構造化BASICに行番号は存在しないため）。

---

## 6.4 GOSUB → 関数呼び出し復元（仕様4-1）

変換時の定型パターンを認識して畳み込む。

MSX（2文字名：A→`AA`, B→`AB`, 戻り値→`AR`）:
```basic
110 AA=1 : AB=2 : GOSUB 1000
120 X=AR
```
↓ 復元
```basic
LET X = ADD(1, 2)
```

復元手順:
1. `GOSUB <entryLine>` を MapTable の `FuncMap` で関数名 `ADD` に解決。
2. 直前の `msxVar = 式` 代入群を、params 順に実引数へ対応付け（値渡し）。
3. 直後の `<lhs> = <retVar>` を戻り値受けと認識し、`LET <lhs> = ADD(args)` に統合。
4. 戻り値を捨てている場合（`<lhs> = <retVar>` の受けが無い）は、`LET _ = ADD(args)` のような
   ダミー代入にはせず、**式を捨てる文呼び出し（CallStmt）として復元**する（例：`ADD(args)` 単独の文）。

---

## 6.5 REF 復元（仕様4-1）

REF は **名前置換方式**（[05 §5.4](05-transformer.md#54-ref引数--名前置換方式仕様3-3)）。
逆変換は `MapTable.variants` と各関数の `params.byRef`／`msxVar`（置換した実変数名）を使い、
**置換された変数名を元の `REF <変数名>` へ復元**する。コピーバック定型は存在しない（廃止済み）。

MSX（A→X, B→Y に置換済み。局所 T→`ST`、戻り値→`SR`）:
```basic
130 GOSUB 3000: R=SR
...
3000 ' === FUNCTION SWAP (A->X, B->Y) ===
3010 ST=X
3020 X=Y
3030 Y=ST
3040 SR=0: RETURN
```
↓ 復元
```basic
LET R = SWAP(REF X, REF Y)
```

判定手順:
- `GOSUB <entryLine>` を `MapTable.variants`（または `functions`）で**元関数名**に解決。
- そのブロックの `refSubst`（例 `[{param:"A",actual:"X"},{param:"B",actual:"Y"}]`）から、
  各REF引数を **`REF <actual>`** として呼び出しを再構成する。
- 戻り値受け `<lhs>=<retVar>` は §6.4 と同様に統合。

### 複製された関数ブロックの統合復元

同じ関数が異なる配列名で呼ばれて**複製**されている場合（[05 §5.4.3](05-transformer.md#543-異なる配列で呼ぶ場合配列名ごとに本体を複製)）、
逆変換は `variants` を辿り **すべての複製を元の1つの `FUNCTION` 定義へ統合**する。
各呼び出しは、その複製の `refSubst` に応じて `F(REF SCORE, …)` / `F(REF DAMAGE, …)` のように
**それぞれ正しい実引数名で復元**する。

```
2000ブロック(SUM, A->SCORE) / 3000ブロック(SUM, A->DAMAGE)
  → FUNCTION SUM(REF A, N) … END FUNCTION  （1個に統合）
  → 呼び出しは T1=SUM(REF SCORE,10) / T2=SUM(REF DAMAGE,5)
```

値渡し引数（byRef=false）は通常の値渡しとして復元する。

---

## 6.6 変数名の復元（2文字MSX名 → 元名、仕様4-3）

MSX側は全変数が **2文字MSX名**（型別・スコープ別、[05 §5.11](05-transformer.md#511-2文字msx名アロケータ全変数全型)）。
逆変換は `MapTable.varNameMap` を逆引きし、`S0 → SCORE`、`A$ → PLAYER_NAME$`、`FI → I` のように復元する。
数値・文字列を区別せず、**スコープ（GLOBAL／関数名）と生存範囲**で正しい割当を選ぶ。

```ts
function restoreVarNames(scope: string, text: string, map: MapTable, atLine: number): string {
  let out = text;
  // 同じ2文字名が別スコープ/別範囲で別変数に再利用されるため、scope と生存範囲で選ぶ
  for (const v of map.varNameMap) {
    if (appliesHere(v, scope, atLine)) out = replaceWholeWord(out, v.msxName, v.original);
  }
  return out;
}
```

- **名前再利用に注意** — 同じ `FI` が別関数で別変数に割り当てられている場合があるため、
  `scope`（GLOBAL／関数名）と `liveFrom`/`liveTo` で対象に合致する割当のみ復元する。
- 語境界を厳守（`S0` と `S01`、`A$` と `AB$` を誤マッチしない）。
- 戻り値の2文字名（例 `FR`）は関数呼び出し復元（§6.4）で消えるため、残存時のみ別名復元。

---

## 6.7 IF 1行化の復元（仕様4-4）

変換で生成された分岐定型を、構造化BASICの **IF ブロック**（必要に応じてネスト）へ戻す。

### 本体が単一文の1行IF → IFブロック
```basic
2010 IF AN<0 THEN AR=-AN : RETURN
```
↓（ネスト許可後はブロックIFに統一して復元）
```basic
IF N < 0 THEN
    RETURN -N
END IF
```

### `IF NOT()…GOTO` 形 → IF/ELSE ブロック
```basic
200 IF NOT(X>0) THEN 230
210 PRINT "POS" : F=1
220 GOTO 240
230 PRINT "NONPOS"
240 ' endif
```
↓
```basic
IF X > 0 THEN
    PRINT "POS"
    LET F = 1
ELSE
    PRINT "NONPOS"
END IF
```

復元アルゴリズム:
1. `IF NOT(<cond>) THEN <Lelse>` を検出 → 条件を二重否定除去し `IF <cond> THEN` 開始。
2. `<Lelse>` ラベルまでを THEN 節、`GOTO <Lend>` を ELSE 区切りと認識。
3. `<Lelse>`〜`<Lend>` を ELSE 節、`<Lend>`（`' endif`）でブロック終了。
4. `:` 複文を1文ずつ分解して各 simple_stmt に戻す。
5. **THEN/ELSE 節の内部にネイティブ `FOR…NEXT` / `WHILE…WEND` や別の `IF` パターンが含まれる場合は、
   §6.7a に従い再帰的に復元する（ネスト構造の再構築）。**

### <a name="6.7a"></a>6.7a ネスト構造の再構築（ネスト許可対応）

変換後コードに **ネイティブの入れ子 FOR/NEXT・WHILE/WEND** や、IF分岐内の内側ブロックが
含まれるため、逆変換は **行範囲を入れ子に解析** する。

- ネイティブ `FOR…NEXT` / `WHILE…WEND` は、対応する終端（`NEXT`/`WEND`）を
  **スタックで対応付け**ながらブロックとして取り出し、その本体を再帰的に逆変換する。
- IF分岐（`IF NOT()…GOTO`）の THEN/ELSE 範囲も同様に、内部をネストブロックとして再帰処理する。
- **1行IF（`IF cond THEN a:b`）もブロックIFに復元する。** 05のIF平坦化（§5.5.1）で生成された
  「条件成立時のみ実行する `:` 連結」は、`THEN` 以降を THEN 節として取り出し、
  `IF cond THEN … END IF` のブロック形へ戻す（早期RETURN/BREAK/CONTINUE を含む形も同様）。
- これにより、変換前の任意深さのネスト構造が復元される。

```
parseRangeToStmts(行範囲):
   while 範囲内に行が残る:
     if 行 が "FOR":   inner = matchNext(); FORブロック化(本体= parseRangeToStmts(内側))
     elif 行 が "WHILE": inner = matchWend(); WHILEブロック化(本体= parseRangeToStmts(内側))
     elif 行 が "IF NOT()…GOTO": THEN/ELSE範囲を特定し IFブロック化（各節を再帰）
     elif 行 が "IF cond THEN a:b": THEN以降を THEN節として IFブロック化（1行IF→ブロックIF）
     else: 単純文として復元
```

---

## 6.8 制御フロー（BREAK/CONTINUE/RETURN）復元（仕様4-1）

`MapTable.controlFlow` で GOTO 先を判定する。`loopId` により **どのループに対する**
BREAK/CONTINUE かを特定できるため、多重ループでも正しい内側ループの脱出/継続として復元する。

| MSX | 条件 | 復元 |
|-----|------|------|
| `GOTO <ループL のNEXT直後>` | flow.kind = "Break", loopId=L | `BREAK`（Lが最内なら素直） |
| `GOTO <ループL のNEXT行>` | flow.kind = "Continue", loopId=L | `CONTINUE` |
| `…=式 : RETURN` | retVar への代入直後 | `RETURN 式` |
| `RETURN`（代入無） | — | `RETURN`（または `RETURN 0`） |

§6.7 のIFブロック復元と組み合わせ、`IF cond THEN <break/continue/return GOTO>` は
ネストした `IF … THEN / BREAK or CONTINUE or RETURN / END IF` ブロックへ復元する。

---

## 6.9 整形（仕様4-5）

Formatter.prettyPrint(ast) で最終整形する。

- ブロック本体を1段インデント（スペース4）。
- `LET`/演算子の前後にスペース1。
- 関数間に空行1。
- コメントは原文（`raw`）を保持。
- キーワードは大文字（仕様1-6に整合）。

---

## 6.10 逆変換の限界と注意

- MapTable が無い／壊れている場合、関数境界・REF・改名の復元は不可能。
  → このとき ReverseTransformer は「行番号削除＋大文字整形」のみのベストエフォート復元を行い、
    UI に「変換テーブルが無いため完全復元できません」と警告する。
- 手作業でMSX側を編集した行（テーブルに整合しない行）は、コメント `' [REVERSE?]` を付けて
  そのまま残し、ユーザに確認を促す。

---

## 6.11 逆変換 擬似コード

```ts
function restore(msxSource: string, map: MapTable): string {
  const lines = parseMsxLines(msxSource);           // ① 行パース
  relabel(lines, map.lineLabels);                   // ②
  const funcs = splitIntoFunctions(lines, map);     // ③
  const ast: Program = { type: "Program", functions: [], toplevel: [] };

  for (const seg of funcs) {
    const fn = rebuildFunction(seg, map);            // ④⑤ 呼び出し・REF畳み込み
    restoreVarsInPlace(fn, map);                     // ⑥ 2文字MSX名→元名（varNameMap, スコープ別, §6.6）
    rebuildNesting(fn, map);                          // ⑧ ネイティブFOR/WHILE・IF範囲を再帰再構築（§6.7a）
    foldControlFlow(fn, map);                         // ⑦ GOTO→BREAK/CONTINUE/RETURN（loopIdで内側ループ特定）
    foldIfBlocks(fn);                                 // ⑨ IF1行化復元（ネスト節も再帰）
    if (fn.name === "MAIN") ast.toplevel = fn.body;
    else ast.functions.push(fn);
  }
  return prettyPrint(ast);                            // ⑩ ネスト段数に応じてインデント
}
```

---

## 6.12 INCLUDE 分割ファイルへの復元（provenance）

`INCLUDE` で複数ファイルを統合して変換した場合、逆変換は **元の複数ファイルへ分割復元**する。

- 変換テーブルの `sources`（全取り込みファイル）と各 `MsxLine.origin.sourceFile`/`srcLine`（[04](04-data-model.md)）を使う。
- 復元手順：
  1. 統合された構造化BASICを通常どおり復元（§6.1〜6.11）。
  2. 各構造化文を **由来ファイル(provenance)** ごとに振り分け、元ファイル単位の内容を再構成。
  3. エントリファイルには元の `INCLUDE "..."` 行を復元して配置する。
- **由来情報が欠落/不整合**の行（手編集等）は、エントリファイルに残し `' [REVERSE?]` 注記を付ける（§6.10）。
- provenance が完全なら往復で元のファイル分割が再現される。最適化で字面が変わる点は §6.10 の限界に従う。
