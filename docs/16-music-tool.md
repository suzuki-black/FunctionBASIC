# 16. 音楽ツール（MML方言 ⇄ 読みやすい PLAY 文）

音符を「読みやすい `PLAY` 文（構造化BASIC）」として書き出し、逆に既存の `PLAY` 文から音符へ戻す
（デコンパイル）ためのツール群。**中間フォーマット＝MML方言**、**整形（読みやすいPLAY化）＝FunctionBASIC 側**
が持つ（単一の正）。CLI ファースト（stdin/stdout フィルタ）でエコシステム連携する。

- 共有コア: `src/music/mml.ts`（音符列 `Song` ⇄ MML方言 ⇄ PLAY文。パーサ非依存の純粋処理）
- デコンパイル: `src/music/decompile.ts`（`.msxb` を parse して `PLAY` 文字列を抽出）
- CLI: `music.mjs`
- テスト: `test/music.test.ts`
- GUI（ピアノロール）: `editor/mml-piano.html`（`editor/core/music/mml.js` を import してコア再利用）

## MSX MML 仕様（対応サブセット・一次資料）

`O`=1..8（既定4）／`>`上げ `<`下げ／`L`=1..64（既定4）＋付点`.`／`T`=32..255（既定120）／
`V`=0..15（既定8）／`R`=休符／音名 `A`–`G` ＋ `#`/`+`（♯）`-`（♭）／3声 `PLAY a$,b$,c$`。
`S`（エンベロープ形）`M`（周期）`Q`（ゲート）`N`（音番号）はサブセット外＝**保持（パススルー）＋警告**。
出典: msxitalia lezione-21 / VGMPF Microsoft BASIC MML / MSX-AUDIO Extended BASIC。

## 中間フォーマット（MML方言）

```
; コメント行（メタ）
@tempo 120
@timesig 4/4
@ch A melody          ← チャンネル名（メタ。PLAY出力ではコメントへ）
@ch B bass
A: O4 L8 CDEF GAB>C | O5 CDEFGABC     ← '|' は小節区切り（メタ・可読用）
B: O2 L2 CG | FG
```

- `X:` の中身は**本物の MSX MML**。`;` `@…` `|` ラベルはこの方言の「外皮」で、PLAY 出力時に剥がす。
- 同一チャンネルの行は複数書いて連結できる（長い曲）。

## 生成する「読みやすい PLAY 文」

```basic
' ========================================================
'  BGM: BGM_MAIN  (PSG 2ch)   ※music tool 生成 / 再編集は tool 推奨
' ========================================================
FUNCTION BGM_MAIN()
    PLAY "T120", "T120"
    ' -- 小節1 --   [A]melody [B]bass
    PLAY "L8O4CDEFGAB>C", "L2O2CG"
    ' -- 小節2 --
    PLAY "L8O5C<BAGFEDC", "L2O2FG"
END FUNCTION
```

整形規則：**1小節=1 PLAY文＋小節コメント**／短い ch は休符で埋め**3ch等長**（再生同期を保証）／
**`O`・`L` は小節頭で明示**（実機の状態持ち越し差に依存しない・往復が曖昧にならない）／`T` は先頭で設定。
`--min-state` で「`O`/`L` を変化時のみ出力」の圧縮版。

## CLI

```
# import: 中間MML → 読みやすいPLAY .msxb（既定 FUNCTION 名 BGM_MAIN）
node --experimental-strip-types music.mjs import [song.mml] [--func NAME] [--min-state] > bgm.msxb

# export（デコンパイル）: .msxb の PLAY → 中間MML
node --experimental-strip-types music.mjs export <file.msxb> [--func NAME] > song.mml

# roundtrip: 往復一致の自己検証（song → PLAY → song' の MML 正規形比較）
node --experimental-strip-types music.mjs roundtrip <file.msxb> [--func NAME]
```

入力ファイル省略時は標準入力。既定出力は標準出力（`mtool | music.mjs import > bgm.msxb` のように使う）。
`--func` 未指定の export は「`PLAY` を含む最初の関数」→無ければトップレベルを対象にする。

## 往復の保証と非対応

- **可逆（v1サブセット：音程／音長／休符／テンポ／音量／オクターブ）**：`Song→PLAY→Song`・`Song→MML→Song` は無損失。
- `S`/`M`/`Q`/`N` 等サブセット外トークン＝デコンパイル時は **`ctrl` として保持（そのまま再出力）＋警告**。
- 非リテラルな `PLAY A$`（変数・実行時連結）＝該当 ch を**スキップ＋警告**（安全側）。
- 内部解像度 `PPQ=48`（付点・3連まで表現）。エディタのグリッドは MML で表せる音長に制限する想定。
- 音符が小節境界をまたぐ場合は分割（発音が切れる）＋警告。ツール側のグリッドで回避する。

## 実機ランタイムの使い分け

生成 `FUNCTION`（既定の inline）は **ジングル／効果音**（呼べば鳴る）に向く。**プレイ中の常時BGM**は
`--player feeder` で**非ブロックのフィーダ**を生成する。

### `--player feeder`（プレイ中BGM）

```
node --experimental-strip-types music.mjs import song.mml --player feeder [--feed N] --func BGM > bgm.msxb
```

一次資料（[MSX Wiki PLAY()](https://www.msx.org/wiki/PLAY())）：MSX の `PLAY` は **1chあたり128バイトのキュー**へ
積み、**満杯だとブロック（空くまで待つ）**。`PLAY(n)` は**真偽値**（-1=再生中／0=停止）で残量は返せない。
よって定石＝**キューが空いた（`PLAY(0)=0`）時に次の数小節を積む**フィーダ。生成物は
`<prefix>_LOAD` / `_START` / `_TICK` / `_STOP`（`--func` が prefix。既定 `BGM`）と、小節ごとの MML を持つ
`DATASET <prefix>_DATA`。各小節の第1chに `T<tempo>` を埋めてテンポを確立する。

```basic
BGM_LOAD()            ' 起動時に1回（DATASETから小節配列へ読込）
BGM_START()           ' 再生開始
WHILE 1
    ' … ゲーム処理 …
    BGM_TICK()        ' 毎フレーム：PLAY(0)=0 なら次の BGM_FEED% 小節を積む（非ブロック）
    ' … 描画 …
WEND
' BGM_STOP() で停止（以後は積まない。現キューは鳴り切る）。ループ再生（末尾で index 0 へ）。
```

`BGM_FEED%`（1回の補充で積む小節数、既定2／`--feed`）を増やすと継ぎ目が減る（1chあたり合計 ~128B 未満に）。

## ピッチスライド（グライド／急降下SFX）

MSX の PLAY/MML に**ポルタメント命令は無い**（[msx.org](https://www.msx.org/forum/msx-talk/development/mml-ms-basic-in-machine-language)）。ので2方式で実現する。

- **方式A: グライド（音楽的スライド）** — 音符に `glideTo`（滑り先の音程）を付けると、出力時に
  `expandGlides()` が **半音刻みの高速ラン（`L64` 等の下降/上昇）** へ展開し、`PLAY`／フィーダにそのまま乗る。
  GUI では **Shift+ドラッグ**で滑り先を指定（ロールに斜線表示）。
- **方式B: 急降下SFX（本物のスイープ）** — `sfxSweepBasic(from, to)` が **PSG音程レジスタを直接スイープ**する
  `SFX_DROP()` を生成（`SOUND 7`=ミキサ / `SOUND 8+ch`=音量 / `FOR P=P0 TO P1`で `SOUND 0/1` に周期を書く）。
  一次資料: PSGクロック=1,789,772.5Hz、`period=clock/(16*freq)`（[PSG Registers](https://www.msx.org/wiki/PSG_Registers)）。
  落下・爆発の効果音向き。BGMが使っていない ch で呼ぶ。GUI は **「→ SFX(急降下)」**（グライド音符の音程を使用）。

## ピアノロール GUI（`editor/mml-piano.html`）

エディタの **実行 → 音楽ツール（ピアノロール）…** から開く（別ウィンドウ）。単体では `npm run serve` →
`http://localhost:8123/mml-piano.html`。3声（A/B/C）。テンポ/拍子/音長(既定長)/小節数を指定、Web Audio で試聴。

**操作（標準ピアノロール流）**: ドラッグで描画（長さ＝ドラッグ量・16分スナップ）／音符の右端ドラッグで長さ変更／
本体ドラッグで移動／**Shift+ドラッグでグライド**（滑り先を指定・斜線表示）／右クリックで削除。単クリックは直近の長さ。

**ボタン**: 「→ MML 書出／← MML 読込」／「→ PLAY文(.msxb)」（読みやすい `PLAY`）／
「→ BGM(feeder)」（プレイ中BGM）／「→ SFX(急降下)」（PSGスイープの急降下音）／「コピー」。

コアは CLI と同じ `mml.ts`（ブラウザ用に `build.mjs` が `editor/core/music/mml.js` へ型ストリップ）。
`editor/core/**` はビルド生成物（gitignore）なので、GUI 利用前に `node build.mjs` が必要。
橋渡し API: `songToNotes`（Song→絶対ノート）/ `notesToSong`（絶対ノート→Song）。

## 今後（Phase 3 以降）

- `--json`（リッチメタ・汎用ツール連携）／FM（MSX-MUSIC `@音色`・追加ch）／ループ点
- 音符ドラッグでの長さ変更・ノート移動などGUI操作の拡充
