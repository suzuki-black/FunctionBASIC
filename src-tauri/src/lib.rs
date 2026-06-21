// Tauri デスクトップ側コマンド。docs/10 §10.4
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

mod sav;

// Shift-JIS で書き出す（docs/08 §8.6）。表現不能文字があればエラー。
fn write_sjis(path: std::path::PathBuf, text: &str) -> Result<(), String> {
    let (bytes, _enc, had_errors) = encoding_rs::SHIFT_JIS.encode(text);
    if had_errors {
        return Err(format!(
            "Shift-JISで表現できない文字が含まれています: {}",
            path.display()
        ));
    }
    std::fs::write(&path, bytes.as_ref()).map_err(|e| e.to_string())
}

// 保存（docs/08 §8.3）。
// - エラーあり: 変換前 .msxb のみ（Shift-JIS）
// - エラーなし: .msxb / .bas を Shift-JIS、.map.json を UTF-8(JSON標準) で保存
// 同期コマンドはメインスレッドで実行され、ダイアログの blocking 呼出で
// メインスレッドが止まり UI が固まる。async にしてワーカースレッドで走らせる。
#[tauri::command]
async fn save_project(
    app: tauri::AppHandle,
    base: String,
    source: String,
    map_json: String,
    msx: String,
    has_error: bool,
) -> Result<bool, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(false); // キャンセル
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;

    write_sjis(dir.join(format!("{base}.msxb")), &source)?;
    if !has_error {
        std::fs::write(dir.join(format!("{base}.map.json")), map_json.as_bytes())
            .map_err(|e| e.to_string())?;
        write_sjis(dir.join(format!("{base}.bas")), &msx)?;
    }
    Ok(true)
}

// WebView の execCommand/clipboard は WKWebView で不安定なため、
// デスクトップではクリップボード書き込みを OS 側（Tauri公式プラグイン）で行う。
#[tauri::command]
fn set_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

// ===== 方式B: WebMSX 用 FAT12 ディスクイメージ生成（docs/10 §10.4）=====
// 打鍵ペーストは非ASCIIで化け・取りこぼしがあるため、ASCII BASIC を 1 ファイル収めた
// 720KB(3.5" 2DD) FAT12 ディスクを生成し、WebMSX にドラッグ→ RUN"NAME.BAS" で確実に投入する。

// 8.3 形式のディスク内ファイル名（拡張子 .BAS）を base から作る。
fn dsk_filename(base: &str) -> String {
    let mut name = String::new();
    for c in base.chars() {
        if name.len() >= 8 {
            break;
        }
        if c.is_ascii_alphanumeric() {
            name.push(c.to_ascii_uppercase());
        }
    }
    if name.is_empty() {
        name.push_str("PROG");
    }
    format!("{name}.BAS")
}

// 720KB FAT12 イメージに program（ASCIIバイト列）を1ファイルで収めて返す。
fn build_dsk(base: &str, program: &[u8]) -> Result<Vec<u8>, String> {
    const SECTOR: usize = 512;
    const TOTAL_SECTORS: usize = 1440; // 720KB
    const SPC: usize = 2; // sectors / cluster
    const RESERVED: usize = 1;
    const NUM_FATS: usize = 2;
    const SECTORS_PER_FAT: usize = 3;
    const ROOT_ENTRIES: usize = 112;

    let total = SECTOR * TOTAL_SECTORS;
    let root_sectors = ROOT_ENTRIES * 32 / SECTOR; // 7
    let data_start_sector = RESERVED + NUM_FATS * SECTORS_PER_FAT + root_sectors; // 14
    let cluster_bytes = SPC * SECTOR; // 1024

    let mut img = vec![0u8; total];

    // --- ブートセクタ / BPB ---
    img[0] = 0xEB;
    img[1] = 0xFE;
    img[2] = 0x90;
    img[3..11].copy_from_slice(b"MSXDISK ");
    img[11] = (SECTOR & 0xFF) as u8;
    img[12] = (SECTOR >> 8) as u8; // 512
    img[13] = SPC as u8;
    img[14] = RESERVED as u8;
    img[15] = 0;
    img[16] = NUM_FATS as u8;
    img[17] = (ROOT_ENTRIES & 0xFF) as u8;
    img[18] = (ROOT_ENTRIES >> 8) as u8;
    img[19] = (TOTAL_SECTORS & 0xFF) as u8;
    img[20] = (TOTAL_SECTORS >> 8) as u8;
    img[21] = 0xF9; // メディアディスクリプタ（720KB）
    img[22] = SECTORS_PER_FAT as u8;
    img[23] = 0;
    img[24] = 9; // sectors/track
    img[26] = 2; // heads
    img[510] = 0x55;
    img[511] = 0xAA;

    // --- 必要クラスタ数 ---
    let data_len = program.len();
    let clusters = data_len.div_ceil(cluster_bytes).max(1);
    let max_clusters = (TOTAL_SECTORS - data_start_sector) / SPC;
    if clusters > max_clusters {
        return Err("プログラムが720KBディスクに収まりません".into());
    }

    // --- FAT12 構築 ---
    let fat_bytes = SECTORS_PER_FAT * SECTOR;
    let mut fat = vec![0u8; fat_bytes];
    let set12 = |fat: &mut [u8], idx: usize, val: u16| {
        let o = idx * 3 / 2;
        if idx & 1 == 0 {
            fat[o] = (val & 0xFF) as u8;
            fat[o + 1] = (fat[o + 1] & 0xF0) | ((val >> 8) & 0x0F) as u8;
        } else {
            fat[o] = (fat[o] & 0x0F) | (((val << 4) & 0xF0) as u8);
            fat[o + 1] = (val >> 4) as u8;
        }
    };
    set12(&mut fat, 0, 0xFF9); // メディア
    set12(&mut fat, 1, 0xFFF);
    for k in 0..clusters {
        let cl = 2 + k;
        let v: u16 = if k + 1 == clusters {
            0xFFF
        } else {
            (cl + 1) as u16
        };
        set12(&mut fat, cl, v);
    }
    let fat1 = RESERVED * SECTOR;
    img[fat1..fat1 + fat_bytes].copy_from_slice(&fat);
    let fat2 = (RESERVED + SECTORS_PER_FAT) * SECTOR;
    img[fat2..fat2 + fat_bytes].copy_from_slice(&fat);

    // --- ルートディレクトリ・エントリ ---
    let root_off = (RESERVED + NUM_FATS * SECTORS_PER_FAT) * SECTOR;
    let mut name = [b' '; 11];
    let base_name = dsk_filename(base); // "NAME.BAS"
    let stem = base_name.trim_end_matches(".BAS");
    for (i, b) in stem.bytes().enumerate().take(8) {
        name[i] = b;
    }
    name[8] = b'B';
    name[9] = b'A';
    name[10] = b'S';
    img[root_off..root_off + 11].copy_from_slice(&name);
    img[root_off + 11] = 0x20; // アーカイブ属性
    let date: u16 = (((2024 - 1980) as u16) << 9) | (1 << 5) | 1; // 2024-01-01
    img[root_off + 24] = (date & 0xFF) as u8;
    img[root_off + 25] = (date >> 8) as u8;
    img[root_off + 26] = 2; // 開始クラスタ = 2
    img[root_off + 27] = 0;
    let sz = data_len as u32;
    img[root_off + 28] = (sz & 0xFF) as u8;
    img[root_off + 29] = ((sz >> 8) & 0xFF) as u8;
    img[root_off + 30] = ((sz >> 16) & 0xFF) as u8;
    img[root_off + 31] = ((sz >> 24) & 0xFF) as u8;

    // --- データ領域（クラスタは連続なので先頭から流し込むだけ）---
    let data_off = data_start_sector * SECTOR;
    img[data_off..data_off + data_len].copy_from_slice(program);

    Ok(img)
}

#[derive(serde::Serialize)]
struct DskResult {
    path: String,
    load_name: String,
}

// 変換後 BASIC を MSX の ASCII セーブ形式（Shift-JIS, CRLF 改行＋末尾 EOF 0x1A）の
// 1 ファイルとして収めた 720KB FAT12 フルイメージ（1440×512 バイト）を返す。
// .dsk / .sav の両経路で共有する。
fn build_disk_image(base: &str, msx: &str) -> Result<Vec<u8>, String> {
    let body = msx.replace("\r\n", "\n").replace('\r', "\n");
    let crlf = body.split('\n').collect::<Vec<_>>().join("\r\n");
    let (bytes, _enc, had_errors) = encoding_rs::SHIFT_JIS.encode(&crlf);
    if had_errors {
        return Err("Shift-JISで表現できない文字が含まれています".into());
    }
    let mut data = bytes.into_owned();
    data.push(0x1A);
    build_dsk(base, &data)
}

// 変換後 BASIC を ASCII(Shift-JIS) のディスクファイルにして .dsk を保存。
// async: 保存ダイアログの blocking 呼出でメインスレッドを固めないため。
#[tauri::command]
async fn save_dsk(
    app: tauri::AppHandle,
    base: String,
    msx: String,
) -> Result<Option<DskResult>, String> {
    let img = build_disk_image(&base, &msx)?;
    let load_name = dsk_filename(&base);

    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(format!("{base}.dsk"))
        .add_filter("MSX disk image", &["dsk"])
        .blocking_save_file()
    else {
        return Ok(None); // キャンセル
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, &img).map_err(|e| e.to_string())?;
    Ok(Some(DskResult {
        path: path.display().to_string(),
        load_name,
    }))
}

#[derive(serde::Serialize)]
struct SavResult {
    path: String,
    load_name: String,
    // 上書き前に取った既存ファイルのバックアップパス（新規保存なら null）。
    backup: Option<String>,
}

// 現在時刻（UTC）を "YYYYMMDD-HHMMSS" 文字列で返す。バックアップ名の付与用。
// chrono 等を足さずに std だけで算出（Howard Hinnant の civil_from_days）。
fn timestamp_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = y + if m <= 2 { 1 } else { 0 };
    format!("{year:04}{m:02}{d:02}-{hh:02}{mm:02}{ss:02}")
}

// path に既存ファイルがあれば、上書き前に同じディレクトリへ
// "<元名>.<UTCタイムスタンプ>.bak" としてコピーし、そのパスを返す。
// 万一同名が既にあれば連番を付けて衝突回避（バックアップを上書きしない＝データを失わない）。
// 既存ファイルが無ければ何もしない（Ok(None)）。
fn backup_existing(path: &std::path::Path) -> Result<Option<std::path::PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let fname = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "backup".into());
    let ts = timestamp_utc();
    let mut bp = path.to_path_buf();
    bp.set_file_name(format!("{fname}.{ts}.bak"));
    let mut n = 1u32;
    while bp.exists() {
        bp.set_file_name(format!("{fname}.{ts}.{n}.bak"));
        n += 1;
    }
    std::fs::copy(path, &bp).map_err(|e| format!("バックアップ作成に失敗: {e}"))?;
    Ok(Some(bp))
}

// 変換後 BASIC を MSXPLAYer 仮想フロッピー（.sav）にして保存。
// 中身は .dsk と同じ FAT12 フルイメージで、それを .sav 形式に詰め替えるだけ（sav.rs）。
// .sav は MSXPLAYer のワークドライブに置いてデータを受け渡す用途（起動ディスクにはならない）。
// 既存 .sav を上書きする場合は、消える前に必ずバックアップを取る（MSXPLAYer のワーク
// ドライブには利用者の既存データが入り得るため）。
#[tauri::command]
async fn save_sav(
    app: tauri::AppHandle,
    base: String,
    msx: String,
) -> Result<Option<SavResult>, String> {
    let img = build_disk_image(&base, &msx)?;
    let sav = sav::dsk_to_sav(&img).map_err(|e| e.to_string())?;
    let load_name = dsk_filename(&base);

    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(format!("{base}.sav"))
        .add_filter("MSXPLAYer virtual floppy", &["sav"])
        .blocking_save_file()
    else {
        return Ok(None); // キャンセル
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    // 上書き前にバックアップ。失敗したら書き込まずに中断（データ保全を優先）。
    let backup = backup_existing(&path)?;
    std::fs::write(&path, &sav).map_err(|e| e.to_string())?;
    Ok(Some(SavResult {
        path: path.display().to_string(),
        load_name,
        backup: backup.map(|b| b.display().to_string()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_existing_preserves_old_file() {
        let dir = std::env::temp_dir().join(format!("fbe_bk_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("WORK.sav");

        // 既存ファイルが無ければ何もしない。
        assert_eq!(backup_existing(&target).unwrap(), None);

        // 既存ファイルあり → バックアップが作られ、中身が保たれ、元も残る。
        std::fs::write(&target, b"OLD DATA").unwrap();
        let bk = backup_existing(&target).unwrap().expect("backup made");
        assert!(bk.exists(), "バックアップが存在する");
        assert_eq!(std::fs::read(&bk).unwrap(), b"OLD DATA", "旧内容を保持");
        assert!(target.exists(), "元ファイルは残る（コピーであって移動でない）");

        // 連番衝突回避: もう一度バックアップしても既存 .bak を上書きしない。
        let bk2 = backup_existing(&target).unwrap().expect("backup made");
        assert_ne!(bk, bk2, "同じバックアップ名を再利用しない");
        assert_eq!(std::fs::read(&bk).unwrap(), b"OLD DATA", "最初の .bak は無傷");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dsk_structure_and_roundtrip() {
        let prog = b"10 PRINT \"HI\"\r\n20 END\r\n\x1a";
        let img = build_dsk("game", prog).unwrap();
        assert_eq!(img.len(), 737280, "720KB");
        // BPB
        assert_eq!(u16::from_le_bytes([img[11], img[12]]), 512);
        assert_eq!(img[13], 2); // spc
        assert_eq!(img[21], 0xF9); // media
        assert_eq!(u16::from_le_bytes([img[19], img[20]]), 1440);
        // FAT 先頭（media + EOF for cluster2）
        assert_eq!(&img[512..515], &[0xF9, 0xFF, 0xFF]);
        // ルートディレクトリ（sector 7）
        let r = 7 * 512;
        assert_eq!(&img[r..r + 11], b"GAME    BAS");
        assert_eq!(img[r + 11], 0x20);
        assert_eq!(u16::from_le_bytes([img[r + 26], img[r + 27]]), 2); // start cluster
        assert_eq!(
            u32::from_le_bytes([img[r + 28], img[r + 29], img[r + 30], img[r + 31]]),
            prog.len() as u32
        );
        // データ（sector 14 = cluster2）にプログラムがそのまま入る
        let d = 14 * 512;
        assert_eq!(&img[d..d + prog.len()], prog);
        // 検証用に書き出し（外部FAT12ツールでの相互運用チェック用）。
        // OS のテンポラリディレクトリを使う（Windows に /tmp は無い）。
        std::fs::write(std::env::temp_dir().join("fbe_test.dsk"), &img).unwrap();
    }
}

// OSネイティブメニューを構築。クリックで menu-action イベントをフロントへ送り、
// アプリ内メニューと同じ runAction() に流す。ショートカットはフロントの keydown が
// 一手に担うため、二重発火を避けてここではアクセラレータを付けない。
fn build_native_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    lang: &str,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let ja = lang != "en";
    let l = |j: &'static str, e: &'static str| if ja { j } else { e };
    let mi = |id: &str, j: &'static str, e: &'static str| {
        MenuItem::with_id(handle, id, l(j, e), true, None::<&str>)
    };

    // アプリメニュー（macOSでは左端・太字。リポジトリ名 FunctionBASIC を主張）
    let about_meta = AboutMetadataBuilder::new()
        .name(Some("FunctionBASIC"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some(l(
            "構造化BASIC → MSX-BASIC 変換エディタ",
            "Structured BASIC → MSX-BASIC converter/editor",
        )))
        .build();
    let app = Submenu::with_items(
        handle,
        "FunctionBASIC",
        true,
        &[
            &PredefinedMenuItem::about(
                handle,
                Some(l("FunctionBASICについて", "About FunctionBASIC")),
                Some(about_meta),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &mi("lang-ja", "日本語", "日本語")?,
            &mi("lang-en", "English", "English")?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, Some(l("FunctionBASICを終了", "Quit FunctionBASIC")))?,
        ],
    )?;
    let file = Submenu::with_items(
        handle,
        l("ファイル", "File"),
        true,
        &[
            &mi("save", "変換して保存", "Convert & Save")?,
            &mi("dsk", "ディスク(.dsk)を保存…", "Save Disk (.dsk)…")?,
            &mi("sav", "MSXPLAYer用(.sav)を保存…", "Save for MSXPLAYer (.sav)…")?,
        ],
    )?;
    // 編集: 標準の取消/やり直し/コピペ等（ネイティブ編集を保持）＋ 整形
    let edit = Submenu::with_items(
        handle,
        l("編集", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &mi("format", "整形（大文字化）", "Format (Uppercase)")?,
        ],
    )?;
    let view = Submenu::with_items(
        handle,
        l("表示", "View"),
        true,
        &[
            &mi("split-right", "アクティブタブを右へ分割", "Split Active Tab Right")?,
            &mi("merge", "分割を統合", "Unsplit (Merge)")?,
            &mi("layout-reset", "タブ配置をリセット", "Reset Tab Layout")?,
            &PredefinedMenuItem::separator(handle)?,
            &mi("fontup", "文字を大きく", "Increase Font")?,
            &mi("fontdown", "文字を小さく", "Decrease Font")?,
        ],
    )?;
    let run = Submenu::with_items(
        handle,
        l("実行", "Run"),
        true,
        &[
            &mi("run", "WebMSXで実行", "Run in WebMSX")?,
            &mi("reverse", "MSX→構造化に逆変換", "Reverse: MSX → Structured")?,
        ],
    )?;
    let window = Submenu::with_items(
        handle,
        l("ウインドウ", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    Menu::with_items(handle, &[&app, &file, &edit, &view, &run, &window])
}

// 言語切替: ネイティブメニューを作り直して差し替える。
#[tauri::command]
fn set_menu_lang(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let menu = build_native_menu(&app, &lang).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

// ウィンドウタイトルを言語に合わせて差し替える。
#[tauri::command]
fn set_window_title(window: tauri::Window, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Emitter;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .menu(|handle| build_native_menu(handle, "ja"))
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().0.as_str());
        })
        .invoke_handler(tauri::generate_handler![
            save_project,
            set_clipboard,
            save_dsk,
            save_sav,
            set_menu_lang,
            set_window_title
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
