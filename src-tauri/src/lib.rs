// Tauri デスクトップ側コマンド。docs/10 §10.4
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

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

// 変換後 BASIC を ASCII(Shift-JIS) のディスクファイルにして .dsk を保存。
// async: 保存ダイアログの blocking 呼出でメインスレッドを固めないため。
#[tauri::command]
async fn save_dsk(
    app: tauri::AppHandle,
    base: String,
    msx: String,
) -> Result<Option<DskResult>, String> {
    // MSX の ASCII セーブ形式に合わせ CRLF 改行＋末尾 EOF(0x1A)。
    let body = msx.replace("\r\n", "\n").replace('\r', "\n");
    let crlf = body.split('\n').collect::<Vec<_>>().join("\r\n");
    let (bytes, _enc, had_errors) = encoding_rs::SHIFT_JIS.encode(&crlf);
    if had_errors {
        return Err("Shift-JISで表現できない文字が含まれています".into());
    }
    let mut data = bytes.into_owned();
    data.push(0x1A);

    let img = build_dsk(&base, &data)?;
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

// 方式A: ネイティブMSXプレイヤーに .bas を渡して起動（Windows専用想定）
#[tauri::command]
fn launch_native_player(player_path: String, bas_path: String) -> Result<(), String> {
    std::process::Command::new(player_path)
        .arg(bas_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // 検証用に書き出し（外部FAT12ツールでの相互運用チェック用）
        std::fs::write("/tmp/fbe_test.dsk", &img).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            save_project,
            launch_native_player,
            set_clipboard,
            save_dsk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
