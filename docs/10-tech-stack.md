# 10. 技術スタック / プラットフォーム構成

対応: 実装方針（クロスプラットフォーム・デスクトップ化、MSX再生連携）

---

## 10.1 方針

- **クロスプラットフォーム・デスクトップアプリ（Windows / macOS 両対応）** として実装する。
- フレームワークは **Tauri**（OS標準WebView＋Rust）を採用する（理由は §10.3）。
- 設計済みの **TypeScript コア**（Lexer / Parser / AST / Transformer / ReverseTransformer / Formatter /
  ErrorReporter）は **WebView 内でそのまま動作**し、**プラットフォーム非依存**とする。
- プラットフォーム依存は **「ファイルI/O」と「再生（MSXプレイヤー連携）」のみ**に閉じ込め、抽象化する。
- **公式MSXプレイヤー連携（方式A）はWindows専用**（実機相当プレイヤーがWindows版のみ）。
  Mac/共通では **WebMSX（方式B）** または **外部エミュレータ＋仮想FD（方式C／openMSXはMac対応）** を用いる。

---

## 10.2 レイヤと技術選定

| 領域 | 技術 | 対応OS | 備考 |
|------|------|--------|------|
| UIシェル | **Tauri**（Rust + システムWebView） | Win / Mac | Win=WebView2、Mac=WKWebView |
| エディタUI | TypeScript（+ 任意のUIライブラリ） | Win / Mac | WebView内で動作 |
| 変換コア | TypeScript（[01](01-language-spec.md)〜[06](06-reverse-transformer.md)） | Win / Mac | **プラットフォーム非依存・移植可能** |
| ファイルI/O | Tauri `fs` / `dialog`（Rustコマンド） | Win / Mac | `.msxb` / `.map.json` / `.bas` の保存（[08](08-file-save.md)） |
| 再生（プレイヤー） | PlayerProvider 抽象（§10.4） | 方式により異なる | ネイティブはWin専用、WebMSXは両対応 |

> **重要**：重いロジック（字句解析〜変換〜逆変換）はすべて TS のまま WebView 内で動く。
> Rust 側は「ファイル保存」「外部プレイヤー起動」程度の薄いグルーに限定するため、
> フレームワーク選定は後から覆しても低コスト（[README §8](README.md)）。

---

## 10.3 なぜ Tauri か（Electron 比較）

| | Electron | **Tauri（採用）** |
|---|---|---|
| 同梱物 | Chromium 丸ごと | OS標準WebView（追加同梱なし） |
| アプリサイズ | 150〜250MB | 3〜10MB |
| メモリ | 重い（Chromium常駐） | 軽い |
| ネイティブ連携 | Node で容易 | Rust の薄いコマンドで可能 |
| TSコア流用 | そのまま | そのまま（WebView内） |

- 採用理由：**軽量・低メモリ**、配布サイズが小さい、TSコアを無改変で流用できる、外部プロセス起動が可能。
- Electron の利点（全部JS／最短実装）は本プロジェクトでは決定打にならない（コアは既にTSで、ネイティブ連携は薄い）。

---

## 10.4 再生（プレイヤー）インタフェース — 3方式

再生手段は **PlayerProvider 抽象**で切り替える。3つの実装を用意する。**いずれもエミュレータ・ROMを同梱せず、
当方の配布物に著作権物を含まない**（取り下げた「WebMSX内蔵」方式とは異なる。§10.5）。

```ts
interface PlayerProvider {
  id: "native-win" | "webmsx-link" | "external-disk";
  label: string;
  platforms: Array<"win" | "mac">;     // 利用可能OS
  play(msxCode: string): Promise<void>;
}
```

| 方式 | id | 対応OS | 内容 | ROM | 当方の配布物 |
|------|----|--------|------|-----|--------------|
| **A. ネイティブMSXプレイヤー連携** | `native-win` | **Win専用** | ユーザ導入済みの公式MSXプレイヤーに `.bas` を渡して起動（Rustで外部プロセス起動） | プレイヤーが正規ROMを保持 | なし（起動のみ） |
| **B. WebMSXリンク＋コピペ** | `webmsx-link` | Win / Mac | WebMSX（既定 webmsx.org、**URLは設定変更可** §10.9）を既定ブラウザで開き、変換後コードをクリップボードへ。ユーザが貼り付け→`RUN` | WebMSX側／ユーザ環境 | **なし（リンク＋クリップボードのみ）** |
| **C. 外部エミュレータ＋仮想フロッピー(.dsk)** | `external-disk` | **Win / Mac** | 変換後 `.bas` を FAT12 の仮想フロッピーイメージ(.dsk)に書き込み、外部エミュレータ（**openMSX**=Win/Mac、blueMSX=Win）にマウントさせて起動・RUN | ユーザのエミュレータが保持 | **なし（.dsk生成＋外部起動のみ）** |

> 方式C は **openMSX が Win/Mac 対応**のため、**Macでもネイティブ実機相当の再生**が可能（方式Bのブラウザ依存を脱せる）。
> 当方はエミュレータもROMも配布せず、規格である FAT12 の `.dsk` を生成して外部エミュレータに渡すだけ。

### プラットフォーム別の既定

- **Windows**：A を既定、B・C も選択可。
- **macOS**：**C（openMSX）を既定**、B も選択可（A はネイティブMSXプレイヤーが無いため非表示）。

### Rust 側コマンド（例）

```rust
// A: 外部プレイヤー起動（Windows専用）
#[tauri::command]
fn launch_native_player(player_path: String, bas_path: String) -> Result<(), String> { /* Command::new(...).spawn() */ }

// B: 既定ブラウザでURLを開く（URLは設定値。クリップボードはフロント側で設定）
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> { /* opener */ }

// C: .dskへ書き込み → 外部エミュレータをマウント起動
#[tauri::command]
fn write_dsk_and_launch(emu_path: String, emu_kind: String, dsk_path: String, bas_text: String)
  -> Result<(), String> { /* FAT12生成→.bas書込→openmsx -diska 等で起動 */ }
```

---

## 10.5 著作権・ライセンス上の整理（重要）

> 本節は技術的事実に基づく整理であり、**法的助言ではない**。配布前に各ライセンス・ROMの取り扱いを必ず確認すること。

- **MSXシステムROM（BIOS / MSX-BASIC ROM）は著作物**であり、**アプリに同梱して配布しない**ことを鉄則とする。
  - 無償の **C-BIOS** には **MSX-BASIC が含まれず**、本システムの出力（BASIC）は動かないため、C-BIOS同梱は採用しない。
- **方式A**：公式MSXプレイヤーが**正規ライセンスのROMを保持**（ユーザが導入済み）。当方は起動するだけ。
- **方式B**：**ROMもエミュレータも配布せず**、外部公開サービス（webmsx.org）への**リンク＋クリップボード**のみ。
  当方の配布物に著作権物を含まないため、ライセンス上もっとも安全。
- **方式C**：**エミュレータ（openMSX/blueMSX）もROMも配布しない**。ユーザが自身でエミュレータを導入し、ROMを用意する
  （openMSX/blueMSX 標準の運用と同じ）。当方が生成する `.dsk` は **FAT12 という公開規格**であり著作物ではない。
  → 当方の配布物に著作権物を含まずクリーン。openMSX自体は GPLv2 だが、**同梱せずユーザ導入**のためGPLの配布義務は当方に生じない。

### WebMSX内蔵方式を採用しない理由（記録）

「WebMSXをアプリに同梱して内蔵再生する」方式は検討したが、**ライセンス上の理由で取り下げた**。

- **調査結果（2026-06時点）**：WebMSX（`ppeccin/WebMSX`）は **LICENSEファイルが存在せず、`package.json` にも license 指定が無い**。
  ソースには `See license.txt distributed with this file` とあるがその `license.txt` 自体が無く、ライセンス明示を求める Issue #4（2016）も未解決。
- 著作権の原則では **ライセンス未宣言＝全権利留保（All Rights Reserved）**。よって**WebMSXをアプリに同梱・再配布する権利は無い**。
- 以上より **内蔵方式は採用せず、再生は A＋B のみ**とする（外部のWebMSXを利用する方式Bは、当方が何も配布しないため影響を受けない）。
- 参考：[ppeccin/WebMSX](https://github.com/ppeccin/WebMSX) ／ [Issue #4（ライセンス宣言依頼）](https://github.com/ppeccin/WebMSX/issues/4)
- ※本記述は技術的事実の整理であり法的助言ではない。最終判断は権利者確認・専門家相談のこと。

---

## 10.6 再生へのコード受け渡し（技術メモ）

- **方式B（WebMSX）**：`open_in_browser(<設定URL>)`（既定 `https://webmsx.org`）→ 変換後 `.bas`（行番号付き・CRLF、[§09](09-optimization.md)）を
  クリップボードへ → WebMSX のペースト/オートタイプ機能で MSX-BASIC プロンプトへ投入 → `RUN`。
  - URLパラメータ（`?DISK=` 等）でのロードはファイルのホスティングが必要なため、既定はクリップボード方式とする。
- **方式C（外部エミュレータ＋.dsk）**：
  1. **FAT12 の仮想フロッピーイメージ(.dsk)** を生成（720KB/2DD 等。空テンプレート or 自前生成）。
  2. 変換後コードを **ASCII形式のBASICファイル**（例 `PROG.BAS`）としてイメージ内に書き込む（当方の出力は元々ASCIIリスト）。
  3. 外部エミュレータを起動してマウント：
     - openMSX（Win/Mac）：`openmsx -diska game.dsk`。Tclスクリプトで `type RUN"PROG.BAS\r` 等まで自動化可。
     - blueMSX（Win）：コマンドライン引数でディスク指定。
  - ROM/マシン構成（MSX-BASICを含む実機ROM）は**ユーザのエミュレータ側**に用意されている前提。
- 変換後コードは [README §9](README.md#9-変換後コードの品質要件)・[05](05-transformer.md) の品質要件（ASCII記号・255バイト以内・CRLF）を満たす前提。

---

## 10.7 ディレクトリ構成への追加（[02](02-architecture.md#27-ディレクトリ構成実装時の推奨) を拡張）

```
src/
  platform/
    bridge.ts            # Tauri fs/dialog ラッパ（プラットフォーム抽象）
    player/
      provider.ts        # PlayerProvider インタフェース
      nativeWin.ts       # A: ネイティブMSXプレイヤー連携（Win）
      webmsxLink.ts      # B: WebMSXリンク＋コピペ（Win/Mac）
      externalDisk.ts    # C: 外部エミュレータ＋仮想フロッピー(.dsk)（Win/Mac）
    fat12.ts             # FAT12 .dskイメージ生成・ファイル書き込み
    settings.ts          # アプリ設定（WebMSX URL・エミュレータパス等。§10.9）
src-tauri/
  src/                   # Rust: commands（save_file, launch_native_player, open_in_browser, write_dsk_and_launch 等）
  tauri.conf.json
```

---

## 10.8 プラットフォーム機能マトリクス

| 機能 | Windows | macOS |
|------|:-------:|:-----:|
| 編集（行番号・×・ツールチップ・タブ） | ✓ | ✓ |
| 文法チェック・変換・逆変換 | ✓ | ✓ |
| 保存（.msxb / .map.json / .bas） | ✓ | ✓ |
| 再生A：ネイティブMSXプレイヤー | ✓ | — |
| 再生B：WebMSXリンク＋コピペ | ✓ | ✓ |
| 再生C：外部エミュレータ＋仮想FD(.dsk) | ✓ | ✓（openMSX） |

> エディタ・変換・保存はすべて両対応。再生は A（Win）／B（Win/Mac）／C（Win/Mac）の3方式。
> **Macでもネイティブ再生は方式C（openMSX）で可能**。OS差はネイティブMSXプレイヤー方式A（Win専用）のみ。
> WebMSX内蔵方式はライセンス上の理由で採用しない（§10.5）。

---

## 10.9 設定（Settings）

ユーザが変更できる主な設定項目。アプリ設定として永続化する（`settings.ts`）。

| 設定キー | 既定値 | 用途 |
|----------|--------|------|
| `webmsxUrl` | `https://webmsx.org` | **方式BのWebMSX URL。ユーザが変更可能**（自前ホストのWebMSX・ミラー等に差し替え可） |
| `nativePlayerPath` | （未設定） | 方式A：WindowsのネイティブMSXプレイヤー実行ファイルのパス |
| `externalEmu.kind` | `openmsx` | 方式C：外部エミュレータ種別（`openmsx` / `bluemsx`） |
| `externalEmu.path` | （未設定） | 方式C：外部エミュレータ実行ファイルのパス |
| `dskTemplatePath` | （内蔵生成） | 方式C：使用する .dsk テンプレート（未指定なら空FAT12を自動生成） |
| `defaultPlayer` | OS依存（Win=A / Mac=C） | 既定の再生方式 |
| `fontFamily` | システム等幅フォント | エディタフォント（**等幅必須**、[11 §11.2](11-editor-features.md#112-フォント表示)） |
| `fontSize` | 14（例） | エディタ文字サイズ（ユーザ変更可。`Ctrl/Cmd +/-/0`） |
| `indentSpaces` | 2 | インデント幅（[11 §11.8](11-editor-features.md#118-インデント制御)・[09](09-optimization.md)） |
| `encoding` | `shift_jis` | MSXへ渡すファイルの文字コード。既定 **Shift-JIS（JIS X 0201＋0208、MSX忠実）**。`cp932` も選択可（[08 §8.6](08-file-save.md#86-ファイルフォーマット詳細)） |
| `keybindings` | 既定セット | キーバインド上書き（[11 §11.15](11-editor-features.md#1115-既定キーバインド抜粋)） |
| `targetMachine` | `turboR` | ターゲット機種（`MSX1`/`MSX2`/`MSX2P`/`turboR`）。既定 turboR（最も高機能）。これより新しい組み込みやturboR非対応命令は警告（[12 §12.3](12-builtins.md#123-ターゲット機種フラグ)） |
| `builtins` | 出荷時テーブル | **組み込み命令・関数表。設定画面で追加/編集/無効化でき、いつでも既定へリセット可**（[12 §12.4](12-builtins.md#124-設定からの編集とリセット要件)） |
| `includePaths` | （空） | `INCLUDE` の探索パス（取り込み元相対に加える。[01 §1.13](01-language-spec.md#113-include分割ファイル)） |
| `transformOptions` | [09](09-optimization.md) の既定 | 変換オプション（行刻み・複文化・整数化等） |

> **WebMSX URL の変更可否**は明示要件。既定は公式 `https://webmsx.org` だが、設定画面から任意URLへ変更できる。
> **フォントは等幅必須・サイズ可変**、**保存は Shift-JIS（既定、MSX忠実）** も明示要件（[11](11-editor-features.md)）。
