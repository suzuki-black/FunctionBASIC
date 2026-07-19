# 14. 外部ファイル変更の検出と整合（External File Change Detection & Reconciliation）— 設計仕様

> **この仕様のねらい**：エディタ系ツールで「外部プロセス（AI コーディング支援・git・他エディタ・ビルドスクリプト等）が、編集中のソースファイルを直接書き換えた」ときに、
> **古いメモリ内容でディスクを上書き（＝巻き戻し）してしまう事故を防ぎ、常に最新と整合させる**。
>
> **横展開前提**：本書はランタイム非依存の**設計パターン**として書く。バックエンド（ネイティブ FS）／フロント（UI）の分離を仮定し、[§7](#7-バックエンドapi契約ランタイム非依存) で API 契約、[§8](#8-フロント状態機械擬似コード) で状態機械、[§11](#11-移植ガイド他ツールへの横展開) で各ランタイム（Tauri / Electron / VSCode 拡張 / Node / ブラウザ）への移植を示す。FunctionBASIC エディタ（Tauri）を参照実装とする。

---

## 1. 問題定義

エディタはファイルの**メモリ内コピー**を持つ。外部プロセスがディスク上の同ファイルを変更すると、メモリ内コピーが陳腐化し、次の 3 つが起きる：

| 事象 | 内容 | 深刻度 |
|---|---|---|
| **巻き戻し（stale overwrite）** | ユーザ/ツールが**古いメモリ内容を保存**→**新しいディスク版を上書き**→外部変更を喪失 | ★★★ データ損失 |
| **混乱（confusion）** | エディタは古い内容、ディスクは新しい内容を表示 | ★★ |
| **競合（conflict）** | エディタに未保存編集**があり**、かつディスクも外部変更された（両者に変更） | ★★★ 要解決 |

最優先は**巻き戻しの封じ込め**。これは [§5 保存時ガード](#5-保存時ガード巻き戻し対策の要) だけでも達成できる。

---

## 2. コアモデル：3-way（baseline / working / disk）

オープン中の各ファイルに 1 レコードを持つ：

| 用語 | 意味 |
|---|---|
| **baseline** | エディタ内容が「基づいている」ディスク版。**最後に読込 or 保存した時点の {内容, mtime, size}** |
| **working** | 現在のメモリ内容（エディタのバッファ） |
| **disk** | 今のディスク内容 |

派生状態：

- **dirty（未保存編集あり）** ＝ `working ≠ baseline.content`
- **externalChanged（外部変更あり）** ＝ `disk ≠ baseline`（まず `mtime/size` で軽く判定 → 一致しなければ内容を読んで確定）
- `baseline` は **読込時**と**保存成功時**に更新する。

> **なぜ 3-way か**：`baseline` を共通祖先として持つことで「どちらが変わったか（working / disk / 両方）」を判定でき、**自動再読込／競合／自己書込みの黙認**を正しく分岐できる。

---

## 3. 検出の多層トリガ（belt-and-suspenders）

単一手段に頼らず多層で検出する。どれか 1 つが漏れても他で拾う。

| 種別 | タイミング | 実装 | 位置づけ |
|---|---|---|---|
| **A. ウォッチャ（即時）** | ディスク変更を即検知 | ネイティブ FS 監視 → `changed` イベント。**デバウンスはフロント**（多発するため） | 主 |
| **B. アクション前チェック** | **保存 / ビルド / 実行（プレビュー）の直前** | 各ハンドラ先頭で `checkExternalChanges()` | 主（巻き戻し封じ） |
| **C. フォーカス復帰** | ウィンドウが再アクティブ | `focus` イベント | 補 |
| **D. タブ切替** | そのファイルを開いた時 | タブ切替時に対象を整合 | 補 |
| **E. ポーリング（保険）** | 数秒毎（**ウォッチャが使えない環境のみ**） | 軽量 `stat` | フォールバック |

---

## 4. 整合ロジック（状態機械）

`checkExternalChanges()` の中核。対象ファイル群について `stat` → `baseline` と比較し、変化したものだけ内容を読んで分岐する。

### 4.1 既存ファイルの 4 ケース

```
externalChanged?  ── no ──▶ 何もしない
       │ yes
   read disk content
       │
   disk == working ? ── yes ──▶ baseline を更新（UI 変化なし。※自己書込みもここで黙認）
       │ no
   dirty ? ── no ──▶ 自動再読込（working=disk, baseline=disk。表示中ならキャレット/スクロール保持）＋トースト
       │ yes
   競合 ──▶ 競合モーダル（§6.2）。どちらも黙って捨てない
```

### 4.2 ファイルの増減（フォルダ監視時）

- **追加**（ディスクにあり baseline に無い）：読み込んで追加。UI ツリー更新。競合なし。
- **削除**（baseline にありディスクに無い）：
  - 未 dirty → エディタからも除去（or「削除済み」マーク）。
  - dirty → **削除競合**：エディタに残し「外部で削除」提示（次の保存で再作成 or 破棄を選ばせる）。
- **リネーム**：多くの FS で「削除＋追加」として観測される。特別扱いせず上記で処理（内容一致による追従は任意）。

---

## 5. 保存時ガード（巻き戻し対策の要）★

**すべての書込み経路**（明示保存・自動保存・ビルド/実行前保存）は、**書込み直前に** `disk vs baseline` を再確認する：

| 状況 | 挙動 |
|---|---|
| 外部変更あり ＆ **未 dirty** | 保存せず**再読込**（書くものが無い） |
| 外部変更あり ＆ **dirty** | **競合モーダル**（黙って上書きしない） |
| 外部変更なし | 通常保存 → **保存後に再 stat して baseline を更新** |

- これはウォッチャと**独立に効く最後の砦**。ウォッチャが取りこぼしても、保存の瞬間に必ず検査する。
- **自己書込みの黙認**：自分の保存が発火させたウォッチャイベントは、[§4.1](#41-既存ファイルの-4-ケース) の `disk == working` 分岐で自然に無害化される（読み直した disk が今書いた working と一致 → baseline 更新のみ、UI 変化なし）。**専用の抑制ウィンドウは不要**。

---

## 6. UX

### 6.1 非競合の外部変更 → 自動再読込＋トースト（既定）
- シームレスに再読込し、「外部で更新 → 再読込しました」をトースト表示。**キャレット/スクロール位置を保持**。
- 設定で「毎回確認」に変更可（[§9](#9-設定)）。

### 6.2 競合モーダル（3 択）
```
「⚠ 〈ファイル名〉は外部で変更されました。未保存の編集があります。」
  [ ディスクの内容で置き換える ]  ← working=disk, baseline=disk（自分の編集を破棄）
  [ エディタの内容を保持 ]        ← baseline=disk（変更は認識）＋ working 維持。次の保存でディスクを上書き（再確認付き）
  [ 差分を見る ]                  ← working ↔ disk の差分表示。閉じたら再びこの 3 択へ
```

### 6.3 その他
- **外部削除**：通知＋「エディタに残す（次保存で再作成）／閉じる」。
- **プロジェクトツリー**：追加/削除/リネームを検知してツリー更新。
- **状態表示**：非アクティブなファイルに競合がある場合、タブ/ツリーに印を出し、切替時にモーダル。

---

## 7. バックエンド API 契約（ランタイム非依存）

フロントが必要とする最小の 4 操作。**mtime は UNIX epoch ミリ秒**を推奨（比較が容易）。

| 操作 | 入力 | 返り値 | 用途 |
|---|---|---|---|
| `stat(dir\|path)` | パス（or ディレクトリ） | `{name, mtime, size}[]`（or 単一） | 軽量な外部変更判定（内容を読まない） |
| `read(path)` | パス | `{content, mtime, size}` | 内容＋メタの取得（読込・整合確認） |
| `write(path, content)` | パス, 内容 | `{mtime, size}`（**書込み後のメタ**） | 保存。返り値で baseline を即更新→自己書込み黙認が楽 |
| `watch(dir)` | ディレクトリ | イベント `changed` を push | 即時検出。**デバウンスはフロント** |

### 7.1 Tauri 参照実装（本ツールで実装済み・コンパイル確認済み）

```rust
// メタから mtime(ms)
fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64).unwrap_or(0)
}

// stat: 内容を読まず name/mtime/size だけ返す（ポーリング・アクション前チェック用）
#[tauri::command]
fn stat_files(dir: String) -> Result<Vec<FileStat>, String> { /* read_dir → metadata */ }

// read: 単一ファイルの内容＋メタ
#[tauri::command]
fn read_file(dir: String, name: String) -> Result<FileRead, String> { /* read + metadata */ }

// watch: notify で監視し "files-changed" を emit（watcher は管理状態に保持して生存）
struct WatcherState(std::sync::Mutex<Option<notify::RecommendedWatcher>>);
#[tauri::command]
fn watch_folder(app: tauri::AppHandle, state: tauri::State<WatcherState>, dir: String) -> Result<(), String> {
    let app2 = app.clone();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() { let _ = app2.emit("files-changed", ()); }
    })?;
    w.watch(std::path::Path::new(&dir), notify::RecursiveMode::NonRecursive)?;
    *state.0.lock()? = Some(w);
    Ok(())
}
```
`Cargo.toml`: `notify = "6"`。`FileEntry` に `mtime: u64, size: u64` を追加し、読込時に埋める。

---

## 8. フロント状態機械（擬似コード）

```js
// ファイルごと: baseline = { content, mtime, size }
const baseline = new Map();               // name -> {content, mtime, size}
const working  = /* エディタのバッファ */; // name -> content
const conflicted = new Set();             // 非アクティブで競合中のファイル

const isDirty = (name) => working.get(name) !== baseline.get(name)?.content;

async function checkExternalChanges({ reason }) {   // reason: 'watch'|'focus'|'tab'|'save'|'run'|'poll'
  syncActiveBuffer();                                // 編集中バッファを working へ反映
  const stats = await backend.stat(dir);             // [{name, mtime, size}]
  // 追加/削除
  handleAddedRemoved(stats);
  // 変更
  for (const s of stats) {
    const base = baseline.get(s.name);
    if (base && s.mtime === base.mtime && s.size === base.size) continue; // 未変更
    const disk = await backend.read(dir, s.name);     // {content, mtime, size}
    if (disk.content === working.get(s.name)) {        // disk == working（自己書込み含む）
      setBaseline(s.name, disk); continue;             // 黙って baseline 更新
    }
    if (!isDirty(s.name)) {                             // 外部のみ変更
      applyReload(s.name, disk);                        // working=disk, baseline=disk（表示中は位置保持）
      toastReloaded(s.name);
    } else {                                            // 競合
      if (s.name === activeName) await resolveConflict(s.name, disk);
      else conflicted.add(s.name);                      // 非アクティブは切替時に解決
    }
  }
}

async function resolveConflict(name, disk) {
  const choice = await showConflictModal(name, working.get(name), disk.content); // 'disk'|'keep'|'diff'
  if (choice === 'diff') { await showDiff(working.get(name), disk.content); return resolveConflict(name, disk); }
  if (choice === 'disk') { applyReload(name, disk); }
  else /* keep */        { setBaselineMetaOnly(name, disk); /* working 維持→次保存で上書き */ }
  conflicted.delete(name);
}

// 保存経路は必ず先にガード
async function save(name) {
  await checkExternalChanges({ reason: 'save' });     // 競合ならここでモーダル
  if (aborted) return;
  const meta = await backend.write(dir, name, working.get(name));
  setBaseline(name, { content: working.get(name), ...meta }); // 保存後 baseline 更新
}
```
トリガ配線：`watch` イベント（デバウンス300ms）／`window focus`／タブ切替／`save`・`run`・`build` 各ハンドラ先頭／ポーリング（ウォッチャ不在時）。

---

## 9. 設定

- 外部変更時：**自動再読込**（既定） / 毎回確認。
- ウォッチャ ON/OFF、ポーリング間隔（既定 例: 2s、ウォッチャ有効時は停止）。
- 保存時ガードは常時 ON（無効化不可を推奨）。

---

## 10. エッジケース

- **自己書込み**：`disk == working` の黙認で無害化（§5）。書込み API が新 mtime を返せばさらに堅牢。
- **逐次書込み**（AI が小刻みに保存）：ウォッチャイベントを**フロントでデバウンス**（例 300ms）してから整合。
- **ネットワーク FS / mtime 精度**：mtime だけを信用せず、**内容比較で確定**。
- **複数ファイル**：アクティブは即時に UI 反映、非アクティブは自動再読込 or `conflicted` に積み切替時に解決。
- **未保存＋外部削除**：削除競合として扱う。
- **大きいファイル**：`stat`（mtime/size）で先に絞り、変化時のみ内容取得。ハッシュは任意（KB 級なら内容直接比較で十分）。
- **FS 無し環境（ブラウザ等）**：機能を**無効化**（ゲート）。

---

## 11. 移植ガイド（他ツールへの横展開）

**不変部分**（どのツールでも同じ）：[§2 3-way モデル](#2-コアモデル3-waybaseline--working--disk)、[§4 整合状態機械](#4-整合ロジック状態機械)、[§5 保存時ガード](#5-保存時ガード巻き戻し対策の要)、[§8 フロント擬似コード](#8-フロント状態機械擬似コード)。

**差し替え部分**：[§7 バックエンド API 契約](#7-バックエンドapi契約ランタイム非依存)（stat/read/write/watch）の実装のみ、各ランタイムに合わせる。

| ランタイム | watch 実装 | stat / read / write |
|---|---|---|
| **Tauri (Rust)** | `notify` crate → `emit("files-changed")` | `std::fs` + `metadata` |
| **Electron** | `chokidar`（推奨）or `fs.watch` → IPC | `fs.promises.stat/readFile/writeFile` |
| **VSCode 拡張** | `workspace.createFileSystemWatcher` | `workspace.fs` |
| **Node CLI/TUI** | `chokidar` / `fs.watch` | `fs.promises` |
| **ブラウザ（File System Access API）** | ウォッチャ無し → **ポーリング**（`fileHandle.getFile().lastModified`） | `getFile().text()` / `createWritable()` |

**ツール固有の差し替え点**：対象ファイル種別（拡張子フィルタ）、単一ファイル or フォルダ、`working`/`dirty` の持ち方（本ツールは `project.files` マップ）。これらは §8 の `backend.*` と `syncActiveBuffer/isDirty` の実装に閉じ込める。

---

## 12. 段階実装（本ツールでの適用）

- **Phase 1（巻き戻しを即封じる）**：`stat`/`read` API＋`baseline`＋[§5 保存時ガード]＋focus/タブ整合＋自動再読込＋競合モーダル。
- **Phase 2**：ウォッチャ（`notify`）で即時検出＋ツリー同期。
- **Phase 3**：競合モーダルの差分表示、設定、ポーリング保険。

> 本ツールの実装状況：バックエンド（`stat_files` / `read_file` / `watch_folder` / `FileEntry.mtime,size` / `notify` 依存）は着手済み・`cargo check` 通過。フロント状態機械は本仕様に沿って実装予定。
