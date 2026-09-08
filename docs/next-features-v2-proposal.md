# FunctionBASIC 次期機能提案書（v2・リポジトリ照合済み）

対象: FunctionBASIC v0.2.0（`suzuki-black/FunctionBASIC` main、2026-09-07 時点）
入力: `FEATURES.md`、リポジトリの `README.md` / `TODO.md` / `CHANGELOG.md` / `docs/` / `src/` / `examples/`、設計方針に関する対話

---

## 0. リポジトリ照合の結果

前版（v1）の 10 提案を、リポジトリの実装・TODO と突き合わせた。

| v1 提案 | 照合結果 | 扱い |
|---|---|---|
| 1 `TILEMAP` ＋マップエディタ | 未実装（`FAST_TILES`/`FAST_TILEGRID` は存在） | **継続** |
| 2 画像インポート（PNG → VRAM 形式） | 未実装（`.BIN` 同梱のみ） | **継続** |
| 3 スプライトエディタ GUI | `TODO.md` P1 に「SPRITE ドット絵ライブプレビュー」あり（未実装） | **継続・差分を明確化**（プレビューは既に計画済み。本提案は行別色記法と編集を追加） |
| 4 FM 対応と SFX デザイナ | `SFX_DROP()`（PSG レジスタ直書きの急降下 SFX）が **実装済み**（`music.mjs sfx`／GUI「→ SFX(急降下)」）。FM は「MML→PLAY で参照音源を再現する経路は放棄、BIN+ASM（VGM レジスタ再生）を採用」と `TODO.md` で決定済み | **書き直し**（決定と矛盾しない形に） |
| 5 変数インスペクタ／実測プロファイラ | README ロードマップに「openMSX へ `.dsk` 自動マウント＋Tcl で RUN」（未実装）、`TODO.md` P2 に `ASSERT`（未実装）。RAM 読み・長名逆引き・プロファイラは未着手 | **継続**（既存計画を土台として明記） |
| 6 `TABLE` コンパイル時テーブル生成 | 未実装 | **継続** |
| 7 言語小改善 | `FOR` 空範囲: **定数で空と確定する場合の警告 `W_FOR_EMPTY_RANGE` が実装済み**（`check-for-range.ts`）。同ファイルに「コード生成は一切変えない（透明性維持）」と明記されており、v1 の実行時ガード案は方針に反する → **取り下げ**。`ENUM`/`ASSERT`/`+=`/`TRUE`/`FALSE`/`WITH` は `TODO.md` に**既出**（未実装）→ 本書では重複提案せず参照のみ | **縮小・差し替え** |
| 8 `lib/game.msxb` | 未実装（`M2_WAIT`/`M2_SE` は MSX2 ライブラリに一部） | **継続** |
| 9 `.rom` エクスポート／トークナイザ | 未実装（`sav.rs` は ASCII 書き出し。トークナイザ無し） | **継続** |
| 10 AI 向けリファレンス | **実装済み**。`docs/00-msx-basic-diff.md`（英日）が「AI（バイブコーディング）が読めば正しく生成できる差分チートシート」として存在 | **取り下げ → 新提案に差し替え** |

### 差し替え・追加した提案
- **10' `TASK`（コルーチン風ふるまい記述）** — 敵 AI・演出進行を「状態番号＋SELECT CASE」に降下する言語機能
- **11 メモリ予算解析（静的 RAM 見積り）** — コスト解析の「速度」に対する「容量」版
- **12 `TEST` ブロック＋内蔵ミニ BASIC インタプリタ** — ROM もエミュレータも要らないロジック検証

### 照合中に気づいた点（提案外）
- `README.md` と `docs/00-msx-basic-diff.md` は「再帰不可（`E_RECURSION_UNSUPPORTED`）」と書いているが、`FEATURES.md` と `test/recursion.test.ts` はソフトスタックによる再帰対応済み。ドキュメントの更新漏れと思われる。
- `TODO.md` の「同一オリジン WebMSX」は「link only, do not bundle」の方針と衝突するとして保留になっている。本書の提案 5 はその制約を前提に、WebMSX に触らず openMSX 接続で解決する。

---

## 0.1 前提と評価軸

FEATURES.md・TODO.md から読み取れる設計方針を判断基準にする。

| 方針 | 意味するところ |
|---|---|
| **実行時コストゼロ／透明性** | 高水準構文は生 MSX-BASIC へ降下し手書きと同コスト。**生成コードを黙って変えない**（`check-for-range.ts` の注記） |
| **テキストが正、GUI は補助** | `SPRITE` ブロック、MML ⇄ `PLAY`、ピアノロール。GUI は往復可能なテキストの編集器 |
| **依存ゼロ・同梱物ゼロ** | npm 依存なし。BIOS/BASIC ROM・エミュレータは同梱しない（`docs/10-tech-stack.md` 方式C） |
| **逃げ道は opt-in・隠さない** | FAST は「選ぶ道具」。変換テーブルに見える。BASIC 版「双子」を並べて教える（TODO の決定） |
| **診断は編集時に** | 255 バイト、SJIS、機種未対応、空 `FOR` |

各提案は「目的／現状との接点／仕様案／実装段階／制約・リスク／規模感（S: 数日, M: 1〜3週, L: 1ヶ月超）」で記述する。

---

## 1. `TILEMAP` ブロック ＋ マップエディタ

### 目的
背景・ステージ・敵編隊のデータを、`SPRITE` ブロックと同じ「見たまま」の記法で書く。現状は `DATA` を手で数えるか、`FAST_TILEGRID` 用の生存マスク配列を自前で詰める。

### 現状との接点
`SPRITE … END SPRITE`（`lower-sprite.ts`）、`DATASET`／`RESTORE name`、`FAST_TILES`／`FAST_TILEGRID`（`examples/lib/fast.msxb`）、データファイル同梱（v0.2.0）。

### 仕様案

```basic
TILEMAP STAGE1 WIDTH 32 HEIGHT 24 TILES "#=65 .=32 ^=66 o=67"
################################
#....^^^....o.....^^^..........#
################################
END TILEMAP
```

- ヘッダで「文字 → キャラクタコード」を宣言。未定義文字は編集時エラー。
- 生成先は `AS` 句で選ぶ。
  - `AS DATASET`（既定）: `DATASET STAGE1` へ。追加 RAM は `DATA` 分のみ。
  - `AS DATAFILE "STAGE1.MAP"`: データファイルとして同梱し `OPEN … FOR INPUT` で 1 行ずつ読む。RAM 消費なし。
  - `AS RLE`: 連長圧縮 `DATA` ＋ 展開ルーチン。**BASIC 版と ASM 版の双子**を生成（FAST の「双子」方針に合わせる）。`TILEMAP_DRAW(STAGE1, X%, Y%)` を定義。
  - `AS MASK`: `FAST_TILEGRID` の生存マスク形式（0/1）。敵編隊の初期配置向け。
- `STAGE1_W`/`STAGE1_H` を `CONST` として生成。
- 横長スクロールマップは `TILEMAP … PART n` で縦分割。エディタは連結表示。

### マップエディタ GUI（*Run→Map tool*）
ピアノロールと同じ構造。左に文字パレット（ヘッダから自動生成）、中央グリッド、右に `SPRITE`/フォントプレビュー。`TILEMAP … END TILEMAP` の範囲だけを読み書きし、GUI 固有の保存形式を持たない。

### 実装段階
- **段階0**: 構文と `AS DATASET`（`lower-sprite.ts` と同じ位置に `lower-tilemap.ts`）。
- **段階1**: `AS DATAFILE` / `AS RLE` / `AS MASK`。`examples/runner-turbor.msxb` を書き換えて効果を示す。
- **段階2**: マップエディタ GUI。

### 制約・リスク
- `DATA` の 255 バイト分割でマップ 1 行 ≠ `DATA` 1 行になる。行対応ハイライトが 1 対多になる点のみ扱う。
- SCREEN 2 のパターンバンク（3 分割）は利用者責任。`BANK` 指定の要否は段階1で判断。

### 規模感: S / M / M

---

## 2. 画像インポート（PNG → SCREEN 2/5 パターン・パレット・`.BIN`）

### 目的
タイトル画面・背景・フォントを画像ツールで描いて VRAM 形式に落とす。`.BIN` 同梱の**入口**を作る。データファイル「テキスト/SJIS のみ」の制約を `.BIN` 側から解消する。

### 現状との接点
`.BIN` 無加工同梱（v0.1.43）、`M2_PAL`、`M2_DEFSPR`、`check-screen.ts`（SCREEN 検査）。

### 仕様案
プロジェクトに `.png` を置くと「アセット」欄に現れ、変換先を選ぶ。

| 変換先 | 入力条件 | 出力 |
|---|---|---|
| SCREEN 2 パターン+カラー | 256×192 以下、8×1 ブロックにつき 2 色 | `.BIN`（`BLOAD "X.BIN",S`） |
| SCREEN 5 ビットマップ | 256×212 以下、16 色 | `.BIN`（ページ指定）＋ `M2_PAL` 呼び出し列 |
| フォント | 8×8×256 | パターンテーブル `.BIN` |
| スプライト | 16×16 の並び | `SPRITE` ブロックへ逆生成（テキストが正） |

- **編集時診断**: SCREEN 2 の色数超過を「どのブロックで何色」まで示す。SCREEN 5 の 16 色超過はメディアンカットで量子化案を提示。
- パレット RGB は 3 ビット/成分に丸め、丸め後プレビューを出す。
- `.png` は再変換の元として残し、`BLOAD` 行のスニペットを挿入。

### 実装段階
- **段階0**: フォントとスプライト（1 色）。`SPRITE` 逆生成は画像 → `.`/`#`。
- **段階1**: SCREEN 2 `.BIN` と色数診断（タイトル画面が作れる段階）。
- **段階2**: SCREEN 5 量子化とページ指定。

### 制約・リスク
- SCREEN 5 のページ配置は `SET PAGE` 依存。`M2PG` と整合させる。
- `.BIN` は autorun URL 超過（`run.toobig.dsk` の経路）を押しやすい。`.dsk` フォールバック閾値を先に表示。
- 依存ゼロ方針: PNG デコードは Tauri 側 Rust（`image` クレート）かブラウザ Canvas API。

### 規模感: S / M / M

---

## 3. スプライト行別色記法 ＋ エディタ（MSX2）

### 目的
`TODO.md` P1 の「SPRITE ドット絵ライブプレビュー」は**表示**の計画。本提案はその先の、MSX2 の「行ごとに色を変える」「2 枚重ね」を**記述・編集**できるようにする。

### 現状との接点
`SPRITE … END SPRITE`、`M2_SPR`（2 枚重ね）、`COLOR SPRITE$` パススルー、TODO のプレビュー計画。

### 仕様案（後方互換の拡張）

```basic
SPRITE HERO SIZE 16 COLORS 15,9
..####..........  : 15
.#.##.#.........  : 9
END SPRITE
```

- 行末 `: 色番号` で行別色。省略時は `COLORS` 先頭。MSX1 ターゲットでは警告して無視。
- `LAYER 2` で 2 枚重ね。パターン 2 個と `HERO_PUT(X%,Y%)`（`MACRO` 展開・ゼロコスト）を生成。
- コンパイル時に `COLOR SPRITE$(n)=CHR$(…)` を生成（MSX2 以降）。
- プレビュー（TODO 計画）は行別色を反映して描く。

### 実装段階
- **段階0**: 記法とコード生成（`lower-sprite.ts` 拡張）。
- **段階1**: TODO のプレビューに行別色を載せる。
- **段階2**: グリッド編集 GUI（プレビューをクリック編集に昇格）。

### 制約・リスク
既存 `.msxb` は全て `COLORS` 無しで通す。横並び制限（MSX1 4 枚/MSX2 8 枚）は静的検出できないので範囲外。

### 規模感: S / S / M

---

## 4. 音: FM 作曲経路、`SFX` ブロック、SFX デザイナ

### 前提（TODO の決定を尊重）
- 「MML→`PLAY` で**参照音源を再現する**」経路は放棄済み（`@`/`V` の再アタックでクリック音、レジスタ表現不可）。再現は **BIN+ASM（VGM レジスタ再生）**。
- `SFX_DROP()`（PSG 音程レジスタ直書きスイープ）は実装済み。

本提案は「再現」ではなく**「自分で作曲・効果音設計する」**用途に限定し、上記決定と競合しない範囲で埋める。

### 4a. FM 作曲経路（MML → `PLAY #2`）
- `music.mjs export --target fm` で `CALL MUSIC` 初期化＋`PLAY #2,"…",…` を生成。PSG と同じコアの出力先切替。
- FM 固有の方言: 音色 `@n`、`V` 範囲、リズム（`CALL MUSIC` 引数）。9 声（リズム時 6 声）まで等長パディング。
- 位置づけ: 「MSX-BASIC で書けるゲーム BGM」の範囲を作るもの。細かい表情付けは BIN+ASM 経路へ、と明記。
- ピアノロールの Web Audio プレビューは PSG 相当のまま。「FM 音色は近似」と表示。

### 4b. `SFX` ブロック（`SFX_DROP` の一般化）
```basic
SFX EXPLODE
  NOISE 20 TO 31 STEP 1 EVERY 2
  ENV 0 SHAPE 0 PERIOD 400
  LEN 24
END SFX
```
- 1 フレーム 1 段のレジスタ列を `DATASET` 化し、`SFX_PLAY(EXPLODE)` を生成。feeder の `TICK` と同じ駆動で非ブロッキング。
- `SFX_DROP` は「`SFX` ブロックの急降下プリセット」として取り込む（既存呼び出しは互換維持）。
- `M2_SE` は `SFX` の薄いラッパへ。

### 4c. SFX デザイナ GUI（*Run→SFX tool*）
スライダー（周期スイープ・ノイズ・エンベロープ・長さ）と試聴。出力は `SFX … END SFX` テキスト。

### 実装段階
- **段階0**: 4a（出力テンプレート追加のみ）。
- **段階1**: 4b（`lower-sfx.ts`、feeder 統合）。
- **段階2**: 4c GUI。BIN+ASM 側の「スネア欠落」（TODO 記載）はこの提案とは独立に扱う。

### 制約・リスク
- アプリ内 WebMSX は FM 無音（別オリジン iframe の AudioContext 制約、v0.1.43 で原因確定）。FM 試聴は外部ブラウザか openMSX。
- ch C を SFX に割く前提は `M2_SE` と同じ。BGM 3 声との競合は feeder 側で「SFX 中は ch C ミュート」を明文化。

### 規模感: S / M / M

---

## 5. 変数インスペクタ（長名で見えるデバッガ）と実測プロファイラ

### 目的
「2 文字名しか見えない」を、変換テーブルを持つこのツールだからこそ解消する。**エミュレータも BIOS/BASIC ROM も同梱しない**。

### 現状との接点
- `.map.json`（`maptable.ts`）、行対応ハイライト、`error-estimate.ts`、`cost.ts`（静的プロファイラ）
- README ロードマップ「openMSX に `.dsk` 自動マウント＋Tcl で RUN」（未実装）— 本提案の段階1 はこれを土台にする
- `TODO.md` P2 の `ASSERT`（未実装）— 段階0 に含める

### 段階0: 計装ビルド（エミュレータに触らない）
デバッグビルドでのみ展開し、リリースでは消える。

```basic
WATCH PLAYER_SCORE, ENEMY_N%   ' → LOCATE 0,23:PRINT "PLAYER_SCORE=";PS;" ENEMY_N=";EN
ASSERT LIVES% >= 0              ' → IF NOT(LV>=0) THEN PRINT "ASSERT L42":STOP
```
- 長名は文字列リテラルに埋め込むので 2 文字名は見えない。
- GRP 画面では `OPEN "GRP:"` 経由か `WATCH` 無効化を選択。
- iframe 方式・MSXPen・実機の全てで動く。「デバッグ/リリース」の切替は設定→Transpile に置く（既存の最適化トグルと同じ場所）。

### 段階1: openMSX に「接続」する（本命）
openMSX は制御ソケット（macOS/Linux `~/.openMSX/socket/`、Windows 名前付きパイプ、または `-control stdio`）を持ち、`debug read_block memory <addr> <len>` で RAM を読める。BIOS は openMSX 側でユーザーが用意する運用（`docs/10-tech-stack.md` 方式C と同じ）。「openMSX が見つかれば有効」として実装する。

| 機能 | openMSX 側 | FunctionBASIC 側 |
|---|---|---|
| 起動＋RUN | `openmsx -machine <機種> -diska <dir>`、`type` でキー入力 | README ロードマップの Tcl 自動化をそのまま実装。機種は既存設定を共用 |
| 変数一覧 | `debug read_block memory` | `VARTAB`(&HF6C2)〜`ARYTAB`(&HF6C4)〜`STREND`(&HF6C6) を走査し `.map.json` で長名へ。STRUCT は並列配列を 1 レコードに再構成 |
| 現在行 | `CURLIN`(&HF41C) | 対応する構造化行をハイライト（行対応の実行時版） |
| 書き換え検出 | `debug set_watchpoint write_mem` | 「この変数が変わったら止める」 |
| 停止/再開 | `debug break` / `debug cont` | ツールバー |
| ディスク | `diska <フォルダ>`（ディレクトリをディスクとしてマウント） | `.dsk` を作らずデータファイル欄をそのまま読ませる。`APPEND` の結果をエディタで直接開ける |

- 変数走査は停止中または一定間隔（〜10 fps）。読み出しは数百バイト。
- 表示はツリー: グローバル／関数別ローカル（`.map.json` の関数別表）。GOSUB フレームは追えないので「現在行が属する関数」を優先表示。

### 段階1 で同時に成立: 実測プロファイラ
- 関数入口/出口に `JIFFY`(&HFC9E) 読みを挿入して `%` 配列に累積、終了時にマウントフォルダへ書き出す。
- `cost.ts` の見積りと並べて「見積り／実測／差」を表示。差が大きい命令は較正候補として蓄積。
- `EVENT TIMER` 内は別カウンタに分離。

### 段階2（任意）: WebMSX 同一オリジン
`TODO.md` に保留理由（「link only, do not bundle」との衝突）が明記されているので、本書では**推さない**。段階1 で目的は達成できる。

### 制約・リスク
- ROM は一切扱わない。「C-BIOS には BASIC が無いので実 ROM が必要」を openMSX 側の話としてドキュメントに明記。
- openMSX 検出とバージョン差（ソケット位置・コマンド名）を吸収する薄い層。
- `CURLIN` は関数展開後の行番号。`.map.json` で構造化側へ戻す。

### 規模感: S / L / —

---

## 6. コンパイル時テーブル生成 `TABLE`

### 目的
固定小数点の三角関数・弾道・イージング・擬似乱数列を手で `DATA` に打つ手間をなくし、コスト解析が重命令とする `SIN`/`RND` を実行時から追い出す。

### 現状との接点
`CONST`（`const-inline.ts`、`fold-expr.ts`）、`MACRO`、`DATASET`、コスト解析の重命令フラグ、データファイル同梱。

### 仕様案

```basic
TABLE SIN_T%(256) = INT(SIN(I * 3.14159 / 128) * 256)   ' I = 0..255
TABLE EASE_T%(64)  = INT((1 - (1 - I/63)^2) * 255)
TABLE RND_T%(128)  = INT(RND(1) * 100) SEED 42
```

- 右辺は `I` と `CONST` のみを含む式。`fold-expr.ts` の評価器を拡張してコンパイル時に評価。関数は MSX-BASIC と同名に限定。
- 生成先 `AS`: `DATASET`（既定、起動時に 1 回 `READ`）／`DATAFILE`（RAM を `DATA` で消費しない）／`BIN`（`BLOAD` ＋ `PEEK` マクロ。巨大テーブル向け）。
- `WITH MACRO` で `MACRO SINF(A) = SIN_T%((A) AND 255)` を自動生成。
- 診断: 値が `%` 範囲を超えたら編集時エラー。大きいテーブルは `AS DATAFILE` を推奨する警告。

### 実装段階
- **段階0**: `AS DATASET`。
- **段階1**: `AS DATAFILE` / `AS BIN`、`SEED`。

### 制約・リスク
JS double と MSX 単精度の差は整数化前提で許容、ドキュメント明記。

### 規模感: S / S

---

## 7. 言語小改善（TODO に無いものだけ）

`ENUM` / `ASSERT` / `+=` / `TRUE`・`FALSE` / `WITH` は `TODO.md` に既出のため本書では扱わない。`FOR` 空範囲は静的警告が実装済みで、実行時ガードは透明性方針に反するため提案しない。

| 項目 | 仕様案 | 現状との接点 | 規模 |
|---|---|---|---|
| STRUCT レコード渡し | `REF` で STRUCT 要素を丸ごと渡す（各フィールド配列の `REF` 展開） | STRUCT v1 の既知制約 | M |
| inline ASM 拡張 | ラベルへの絶対 `CALL`/`JP`（`HIMEM` 直下配置なので再配置表で解決）、`!` 単精度変数参照 | inline ASM の既知制約。TODO の FAST 拡張要望「absolute CALL/JP to labels」と一致 | M |
| 構造化 ASM | `REPEAT n … END`、レジスタ別名、`COPY src,dst,len` 等の名前付きイディオム | `TODO.md` の「Structured ASM（#3）」を言語仕様として具体化。`z80asm.ts` の前段プリプロセスで実装 | M |
| `FORMAT$` マクロ群 | `FORMAT$(値, 桁, 埋め文字)` を標準 `INCLUDE` に | スコア表示の `RIGHT$("0000"+STR$())` 定型 | S |
| `DEBUG … END DEBUG` | デバッグビルドでのみ残るブロック（提案 5 の `WATCH`/`ASSERT` の一般形） | 提案 5 | S |

---

## 8. `lib/game.msxb`（汎用ゲーム基盤ライブラリ）

### 目的
FAST（ASM バッチ）と MSX2 ヘルパ（SCREEN 5）の間を埋める、機種非依存の「毎回書く層」。README ロードマップ「サウンドのヘルパ」「MSX2 グラフィックのヘルパ」の PSG/入力側を担う。

### 現状との接点
`M2_WAIT`、`M2_SE`、BGM feeder、データファイル `APPEND`、`STICK`/`STRIG`/`INKEY$`、TODO の「BASIC 双子」方針。

### 仕様案（`G_` 接頭辞、`GLOBAL` は最小限）

| 機能 | API | 内容 |
|---|---|---|
| 入力統合 | `G_INPUT()` → `GDIR%`, `GBTN%`, `GBTN_EDGE%` | `STICK(0)`/`STICK(1)` とカーソル/スペースを統合、押下エッジ検出 |
| フレーム待ち | `G_SYNC(N%)` | `JIFFY` ベース。`M2_WAIT` と統合 |
| シーン遷移 | `G_SCENE%` ＋ `SELECT CASE` 雛形 | TODO の `ENUM` 実装後に `ENUM` 版へ |
| ハイスコア | `G_HISCORE_LOAD("HISCORE.DAT")` / `G_HISCORE_SAVE()` | データファイル経路。ファイル無しは `ON ERROR GOTO <FUNCTION>` で 0 初期化 |
| 固定小数点 | `MACRO FX_MUL(A,B)`, `FX_TOI(A)` | 8.8 形式を `%` で。オーバーフロー範囲を明記 |
| 乱数 | `G_RND(N%)` | `TABLE RND_T%` を回すか LCG を `%` 演算で |
| タイマ | `G_TIMER_SET(ID%,N%)` / `G_TIMER_DONE(ID%)` | 複数カウントダウン |

### 実装段階
- **段階0**: 入力統合・フレーム待ち・固定小数点。`examples/starters/shooter-nofast.msxb` を書き換えて検証。
- **段階1**: ハイスコア・タイマ・乱数。コスト解析にライブラリ関数の較正値を登録。

### 制約・リスク
`GLOBAL` の増加は 2 文字名プールを消費する。ライブラリの使用名数を `docs` に明記。turbo R の `_TURBO` 下のフレーム待ちは実測確認。

### 規模感: S / S

---

## 9. トークナイザと `.rom` エクスポート

### 目的
作ったゲームをカートリッジ形式・配布形式で出す。`.dsk`/`.sav` に続く出力先。トークナイザ単体でも `.dsk`/`.sav` の読み込みが速くなる。

### 現状との接点
`.dsk` 書き出し（FAT12）、`sav.rs`（現状 ASCII）、`.BIN` 同梱、機種フラグ付き組込み表（`builtins.ts`）。

### 仕様案
- **段階0: MSX-BASIC トークナイザ**（TS、依存ゼロ）。機種別の拡張トークンは `builtins.ts` の機種フラグを再利用。`.dsk`/`.sav` の書き出しオプション「トークン形式で保存」。
- **段階1: BASIC-in-ROM**。ROM ヘッダ（`AB` ＋ TEXT ポインタ）の後ろにトークン済み BASIC を置く 16/32KB `.rom`。openMSX の `-cart` で検証（提案 5 の接続層を流用）。
- **段階2: 外部コンパイラ連携**。MSXBAS2ROM 等が導入済みなら呼ぶ（同梱しない）。`TODO.md` の BACON 評価（「隠す」ので主経路にしない）と同じ位置づけ＝任意の逃げ道。
- 出力前診断: ROM 上で不可な操作、ページ 3 の RAM 消費（提案 11 と連携）、`.BIN` 同梱可否。

### 制約・リスク
BASIC-in-ROM の制約（RAM はページ 3 のみ、一部命令の挙動差）は実機/openMSX で要検証。方式は BASIC ROM を参照しないので法的懸念は増えない。

### 規模感: M / M / S

---

## 10'. `TASK` — コルーチン風ふるまい記述（v1 の 10 を差し替え）

### 目的
敵 AI・ボスの行動パターン・デモ/演出の進行は、BASIC では「状態変数＋巨大 `IF` 連鎖」で書くしかなく、ゲームで最も読みにくくなる部分。これを「上から順に書く」記法にし、ゼロコストで状態機械へ降下する。

### 現状との接点
`SELECT CASE`（`lower-select.ts`）、STRUCT（struct-of-arrays）、`EVENT TIMER`（協調割込）、TODO の `ENUM`、`FAST_MOVEV`（per-object 速度）。

### 仕様案

```basic
TASK ENEMY_PATROL(REF E AS ENEMY)
  MOVE_TO(E, 200, 50)
  WAIT 30
  FOR K = 1 TO 3
    FIRE(E)
    WAIT 10
  NEXT K
  RESTART
END TASK

' メインループ
FOR I = 0 TO 7
  RUN_TASK ENEMY_PATROL, FOE(I)
NEXT I
```

- `WAIT n` と `YIELD` が「ここで 1 フレーム返す」区切り。トランスパイラは `WAIT`/`YIELD` 位置で本体を**状態番号に分割**し、`SELECT CASE E.PC%` の各 `CASE` へ降下する（`PC%` と `WAIT%` の 2 フィールドを STRUCT に自動追加。STRUCT 以外は `%` 配列を暗黙に持つ）。
- `FOR` を跨ぐ `WAIT` は、ループ変数を STRUCT フィールドへ退避する（ローカルは持てないので**明示的に「TASK 内ローカルは STRUCT フィールドか GLOBAL」**という制約にする。診断で誘導）。
- `RESTART`（先頭へ）、`STOP TASK`（休眠）、`GOTO STATE name`（ラベル付き状態へ）。
- 各エンティティ毎の実行は `RUN_TASK`（`GOSUB` 1 回＋`SELECT CASE`）。実行時コストは手書きの状態機械と同じ。
- 変換テーブルに「状態番号 ↔ ソース行」を載せる（提案 5 の現在行表示と繋がる）。

### 実装段階
- **段階0**: `WAIT`/`YIELD`/`RESTART` のみ、`FOR` 跨ぎ禁止（診断）。`lower-task.ts`。
- **段階1**: `FOR` 跨ぎ（ループ変数のフィールド退避）、`GOTO STATE`。
- **段階2**: 複数 TASK の同一エンティティ実行（並列ふるまい）。

### 制約・リスク
- 「状態機械に降下する」ことを**隠さない**（FAST と同じ）: 変換後 MSX-BASIC は `SELECT CASE` 相当の `IF` 連鎖として素直に読める。`docs/00` に「TASK は SELECT CASE の書き換え」と明記。
- 再帰的な TASK 呼び出しは不可（診断）。
- `WAIT` の単位は `RUN_TASK` の呼び出し回数（＝フレーム）。`EVENT TIMER` からは呼ばない前提（協調割込との二重駆動を防ぐ診断）。

### 規模感: M / M / S

---

## 11. メモリ予算解析（静的 RAM 見積り）— 新規

### 目的
コスト解析は「速度」を無実行で見積もる。同じ発想で「容量」を見積もり、`Out of memory` を実行前に潰す。`TODO.md` P2 の「生成サイズ／行予算インジケータ」を、行数から **RAM 全体**へ拡張する。

### 現状との接点
`cost.ts`（静的解析の枠組み・DCE/到達性）、`maptable.ts`、`DATASET`、inline ASM の `HIMEM` 直下バッファ、`.BIN` 同梱、`CLEAR` パススルー。

### 仕様案（*Run→Memory budget*）
機種ごとの BASIC 空き RAM（MSX1 ROM-BASIC 起動時の `FRE(0)` 相当をテーブル化。実機較正値を持つ）から、以下を引いて残量を表示する。

| 項目 | 見積り方法 |
|---|---|
| プログラム本体 | トークン化後サイズ（提案 9 のトークナイザ。無い間は ASCII 長×係数で近似） |
| 単純変数 | 型別のエントリサイズ × `.map.json` の変数数 |
| 配列 | `DIM` の定数サイズ × 要素サイズ（可変 `DIM` は「不明」として下限表示） |
| 文字列領域 | `CLEAR` 指定値（無ければ既定 200） |
| `DATA` | `DATASET` と生 `DATA` のバイト数（RAM 常駐） |
| ASM バッファ | inline ASM の機械語長 ＋ `CLEAR ,HIMEM` 分 |
| `BLOAD` 領域 | 同梱 `.BIN` のヘッダから開始/終了アドレス |
| 再帰スタック | ソフトスタックの `DIM` サイズ |

- 出力は text/JSON（コスト解析と同形式）。しきい値超過は Problems パネルに警告。
- ヒント: 「`DATASET X` は `AS DATAFILE` にすると n バイト空く」「`TABLE Y` は `AS BIN` へ」のように、提案 1/6 の生成先切替を勧める。
- 提案 9 の ROM 出力では「ページ 3 の 16KB」を上限にした表示へ切り替える。

### 実装段階
- **段階0**: 配列・`DATA`・ASM・`.BIN` の合計と機種別上限（ASCII 近似）。
- **段階1**: トークナイザ連携で本体サイズを正確化、Problems 連携、ヒント。

### 制約・リスク
- 文字列の動的確保（`A$=A$+…`）はガベージコレクションに依存し静的に見積もれない。`CLEAR` の指定値を「上限」として扱い、超過は実行時警告に委ねると明記。
- 実行時の `DIM` 可変サイズは「不明」表示。

### 規模感: S / M

---

## 12. `TEST` ブロック ＋ 内蔵ミニ BASIC インタプリタ — 新規

### 目的
ROM もエミュレータも要らない**ロジック検証**。当たり判定・スコア計算・文字列処理のような「画面に依存しない FUNCTION」を、エディタ内で即座にテストする。トランスパイラの回帰テスト（`test/examples.test.ts` はゴールデン出力の文字列比較）を、**生成コードを実際に実行する**検証へ一段上げる。

### 現状との接点
`test/` の Node テスト、`renderMsx`、`.map.json`、逆変換（`reverse/`）の実世界コーパス、`error-estimate.ts`（実行時エラー行の推定）。

### 仕様案

```basic
TEST "collision detects overlap"
  ASSERT HIT(10,10,8,8, 12,12,8,8) = -1
  ASSERT HIT(10,10,8,8, 30,30,8,8) = 0
END TEST
```

- `TEST … END TEST` はリリースビルドでは削除。デバッグビルドでは通常の BASIC として残る（実機でも動く）。
- **内蔵ミニインタプリタ**（TS、依存ゼロ）: 生成後の MSX-BASIC の**サブセット**を実行する。対象は数値/文字列演算、変数・配列、`IF/FOR/WHILE/GOSUB/RETURN/ON…GOSUB`、`DATA/READ/RESTORE`、文字列関数、`PRINT`（ログへ）。VDP/PSG/入力（`SCREEN`/`PUT SPRITE`/`SOUND`/`STICK` 等）は**明示的に非対応**とし、テストがそれに触れたら「このテストはエミュレータで」と診断。
- 実行は変換後コードに対して行う（構造化ソースを直接実行しない）。これにより 2 文字名割当・`GOSUB` 展開・再帰スタック・255 バイト分割までを検証対象にできる。
- 結果はテストパネルに一覧、失敗は `.map.json` で構造化行へジャンプ。
- 数値は MSX 単精度/倍精度の丸めを**再現しない**（JS double）。`%` 整数演算のオーバーフロー（32767 超）と `\`/`MOD` の切り捨てだけは MSX と同じにする。

### 実装段階
- **段階0**: インタプリタ本体（整数・文字列・制御・配列・`DATA`）と `TEST` 構文。`examples/cookbook/{math,string,data-vars}.msxb` を通す。
- **段階1**: `npm test` からも呼べるようにし、`examples/` の非グラフィック関数を実行検証。テストパネル。
- **段階2**: `INPUT`/`INKEY$` のスクリプト化（テストから入力列を与える）。

### 制約・リスク
- **BASIC ROM を再実装するものではない**。パーサ＋数値/文字列のみで、機種依存の意味論（VDP 等）は持たない。「実機と同じ動作を保証しない・ロジックの検証用」と明記。
- 単精度の丸め差で通る/落ちるテストが出うる。既定で `%`/`$` のみ厳密比較、`!`/`#` は許容誤差付き比較にする。
- 実装規模は大きめだが、`reverse/basic-reader.ts` に MSX-BASIC の読み取り器が既にあるので、式評価と文実行を足す形。

### 規模感: M / M / S

---

## 13. 優先順位とロードマップ案

### 判断
- **最も「ゲームが楽になる」**: 1（TILEMAP）、6（TABLE）、8（game ライブラリ）、10'（TASK）。
- **このツールにしか作れない**: 5（変数インスペクタ／実測プロファイラ）、12（`TEST`＋ミニインタプリタ）。どちらも ROM を扱わない。
- **既存計画の延長で小さい**: 3（TODO のプレビュー計画に記法を足す）、11（TODO の行予算指標を RAM 全体へ）、7 の `FORMAT$`/`DEBUG`。
- **GUI（2, 3-段階2, 4c, 1-段階2）** はテキスト記法が固まってから。

### 段階案

| フェーズ | 内容 | 狙い |
|---|---|---|
| **P1（言語の足場）** | 6 `TABLE`-段階0、5-段階0（`WATCH`/`ASSERT`、TODO の `ASSERT` を吸収）、7 `FORMAT$`/`DEBUG`、11-段階0 | 例題が書きやすくなる小物。TODO P1 の `ENUM`/`+=` と同時期 |
| **P2（ゲーム基盤）** | 1 `TILEMAP`-段階0/1、8 game ライブラリ、10' `TASK`-段階0、4a | Scroll Runner / Space Shooter を新機能で書き直して効果を示す |
| **P3（差別化）** | 5-段階1（openMSX 接続＝README の Tcl 計画を包含）、12-段階0/1、9-段階0（トークナイザ） | 「長名で見えるデバッガ」「ROM 不要のテスト」を看板に |
| **P4（アセット GUI）** | 2、3-段階1/2、1-段階2、4b/4c | テキスト記法の上に GUI |
| **P5（配布）** | 9-段階1/2（`.rom`）、11-段階1 | 需要を見て |

### 全提案に共通する約束
- 新構文は**リリースビルドで実行時コストを足さない**（`DATASET`/`CONST`/`MACRO`/`SELECT CASE` への降下、またはデバッグ限定）。降下結果は変換テーブルに載せ、隠さない。
- GUI は**テキスト記法の往復編集器**。GUI 固有の保存形式を持たない。
- 外部ツール（openMSX、MSXBAS2ROM）は**同梱せず、あれば使う**。BIOS/BASIC ROM は扱わない。
- 追加の診断は**編集時**に出す。

---

## 付録 A: 既知制約（FEATURES.md §9）との対応

| 既知制約 | 提案 |
|---|---|
| MML 経路で FM 未対応 | 4a（作曲用途。再現は BIN+ASM のまま） |
| 真のポルタメントは PSG レジスタ経路 | 4b（`SFX_DROP` の一般化） |
| データファイルはテキスト/SJIS のみ | 2、6 `AS BIN` |
| inline ASM: `%` のみ・絶対 `CALL/JP` 未対応 | 7 |
| STRUCT レコード丸ごと渡し未対応 | 7 |
| アプリ内 WebMSX の FM 無音・RAM 不可視 | 5（openMSX 接続で回避、WebMSX は据え置き） |

## 付録 B: `TODO.md` 既出項目との関係

| TODO 項目 | 本書 |
|---|---|
| `ASSERT` (P2) | 5-段階0 に吸収 |
| `ENUM` (P1) | 8・10' が利用側。提案はしない |
| SPRITE ライブプレビュー (P1) | 3 が記法を足す |
| 生成サイズ/行予算 (P2) | 11 が RAM 全体へ拡張 |
| openMSX 起動＋Tcl RUN (README) | 5-段階1 が包含 |
| Structured ASM / absolute CALL/JP | 7 |
| 同一オリジン WebMSX（保留） | 推さない（5 で不要化） |
| BACON 全体コンパイル（保留） | 9-段階2 と同じ「任意の逃げ道」の位置づけ |
