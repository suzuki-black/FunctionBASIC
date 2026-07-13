# 05. 変換アルゴリズム（構造化BASIC → MSX-BASIC）

対応仕様: **【3. 変換仕様】**

---

## 5.1 変換の全体方針

AST を入力に、`MsxLine[]` と `MapTable` を生成する。変換は以下の段階で行う。

```
AST
 │ ① 2文字MSX名アロケータで全変数に名前割当（スコープ・型別・生存解析。§5.11）
 │ ② 関数 → GOSUBブロック 展開
 │ ③ RETURN → 戻り値変数代入 + RETURN
 │ ④ REF引数 → 名前置換（呼び出し側の実変数名へ／必要なら配列名ごとに本体複製）
 │ ⑤ ブロック(IF/FOR/WHILE) → MSX制御文
 │ ⑥ BREAK/CONTINUE → GOTO
 │ ⑦ 行番号割当・最適化
 ▼
MsxLine[] + MapTable
```

---

## 5.2 FUNCTION → GOSUB ブロック（仕様3-1）

各 FUNCTION を「ラベル付きの行ブロック」に展開し、呼び出しを `GOSUB <entryLine>` に変換する。
`MAIN` は先頭に配置し、末尾で `END`。各関数ブロックはメインの後ろに連結する。

### 変換例

構造化:
```basic
FUNCTION ADD(A, B)
    RETURN A + B
END FUNCTION

FUNCTION MAIN()
    LET X = ADD(1, 2)
    PRINT X
    RETURN 0
END FUNCTION
```

MSX-BASIC（概念。変数は2文字名アロケータが割当：A→`AA`, B→`AB`, 戻り値→`AR`。§5.11）:
```basic
100 ' === MAIN ===
110 AA=1 : AB=2 : GOSUB 1000
120 X=AR
130 PRINT X
140 END
1000 ' === FUNCTION ADD ===
1010 AR=AA+AB
1020 RETURN
```

- 呼び出し側は **引数を値渡し用変数へ代入** してから `GOSUB`。
- 戻り値は呼び出し直後に `戻り値変数` から受け取る。

### 引数渡しの規則

| 種別 | 生成コード |
|------|-----------|
| 値渡し | 呼出側で `<msxVar> = <実引数式>` を代入 → GOSUB |
| 参照渡し(REF) | §5.4 参照 |

---

## 5.3 RETURN → 戻り値変数代入（仕様3-2）

`RETURN <式>` は次の2文に変換する。

```
<関数戻り値変数> = <式>
RETURN
```

- 戻り値変数は関数ごとに **2文字名1つ**（アロケータが割当、例 `AR`）。MapTable の `retVar` に記録。
- **早期リターン**（関数の途中の RETURN）も同様に変換する。関数末尾以外の RETURN は
  そのまま `…=式 : RETURN` を出すだけでよい（MSXの GOSUB/RETURN セマンティクスに合致）。

```basic
FUNCTION ABS(N)
    IF N < 0 THEN
        RETURN -N          ' 早期リターン（ネストしたIF内）
    END IF
    RETURN N
END FUNCTION
```
↓（N→`AN`, 戻り値→`AR`）
```basic
2000 ' === FUNCTION ABS ===
2010 IF AN<0 THEN AR=-AN : RETURN
2020 AR=AN
2030 RETURN
```

> 本体が単一文の IF ブロックは、最適化により MSX の1行 `IF…THEN …:RETURN` へ畳み込める（§5.7.3）。
> 本体が複数文の場合は §5.5.1 の GOTO 平坦化を用いる。

---

## 5.4 REF引数 → 名前置換方式（仕様3-3）

> **【方式確定】** REF は **名前置換方式（ゼロコピー）** で実装する。コピーバック方式は**廃止**。
> REF仮引数を、**呼び出し側の実変数名（プリプロセス後のグローバル名）へ直接置換**する。
> これによりコピーが一切発生せず、参照渡しの意味論・直感（REF＝本当の参照＝速い）に一致する。
> **スカラ・配列とも同一規則**（特例なし）。

MSXは全変数グローバルでポインタが無いため、REF＝「関数本体が呼び出し側の実変数名を直接使う」。
REF実引数は **変数名のみ**（仕様2-3）なので、置換先はプリプロセス時に常に確定する。

### 5.4.1 スカラREF（名前置換）

```basic
FUNCTION SWAP(REF A, REF B)
    LET T = A
    LET A = B
    LET B = T
    RETURN 0
END FUNCTION

FUNCTION MAIN()
    LET X = 1
    LET Y = 2
    LET R = SWAP(REF X, REF Y)
END FUNCTION
```
↓（A→X, B→Y に置換。コピーイン/アウトは無い）
```basic
100 ' === MAIN ===
110 X=1
120 Y=2
130 GOSUB 3000: R=SR
140 END
3000 ' === FUNCTION SWAP (A->X, B->Y。局所T→ST, 戻り値→SR) ===
3010 ST=X
3020 X=Y
3030 Y=ST
3040 SR=0
3050 RETURN
```

### 5.4.2 配列REF（名前置換・スカラと同一・多次元可）

数値配列も**まったく同じ規則**で名前置換する（特例なし）。多次元配列も同様。
配列の実体をそのまま使うため**ゼロコピー**。

```basic
FUNCTION SUM(REF A, N)
    LET S = 0
    FOR I = 1 TO N: LET S = S + A(I): NEXT
    RETURN S
END FUNCTION

LET T1 = SUM(REF SCORE, 10)
LET T2 = SUM(REF DAMAGE, 5)
```

### 5.4.3 異なる配列で呼ぶ場合：配列名ごとに本体を複製

1つのGOSUB本体には1つの配列名しか焼き込めない（ポインタ不在）。よって**異なる配列名ごとに本体を複製**する。
**ゼロコピーを維持するための正しい挙動**。局所変数（2文字名 `SS`(S)/`SI`(I)/`SR`(戻り値)）は非再帰なので複製間で共有してよい。

```basic
130 GOSUB 2000: T1=SR           ' SCORE用
140 GOSUB 3000: T2=SR           ' DAMAGE用
...
2000 ' === FUNCTION SUM (A->SCORE) ===
2010 SS=0
2020 FOR SI=1 TO 10: SS=SS+SCORE(SI): NEXT
2030 SR=SS: RETURN
3000 ' === FUNCTION SUM (A->DAMAGE) ===
3010 SS=0
3020 FOR SI=1 TO 5: SS=SS+DAMAGE(SI): NEXT
3030 SR=SS: RETURN
```

- 生成される複製数 ＝ その関数が呼ばれる**異なる実引数名の数**（同じ名前だけなら複製ゼロ）。
- **ブロック複製にハード上限は設けない**。ただし複製が多いとコードが増えるため、
  **異なる配列が10個以上**でその関数を呼ぶ場合は **`W_REF_MANY_VARIANTS`（warning）** を `transformErrors` に積む（禁止はしない）。

### 5.4.4 文字列配列のREFも許可（特例なし）

> **【決定・更新】** かつて「文字列は A$〜Z$ の26個」という前提で文字列配列REFを禁止していたが、
> その前提は**誤り**（文字列も2文字名で約960個、§5.11）。名前置換方式では文字列配列も数値配列と
> 完全に同じ扱いが可能。よって **`E_REF_STRING_ARRAY_NOT_SUPPORTED` は撤廃し、文字列配列REFを許可**する。

- **数値配列・文字列配列・多次元配列、すべて REF 可**（特例なし）。一貫した名前置換で実装する。

### 5.4.5 配列の値渡し（REF無し）は許可・ただし巨大コスト警告

- 配列を **REF無しで渡す（値渡し）** ことは許可する。この場合は関数が自分用コピーを持つため、
  呼び出し時に **全要素コピーイン（O(n)）** が発生する。
- **禁止はしない**（プログラマが意図して選べる）。ただし **配列長が32要素以上**の値渡しは
  **`W_ARRAY_VALUE_COPY`（warning）** を積む（[09 §9.6](09-optimization.md#96-ref名前置換と配列値渡しのコスト)）。

### 5.4.6 MapTable への記録（逆変換用）

- 各REF引数：`byRef:true` ＋ **置換した実変数名**を記録（受渡変数は無い）。
- 複製された関数ブロック：どの (関数, 実引数名) から生成されたかを記録し、逆変換で**元の1関数へ統合復元**する（[06 §6.5](06-reverse-transformer.md#65-ref-復元仕様4-1)）。
- REF実引数は変数名のみ（仕様2-3）なので、置換先・復元先は常に一意。

---

## 5.5 ブロック構造の変換

### 5.5.1 IF（ブロック）

```basic
IF X > 0 THEN
    PRINT "POS"
    LET F = 1
ELSE
    PRINT "NONPOS"
END IF
```
本体は任意の文（ネストしたブロックを含む）を取りうる。可能なら `:` で1行化し、無理なら GOTO で分岐する。
ネストしたブロックは、後述 §5.5.4 のとおり**内側から外側へ再帰的に**変換する。

THEN節が短い場合（推奨・可読）:
```basic
200 IF NOT(X>0) THEN 230
210 PRINT "POS" : F=1
220 GOTO 240
230 PRINT "NONPOS"
240 ' endif
```

> 1行化の判断は §5.7（行長最適化）に従う。条件の否定 `NOT(...)` で「else へ飛ばす」形に統一すると
> 行番号の前方参照が減り、可読性が上がる（仕様8-3）。

> **補足（行長制限）**：THEN節の1行化は、**1行化後の行長が255バイトを超えない場合に限る**。
> 超える場合は1行化せず、上記の `IF NOT(cond) THEN <else行>` ブロック展開で行を分散させる
> （§5.12 / [README §9](README.md#msx-basic-の-1-行-255-バイト制限絶対制限)）。

### 5.5.2 FOR

```basic
FOR I = 1 TO 10 STEP 2
    PRINT I
NEXT
```
↓
```basic
300 FOR I=1 TO 10 STEP 2
310 PRINT I
320 NEXT
```
FORはMSXにネイティブに存在するため素直に対応。

### 5.5.3 WHILE

**MSX-BASIC には `WHILE…WEND` が無い**（ループは `FOR…NEXT` のみ）。そのまま出力すると実機・
エミュレータで `Syntax error` になるため、**必ず `IF…GOTO` 形へ展開する**。
条件が偽(=0)のとき脱出。`WHILE 1` のような数値条件も正しく扱えるよう `(cond)=0` で判定する。

```basic
WHILE A < 100
    LET A = A * 2
WEND
```
↓（IF/GOTO 展開）
```basic
400 IF (A<100)=0 THEN GOTO 430
410 A=A*2
420 GOTO 400
430 ' (ループ後 / BREAK 先)
```

- 脱出: `(cond)=0` が真 → ループ後へ `GOTO`。
- `BREAK` → ループ後（430）へ `GOTO`。`CONTINUE` → 末尾の `GOTO 400`（条件再評価）へ。

### 5.5.4 ネストしたブロックの変換（ネスト許可対応）

ネストを許可したため、変換器は **ブロックを再帰的に** 処理する。基本方針は次のとおり。

- **FOR/WHILE のネスト**：MSX-BASIC はネイティブに入れ子可能なので、`FOR…NEXT`/`WHILE…WEND` を
  そのまま入れ子で出力する（追加のGOTO不要）。
- **IF のネスト**：外側IFの本体を変換する過程で、内側ブロックを再帰的に変換して埋め込む。
  多段 IF/ELSE は §5.5.1 の「`IF NOT(cond) THEN <else行>`」パターンを各段で適用する。
- 変換は **内側から外側（ボトムアップ）** に行先ラベルを確定し、2パスで行番号へ解決（§5.7.2）。

例（FOR の中に IF ブロック）:
```basic
FOR I = 1 TO N
    IF A(I) > 0 THEN
        LET S = S + A(I)
        PRINT A(I)
    END IF
NEXT
```
↓
```basic
300 FOR I=1 TO N
310 IF NOT(A(I)>0) THEN 340     ' 内側IF: 偽なら本体skip
320 S=S+A(I)
330 PRINT A(I)
340 NEXT                         ' endif の落ち先 = NEXT
```

例（FOR の中に FOR：二重ループはネイティブ）:
```basic
FOR I = 1 TO 3
    FOR J = 1 TO 3
        PRINT I * J
    NEXT
NEXT
```
↓
```basic
300 FOR I=1 TO 3
310 FOR J=1 TO 3
320 PRINT I*J
330 NEXT
340 NEXT
```

---

## 5.6 BREAK / CONTINUE → GOTO（仕様3-4, 3-5）

ネスト許可に伴い、BREAK/CONTINUE は **最も内側（innermost）の囲みループ** を対象とする。
変換器はパーサーと同様に **ループスタック** を持ち、各 BREAK/CONTINUE のノードに記録された
`enclosingLoopId`（[03](03-lexer-parser.md#ループスタック), [04](04-data-model.md)）から飛び先ループを特定する。

| 文 | 飛び先 | 説明 |
|----|--------|------|
| `BREAK` | **最も内側ループの NEXT/WEND の直後の行** | 内側ループのみ脱出（仕様3-4） |
| `CONTINUE` | **最も内側ループの NEXT/WEND 行（直前）** | 内側ループの次反復へ（仕様3-5） |

### 単一ループ
```basic
FUNCTION SCAN(REF A, N)
    FOR I = 1 TO N
        IF A(I) = 0 THEN
            CONTINUE
        END IF
        IF A(I) < 0 THEN
            BREAK
        END IF
        PRINT A(I)
    NEXT
    RETURN 0
END FUNCTION
```
↓
```basic
5000 ' === FUNCTION SCAN (REF A->A, N->SN, I->SI, 戻り値->SR) ===
5010 FOR SI=1 TO SN
5020 IF A(SI)=0 THEN 5050        ' CONTINUE → 内側FORのNEXT(5050)へ
5030 IF A(SI)<0 THEN 5060        ' BREAK    → 内側FORのNEXT直後(5060)へ
5040 PRINT A(SI)
5050 NEXT
5060 SR=0                        ' ← BREAK の飛び先（NEXT直後）
5070 RETURN
```

### 多重ループ（BREAK は内側のみを抜ける）
```basic
FOR I = 1 TO 3
    FOR J = 1 TO 3
        IF B(I,J) = 0 THEN
            BREAK              ' J ループだけを抜ける
        END IF
        PRINT B(I,J)
    NEXT
    PRINT "ROW END"
NEXT
```
↓
```basic
600 FOR I=1 TO 3
610 FOR J=1 TO 3
620 IF B(I,J)=0 THEN 660       ' BREAK → 内側(J)のNEXT(650)直後=660へ
630 PRINT B(I,J)
640 NEXT
650 ' (Jループ NEXT は 640。BREAKの飛び先はその直後)
660 PRINT "ROW END"            ' ← 内側BREAKの着地点（外側Iループは継続）
670 NEXT
```
> BREAK は `enclosingLoopId = (Jループ)` を見て、Jループの NEXT(640) の直後行へ GOTO する。
> 外側 I ループには影響しない。CONTINUE も同様に最も内側ループの NEXT 行へ飛ぶ。

- `CONTINUE` は `FOR` の場合 該当ループの NEXT 行へ GOTO（NEXT がカウンタ更新と再判定）。
- `WHILE` の `CONTINUE` は該当ループの `WEND` 行へ GOTO（再判定）。
- 飛び先行は2パス（全行仮配置→ラベル解決）で確定し、`loopId` 付きで MapTable の `controlFlow` に記録。

---

## 5.7 行番号割当と最適化（仕様3-6, 8-3）

### 5.7.1 基本割当（仕様3-6）

- 既定の刻みは **10**：`100,110,120,…`。
- 関数ブロックは **1000刻みのセグメント先頭**（`1000`,`2000`,…）から開始し、内部は10刻み。
  これにより「関数=明確な行帯」となり可読性・編集耐性が向上する。

### 5.7.2 2パス・ラベル解決

```
パス1: 各文に「仮ラベル」を割り当てて MsxLine 列を生成（GOTO先はラベル参照）
パス2: ラベル → 実行番号 を確定し、GOTO/GOSUB/THEN <行> を数値に解決
```

### 5.7.3 最適化（仕様8-3）

- 飛び石が大きくなりすぎないよう、空き行帯を詰めて再採番するオプション。
- THEN節1行化により行数削減（§5.5.1）。
- `:` 連結による複文化は **R800/R80でのインタプリタ行解釈コスト削減** に寄与（[09](09-optimization.md)）。
- **インデント**：MSX-BASICはプログラムテキスト中の空白を保持するため、ネスト段数に応じて
  行番号の後を **2スペース単位**でインデントし可読性を高める（READMEの品質要件と整合）。
  空白はバイトを消費するため、サイズ最優先時はオプションでインデントを抑制できる（[09](09-optimization.md)）。
- 関数境界はコメント行 `' === FUNCTION X ===` で明示する。

---

## 5.8 変換テーブル生成（仕様3-7）

変換中に逐次 `MapTable` を構築する。記録項目は [04-data-model.md](04-data-model.md#44-変換テーブル-maptable仕様3-7) の通り。

- 関数→entry/exit行・retVar・params
- 全変数の2文字名割当（A→`AA` 等。スコープ・型別、§5.11）
- BREAK/CONTINUE/RETURN の GOTO 対応
- MSX行番号↔ラベル

---

## 5.9 出力の実行可能性（仕様3-8）

- 生成コードは **そのまま MSX-BASIC として実行可能** であること。
- 行番号は昇順・重複なし。前方/後方参照の GOTO/GOSUB は全て解決済み。
- 文字列変数は `$` 付与、整数演算は適宜 `%`（[09](09-optimization.md) の最適化方針）。
- WebMSX への貼り付け運用は [07-editor-ui.md](07-editor-ui.md#変換後モード)。

---

## 5.10 変換アルゴリズム擬似コード

```ts
function transform(ast: Program): TransformResult {
  const map = newMapTable(ast);
  const transformErrors: SyntaxError[] = [];

  // 全変数 → 2文字MSX名アロケータ（§5.11、スコープ・型別・生存解析）。枯渇時 E_VAR_NAMES_EXHAUSTED
  checkRecursion(ast, transformErrors);          // 再帰検出 → E_RECURSION_UNSUPPORTED
  allocateNames(ast, map, transformErrors);
  if (transformErrors.some(e => e.severity === "error")) return { code: [], map, transformErrors };

  const out = new LineBuffer();          // ラベル付きで蓄積

  // メイン
  out.label("@MAIN");
  emitStmts(ast.toplevel ?? mainBody(ast), "MAIN", out, map);
  out.emit("END");

  // 各関数
  for (const fn of ast.functions) {
    if (fn.name === "MAIN") continue;
    out.segment();                       // 1000刻みセグメント
    out.label("@" + fn.name);
    out.comment(`=== FUNCTION ${fn.name} ===`);
    emitFunctionBody(fn, out, map);
  }

  splitLongLines(out);                    // §5.12: 255バイト超の複文を事前分割
  const lines = allocateLineNumbers(out); // 2パス: ラベル→行番号（分割後に採番）
  resolveJumps(lines, map);               // GOTO/GOSUB/THEN を数値解決
  optimizeLines(lines);                   // 仕様8-3
  enforceLineByteLimit(lines, transformErrors); // §5.12: なお255超なら E_LINE_TOO_LONG
  return { code: lines, map, transformErrors };
}

// 文の出力。ネスト許可のためブロックは再帰的に emit する。
// ループスタックで BREAK/CONTINUE の飛び先（最も内側ループ）を解決する。
function emitStmt(s: Stmt, fn: string, out: LineBuffer, map: MapTable, loops: LoopCtx[]) {
  switch (s.type) {
    case "For": {
      const ctx = pushLoop(loops, s.loopId);     // continue先=NEXT, break先=NEXTの直後
      out.emit(`FOR ${s.varName}=...`);
      s.body.forEach(c => emitStmt(c, fn, out, map, loops));  // 再帰（ネスト）
      ctx.nextLabel = out.emit("NEXT");
      ctx.breakLabel = out.here();                // NEXT直後
      loops.pop();
      break;
    }
    case "While": /* 同様に WHILE…WEND を再帰 emit */ break;
    case "If":    emitIf(s, fn, out, map, loops); break;       // 内側ブロックも再帰
    case "Break":    out.gotoLabel(top(loops).breakLabel, {kind:"Break", loopId:s.enclosingLoopId}); break;
    case "Continue": out.gotoLabel(top(loops).nextLabel,  {kind:"Continue", loopId:s.enclosingLoopId}); break;
    case "Return":   emitReturn(s, fn, out, map); break;
    default:         emitSimple(s, fn, out, map);
  }
}
```

---

## 5.11 2文字MSX名アロケータ（全変数・全型）

> **【重要・設計統合】** 旧「`<関数>_<名前>` 改名」と「文字列26スロット」は**廃止**。
> MSX-BASIC変数名は **先頭2文字のみ有効**（`COUNT`=`CO`、`AD_A`/`AD_B` は両方 `AD` で衝突、`_` も不可）。
> よって**全変数を「先頭2文字で一意なMSX名」へ割り当てる**単一アロケータに統合する。文字列も同じ規則（26ではなく約960個）。

### 5.11.1 名前空間と予算

- 有効名は **先頭英字（A-Z）＋2文字目（A-Z0-9 または無し）**。予約語（`IF` `TO` `ON` `OR` `FN` 等）は除外。
- 実質予算 ≈ **約960個／型**。型は **`%`(整数) `!`(単精度) `#`(倍精度) `$`(文字列)** の別プール
  （`AB%` と `AB$` は別変数なので、2文字名は型をまたいで再利用可）。
- 文字列も数値と同じ2文字規則（旧「26スロット」は誤りだったため撤去）。

### 5.11.2 スコープと割当方針（[01 §1.10](01-language-spec.md#110-変数スコープ)）

- **グローバル**（トップレベル/MAIN変数、または関数内で `GLOBAL` 宣言された名前）
  → プログラム全体で**固定の2文字名**を割り当てる。
- **ローカル**（関数内の非グローバル変数）→ 再帰禁止＝非再入なので、
  **生存区間（liveness）が重ならなければ他関数と2文字名を使い回す**。

### 5.11.3 アルゴリズム（線形走査レジスタ割当・型別）

```
型ごと（% ! # $）に独立して:
  1. 各変数の生存区間を求める（グローバルは全域、ローカルは関数内）。
  2. グローバルに固定名を先に確保。
  3. ローカルを開始位置順に走査し、生存が切れた名前を解放→再利用しつつ割当。
  4. その型の2文字名（約960）を使い切ったら E_VAR_NAMES_EXHAUSTED（全件報告のため走査継続）。
  5. 割当結果 (original, scope, type → msxName) を MapTable.varNameMap に記録。
```

```ts
function allocateNames(prog: Program, map: MapTable, errors: SyntaxError[]): void {
  for (const ty of ["%","!","#","$"] as const) {
    const pool = twoCharNamePool(ty);                 // 約960（予約語除外）
    const globals = liveGlobals(prog, ty);            // 固定名を先取り
    globals.forEach(g => bindFixed(g, pool, map));
    const active: {to:number; name:string}[] = [];
    for (const iv of sortBy(localIntervals(prog, ty), i => i.from)) {
      expire(active, iv.from, pool);                  // 生存終了の名前を解放（再利用）
      const name = pool.take();
      if (!name) { errors.push(makeError("E_VAR_NAMES_EXHAUSTED", iv.pos,
        `2文字変数名(${ty})を使い切りました: ${iv.name}`)); continue; }
      active.push({ to: iv.to, name });
      map.varNameMap.push({ original: iv.name, scope: iv.scope, type: ty, msxName: name });
    }
  }
}
```

### 5.11.4 出力・逆変換との関係

- 変換後は構造化の変数名を割当済み2文字名へ置換（例：`PLAYER_NAME$` → `A$`、`SCORE` → `S0`、`I` → `I`）。
- `varNameMap` により逆変換で `S0` → `SCORE` 等を復元する（[06](06-reverse-transformer.md)）。スコープ情報で
  「同じ2文字名が別関数で別変数に再利用されている」場合も正しく逆引きする。

> 本書の例は実際の2文字名（`AA` `FI` `SS` 等）で記載している。割当はアロケータが自動で行うため、
> ソース上の名前（`SCORE` `PLAYER_NAME$` 等）はそのまま書いてよい。

---

## 5.12 1行255バイト制限の検査と自動分割

**MSX-BASIC の1行は最大255バイト**（行バッファ長の固定値）。超過行は実行不能のため、変換器は
**トークン化後のバイト長**で各行を検査し、可能なら自動分割、不能なら `E_LINE_TOO_LONG` とする
（[README §9](README.md#msx-basic-の-1-行-255-バイト制限絶対制限)）。

### 5.12.1 バイト長の見積り（画面文字数ではない）

- 行長は **トークン化後のバイト数** で測る。MSX-BASIC はキーワードを1バイトのトークンに圧縮する
  （`PRINT`→1バイト等）。一方 **文字列リテラル・変数名・数値リテラルはほぼそのままの長さ**でカウント。
- **255バイト制限は MSX-BASIC の行バッファ長であり、行全体に適用される。** 本システムは判定基準として
  本文（テキスト）部のトークン化後バイト長を用いる（固定オーバヘッドを含めても安全側に倒れるため実用上問題ない）。
- 行頭には行番号(2)＋リンク(2)＋終端(1)の固定オーバヘッドがあるが、判定は **本文（テキスト）部** を基準とする。
- 変換器はキーワード→トークン長テーブルを持ち、レンダリング前に各 `MsxLine.text` の推定バイト長を算出する。

```ts
function tokenizedByteLength(text: string): number {
  // キーワードは1バイト、それ以外（リテラル・記号・空白）はバイト長で加算
  return estimateMsxTokenBytes(text);
}
```

### 5.12.2 自動分割（splitLongLines）

255バイトを超える行は、**安全に分割できる場合のみ**複数行へ分割する。

- **トップレベルの `:` 連結**（順次実行の複文）→ `:` 境界で複数行に割る。各断片に新しい行番号を割当て、
  自然な実行順（次行へ落ちる）で接続するため制御は保たれる。
- **`IF … THEN a:b:c`（1行IF）は単純分割できない** — THEN以降の `:` 文は条件成立時のみ実行されるため、
  素朴に行を割ると無条件実行になり**意味が変わる**。この場合は §5.5.1 の
  `IF NOT(cond) THEN <else行>` ブロック展開に切り替えて行数を分散させる。
- **`PRINT` の長い連結**（多数の文字列/式を `;` で連結）→ 同じ出力位置を保てる範囲で
  `PRINT a;b;` ＋ 次行 `PRINT c;d` のように分割する（末尾 `;` で改行抑制を維持）。

### 5.12.3 分割不能なケース → E_LINE_TOO_LONG

- 分割しても **単一の文が255バイトを超える**場合（巨大な文字列リテラル、極端に長い式など）は
  これ以上割れないため `E_LINE_TOO_LONG` を `transformErrors` に積む。

```ts
function enforceLineByteLimit(lines: MsxLine[], errors: SyntaxError[]): void {
  for (const ln of lines) {
    if (tokenizedByteLength(ln.text) > 255) {
      errors.push(makeError("E_LINE_TOO_LONG", originPos(ln),
        `MSX-BASIC の1行制限 255 バイトを超過しました（行 ${ln.lineNo}）。式の簡略化か行分割が必要です。`));
    }
  }
}
```

- 本制限は **MSX-BASIC の絶対制限**であり回避手段は無い。`E_LINE_TOO_LONG` 発生時は
  文法エラーと同様に**変換前のみ保存**し変換後タブは更新しない（[08](08-file-save.md)）。

---

## 5.13 DATA / READ / RESTORE

- `DATA` / `READ` は **そのままパススルー**（MSXは `DATA` をプログラム全体から走査するため、位置は問わない）。
- 構造化側に行番号は無いので、**`RESTORE <ラベル>`** はラベルで書く。変換器がそのラベル＝対応する `DATA` 行の
  **MSX行番号**へ解決し、`RESTORE <行番号>` を出力する（ラベル↔行番号は MapTable に記録、[04](04-data-model.md)）。
- ラベルが指す先に `DATA` が無ければ `E_UNKNOWN_LABEL`（任意）。

```basic
RESTORE @STAGE1          ' 構造化: ラベル指定
...
@STAGE1:
DATA 1,2,3,4
```
↓
```basic
... RESTORE 2010        ' @STAGE1 の DATA 行番号へ解決
2010 DATA 1,2,3,4
```

---

## 5.14 INCLUDE と 2文字名予算（注意）

- `INCLUDE` で統合された全ファイルは **1つのコンパイル単位**。よって **2文字名アロケータの予算（約960/型）は
  全ファイル合算で消費**される（§5.11・[01 §1.13](01-language-spec.md#113-include分割ファイル)）。
- グローバル変数・関数名も単位全体で共有。各 `MsxLine` に **由来ファイル(provenance)** を付与し、逆変換の分割復元に使う（[06 §6.12](06-reverse-transformer.md)）。

---

## 5.15 SELECT CASE → 一時Let + ネストIF（desugar）

`SELECT CASE`（[01 §1.4.1](01-language-spec.md#141-select-case多分岐)）は、変換の**最初のパス** `lower-select.ts` で
**AST→AST の desugar** を行い、以降のパス（名前検査・CONST展開・畳み込み・型検査・emit）は `SelectBlock` を一切見ない。
これにより既存の **IF lowering（畳み or GOTO化）・provenance(src)・最適化・STRICT 型検査**をそのまま再利用できる。

- セレクタは **一時変数 `__sel<n><型>`**（普通のローカル。Let で退避）へ**一度だけ**代入。型サフィックスはセレクタ式から推定
  （明示があればそれ、未指定の数値は `!`、文字列絡みは `$`）。`__` 接頭辞の内部一時は変換テーブル表示からは除外。
- 各 `CASE` は `else` にネストした `IfBlock` に展開（`ELSEIF` が無いためネスト連鎖）。
  - `CASE v` → `__sel = v`／`CASE a,b,c` → `(__sel=a) OR (__sel=b) OR (__sel=c)`
  - `CASE lo TO hi` → `(__sel>=lo) AND (__sel<=hi)`／`CASE IS <op> n` → `__sel <op> n`（op は `= <> < <= > >=`）
    - 1つの CASE の複数テストは OR。MSX 優先順位で AND が OR より上位のため `a AND b OR c` は正しく `(a AND b) OR c` と評価され括弧不要。
  - `CASE ELSE` → 連鎖末尾の `else`。
- **フォールスルー無し**は IF ブロックの構造（一致本体の後に `END SELECT` へ GOTO）で自然に満たされる。
- 生成ノードの `pos` は元の `SELECT`／各 `CASE` 行を継承 → 行対応ハイライト（[11 §11.16](11-editor-features.md)）が効く。

例（`SELECT CASE STATE% / CASE 0 / CASE 1,2,3 / CASE ELSE`）:
```basic
110 A%=2                                  ' STATE%
120 B%=A%                                 ' __sel0% ← セレクタを一度だけ退避
130 IF NOT(B%=0) THEN 160
140 ...CASE 0 本体...
150 GOTO 200                              ' 一致したので END SELECT へ（fall-through 無し）
160 IF NOT(B%=1 OR B%=2 OR B%=3) THEN 190
170 ...CASE 1,2,3 本体...
180 GOTO 200
190 ...CASE ELSE 本体...
200 ...END SELECT の次...
```
> v3 の任意最適化として、全 CASE が密な小整数リテラルの時に `ON __sel GOTO …`（O(1) ジャンプテーブル）へ
> 落とす余地がある（emit レベル。既存 `ON <式> GOTO/GOSUB` を利用）。v1/v2 では IF チェーンで正しく動く。
