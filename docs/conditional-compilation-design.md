# 条件コンパイル `#IF` / `#IFDEF`（設計メモ）

状態: 設計確定（2026-09-08）・P0 実装中。提案 v2 の 7-5（debug/release トグル）を一般化したもの。
`DEBUG` はこの仕組みの**組込みシンボル1個**の特殊形になる（`DEBUG … END DEBUG` ＝ `#IFDEF DEBUG … #ENDIF` の糖衣）。

## 目的
1ソースから**ビルド時に構成を選んで出力を出し分ける**（未選択の枝は出力に存在せず＝RAM/速度ゼロ）。
例: MSX1版/MSX2版、難易度、デモ/製品、そして debug/release。ルート A/B/C に a1/a2… を用意して `A=1,B=2,C=1` の組合せで1本を生成、が可能。

## 構文（実行時 `IF` と紛れないよう `#` プリプロセッサ）
- `#DEFINE NAME [value]` — シンボル定義（値省略時は `1`）。
- `#UNDEF NAME` — 定義解除。
- `#IFDEF NAME` / `#IFNDEF NAME` — 定義の有無（`#IF DEFINED(NAME)` の糖衣）。
- `#IF <expr>` / `#ELIF <expr>` / `#ELSE` / `#ENDIF` — 条件分岐（ネスト可）。
- `<expr>`: `DEFINED(NAME)`・比較 `= == <> != < <= > >=`・論理 `AND OR NOT`（`&& || !`）・括弧・整数/文字列リテラル・シンボル参照。
- 囲める対象: 文だけでなく **FUNCTION/STRUCT/DATASET/SPRITE/CONST/GLOBAL/INCLUDE 行**（構成ごとにライブラリ切替も可）。

## 確定した設計判断
1. **未定義シンボルを値比較で使ったとき → 0 扱い＋警告 `W_PP_UNDEFINED`**（タイプミス検出）。`#IFDEF`（存在検査）は警告なし＝単に未定義=false。
2. **供給元の優先＝設定UI が ソース `#DEFINE` を上書き**。ソースの `#DEFINE` は「単体で開いても通る既定値」。UI の「ビルド構成」で同名を設定すると、ソースを編集せず変種を出せる。上書き時は変換テーブル/ステータスに「`NAME = v`（UI構成・ソース既定は d）」と明示（透明性）。
3. **`#DEFINE` と `CONST` は別物**（C 流儀）。`#DEFINE` はプリプロセッサ専用（`#IF` でのみ使用）、`CONST` は実行時式でも使える定数。統合しない。

## シンボルの供給元（層・優先は上ほど強い）
1. 設定→Transpile「ビルド構成」UI（このビルドの構成・**上書き**）。
2. 組込みシンボル: `DEBUG`（ビルドモード=debug で定義）、`MACHINE`（対象機種 MSX1<MSX2<MSX2P<TURBOR を数値化。`#IF MACHINE >= MSX2`）。
3. ソース内 `#DEFINE`（既定値）。

## 意味論（透明性・ゼロコスト）
- 評価は **preprocess 段階**（`src/preprocess/`、INCLUDE 解決と同層）。不採用枝の行はパース前にソースから除去し、**採用枝だけ**が字句解析/変換へ渡る。
- → 出力に他変種は存在しない（RAM/速度ゼロ）。**診断は選択中の構成に対してのみ**（見えている＝出荷される）。
- `DEBUG…END DEBUG`／`ASSERT`／`WATCH`（コード生成系）は同じ `DEBUG` シンボルでゲート。
- ビルド情報（有効シンボル＋各 `#IF` で採った枝）を変換テーブル/ステータスに表示＝隠さない。

## 診断
- `E_PP_UNMATCHED_ENDIF`（対応する `#IF` の無い `#ENDIF`）、`E_PP_UNMATCHED_ELSE`（同 `#ELSE`/`#ELIF`）、`E_PP_DUP_ELSE`（`#ELSE` の後の `#ELIF`/`#ELSE`）、`E_PP_UNTERMINATED`（ファイル末で `#IF` 未閉じ）、`E_PP_BAD_EXPR`（式が壊れている）、`W_PP_UNDEFINED`（未定義シンボルを値比較で参照）。
- `#IF`/`#ENDIF` はファイル内で釣り合うこと（P0）。

## 段階
- **P0**: `#DEFINE/#UNDEF/#IFDEF/#IFNDEF/#IF/#ELIF/#ELSE/#ENDIF` ＋式評価器（`DEFINED`・比較・論理）、`resolveIncludes` 統合（不採用枝の行・INCLUDE を除去）、シンボル seed（オプション経由）。→ 純ロジックをテストで固める。
- **P1**: 組込み `MACHINE`、`DEBUG` をビルドモード設定と接続、設定→Transpile の「ビルド構成」UI（シンボル一覧の追加/トグル/値・上書き表示）、`ASSERT`/`WATCH` を `DEBUG` ゲートで。
- **P2**: ビルド情報の可視化（変換テーブル）、任意で「全構成まとめて検証」モード（組合せ爆発対策）。
