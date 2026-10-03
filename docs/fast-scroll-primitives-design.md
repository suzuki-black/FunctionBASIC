# FAST scroll primitives — I/F 設計（縦スクロール3肝）＋フレームエンジン

*Status: **実装・実測済 → 公開ライブラリ昇格済**（`examples/lib/fast-scroll.msxb` = 3肝 /
`examples/lib/fast-stg.msxb` = フレームエンジン `FAST_STGFRAME`+`FEED1`）. v1 target = SCREEN 5, MSX2 以降.*

> **最重要の実測結論（先に読む）**：細かい primitive を毎フレーム何個も BASIC から呼ぶ設計は
> MSX BASIC の GOSUB 行番号線形探索（プログラムが大きいほど遅い＝FASTは全関数展開でDCE無し）で
> **~25fps が天井**（空GOSUB=2.3ms×呼数＋各セットアップの積算）。**毎フレームのホットパスは
> 「1関数=全ASM(1 USR/frame)」に畳む**のが必須で、これで縦STGが turbo R 実測 **9→48fps（5.3倍）**。
> その畳んだ形が `FAST_STGFRAME`（下記「肝の統合形」節）。3肝は依然「合成の部品／低速度でよい用途」
> として有効だが、実ゲームのメインループは統合形を使う。→ memory `msx-gosub-linear-search-fast-perf`。

BattleshipProtoR（C/MegaROM 版）に純 FunctionBASIC + FAST でどこまで肉薄できるか、を
狙う R&D の設計メモ。**戦艦専用の概念（艦体・砲台・敵AI・面データ）は一切持ち込まない。**
FAST は「1フレーム分の反復作業を1回のASM呼びに内包する、BASIC 形の汎用バッチ命令」という
既存方針（[fast-library.md](fast-library.md) / memory `fast-library-positioning`）をそのまま踏襲する。

## 計測で確定した前提（このゲームの遅さの正体）

コストアナライザ（[15-cost-analyzer.md](15-cost-analyzer.md)）で battleship.msxb を実測した結果、
**遅さは毎フレームではなく一度きりの起動時グラフィック生成**に集中していた：

| 関数 | 自コスト | 割合 |
|---|---|---|
| `BUILD_BANK`（タイル絵柄をLINE+PSETで焼く） | 264.78 tk | **64%** |
| `GEN_TILEMAP`（896 POKE） | 76.11 tk | 18% |
| `LOAD_ALL`（hexデコード等） | 18.30 tk | 4% |
| 毎フレーム WHILE 本体 | ~28 tk | — |

→ **per-frame は既に速い**（battleship は自前 ML に委譲済）。純 BASIC でここに肉薄するには
per-frame の反復（スプライト・弾・当たり）を FAST で ASM 内包する必要があり、そこは
既存 `FAST_SPRITES5` / `FAST_MOVEDRAW5` / `FAST_STREAM` / `FAST_COLLIDE` / `FAST_MOVEV` /
`FAST_DRIFT` / `FAST_BIGSPRITES` で**汎用にカバー済み**。残る穴が「背景スクロール系」で、
そこを埋めるのが本設計の3肝。

## 設計判断（確定・実測反映済）

1. **軸**：v1 は**縦のみ**（R#23）。横スクロールは将来 `FAST_HSCROLL`（R#26/#27）で別途。
2. **バンク配置**：`TF_BANKCOLS%` によるグリッド方式（タイル index → バンク座標を算術で導出。
   `=1` で縦ストリップも表現可）。
3. **転送コマンド**：**HMMM（高速バイト転送）を既定**。当初 LMMM を想定したが実測で LMMM は
   3.7倍遅い（下記）＝論理演算・per-pixel でタイル用途に不適。透明転送が要る時だけ LMMM。
4. **VDPコマンド待ち**：**CE（コマンド終了）まで待つ安全版で十分**（実測で確定）。CE待ち＝
   コマンド実行時間そのもので、増分供給ならフレーム占有は数%＝ヘッドルーム大。「発行しっぱなし」
   高速版は不要（同一フレーム内で多数タイルを重ねる時のみ意味を持つ）。
5. **タイル供給の粒度**：**行一括でなく毎フレーム1〜4枚ずつ増分供給**（呼び側ペース）。
   `FAST_VSCROLL` は純 R#23＋`VOFS%` 更新に限定し、供給タイミング判断は呼び側（直交）。
6. **対象モード**：v1 は **SCREEN 5 固定**（既存 `*5` 系と揃える）。

## 実測（openMSX accurate V9938 モデル / turboR / SCREEN5 / 表示ON / コピー結果もVRAM照合済）

per は Z80 発行オーバーヘッド(15連続OUT ≒ 100us)＋CE待ち(=コマンド実行時間)込みの1回コスト。
budget = 16.6ms(1フレーム=1/60s) に何回入るか。

| コマンド | 対象 | per(発行込) | /frame | 備考 |
|---|---|---|---|---|
| R#23 書込 | 背景スクロール | ~数us | ~多数 | 実質無コスト |
| **HMMM** 16x16 | タイル1枚(不透明) | **511us** | **32** | ← 既定。タイル供給の単位 |
| LMMM 16x16 | タイル1枚(論理) | 1871us | 8.6 | 遅い。透明が要る時だけ |
| HMMM 256x16 | 1行=16枚まとめ | 5916us | 2.8 | 行一括は1/3フレーム。増分推奨 |
| HMMM 256x212 | 全画面 | 76.8ms | 0.2 | 毎フレーム不可 |
| HMMV 256x212 | 全画面塗り | 38.6ms | 0.4 | 面切替クリア専用 |

**フレーム予算の帰結**：SPEED=1px/f なら 16フレームに1行露出＝**1枚/f≒0.5ms(3%)**。SPEED=4 でも
4枚/f≒2ms(12%)。背景スクロール(R#23)は無コスト。**＝縦STGの背景は R#23＋HMMM増分供給で汎用に
フレーム予算内**。per-frame のスプライト/弾/当たりは既存 FAST_* が別途カバー済。

### FAST の真の価値＝「BASIC COPY が出せない HMMM」

MSX2 BASIC の `COPY` 文は論理演算対応＝**内部 LMMM（遅い 1871us/枚）**。FAST_COPY は **HMMM（511us/枚）**。
つまりスクロール系での FAST の存在意義は「BASIC が emit できない高速コマンド(HMMM)を使える」＝
**タイル供給が実測3.7倍速**、かつスプライト/弾の FAST バッチと統一APIで合成できる点にある。
（注記: 「BASIC COPY = LMMM」は COPY 文が論理演算子を取ることからの推定。実機/一次資料で最終確認する。）

> **A/B とコストアナライザの注意**：`research/vstg-basic.msxb`(COPY版) vs `research/vstg-fast.msxb`(FAST版)
> をコストアナライザに掛けると A=1.03tk / B=9.23tk と *B が高く* 出るが、これは**アナライザがこの用途に
> 不適**なため。アナライザは BASIC 文の解釈コストを測る道具で、組込 `COPY` を「1文」としか見ず内部の
> VDP コマンド実行(~500us〜1.9ms)を無視する一方、FAST 側は同じ実行時間を ASM の CE待ちループとして
> 露出するので概算で大きく出る。**両者とも同じ VDP 実行コストを払う**＝スクロール系の物差しは
> コストアナライザでなく直接 VDP 実測（上表）。アナライザは解釈律速な per-frame(スプライト/弾)向き。

## 共有状態（一度だけセットする設定グローバル / SoA）

タイルスクロール系が共通で参照する設定。値・絵柄・マップの中身はすべて**ゲーム側**が用意する。

```basic
GLOBAL TF_PAGE%      ' スクロール表示ページ(0-3)。縦256px をリングバッファとして使う
GLOBAL TF_TW%, TF_TH%    ' タイル幅・高さ(px)  例:16,16
GLOBAL TF_COLS%      ' 1行あたりのタイル数 (=256\TF_TW%  例:16)
GLOBAL TF_BANKPG%    ' タイル絵柄バンクのあるページ(0-3)
GLOBAL TF_BANKCOLS%  ' バンク内の横タイル数(index→bank座標算出用。1=縦ストリップ)
GLOBAL TMAP%()       ' タイルマップ配列(row-major, 各行 TF_COLS% 個, 値=タイルindex, 負=空/透明)
GLOBAL VOFS%         ' 現在の縦スクロール累積量(px)。FAST_VSCROLL が更新
```

> **ライブラリ境界（重要）**：`TMAP%()` の中身、絵柄バンクの焼き方（`BUILD_BANK` 相当）、
> 面データ・敵配置・スクロール速度カーブは**すべてゲーム側**。ライブラリは「与えられた
> マップ配列とバンクから、露出した行を VDP 転送で描く／表示位置をずらす」だけを担う。

---

## 肝1: `FAST_VSCROLL(DELTA%)` — ハード縦スクロール（R#23）

- **目的**：表示を毎フレーム `DELTA%` ラインだけ縦に流す（256ライン リング）。機種差を隠す
  （MSX2/2+/turbo R すべて **R#23** で統一。`SET SCROLL` は turbo R 専用なので使わない
  → memory `set-scroll-turbor-only`）。
- **引数**：`DELTA%`（このフレームのスクロール量 px。負値=逆スクロール可）。
- **参照/更新**：`VOFS%`。
- **動作**：`VOFS% = (VOFS% + DELTA%) AND 255` → VDP R#23 に `VOFS%` を書く
  （= 表示開始ラインをずらす。1発の OUT、ASM 化はほぼ不要だが API を揃えるため FAST 名で公開）。
- **戻り**：更新後の `VOFS%`（呼び出し側が行送りの時期判断に使う）。
- **前提**：`TF_PAGE%` は縦256px のリングとして使う（露出領域を肝2 が上書きしていく）。

## 肝2: `FAST_TILEFEED(ROW%, C0%, NCELL%)` — 露出行のタイルを増分供給

- **目的**：スクロールで露出する行のうち **NCELL% 枚だけ**（列 C0% から）を、`TMAP%()` と絵柄
  バンクから **HMMM で描画**。**行一括(5.9ms)でなく毎フレーム1〜4枚の増分**で予算内に収める。
  battleship の DRAW_ROW を汎用化。
- **引数**：`ROW%`（マップ行）、`C0%`（開始列）、`NCELL%`（今フレームに供給する枚数）。
  ほか設定グローバル一式＋ `TMAP%()` ＋バンク。
- **動作（1回のASM呼びに内包・HMMMをNCELL回）**：
  1. `VY% = (ROW% * TF_TH%) AND 255`（リング上の書き込み Y）。
  2. `c = C0% .. C0%+NCELL%-1` で `t = TMAP%(ROW%*TF_COLS% + c)`。
  3. `t >= 0` のとき、バンク座標
     `bx = (t MOD TF_BANKCOLS%) * TF_TW%`, `by = (t \ TF_BANKCOLS%) * TF_TH%` から
     `(TF_PAGE%, c*TF_TW%, VY%)` へ **HMMM** コピー（肝3 と同じ発行列。NX/NY/CMD は不変なので
     内部ループでは変わる SX/SY/DX/DY だけ書換えて発行オーバーヘッドを削る）。
  4. `t < 0`（負値セル）は**スキップ**（= 海/透明。上書きしないので背景が残る）。
- **戻り**：なし。呼び側は列カーソル(C0%)と行カウンタを保持（直交）。
- **使い方**：`FAST_VSCROLL` 後、露出予定行を C0% から少しずつ `FAST_TILEFEED(row, c0, 1..4)` で
  埋め、`TF_TH%` 境界を跨ぐ前に1行分を完了させる（SPEED に応じて NCELL% を決める）。

## 肝3: `FAST_COPY(SPG%, SX%, SY%, W%, H%, DPG%, DX%, DY%)` — VDP ブロック転送（HMMM）

- **目的**：VRAM→VRAM の矩形ブロック転送を1コマンドで（背景片・スタンプ・タイル1枚）。
  肝2 が内部で使う土台であり、単体でも公開。battleship の `CMD` を汎用化。
- **引数**：source ページ/座標(`SPG% SX% SY%`)、サイズ(`W% H%`)、dest ページ/座標(`DPG% DX% DY%`)。
  **座標/サイズは「ドット(px)」でそのまま指定**（HMMM/HMMV は高速コマンドだが座標はドット。内部が
  バイト粒度なだけで、**X/W は偶数**であればよい＝16px タイルは常に満たす）。※当初「バイト指定(px/2)」と
  誤設計し幅が半分になった。openMSX の VRAM 読み戻しで「ドット指定で全幅」を実証し修正（2026-09-19）。
- **動作**：V9938 **HMMM** コマンドを1発発行し、**CE(コマンド終了)まで待つ**（安全版）。
  ページは縦Y上位で扱い、212ライン超（page跨ぎ）も可。実測 16x16=511us。
- **兄弟（同系・v1 で同時に入れる）**：
  `FAST_VFILL(DPG%, DX%, DY%, W%, H%, COL%)` — **HMMV** による矩形塗り（`FAST CLS` / 面切替クリア相当。
  全画面は38ms＝毎フレーム不可、面切替専用）。
- **汎用性**：VDP を持つ全 MSX2+ タイトルの基本ブロック。透明転送が要る用途のみ将来 LMMM 版を追加。

---

## 1フレームの組み立て（既存 FAST と合成）

```basic
' 毎フレーム
FAST_VSCROLL(SPEED%)                          ' 肝1: R#23 で表示を流す(無コスト)
FAST_TILEFEED(FEEDROW%, FEEDCOL%, NCELL%)     ' 肝2: 露出行を毎フレーム NCELL 枚だけ増分供給
FEEDCOL% = FEEDCOL% + NCELL%                   ' 列カーソルを進める(1行=TF_COLS%枚で次行へ)
IF FEEDCOL% >= TF_COLS% THEN FEEDCOL% = 0: FEEDROW% = FEEDROW% + 1
FAST_STREAM(...)     ' 既存: 弾ストリーム
FAST_COLLIDE(...)    ' 既存: 当たり判定
FAST_MOVEDRAW5(...)  ' 既存: スプライト移動＋OAM一括(&H7600)
```

→ 縦STG の per-frame 中核がすべて「1回ずつの ASM 呼び」に収まり、BASIC は薄い glue のみ。
C/MegaROM 版に肉薄する狙い。**ただし上記の「毎フレーム複数 GOSUB」構成は実測で ~25fps が天井**
だったため、実ゲームでは次の統合形（`FAST_STGFRAME`）に畳む。

---

## 肝の統合形: `FAST_STGFRAME()` — 1フレーム=全ASM のフレームエンジン（公開: `fast-stg.msxb`）

3肝＋既存 per-frame FAST を**別々の関数として毎フレーム呼ぶ**と、MSX BASIC の GOSUB 線形探索で
律速する（前述）。そこで縦STGの1フレーム分を**1本の ASM 関数**に統合したのが `FAST_STGFRAME()`。
BASIC 側は「入力・発射・撃破再出現」だけを担い、フレーム本体は `H% = FAST_STGFRAME()` の1回だけ。

- **内訳（1回のASM内で順に）**：
  - **A) スクロール**：`VOFS% += SPEED%` → R#23（肝1 相当をインライン）。
  - **B) タイル増分供給**：16px 境界を跨いだら新行開始、毎フレーム1枚だけ HMMM で供給（肝2/肝3 相当を
    インライン。`FEED1` と同一ロジック）。
  - **C) 当たり判定**：弾群 × 敵群 の AABB（box 31=+-15）。当たった弾は非表示＋Y=216、当たった敵は
    X=248（撃破マーク）、件数を戻り値に加算。
  - **D) 全plane 移動＋描画**：`SY += SV` → スクロールに追従する **Y補正 `attrY=(screenY+VOFS) AND 255`**
    → OAM（`&HF600`）へ直書き。弾は上端で自動消去、敵は下端で折り返し、非表示 plane は画面外へ退避。
- **戻り値**：この1フレームの命中件数。`>0` なら BASIC 側が X=248 の敵を見て再出現。
- **実測**：turbo R で **~48fps**（同構成を3肝の毎フレーム複数呼びで組むと 9fps）。

### 汎用性の担保（戦艦STG専用ではない）

`FAST_STGFRAME` は **SoA 配列と数値グローバルだけ**を駆動する。タイル絵柄・マップ・スプライト絵柄/色・
自機/弾/敵の数はすべてゲーム側が決める。専用に見える固定は「v1 の構成前提」であって内容ではない：
SCREEN 5 / 16x16 タイル / マップ16列・縦32行ラップ / 背景リング=page0・絵柄バンク=page1 /
スプライト表を page1(OAM=`&HF600`)へ退避 / 16x16 スプライト。

**呼び出し契約（起動時に1回セット）**：

```basic
' 配列(トップレベル DIM。要素 0..NSPR%-1 が有効 plane)
DIM TMAP%(512), SY%(N), SX%(N), SP%(N), ACT%(N), SV%(N)
' plane 配置の約束: 自機=0 / 弾=連続 / 敵=連続 (当たり判定が連続領域を走査)
F_TMP% = VARPTR(TMAP%(0))
QY0%=VARPTR(SY%(0)): QX0%=VARPTR(SX%(0)): QP0%=VARPTR(SP%(0))
QA0%=VARPTR(ACT%(0)): QV0%=VARPTR(SV%(0))           ' 全plane走査の起点
PSX%=VARPTR(SX%(弾先頭)): PSY%=VARPTR(SY%(弾先頭)): PSA%=VARPTR(ACT%(弾先頭))
PEX%=VARPTR(SX%(敵先頭)): PEY%=VARPTR(SY%(敵先頭))   ' 当たり判定の弾群/敵群起点
CSN% = 弾数: CEN% = 敵数: NSPR% = 使用plane総数
SPEED% = 1: VOFS% = 0: LR% = 0: FR% = 16: FC% = 16 ' 内部状態初期値
' 別途: スプライト表を page1 退避(R#5=&HEC,R#6=&H1F,R#11=1)＋色/パターン/停止マーカ(Y=216)を用意
' 別途: 可視16行を FEED1(R,C) で prefill / フレーム同期(EI:HALT)はゲームループの責務
```

`SV%()`（Y速度）で弾＝負・敵＝正・自機＝0 を表し、供給元マップは `TMAP%()`。**負値タイルは供給
スキップ（海/透明）**。これらは全てゲーム側の値なので、絵柄・面・敵数を差し替えれば別の縦STGになる。

### `FEED1(ROW%, COL%)` — 1タイル供給（prefill 用・統合形と同一ロジック）

起動時に可視16行を敷く prefill と、`FAST_STGFRAME` 内の増分供給が同じ HMMM ロジックを使う。
prefill 用に単体でも公開（`FUNCTION FEED1` in `fast-stg.msxb`）。3段ネスト（`FAST_TILEFEED`→
`FAST_COPY`→`FSC_ISSUE`）を排して全ASM1本にした版で、単体でも 6.3倍速。

## ライブラリに入れない（＝ゲーム側の責務）

- タイル絵柄そのもの（`BUILD_BANK` 相当の焼き付け）
- マップ内容 `TMAP%()` の生成（`GEN_TILEMAP` 相当）
- 面進行・スクロール速度カーブ・敵配置・敵AI・スコア等のゲームロジック
- 起動時の一度きりセットアップ（遅さの64%はここ。FAST の対象外）

## 検証状況

- **済**：純Z80タイミングハーネスを openMSX(C-BIOS turboR)ヘッドレスで実行し、LMMM/HMMM/HMMV の
  実コスト＋CE待ちを実測（上表）。ステータスレジスタ直読みで CE High=1.87ms(LMMM16x16) を裏取りし、
  dest VRAM 照合でコピー正当性も確認。→ HMMM 既定・安全版で十分・増分供給、を確定。
- **済**：`research/fast-scroll.msxb` に 肝1/肝3＋兄弟(HMMM/HMMV/R#23) を実装、トランスパイル＋
  インラインASMアセンブル 0エラー、生成機械語を逆アセンブル照合（R#32..46 の15バイト順・CE待ち）。
- **済**：3肝を `examples/lib/fast-scroll.msxb` へ、統合形 `FAST_STGFRAME`＋`FEED1` を
  `examples/lib/fast-stg.msxb` へ昇格（公開デリバラブル）。`build.mjs` でエディタ LIBS にも同梱。
  research の縦STGデモ（gitignored）を `INCLUDE "fast-stg.msxb"` に切替え、トランスパイル 0エラー・
  SJIS クリーン・全行 255バイト以内をデスクチェックで確認。
- **済**：research 縦STGデモを turbo R 実機/MSXPen で実測。**毎フレ複数GOSUB版=9fps →
  `FAST_STGFRAME` 統合版=~48fps**（TIME カウンタで算出）。背景に大きい戦艦（tile を2x3で配置）が
  流れる戦艦テーマも実装（零の咆哮の背景要素）。
- **次段（任意/将来）**：
  1. 60fps へ詰めるなら入力 IF 群も ASM 化（genericity とトレードオフ）。
  2. 横スクロール `FAST_HSCROLL`（R#26/#27）を別途。
  3. README（英日）に「零の咆哮の元ゲームを公開用に改良」サンプルとして追加＋零の咆哮リンク。
  4. FunctionBASIC Runtime 側に VDP コマンドエンジン＋`&H9B`＋`HALT` を実装し連携（下記注記/TODO）。

> **FunctionBASIC Runtime 連携の注記**：本設計の HMMM/HMMV は VDP コマンドエンジンと（ASM実装が
> 間接ストリームを使う場合）ポート `&H9B` を使う。別プロジェクトの FunctionBASIC Runtime
> (`~/work/BasicPureInterpreter`) は 2026-09-19 時点で **コマンドエンジン未実装・`&H9B` 未対応**のため、
> これらは Runtime では動かない（R#23 スクロールと OAM 直書きは動く）。公開ライブラリ昇格時は
> Runtime 拡張依頼か本体側フォールバック（VPOKE/OAM 経路）の方針決定を昇格条件に含める。
> 詳細は TODO.md「FunctionBASIC Runtime 連携」節。

> **測定環境の注記**：このMacは実 BASIC ROM が無く C-BIOS のみ（BASIC統合の絶対fpsは測れない）。
> 上表は純Z80ハーネス＋openMSXの accurate な V9938 コマンドタイミングモデルによる。openMSX 運用は
> `~/.claude/CLAUDE.md` 準拠（`pkill -f openmsx` 禁止・session UUID 絞り込み・`timeout` 必須）。
