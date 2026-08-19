# The FAST library — what it buys you (a racing-game case study)

*Japanese follows / 日本語は後半にあります → [日本語](#fastライブラリの有用性--レースゲームで測る)*

FunctionBASIC's default identity is **transparent, readable MSX-BASIC**. `FAST` is an
opt-in *escape hatch*: a small library of inline-Z80 helpers (`INCLUDE "lib/fast.msxb"`)
you can read and edit, for the moments a hot loop needs arcade speed. It is **not** a
per-command accelerator and it is not a hidden compiler — it is a handful of readable
batch primitives, plus the same inline-`ASM` mechanism they are built from.

The clearest way to feel what it buys is a **before/after of the very same game**: a
top-down car-dodging racer, written twice.

> **Status — v1, actively evolving.** The FAST library is at **version 1** and under active
> development; its API, names and conventions **will keep changing**. The intended workflow
> drives this: build a game in plain BASIC (portable across many MSX BASICs), and *only*
> when it's judged too slow reach for FAST — then fix and extend the library wherever it
> turns out to be missing pieces or under-specified. Expect signatures and coverage to
> shift between versions; pin to the `examples/lib/fast.msxb` you built against.

| | [`highway-nofast.msxb`](../examples/highway-nofast.msxb) | [`highway-fast.msxb`](../examples/highway-fast.msxb) |
|---|---|---|
| Library / ASM | none — pure interpreted BASIC | `INCLUDE "lib/fast.msxb"` + one inline-ASM hot loop |
| Car sprite | 1 plane (monochrome) | 2 planes stacked = tall, two-tone |
| Player motion | lane-to-lane (discrete) | pixel-smooth left/right |
| Car motion | big steps, 8–12 px/frame | pixel-smooth, 1–2 px/frame |
| Framerate feel | lower fps, kept lively by big steps | rock-steady 60 fps |
| Road | scrolls (one shared char pattern) | scrolls (in ASM, per frame) |
| Colour | 6 per-slot colours | per-car two-tone + white/cyan player |
| Deployed size | ~2.8 KB | ~13.8 KB |

Match the shared `CONST`s and it is the same game — only the *engine* differs.

## What pure BASIC can (and can't) do — the `nofast` build

Interpreted BASIC is slower than you'd like for action, but it is far from helpless. The
`nofast` build stays lively with a few cheap tricks, all still 100% BASIC:

- **Poke only what changed.** A falling car changes only its `Y`, so we `VPOKE` a single
  byte straight into the sprite attribute table (OAM) instead of calling `PUT SPRITE`.
- **Scroll the road for free.** Every lane marker shares one character code, so rewriting
  that character's 8-byte pattern once per frame scrolls the *entire* road at once
  (8 `VPOKE`s) — a big sense-of-speed win for almost no cost.
- **Colour costs nothing.** Each car's colour is set once when it spawns.

But there is a wall. At 60 fps you have ~16.6 ms per frame, and interpreted BASIC only
gets through a few hundred statements in that budget. Processing *each* sprite's move,
draw and collision as separate BASIC statements does not fit 60 fps once you have several
cars. So `nofast` makes a deliberate trade: it moves in **big discrete steps** (8–12 px)
to keep a *sense of speed* at a lower framerate. It's genuinely fun — but it's chunky, and
adding cars makes it heavier.

Pixel-smooth motion (1–2 px/frame) *requires* a real 60 fps. Pure BASIC can't get there.
That's the exact gap `FAST` fills.

## What FAST adds — in two levels

### Level 1 — batch primitives (drop-in)

The library's core idea: **do the per-sprite work for the whole array in one ASM pass**,
instead of one BASIC statement per sprite.

- `FAST_SPRITES(N)` — flush the whole sprite table (the `SPY%/SPX%/SPP%/SPC%` arrays) to
  OAM in a single VDP burst.
- `FAST_MOVEV(base, N, …)` — move every sprite by its own `SVX%/SVY%` velocity in one pass.
- `FAST_STREAM`, `FAST_TILES`, `FAST_COLLIDE`, … — more of the same shape.

These are ordinary `INCLUDE` calls. You keep writing BASIC for input, spawning and rules;
only the heavy, repetitive *move + draw many sprites* drops to ASM. This alone is enough
for the fixed-shooter A/B ([`shooter-nofast`](../examples/starters/shooter-nofast.msxb) vs
[`shooter-fast`](../examples/starters/shooter-fast.msxb)) to hold **many more enemies**
smoothly. Reach for Level 1 when your bottleneck is "too many sprites to move and draw in
BASIC," and you don't necessarily need 60 fps pixel motion.

### Level 2 — the whole hot loop in one ASM routine

Racing wants **pixel-smooth**, which means a genuine 60 fps — and here a subtler ceiling
appears. Even Level-1 primitives, called once per frame from BASIC, pay for it twice:
per-frame **BASIC dispatch**, and **per-`USR`-call overhead** (setting up `VARPTR`
operands, then `DEFUSR`/`USR`) on *each* call. With several such calls per frame, that
overhead alone can miss 60 fps.

The fix — and what [`highway-fast.msxb`](../examples/highway-fast.msxb) actually does — is
to fold the **entire per-frame loop into one inline-`ASM` routine** (`HWFRAME`): move,
draw-to-OAM, screen wrap / recycle, random lane pick, collision, *and* the road scroll,
all in a single pass, with the array `VARPTR` pointers **cached once at startup**. Per
frame, BASIC does only two cheap things: read input, and occasionally update the score.

The result is exactly the "impossible in pure BASIC" list: rock-steady 60 fps, pixel-smooth
cars **and** player, a fast-scrolling road, and two-plane two-tone colourful cars — on a
plain Z80.

Crucially, this is the **same** inline-`ASM` mechanism the FAST library itself is built
from (`ASM … END ASM`, `(NAME%)` `VARPTR`-patched operands, `DEFUSR`/`USR`). FAST gives you
the readable *batch* rung; when you need every last frame, you write a bespoke hot loop
with the very same tools. Nothing is hidden, and you can read every byte.

## Which rung to reach for

1. **Pure BASIC (`nofast`)** — the default. Readable, tiny (~2.8 KB), runs on any MSX, easy
   to edit. Choose it unless a hot loop is visibly straining.
2. **FAST batch primitives** — when you have many moving sprites and interpreted move+draw
   is the bottleneck. Drop-in; your program stays mostly BASIC.
3. **A full ASM hot loop** — only for the last mile: true 60 fps pixel-smooth action. One
   routine goes to ASM; everything else stays BASIC.

You climb the ladder only as far as the game actually needs.

## The recommended workflow

Prototype in **pure BASIC** (the `nofast` style) on a turbo R, staying within **MSX2**
features so the design is portable. Once it's fun, target **MSX2** (the largest installed
base) and fold the *proven* hot loop into FAST / ASM for the finish. That is exactly how
`highway-nofast` → `highway-fast` were built: same game, same spec, engine swapped only
where it earned its keep.

---

# FASTライブラリの有用性 — レースゲームで測る

FunctionBASIC の本分は**透明で読める MSX-BASIC** です。`FAST` はその上に載る**任意の
「逃げ道」**——読んで編集できるインライン Z80 ヘルパの小さなライブラリ
（`INCLUDE "lib/fast.msxb"`）で、ホットループにアーケード級の速度が要る場面のためのもの。
命令1つ1つを速くする魔法でも、隠れたコンパイラでもありません。**読めるバッチ命令**が数個と、
それらを組み上げているのと同じインライン `ASM` 機構、それだけです。

有用性を一番はっきり体で感じられるのは、**まったく同じゲームの before/after** です。
見下ろし型の車よけレースを、2通りに書きました。

> **状態 — v1、鋭意開発中。** FASTライブラリは**バージョン1**で、現在も活発に開発中です。
> API・名前・流儀は**今後どんどん変わります**。狙っているワークフローがそれを促します——まず
> 素のBASIC（多くのMSX BASICで動く移植性のある形）でゲームを作り、遅いと判断した**その時だけ**
> FASTに手を伸ばす。そこで足りない部品や甘い仕様が見つかった所を順次直し、拡張していきます。
> バージョン間で引数やカバー範囲が変わる前提で、作成時に使った `examples/lib/fast.msxb` に
> 固定して運用してください。

| | [`highway-nofast.msxb`](../examples/highway-nofast.msxb) | [`highway-fast.msxb`](../examples/highway-fast.msxb) |
|---|---|---|
| ライブラリ / ASM | なし — 純インタプリタBASIC | `INCLUDE "lib/fast.msxb"` ＋ 1本のインラインASMホットループ |
| 車のスプライト | 1枚（単色） | 2枚重ね＝背が高い2色 |
| 自機の移動 | レーン単位（離散） | ピクセル単位でぬるぬる |
| 車の移動 | 大きな飛び、8〜12px/フレーム | ピクセル単位、1〜2px/フレーム |
| フレームレート感 | 低fps・大きな飛びで勢いを出す | 安定60fps |
| 路面 | 流れる（共有文字のパターン） | 流れる（ASM・毎フレーム） |
| 色 | スロット別6色 | 車ごとの2色＋白/シアンの自機 |
| 変換後サイズ | 約2.8KB | 約13.8KB |

共有 `CONST` を揃えれば中身は同じゲーム——違うのは**エンジンだけ**です。

## 純BASICでできること・できないこと — `nofast` 版

アクションには遅いインタプリタBASICですが、無力とはほど遠い。`nofast` 版は**すべてBASICの
まま**、いくつかの安い工夫で十分に生き生き動きます。

- **変わった所だけ書く。** 落ちる車は `Y` しか変わらないので、`PUT SPRITE` を呼ばず、
  スプライト属性テーブル（OAM）へ1バイトだけ `VPOKE` 直書きする。
- **路面をタダで流す。** 全レーンマーカーが同じ文字コードを共有しているので、その文字の
  8バイトパターンを毎フレーム書き換えるだけで**路面全体がまとめて流れる**（8 `VPOKE`）。
  ほぼゼロコストで大きなスピード感が得られる。
- **色はタダ。** 各車の色は出現時に1回設定するだけ。

しかし壁があります。60fps では1フレーム約16.6ms、その中でインタプリタBASICが処理できるのは
数百文どまり。車が数台になると、**各スプライト**の移動・描画・当たりを別々のBASIC文として
回すやり方は60fpsに収まりません。だから `nofast` は割り切って、低いフレームレートでも
**勢い**が出るよう**大きく飛ばして**（8〜12px）動かします。これはこれで面白い——けれど
カクッと大きく、車を増やすほど重くなる。

ピクセル単位のぬるぬる（1〜2px/フレーム）には、本物の60fpsが**必要**。純BASICでは届かない。
その差を埋めるのが `FAST` です。

## FASTが足すもの — 2段階

### レベル1 — バッチ命令（そのまま差し込む）

ライブラリの核となる発想は、**スプライト1枚ごとにBASIC文を回すのではなく、配列全体ぶんの
per-sprite処理を1回のASMで片づける**こと。

- `FAST_SPRITES(N)` — スプライトテーブル全体（`SPY%/SPX%/SPP%/SPC%` 配列）を1回のVDP
  バーストで OAM へ一括転送。
- `FAST_MOVEV(base, N, …)` — 全スプライトを各自の `SVX%/SVY%` 速度で1回のパスで移動。
- `FAST_STREAM`・`FAST_TILES`・`FAST_COLLIDE` … も同じ形。

これらはただの `INCLUDE` 呼び出し。入力・出現・ルールはBASICのまま書き、重くて反復的な
**多数スプライトの移動＋描画**だけがASMに落ちます。これだけで固定画面シューターのA/B
（[`shooter-nofast`](../examples/starters/shooter-nofast.msxb) 対
[`shooter-fast`](../examples/starters/shooter-fast.msxb)）は**ずっと多くの敵**を滑らかに
出せます。「BASICで動かし描くにはスプライトが多すぎる」がボトルネックで、必ずしも60fpsの
ピクセル移動までは要らない——そんなときのレベル1です。

### レベル2 — ホットループを丸ごと1本のASMに

レースは**ピクセル単位のぬるぬる**＝本物の60fpsを欲しがります。ここでもう一段の天井が
現れる。レベル1の命令でさえ、毎フレームBASICから呼ぶと二重にコストを払う——毎フレームの
**BASICディスパッチ**と、呼び出し**ごと**の **`USR` 呼び出しオーバーヘッド**（`VARPTR`
オペランドの用意→`DEFUSR`/`USR`）です。1フレームに何度も呼ぶと、それだけで60fpsを外す。

その解決——そして [`highway-fast.msxb`](../examples/highway-fast.msxb) が実際にやっている
こと——は、**1フレーム分の処理を丸ごと1本のインライン `ASM`**（`HWFRAME`）に畳むこと。
移動・OAMへの描画・画面端の折返し/再利用・ランダムなレーン抽選・当たり判定・**路面
スクロールまで**を1パスで、しかも配列の `VARPTR` ポインタは**起動時に1回だけキャッシュ**。
毎フレームBASICがやるのは、入力を読むことと、たまにスコアを更新することだけ。

結果は、まさに「純BASICでは無理」の一覧そのもの：安定した60fps、ぬるぬる動く車**と**自機、
高速に流れる路面、2枚重ねの2色カラフルな車——素の Z80 で。

肝心なのは、これが FAST ライブラリ自身を組み上げているのと**同じ**インライン `ASM` 機構
（`ASM … END ASM`、`(NAME%)` の `VARPTR` パッチ済みオペランド、`DEFUSR`/`USR`）である点。
FAST は読める**バッチ**の段を用意し、最後の1フレームまで削りたくなったら、まったく同じ道具で
専用ホットループを書く。隠し事はなく、全バイトを読めます。

## どの段に手を伸ばすか

1. **純BASIC（`nofast`）** — 既定。読みやすく、小さく（約2.8KB）、どのMSXでも動き、編集も
   楽。ホットループが目に見えて苦しくない限りこれ。
2. **FASTバッチ命令** — 動くスプライトが多く、インタプリタの移動＋描画がボトルネックのとき。
   差し込むだけで、プログラムはほぼBASICのまま。
3. **ホットループ丸ごとASM** — 最後の1マイルだけ：本物の60fpsぬるぬるアクション。1本の
   ルーチンだけASM、あとは全部BASIC。

ゲームが実際に必要とする段までしか、はしごを登らない。

## おすすめのワークフロー

まず turbo R 上で、`nofast` の流儀の**純BASIC**でプロトタイプする。ただし機能は **MSX2** の
範囲に留め、移植性を保つ。面白くなったら本命の **MSX2**（最大の母数）を狙い、**実証済みの**
ホットループだけを FAST / ASM に畳んで仕上げる。`highway-nofast` → `highway-fast` は
まさにこの手順で作りました：同じゲーム・同じ仕様、割に合う所だけエンジンを差し替えた、という
わけです。
