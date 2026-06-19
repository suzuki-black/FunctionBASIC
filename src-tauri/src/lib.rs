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
#[tauri::command]
fn save_project(
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

// 方式A: ネイティブMSXプレイヤーに .bas を渡して起動（Windows専用想定）
#[tauri::command]
fn launch_native_player(player_path: String, bas_path: String) -> Result<(), String> {
    std::process::Command::new(player_path)
        .arg(bas_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
            set_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
