# FunctionBASIC 機能一覧（v0.2.0 時点・詳細版）

構造化BASIC → MSX-BASIC トランスパイラ ＋ Tauri デスクトップ / ブラウザエディタ。
本書は「次に何を作るか」を別AIと相談するための**現状の機能棚卸し**。実装済み＝◯、部分/制約付き＝△、非対応/意図的除外＝✕。

- 実装言語: TypeScript を `node --experimental-strip-types` で直接実行（**依存ゼロ方針**）。デスクトップは Tauri v2（Rust）。
- 配布: macOS(Apple Silicon) `.dmg` / Windows(x64) `.msi`/`.exe`。ブラウザ版は `npm run serve`（port 8123）。
- 既定ターゲット機種: **turbo R（MSX-BASIC 4.0）**。MSX1 / MSX2 / MSX2+ / turbo R を選択可。
- 出力は **Shift-JIS**（表現不能文字は破損させず診断）。1行255バイト制限は自動分割。

---

## 1. 言語機能（構造化BASIC）

### 1.1 制御構造・関数
- ◯ **`FUNCTION`**：トップレベル名前付き関数。ローカル変数を持ち、呼び出しは自動で `GOSUB` 化。戻り値 `RETURN [値]`。値を返す関数は型サフィックス付き名（`FN%()` `FN$()` 等）。
- ◯ **`REF` 引数**：真の参照渡し（配列・文字列配列も可）。同一配列は1ブロック共有、異なる配列渡しはモノモーフィック複製（呼び出し毎コピー無し）。
- ◯ **入れ子ブロック** `IF / FOR / WHILE / DO`：自由にネスト可。`BREAK` / `CONTINUE`。
  - `IF … ELSEIF … ELSE … END IF`（多分岐）。**単行 `IF … THEN 文` は非対応**（ブロック形式必須）。
  - `FOR … NEXT`（`STEP` 可）。**空範囲(開始>終了)でも本体を1回実行する MSX 仕様を継承**＝空になり得るループはガード必須。
  - `WHILE … WEND`（前判定）。
  - `DO [WHILE|UNTIL c] … LOOP [WHILE|UNTIL c]`（前判定 / 後判定(≥1回) / 無限）。
- ◯ **`MACRO NAME(args) = expr`**：コンパイル時インライン展開（`GOSUB` オーバーヘッド無し）。引数は括弧で包んで展開（優先順位事故なし）。再帰/引数不一致/重複はエラー。
- ◯ **ローカル既定・`GLOBAL` で共有**：変数は既定ローカル、`GLOBAL` 宣言で共有。
- ◯ **長い可読名**：`PLAYER_SCORE` 等を一意な2文字MSX名へ割当（MSXは先頭2文字しか区別しない制約を吸収）。
- ◯ **`CONST`**：コンパイル時定数（畳み込み・リテラル埋め込み、再代入エラー、型サフィックス検証、STRICT下は型必須）。
- ◯ **再帰**：自己・相互再帰に対応（ソフトウェアスタックで自動フレーム退避/復元、深さ設定可。再帰関数内の `REF` 引数は誤変換せず報告）。
  - ※注: 探索アルゴリズム等で**明示スタック反復**に書き換える設計もよく使う（速度・確実性のため）。言語としては再帰可。
- △ **`STRICT`**：オプトインの静的型検査（後述 1.4）。
- △ **`OPTION EXPLICIT`**：未宣言変数読みの検出（後述 1.5）。

### 1.2 ゲームBASIC構文（高水準・ほぼゼロランタイムコストで生MSX-BASICへ降下）
- ◯ **`SELECT CASE`**：多分岐（値 / リスト `CASE 6,7,8` / 範囲 `CASE lo TO hi` / 関係 `CASE IS < 0` / `CASE ELSE`、文字列可）。セレクタは1回だけ評価しキャッシュIF連鎖へ。
- ◯ **`STRUCT` ＋ `DIM a(n) AS T`**：レコード宣言＋ドット表記。**struct-of-arrays**（フィールド毎の並列MSX配列）へ降下＝手書き並列配列と同コスト。`GLOBAL` で全フィールド共有。(v1: フラットフィールド、レコード丸ごと渡しは未対応)
- ◯ **`DATASET name … END DATASET` ＋ `READ name INTO …`**：不透明な `READ`/`DATA`/`RESTORE` ポインタを名前付きデータブロックへ。v1はメモリ最適な戦略A（追加RAM 0、ブロック切替で自動 `RESTORE`）。`RESTORE name` で巻き戻し。
- ◯ **`SPRITE name … END SPRITE`**：`.`/`#` アートでハードスプライトを記述→コンパイル時に `SPRITE$(n)=CHR$(…)`（16×16の4象限並べ替えも自動）。名前=パターン番号定数。`SCREEN` は書き換えず、サイズ不一致は警告。
- ◯ **`EVENT TIMER n … END EVENT`**：`ON INTERVAL=n GOSUB` ＋ `INTERVAL ON` へ降下。1個・トップレベル限定・協調的割込（文境界で発火）。**`EVENT VBLANK` は意図的に非対応**（BASICインタプリタへ安全に再入不可）。

### 1.3 インライン Z80 アセンブリ
- ◯ **`ASM … END ASM`**：機械語へアセンブルし自動配線。`HIMEM` 直下のバッファに配置（実行時読込＝機種非依存・255バイト制限外）。`(NAME)` は `%` 整数BASIC変数を `VARPTR` オペランドパッチ参照（1回だけ適用）。ラベルは相対ジャンプ（`JR`/`DJNZ`）対応。`DEFUSR`/`USR` で実行。
- △ 制約: **`%` 整数変数のみ**、ラベルへの絶対 `CALL`/`JP` は未対応。

### 1.4 STRICT（オプトイン静的型）
- ◯ 先頭に `STRICT`。全変数/配列/引数/`FOR`変数/`CONST` に型サフィックス必須（`%`整数 `!`単精度 `#`倍精度 `$`文字列）。未型付き=エラー。
- ◯ 代入・引数・戻り値は**厳密一致**（暗黙変換なし）。変換は `CINT`/`CSNG`/`CDBL`/`INT`/`FIX`/`ASC`/`STR$`/`VAL` 等で明示。
- 既定オフ（既存コードは無影響、非strictでは MSX 通常の暗黙変換）。

### 1.5 OPTION EXPLICIT
- ◯ 先頭に `OPTION EXPLICIT`。**代入も宣言もされていない変数の読み**を検出（タイプミス検出）。スカラのみ。STRICT とは直交（型でなく未宣言読み）。

### 1.6 構造化BASICで使えないもの（明確なエラーで誘導）
行番号が無く変数を2文字名へ改名するため、以下は不可（代替あり）:
- ✕ 生 `GOTO`/`GOSUB <行>` → `FUNCTION`/`IF`/`FOR`/`WHILE`/`BREAK`/`CONTINUE`
- ✕ `ON x GOTO/GOSUB <行番号>` → `<FUNCTION名>`（ハンドラは無引数）
- ✕ `ON ERROR GOTO <行>` → `<FUNCTION>` か `ON ERROR GOTO 0`
- ✕ `RESUME <行>` → `RESUME` / `RESUME NEXT` / `RESUME 0`
- ✕ `RESTORE <行>` → 引数なし `RESTORE` か `RESTORE name`(DATASET)
- ✕ `DEFINT/DEFSNG/DEFDBL/DEFSTR` → 型サフィックス
- ✕ `DEF FN` / `DEF USR` → `FUNCTION`
- ✕ 直接/エディタ命令 `RUN LIST AUTO RENUM NEW CONT DELETE EDIT`
- ✕ 単行 `IF … THEN 文`（`END IF` 無し）→ ブロックIF

---

## 2. トランスパイラ / 出力

- ◯ **行番号割当**：MAIN=100から+10、各FUNCTIONは1000の倍数セグメント（1000,2000,…）。1関数が100行超なら次関数を次の1000の倍数へ押し出し衝突回避。
- ◯ **変数名の長さ拡張**：型別プール（`%`/`!`/`#`/`$` 各~960名、予約語除外）。非重複ローカルは名前再利用。枯渇は `E_VAR_NAMES_EXHAUSTED`。
- ◯ **関数展開**：`FUNCTION`→`GOSUB` ブロック。戻り値は専用内部変数経由。再帰はソフトスタックで退避/復元。
- ◯ **配列参照渡し**：同一配列は1ブロック共有（ゼロコピー）、異なる配列はブロック複製。
- ◯ **255バイト行の自動分割**：長い `DATA` 行も値/カンマ境界で安全分割（`READ` は平坦ストリームとして見るので値不変）。**行番号込みの生バイト長**で予算化（末尾切り捨て事故を防止）。
- ◯ **マルチファイル**：`INCLUDE` で分割。ビルド/実行は単一エントリ（自動判定 or 明示 main 指定）。ライブラリファイルは単独実行しない。リンカ無しのため全結合。
- △ **オプトイン最適化**（設定→Transpile、既定オフ・意味不変を保証）：定数畳み込み＋可換再結合、べき乗の強度低減（`X^2`→`X*X`）、ジャンプ安全なコメント除去、ホット関数配置（頻呼関数を低行番号へ＝`GOSUB` 探索短縮）。
- ◯ **安全な診断**：エラーはコード＋行/列、ガターマーカー表示。
- ◯ **対応組込み命令**（後述 8）を機種フラグ付きでパススルー。機種未対応命令は警告。

---

## 3. エディタ機能

### 3.1 プロジェクト / ファイル管理
- ◯ **プロジェクト＝フォルダ**（デスクトップ、JetBrains流）。Welcome（Open/New/Recent、行方不明時の recover）。切替時に未保存確認。`Cmd+O` フォルダ開く、`Cmd+S` 現ファイル即保存。
- ◯ **外部変更検出・整合**：他プロセス（AI/ git /別エディタ）の書換をネイティブ監視＋focus/save/run時チェックで検出。未編集なら自動リロード（トースト）、両方変更なら競合ダイアログ（disk置換/自分優先/差分表示）。保存時ガードで古いバッファの上書き防止。
- ◯ **INCLUDE 認識ツリー**：取り込みを入れ子表示。パスtooltip。*Reload from Disk*。
- ◯ **【v0.2.0】データファイル**：`.txt/.dat/.csv/.mml/.asc/.tab` をプロジェクトの一員として「データファイル」欄で追加/編集。変換対象外プレーンテキスト。`.dsk`/WebMSX へ **Shift-JIS＋CRLF＋EOF(0x1A)** で自動同梱（`DATA`=RAM を回避しディスクへ外出し、`OPEN…FOR INPUT`/`LINE INPUT#` で1行ずつ読める、`APPEND` 追記可）。編集はUTF-8、非SJIS文字は保存時拒否。当面テキスト/SJISのみ。
- ◯ **【v0.2.0】外す/削除の分離**（.msxb・データ共通）：**⏏ プロジェクトから外す**（ディスク実体は残す・除外リストで再読込復活を防止・元に戻せる）／**🗑 削除**（OSゴミ箱へ移動＝復元可・確認あり）。ブラウザ版はどちらもプロジェクト内除去のみ。
- ◯ **【v0.2.0】インライン名前変更**：名前ダブルクリック or ✎ でその場編集（Enter確定/Esc取消）。.msxb・データ共通。
- ◯ **【v0.2.0】エディタの独立タブ**：📄データ・📦ライブラリを「構造化BASIC」と常に併置（どのタブ表示中でも消えない）。✕ で閉じてもプロジェクトからは外さない。

### 3.2 変換の可視化・ナビゲーション
- ◯ **構造化⇔MSX-BASIC 行対応ハイライト**：分割ビューで一方のキャレット位置が他方の対応行を強調＋スクロール。無生成行はヘッダで通知。
- ◯ **変換テーブル（読み取り専用）**：長名→2文字名（グローバル/関数別ローカル）、各関数の入口行/引数(REF含む)/戻り変数、`BREAK`/`CONTINUE` 飛び先、`DATASET`/inline `ASM`/`SPRITE` の詳細。`.map.json` でコピー可。
- ◯ **Problems パネル**：全エントリの INCLUDE グラフをライブ検証。跨ファイルエラーを file:line＋ワンクリックジャンプ、欠落 INCLUDE の quick-fix、未使用 INCLUDE 警告。
- ◯ **クロスファイル・ナビ**：定義ジャンプ / 参照検索 / リネーム(プレビュー付) / INCLUDE 行ジャンプ(`Cmd+B`/Cmd-click) / INCLUDE パス補完。
- ◯ **エラー行ナビ**：*Edit→Next error line*（`Cmd/Ctrl+Shift+.`）で巡回。
- ◯ **エラー位置推定器**：MSX が誤った行に出す実行時エラー（例 Illegal function call）を、種別＋報告行から原因候補文/引数を列挙し元ソースへマップ（ヒューリスティック・非AI）。
- ◯ **コスト解析（静的プロファイラ）**：*Run→Cost analysis*。**実機較正した turbo-R(R800) 命令別コスト**で無実行見積り。毎フレーム経路をツリー表示、関数を self/inclusive でランク、ホットスポット(◆)・重命令(`RND`/`LINE…BF`/`PUT SPRITE`/GRP `PRINT`)フラグ、DCE/到達性考慮（未使用 INCLUDE 関数は非計上）。inline `ASM` は Z80 Tステート＋ループ検出で計上。text/JSON 出力。

### 3.3 編集支援・その他
- ◯ **Find/Replace** ＋ プロジェクト全体 "Find in Files"（JetBrains keymap・regex）＋ トークン認識の安全リネーム（`Shift+F6`）。
- ◯ **整形 Reformat**（`Cmd+Alt+L`）：唯一の正準スタイル（gofmt風）。ブロック構造で再インデント(4空白)、識別子大文字化、余分空白畳み。文字列/コメント/inline `ASM` 本体は不変。
- ◯ **編集支援**：オートインデント、括弧/引用符オートクローズ、現在行ハイライト、行移動/複製（各トグル可）、Undo/Redo、閉じられる分割タブ。
- ◯ **設定**：言語、フォントサイズ、WebMSX 実行機種 / `PRESETS` / URL。
- ◯ **ネイティブOSメニュー**、**日/英UI**、依存ゼロの軽量エディタ。

---

## 4. 実行・エクスポート

- ◯ **即時実行**：アプリ内 webMSX で1クリックロード＋`RUN`。
- ◯ **外部ブラウザで実行**：既定ブラウザで実行（FM/MSX-MUSIC が鳴る）。FMプログラム（`CALL MUSIC`/`PLAY #2`）は MSX2+ ＋ MSX-MUSIC 有効＋OPLL 音量上げで自動起動。
- ◯ **BLOAD 用バイナリ同梱**：`.BIN` を無加工で実行ペイロード/ディスクへ同梱。
- ◯ **【v0.2.0】データファイル同梱**（上記 3.1）。
- ◯ **実ディスク書出し**：720KB FAT12 `.dsk`（openMSX/実機）。
- ◯ **MSXPLAYer 書出し(`.sav`)**：仮想フロッピー（上書き前自動バックアップ）。
- △ **アプリ内 webMSX の制約**：埋め込みは別オリジンiframe＝**FM無音**（外部ブラウザ推奨）、**MSX-AUDIO非対応**、毎回リブート（Fast boot 設定あり）、機種は webMSX 既定（turbo R は⚙で切替）、音は要1クリック、巨大プログラムは autorun URL 超過（"URI Too Long" 時は `.dsk`）。**変換自体は無影響（生成MSX-BASICは正しい）**。実機/openMSX/MSXPen で音・状態正確。

---

## 5. 逆変換ツール
- ◯ **デコンパイラ**：任意の行番号付きMSX-BASIC→構造化BASIC（ブロック再構築、`GOSUB`→`FUNCTION`、`GOTO`ループ回復、`DEF FN`、イベントトラップ、変数名推論・警告付き）。実世界コーパスで**~95%が再変換クリーン**。*File→Import plain MSX-BASIC*。
- ◯ **逆トランスパイル**：自前出力を map 経由で構造化へ戻す（元のファイル分割も可能な範囲で復元）。
- ◯ **機械語注釈**：`DATA` 埋め込み Z80 機械語（`READ`→`POKE`→`USR` イディオム）を逆アセンブルしニーモニックコメント挿入。BIOS 名解決、制御フロー認識（データは `DB`）、`'@` マーカー（変換時に除去）。読み取り専用/ベストエフォート。

---

## 6. 音楽ツール（MML ⇄ 可読 `PLAY`）
- ◯ CLI `music.mjs`：音符→**可読な構造化BASIC `PLAY` 文**（1小節1行、`O`/`L` 明示、3声を等長パディング）。既存 `PLAY` の**デコンパイル**も。交換形式は MML 方言（`@tempo`/`@timesig`/`|`）。`import`/`export`/`roundtrip` を stdin/stdout でパイプ可能。
- ◯ **ピアノロールGUI**（*Run→Music tool*）：同一コアで Web Audio プレビュー。ディスク保存/読込(`.mml`)、一時保存＋閉じる確認、本体言語追従（v0.1.49）。
- ◯ **BGM feeder**（`--player feeder`）：非ブロッキング BGM（`LOAD`/`START`/`TICK`/`STOP`）でPSGキューを毎フレーム補充。
- △ **MML出力の限界**（MSX MML/PSG 由来）：最細 `L64`（3 tick, PPQ=48）、ポルタメント無し（グライドは高速半音ランで近似・真の連続掃引は PSGレジスタ `SFX_DROP` 経路が必要）、`<`/`>` 無し（常に `O<n>`）、オクターブ `O1`–`O8` にクランプ、PSG 3声のみ（FM未対応）。**音の長さは音程のために犠牲にしない**（グライドは総tick厳密保持＝3声同期）。

---

## 7. 同梱ライブラリ（`INCLUDE` で使用）

### 7.1 `lib/fast.msxb` — FAST ライブラリ（ゲーム向けバッチ高速化）
opt-in の逃げ道レイヤ。1:1命令置換でなく「1フレーム分の処理を丸ごと ASM に内包」し BASIC↔ASM 往復を毎フレーム1回に抑える。`%`整数配列を渡し ASM が内部で回す。
- ◯ `FAST_SPRITES(N%)`：全スプライト属性(Y/X/絵/色)を OAM(&H1B00) へ一括転送。呼ぶ前に `SPY%()/SPX%()/SPP%()/SPC%()` を埋める。
- ◯ `FAST_BIGSPRITES(BASE%,N%)`：32×32合成物体（4枚1組）を plane base から N個一括描画（大型敵/ボス/膨張）。
- ◯ `FAST_DRIFT(BASE%,N%,VX%,VY%,WRAPX%,WRAPY%)`：スプライト群を等速移動＋X/Y軸ごとにリングラップ。
- ◯ `FAST_MOVEV(BASE%,N%,WRAPX%,WRAPY%)`：各自の速度(`SVX%`/`SVY%`)で移動＋ラップ（per-object）。
- ◯ `FAST_MOVEDRAW(BASE%,N%,WRAPX%,WRAPY%)`：移動＋OAM描画を融合（SCREEN 指定に従う）。
- ◯ `FAST_STREAM(BASE%,N%,VX%,VY%,XMAX%,YMAX%,PARKY%)`：弾/粒子を active だけ流し画面外で自動 deactivate（生存数を返す）。
- ◯ `FAST_TILES(N%)`：背景タイル N個を(列/行/キャラ配列指定で)ネームテーブルへ一括転送。
- ◯ `FAST_TILEGRID(ROWS%,COLS%,PITCHX%)`：生存マスク配列を直接走査しタイル格子を一括描画（詰め替え不要・敵編隊/タイルマップ向け）。
- ◯ `FAST_COLLIDE(NS%,NE%)`：全弾×全敵の AABB 当たりを1回のASMで解決（命中数を返す）。
- ◯ `FAST_SPRITES5(N%)`：SCREEN 5(MSX2) 用スプライト属性一括転送。
- ◯ `FAST_MOVEDRAW5(BASE%,N%,WRAPX%,WRAPY%)`：SCREEN 5 の移動＋OAM(&H7600 / R#14)融合。
- 参考: `docs/fast-library.md` / `examples/lib/fast-guide.md`。要 MSX(VDP)。

### 7.2 `lib/msx2.msxb` — MSX2 ヘルパ（SCREEN 5）
間違えやすい所（SET PAGE 引数順・スプライトサイズ・空きチャンネルSE）を隠蔽。全て `M2_` 接頭辞、ページカウンタ `M2PG` 共有。要 MSX2 以降。
- ◯ `M2_INIT()`：SCREEN 5(256×212,16色)＋16×16スプライトで初期化。
- ◯ `M2_PAL(N,R,G,B)`：パレット N(0..15) を RGB(各0..7) に設定。
- ◯ `M2_DEFSPR(N)`：続く32 DATA バイトを16×16スプライトパターン N へ（呼び出し側で `RESTORE`）。
- ◯ `M2_SPR(PL,X,Y,C)`：plane PL を (X,Y) 色 C で表示（2枚重ねで2色スプライト）。
- ◯ `M2_FRAME()` / `M2_SHOW()`：ちらつき無し二重バッファ（`SET PAGE <display>,<draw>` の正しい順序）。ループ先頭で `M2_FRAME`（隠しページに描画）、描画後 `M2_SHOW`（表へ）。
- ◯ `M2_WAIT(N)`：システムクロックで N 割込(~N/60秒)待つ。
- ◯ `M2_SE(PERIOD)`：PSG ch C で短い効果音（A/B は音楽用に空ける）。

---

## 8. 対応 MSX-BASIC 組込み命令・関数（パススルー）
組込みは「そのまま出力」・ユーザ FUNCTION で再定義不可・大文字化対象。機種フラグ付き。設定画面から追加/編集/リセット可。主なカテゴリ:
- 制御: `IF THEN ELSE FOR TO STEP NEXT WHILE WEND GOTO GOSUB RETURN ON…GOTO/GOSUB STOP END`（構造化側はネイティブ、`GOTO/GOSUB` は生成用）
- 画面/IO: `PRINT PRINT USING INPUT LINE INPUT LOCATE CLS SCREEN COLOR WIDTH BEEP`／プリンタ `LPRINT LLIST` 等
- 図形: `PSET PRESET LINE(B/BF) CIRCLE PAINT COPY DRAW POINT PUT SPRITE COLOR SPRITE PUT KANJI COLOR=(…)/NEW`
- 音: `SOUND PLAY(文/関数) BEEP`
- メモリ/系: `PEEK POKE VPEEK VPOKE DEF USR CALL(_) OUT INP BASE VDP WAIT SET`
- ファイル: `OPEN CLOSE GET PUT FILES LOAD SAVE MERGE BLOAD BSAVE MAXFILES KILL NAME…AS FIELD…AS LSET RSET`
- 文字列関数: `LEFT$ RIGHT$ MID$ CHR$ ASC LEN VAL STR$ HEX$ OCT$ BIN$ INSTR SPACE$ STRING$ INPUT$ INKEY$`
- 数学関数: `ABS INT SQR SIN COS TAN ATN LOG EXP RND SGN FIX`
- 型変換: `CINT CSNG CDBL CVI CVS CVD MKI$ MKS$ MKD$`
- ファイル/ディスク関数: `EOF LOC LOF FPOS LPOS DSKF DSKI$`
- 入力/特殊: `STICK STRIG PAD PDL POS CSRLIN VARPTR FRE TIME ERR ERL USR/USR0-9`
- データ: `DATA READ RESTORE`（`RESTORE <行>` 不可）
- 宣言: `DIM ERASE CLEAR LET SWAP`（`DEFxxx` 不可）
- 拡張: `CALL <名>` / `_<名>`（MSX-MUSIC=FM, MSX-AUDIO, 漢字BASIC 等・表に持たず素通し）、turbo R `_TURBO ON/OFF` `CALL PCMPLAY/PCMREC/PAUSE`、MSX2+ `SCREEN 10-12` `SET SCROLL`(turbo Rのみ)
- イベントトラップ: `ON SPRITE/KEY/INTERVAL/STRIG/STOP GOSUB <FUNCTION>`、`ON ERROR GOTO <FUNCTION>`、計算分岐 `ON <式> GOTO/GOSUB`

---

## 9. 既知の制約・非対応（次機能検討の入力に）
- MML/音楽: FM(OPLL)出力は MML 経路では未対応（BIN+ASM レジスタ再生 or feeder）。真ポルタメントは PSGレジスタ経路が要る。
- データファイル: 当面**テキスト/Shift-JISのみ**（バイナリ同梱データ、ランダムアクセスレコード等は未対応）。動的名 `OPEN A$` はエディタの静的収集外（プロジェクトの一員として置けば同梱される）。
- inline ASM: `%` 整数変数のみ・ラベルへの絶対 `CALL`/`JP` 未対応。
- STRUCT: v1 はフラットフィールド、レコード丸ごと渡し未対応。
- アプリ内 webMSX: FM 無音・MSX-AUDIO 非対応・毎回リブート（別オリジン制約）。
- 依存の既知advisory（tauri 経由 quick-xml の DoS 2件）はランタイム攻撃面外・別管理。

---

## 10. 参考（リポジトリ内資料）
- 設計docs: `docs/00`〜`16`（言語仕様/アーキ/字句解析/データモデル/変換/逆変換/エディタUI/ファイル保存/最適化/技術スタック/エディタ機能/組込み/スタイル/外部同期/コスト解析/音楽ツール）。
- ライブラリ詳細: `docs/fast-library.md`, `examples/lib/fast-guide.md`。
- 例: `examples/`（Space Shooter, Scroll Runner, cookbook 等）。
- CHANGELOG: `CHANGELOG.md`。
