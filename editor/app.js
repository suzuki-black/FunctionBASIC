// 構造化BASIC エディタ（依存ゼロ）。コアは dist/ から読み込む。
import { tokenize } from "./core/lexer/lexer.js";
import { parse } from "./core/parser/parser.js";
import { transform, renderMsx } from "./core/transform/transformer.js";
import { reverse } from "./core/reverse/reverse.js";
import { readBasic } from "./core/reverse/basic-reader.js";
import { renameVars } from "./core/reverse/rename-vars.js";
import { decompile } from "./core/reverse/decompile.js";
import { isBuiltin } from "./core/core/builtins.js";
import { localize } from "./core/core/diagnostics.js";
import { resolveIncludes } from "./core/preprocess/include.js";
import { formatSource } from "./core/format/format.js";
import { LIBS } from "./core/libs.js";
import { findDataBlobs } from "./core/disasm/detect.js";
import { buildAnnotationLines, stripMnemonicComments } from "./core/disasm/annotate.js";
import { MSX_BIOS } from "./core/disasm/msx-bios.js";

const $ = (id) => document.getElementById(id);
const srcEl = $("src");
const hlEl = $("highlight");
const gutterEl = $("gutter");
const statusEl = $("status");
const msxOut = $("msxOut");
const msxNote = $("msxNote");
const msxPane = $("msxPane");
const maptableOut = $("maptableOut");
const maptableNote = $("maptableNote");
// アプリのバージョン（About表示用の単一の真実。src-tauri/tauri.conf.json と揃える）
const APP_VERSION = "0.1.41";

// ---- ログ（失敗を可視化。サンドボックス等での不調を診断しやすく）----
const log = (...a) => console.log("[editor]", ...a);
const logErr = (label, e) => console.error("[editor]", label, e);

// ---- 多言語（日本語 / English）----
const I18N = {
  ja: {
    "title": "構造化BASIC エディタ — MSX-BASIC 変換",
    "m.file": "ファイル", "m.edit": "編集", "m.view": "表示", "m.run": "実行", "m.help": "ヘルプ",
    "save": "変換して保存", "dsk": "ディスク(.dsk)を保存…", "sav": "MSXPLAYer用(.sav)を保存…",
    "undo": "元に戻す", "redo": "やり直し", "m.find": "検索", "m.replace": "置換", "m.gfind": "全体検索",
    "m.asm": "機械語DATAを逆アセンブル注釈", "m.asmclear": "注釈を消す",
    "asm.done": (n) => `機械語DATAを注釈しました（${n}件）`, "asm.none": "機械語DATAは見つかりませんでした",
    "asm.cleared": "ニーモニック注釈を消しました",
    "undo.none": "これ以上戻せません", "redo.none": "これ以上やり直せません",
    "format": "整形（インデント＋大文字化）", "def": "定義へ移動", "usages": "使用箇所（順送り）", "goline": "行へ移動…",
    "rn.menu": "識別子をリネーム…",
    "rn.title": "リネーム", "rn.msg": (n) => `「${n}」を一括リネーム。新しい名前:`,
    "rn.done": (n, name) => `${n}箇所を「${name}」にリネームしました`,
    "rn.donefiles": (n, name, f) => `${f}ファイルの${n}箇所を「${name}」にリネームしました`,
    "rn.none": "この名前の出現がありません",
    "rn.preview": (o, next, total, files) => `「${o}」→「${next}」を ${files} ファイル・計 ${total} 箇所で置換します：`,
    "rn.libwarn": "※ 読み取り専用ライブラリにも同名があります。ライブラリは変更されないため、参照が壊れる可能性があります。",
    "rn.notident": "識別子の上にカーソルを置いて実行してください",
    "rn.builtin": (n) => `「${n}」は組み込み名のためリネームできません`,
    "rn.readonly": "読み取り専用です",
    "back": "戻る", "fwd": "進む", "bm": "ブックマーク切替", "bmnext": "次のブックマーク",
    "splitright": "アクティブタブを右へ分割", "merge": "分割を統合", "reset": "タブ配置をリセット",
    "fontup": "文字を大きく", "fontdown": "文字を小さく",
    "m.settings": "設定…", "set.title": "設定",
    "set.lang": "言語", "set.font": "フォントサイズ",
    "set.editor": "エディタ支援",
    "set.autoindent": "自動インデント（Enter）", "set.autopair": "括弧・引用符の自動補完",
    "set.curline": "現在行をハイライト",
    "set.watchexternal": "外部ファイル変更を検出して整合（デスクトップ）",
    "set.autoreload": "競合が無ければ自動で再読込（OFF=毎回確認）",
    "set.transpile": "変換（最適化）", "set.optimize": "定数畳み込み（リテラル同士の演算を事前計算）",
    "set.strength": "べき乗の強度低減（X^2→X*X・指数2〜4）",
    "set.stripcomments": "コメント除去（速度/サイズ優先・飛び先は保持）",
    "set.hotplace": "よく呼ぶ関数を低い行番号へ（GOSUB探索を短縮＝高速化）",
    "set.recdepth": "再帰スタックの最大深さ",
    "find.find": "検索", "find.replace": "置換後", "find.one": "置換", "find.all": "全置換",
    "find.case": "大文字小文字を区別", "find.regex": "正規表現", "find.prev": "前へ", "find.next": "次へ", "find.close": "閉じる (Esc)",
    "find.replaced": (n) => `${n} 件置換しました`,
    "find.gtitle": "ファイル全体を検索", "find.gfind": "全体検索（lib・MSX出力も対象）", "find.badre": "正規表現エラー",
    "find.gcount": (n, f) => `${n} 件 / ${f} ファイル`,
    "src.main": "構造化BASIC", "src.msx": "MSX-BASIC（出力）",
    "proj.title": "プロジェクト", "proj.libs": "ライブラリ（読み取り専用）", "proj.run": "実行",
    "tip.browser": (n) => `${n}\n（ブラウザ内プロジェクト・ディスク未保存）`,
    "tip.unbound": (n) => `${n}\n（フォルダ未バインド・ファイルメニューでフォルダを開くと保存先が決まります）`,
    "tip.lib": (n) => `${n}\n（読み取り専用の埋め込みライブラリ）`,
    "tip.node.msx": "MSX-BASIC変換後（読み取り専用）",
    "tip.node.maptable": "変換テーブル：変数名の圧縮・関数・制御フローの対応（読み取り専用）",
    "tip.node.webmsx": "アプリ内 WebMSX で実行",
    "proj.newfile": "新規ファイル", "proj.newfilemsg": "ファイル名（.msxb）:",
    "proj.rename": "名前を変更", "proj.renamemsg": "新しいファイル名:",
    "proj.delete": "削除", "proj.deletemsg": (n) => `「${n}」を削除しますか？`,
    "proj.exists": (n) => `「${n}」は既に存在します`, "proj.last": "最後の1ファイルは削除できません",
    "proj.setmain": "mainに指定（変換/実行の起点）", "proj.clearmain": "main指定を解除（自動判定に戻す）",
    "proj.mainexplicit": "main（明示指定・変換/実行の起点）", "proj.mainauto": "main（自動判定・変換/実行の起点）",
    "proj.mainset": (n) => `「${n}」を main（起点）に指定しました`, "proj.maincleared": "main指定を解除（自動判定）しました",
    "set.webmsx": "WebMSX 実行",
    "set.machine": "機種", "set.machinedefault": "既定（WebMSX）",
    "set.machinehint": "turbo R の例や FM 検証時に切替。既定のままで多くの例は動作",
    "set.presets": "拡張(PRESETS)", "set.presetshint": "カンマ区切り。FM を試す機種では MSXMUSIC を指定",
    "set.url": "WebMSX URL", "set.save": "保存", "set.cancel": "キャンセル",
    "runmsx": "▶ WebMSXで実行", "reverse": "MSX→構造化に逆変換", "helpsc": "キーボードショートカット…",
    "m.app": "FunctionBASIC", "about": "FunctionBASICについて",
    "about.body": (v) => `FunctionBASIC  v${v}\n\n構造化BASIC → MSX-BASIC 変換エディタ`,
    "tb.save": "変換して保存", "tb.play": "▶ WebMSX", "tb.font": "文字",
    "tab.structured": "構造化BASIC", "tab.msx": "MSX-BASIC変換後", "tab.webmsx": "実行 (WebMSX)", "tab.maptable": "変換テーブル", "tab.close": "タブを閉じる",
    "note.webmsx": "▶ WebMSX（または Ctrl/Cmd+Enter）を押すと、ここで自動実行します", "note.copy": "📋 コピー",
    "maptable.copy": "📋 JSON",
    "maptable.note": "変数名の圧縮・関数・制御フローの対応表（読み取り専用）",
    "maptable.none": "（変換テーブルはまだありません。エラーが無い状態でソースを変換すると表示されます）",
    "maptable.globals": (n) => `グローバル変数（${n}）`,
    "maptable.functions": (n) => `関数（${n}）`,
    "maptable.controlflow": (n) => `制御フロー（BREAK / CONTINUE）（${n}）`,
    "maptable.col.orig": "元の名前", "maptable.col.msx": "MSX名",
    "maptable.entry": "先頭行", "maptable.params": "引数", "maptable.ret": "戻り値", "maptable.locals": "ローカル変数",
    "maptable.ref": "参照", "maptable.none.sub": "（なし）",
    "maptable.cf.from": "元の行", "maptable.cf.to": "飛び先",
    "ready": "準備完了",
    "msx.ok": "▶ WebMSX で実行できます", "msx.err": "文法エラーのため変換できません",
    "link.map": (s, m) => `構造化 ${s}行 → MSX ${m}行（緑）`,
    "link.noout": (s) => `構造化 ${s}行：変換後に出力はありません（GLOBAL宣言・コメント・空行など）`,
    "msx.errbody": "（構造化BASICタブのエラーを修正してください）",
    "st.ok": "OK", "st.okwarn": (n) => `OK（警告 ${n} 件）`, "st.err": (n) => `⚠ エラー ${n} 件`,
    "st.elsewhere": (m) => `（うち他ファイル ${m} 件・クリックでProblems）`,
    "prob.title": "Problems", "prob.count": (e, w) => `エラー ${e} / 警告 ${w}`,
    "prob.create": "このファイルを作成", "prob.createlbl": "作成",
    "folder.created": (n) => `作成しました: ${n}`,
    "save.err": (e) => "保存に失敗しました: " + e, "save.errchk": "誤りがあります。確認してください（変換前のみ保存）",
    "save.done": "保存しました（.msxb / .map.json / .bas、Shift-JIS）",
    "save.dl": "保存しました（.msxb / .map.json / .bas）※Shift-JIS化はデスクトップ版で",
    "save.src": "保存しました（.msxb）",
    "save.srcdl": "保存しました（.msxb をダウンロード）",
    "savesrc": "保存（ソース）", "openfolder": "フォルダを開く…", "reloadfolder": "ディスクから再読込",
    "folder.opened": (n) => `フォルダを開きました（${n} ファイル）`,
    "folder.reloaded": (n) => `ディスクから再読込しました（${n} ファイル）`,
    "folder.bound": "フォルダを紐付けて保存しました",
    "folder.nobind": "フォルダが未バインドです（先に「フォルダを開く」）",
    "folder.empty": "フォルダに .msxb がありません",
    "folder.desktoponly": "「フォルダを開く」はデスクトップ版のみです",
    "sync.reloaded": (n) => `外部で更新 → 再読込しました: ${n}`,
    "sync.synced": (n) => `ディスクと同期しました: ${n}`,
    "sync.removed": (n) => `外部で削除されました: ${n}`,
    "sync.removeddirty": (n) => `外部で削除されました（未保存のため保持・次の保存で再作成）: ${n}`,
    "sync.tookdisk": (n) => `ディスクの内容を採用しました: ${n}`,
    "sync.tookeditor": (n) => `エディタの内容を保持しました（次の保存で上書き）: ${n}`,
    "sync.conflict.title": (n) => `外部変更と競合: ${n}`,
    "sync.conflict.body": "このファイルは外部で変更されました。エディタに未保存の編集があります。どうしますか？",
    "sync.conflict.disk": "ディスクの内容で置き換える",
    "sync.conflict.keep": "エディタの内容を保持",
    "sync.conflict.diff": "差分を見る",
    "sync.diff.title": "差分",
    "sync.diff.legend": "- = エディタのみ  /  + = ディスクのみ  /  空白 = 一致",
    "sync.reload.title": "ディスクから再読込",
    "sync.reload.body": "未保存の変更があります。破棄してディスクの内容を読み込みますか？",
    "sync.confirm.body": (n) => `外部で更新されました: ${n} を再読込しますか？`,
    "welcome.title": "プロジェクトを開く",
    "welcome.body": "編集するプロジェクトフォルダを選んでください。",
    "welcome.lost": "前回のプロジェクトフォルダが見つかりません（移動・削除された可能性）。別のフォルダを開くか、新規作成してください。",
    "welcome.open": "フォルダを開く…",
    "welcome.new": "新規プロジェクト…",
    "welcome.gone.title": "開けません",
    "welcome.gone.body": (n) => `${n} は見つかりませんでした（最近の一覧から削除しました）。`,
    "proj.leave.title": "プロジェクトの切替",
    "proj.leave.body": "未保存の変更があります。保存してから開きますか？",
    "proj.leave.save": "保存して開く",
    "proj.leave.discard": "保存せず開く",
    "proj.created": "新規プロジェクトを作成しました",
    "welcome.recover": "現在の内容を保存して開く（復旧）",
    "proj.recovered": "現在の内容を新しいフォルダへ保存しました",
    "newproject": "新規プロジェクト…",
    "recentprojects": "最近のプロジェクト…",
    "run.noerr": "エラーがあるため実行できません",
    "run.ok": (name, note) => `アプリ内WebMSXで実行（RUN"${name}"）${note}`,
    "run.note": (n) => `（日本語等${n}字は実行用に除去）`, "run.open.err": "WebMSXを開けませんでした",
    "dsk.noerr": "エラーがあるためディスクを作成できません", "dsk.desktoponly": "ディスク(.dsk)作成はデスクトップ版で利用できます",
    "dsk.cancel": "ディスク作成をキャンセルしました",
    "dsk.ok": (path, name) => `ディスク作成: ${path} → WebMSXにドラッグ後 RUN"${name}"`,
    "dsk.err": (e) => "ディスク作成に失敗: " + e,
    "sav.noerr": "エラーがあるため.savを作成できません", "sav.desktoponly": ".sav作成はデスクトップ版で利用できます",
    "sav.cancel": ".sav作成をキャンセルしました",
    "sav.ok": (path, name, backup) =>
      `.sav作成: ${path}${backup ? `（既存ファイルを ${backup} にバックアップ）` : ""} → MSXPLAYerのワークドライブに置き FILES で確認、RUN"${name}"`,
    "sav.err": (e) => ".sav作成に失敗: " + e,
    "rev.noerr": "エラーがあるため逆変換できません",
    "import": "素のMSX-BASICを取込…",
    "import.done": (name, warns) => `取込完了: ${name}` + (warns ? `（要確認 ${warns} 件は ' [未対応] コメントを参照）` : "（警告なし）"),
    "import.empty": "取込できる行がありませんでした（行番号付きMSX-BASICのテキストを選んでください）",
    "import.err": (e) => "取込に失敗: " + e,
    "copy.ok": "コピーしました", "copy.err": "コピーに失敗（手動で選択してコピー）",
    "ok": "OK", "cancel": "キャンセル",
    "confirm.title": "確認", "confirm.reverse": "逆変換（MSX→構造化）の結果でエディタを置き換えますか？（往復確認）",
    "prompt.goline.title": "行へ移動", "prompt.goline": "移動先のエディタ行番号:",
    "sc.title": "キーボードショートカット",
    "sc.body": `  保存:                Ctrl/Cmd + S\n  WebMSXで実行:        Ctrl/Cmd + Enter\n  元に戻す / やり直し:   Ctrl/Cmd + Z / Shift + Z\n  検索（トグル）:       Ctrl/Cmd + F\n  置換:                Ctrl/Cmd + R\n  全体検索:             Ctrl/Cmd + Shift + F\n  次/前の一致:          F3 / Shift + F3\n  行を複製:             Ctrl/Cmd + D\n  行を上下に移動:       Alt + ↑ / ↓\n  整形(ｲﾝﾃﾞﾝﾄ+大文字化): Ctrl/Cmd + Alt + L\n  定義へ移動:           Ctrl/Cmd + B\n  識別子をリネーム:     Shift + F6\n  使用箇所(順送り):     Alt + F7\n  戻る / 進む:          Ctrl/Cmd + Alt + ← / →\n  行へ移動:             Ctrl/Cmd + G\n  ブックマーク 切替/次:  F11 / Shift + F11\n  スニペット:           行頭で fn/for/if/while + Tab\n  インデント:           Tab`,
  },
  en: {
    "title": "Structured BASIC Editor — MSX-BASIC",
    "m.file": "File", "m.edit": "Edit", "m.view": "View", "m.run": "Run", "m.help": "Help",
    "save": "Convert & Save", "dsk": "Save Disk (.dsk)…", "sav": "Save for MSXPLAYer (.sav)…",
    "undo": "Undo", "redo": "Redo", "m.find": "Find", "m.replace": "Replace", "m.gfind": "Find Everywhere",
    "m.asm": "Disassemble machine-code DATA", "m.asmclear": "Clear annotations",
    "asm.done": (n) => `Annotated machine-code DATA (${n})`, "asm.none": "No machine-code DATA found",
    "asm.cleared": "Cleared mnemonic annotations",
    "undo.none": "Nothing to undo", "redo.none": "Nothing to redo",
    "format": "Reformat (indent + uppercase)", "def": "Go to Definition", "usages": "Find Usages (cycle)", "goline": "Go to Line…",
    "rn.menu": "Rename Symbol…",
    "rn.title": "Rename", "rn.msg": (n) => `Rename all "${n}". New name:`,
    "rn.done": (n, name) => `Renamed ${n} occurrence(s) to "${name}"`,
    "rn.donefiles": (n, name, f) => `Renamed ${n} occurrence(s) in ${f} file(s) to "${name}"`,
    "rn.none": "No occurrences of this name",
    "rn.preview": (o, next, total, files) => `Replace "${o}" → "${next}" in ${files} file(s), ${total} occurrence(s):`,
    "rn.libwarn": "Note: a read-only library also uses this name. Libraries are not changed, so references may break.",
    "rn.notident": "Place the caret on an identifier first",
    "rn.builtin": (n) => `"${n}" is a built-in name and cannot be renamed`,
    "rn.readonly": "Read-only",
    "back": "Back", "fwd": "Forward", "bm": "Toggle Bookmark", "bmnext": "Next Bookmark",
    "splitright": "Split Active Tab Right", "merge": "Unsplit (Merge)", "reset": "Reset Tab Layout",
    "fontup": "Increase Font", "fontdown": "Decrease Font",
    "m.settings": "Settings…", "set.title": "Settings",
    "set.lang": "Language", "set.font": "Font size",
    "set.editor": "Editor assist",
    "set.autoindent": "Auto-indent (Enter)", "set.autopair": "Auto-close brackets / quotes",
    "set.curline": "Highlight current line",
    "set.watchexternal": "Detect & reconcile external file changes (desktop)",
    "set.autoreload": "Auto-reload when no conflict (OFF = ask each time)",
    "set.transpile": "Transpile (optimization)", "set.optimize": "Constant folding (precompute literal arithmetic)",
    "set.strength": "Power strength reduction (X^2 → X*X, exponent 2-4)",
    "set.stripcomments": "Strip comments (size/speed build; jump targets kept)",
    "set.hotplace": "Place hot functions at low line numbers (shorter GOSUB search = faster)",
    "set.recdepth": "Max recursion stack depth",
    "find.find": "Find", "find.replace": "Replace with", "find.one": "Replace", "find.all": "All",
    "find.case": "Match case", "find.regex": "Regular expression", "find.prev": "Previous", "find.next": "Next", "find.close": "Close (Esc)",
    "find.replaced": (n) => `Replaced ${n} occurrence(s)`,
    "find.gtitle": "Find in Files", "find.gfind": "Search everywhere (incl. libs & MSX output)", "find.badre": "Bad regex",
    "find.gcount": (n, f) => `${n} in ${f} file(s)`,
    "src.main": "Structured BASIC", "src.msx": "MSX-BASIC (output)",
    "proj.title": "Project", "proj.libs": "Libraries (read-only)", "proj.run": "Run",
    "tip.browser": (n) => `${n}\n(browser project — not saved to disk)`,
    "tip.unbound": (n) => `${n}\n(folder not bound — open a folder from the File menu to set where it saves)`,
    "tip.lib": (n) => `${n}\n(read-only bundled library)`,
    "tip.node.msx": "MSX-BASIC output (read-only)",
    "tip.node.maptable": "Conversion table: name compression, functions, control flow (read-only)",
    "tip.node.webmsx": "Run in the in-app WebMSX",
    "proj.newfile": "New file", "proj.newfilemsg": "File name (.msxb):",
    "proj.rename": "Rename", "proj.renamemsg": "New file name:",
    "proj.delete": "Delete", "proj.deletemsg": (n) => `Delete "${n}"?`,
    "proj.exists": (n) => `"${n}" already exists`, "proj.last": "Cannot delete the last file",
    "proj.setmain": "Set as main (build/run entry)", "proj.clearmain": "Clear main (back to auto-detect)",
    "proj.mainexplicit": "main (explicit — build/run entry)", "proj.mainauto": "main (auto-detected — build/run entry)",
    "proj.mainset": (n) => `Set "${n}" as main (entry)`, "proj.maincleared": "Cleared main (auto-detect)",
    "set.webmsx": "WebMSX run",
    "set.machine": "Machine", "set.machinedefault": "Default (WebMSX)",
    "set.machinehint": "Switch for turbo R examples or FM tests; most examples run on the default",
    "set.presets": "Extensions (PRESETS)", "set.presetshint": "Comma-separated. Use MSXMUSIC on an FM-capable machine to try FM",
    "set.url": "WebMSX URL", "set.save": "Save", "set.cancel": "Cancel",
    "runmsx": "▶ Run in WebMSX", "reverse": "Reverse: MSX → Structured", "helpsc": "Keyboard Shortcuts…",
    "m.app": "FunctionBASIC", "about": "About FunctionBASIC",
    "about.body": (v) => `FunctionBASIC  v${v}\n\nStructured BASIC → MSX-BASIC converter/editor`,
    "tb.save": "Convert & Save", "tb.play": "▶ WebMSX", "tb.font": "Font",
    "tab.structured": "Structured BASIC", "tab.msx": "MSX-BASIC (output)", "tab.webmsx": "Run (WebMSX)", "tab.maptable": "Conversion table", "tab.close": "Close tab",
    "note.webmsx": "Press ▶ WebMSX (or Ctrl/Cmd+Enter) to run here automatically.", "note.copy": "📋 Copy",
    "maptable.copy": "📋 JSON",
    "maptable.note": "How names are compressed, plus function & control-flow mapping (read-only)",
    "maptable.none": "(No conversion table yet. It appears once the source converts without errors.)",
    "maptable.globals": (n) => `Global variables (${n})`,
    "maptable.functions": (n) => `Functions (${n})`,
    "maptable.controlflow": (n) => `Control flow (BREAK / CONTINUE) (${n})`,
    "maptable.col.orig": "Original name", "maptable.col.msx": "MSX name",
    "maptable.entry": "entry line", "maptable.params": "params", "maptable.ret": "returns", "maptable.locals": "Local variables",
    "maptable.ref": "REF", "maptable.none.sub": "(none)",
    "maptable.cf.from": "from line", "maptable.cf.to": "target",
    "ready": "Ready",
    "msx.ok": "Run it with ▶ WebMSX", "msx.err": "Cannot convert: syntax error",
    "link.map": (s, m) => `Structured L${s} → MSX ${m} (green)`,
    "link.noout": (s) => `Structured L${s}: no output (GLOBAL decl / comment / blank)`,
    "msx.errbody": "(Fix the errors in the Structured BASIC tab.)",
    "st.ok": "OK", "st.okwarn": (n) => `OK (${n} warning(s))`, "st.err": (n) => `⚠ ${n} error(s)`,
    "st.elsewhere": (m) => ` (${m} in other files — click for Problems)`,
    "prob.title": "Problems", "prob.count": (e, w) => `${e} error(s) / ${w} warning(s)`,
    "prob.create": "Create this file", "prob.createlbl": "Create",
    "folder.created": (n) => `Created: ${n}`,
    "save.err": (e) => "Save failed: " + e, "save.errchk": "There are errors. Saved source only.",
    "save.done": "Saved (.msxb / .map.json / .bas, Shift-JIS)",
    "save.dl": "Saved (.msxb / .map.json / .bas). Shift-JIS encoding is desktop-only.",
    "save.src": "Saved (.msxb)",
    "save.srcdl": "Saved (.msxb download)",
    "savesrc": "Save (source)", "openfolder": "Open Folder…", "reloadfolder": "Reload from Disk",
    "folder.opened": (n) => `Opened folder (${n} files)`,
    "folder.reloaded": (n) => `Reloaded from disk (${n} files)`,
    "folder.bound": "Bound folder and saved",
    "folder.nobind": "No folder bound (use Open Folder first)",
    "folder.empty": "No .msxb files in the folder",
    "folder.desktoponly": "Open Folder is desktop-only",
    "sync.reloaded": (n) => `Changed externally → reloaded: ${n}`,
    "sync.synced": (n) => `Synced with disk: ${n}`,
    "sync.removed": (n) => `Deleted externally: ${n}`,
    "sync.removeddirty": (n) => `Deleted externally (kept — unsaved; recreated on next save): ${n}`,
    "sync.tookdisk": (n) => `Took disk version: ${n}`,
    "sync.tookeditor": (n) => `Kept editor version (overwrites disk on next save): ${n}`,
    "sync.conflict.title": (n) => `External-change conflict: ${n}`,
    "sync.conflict.body": "This file was changed externally and you have unsaved edits. What do you want to do?",
    "sync.conflict.disk": "Replace with disk version",
    "sync.conflict.keep": "Keep my editor version",
    "sync.conflict.diff": "Show diff",
    "sync.diff.title": "Diff",
    "sync.diff.legend": "- = editor only  /  + = disk only  /  blank = same",
    "sync.reload.title": "Reload from Disk",
    "sync.reload.body": "You have unsaved changes. Discard them and load the disk version?",
    "sync.confirm.body": (n) => `${n} was changed externally. Reload it?`,
    "welcome.title": "Open a Project",
    "welcome.body": "Choose a project folder to work in.",
    "welcome.lost": "The last project folder was not found (moved or deleted). Open another folder or create a new one.",
    "welcome.open": "Open Folder…",
    "welcome.new": "New Project…",
    "welcome.gone.title": "Can't open",
    "welcome.gone.body": (n) => `${n} was not found (removed from recents).`,
    "proj.leave.title": "Switch Project",
    "proj.leave.body": "You have unsaved changes. Save before opening?",
    "proj.leave.save": "Save & Open",
    "proj.leave.discard": "Open Without Saving",
    "proj.created": "Created new project",
    "welcome.recover": "Save current content & open (recover)",
    "proj.recovered": "Saved current content to the new folder",
    "newproject": "New Project…",
    "recentprojects": "Recent Projects…",
    "run.noerr": "Cannot run: there are errors.",
    "run.ok": (name, note) => `Running in the embedded WebMSX (RUN"${name}")${note}`,
    "run.note": (n) => ` (${n} non-ASCII char(s) stripped for run)`, "run.open.err": "Could not open WebMSX.",
    "dsk.noerr": "Cannot create disk: there are errors.", "dsk.desktoponly": "Disk (.dsk) creation is available in the desktop app.",
    "dsk.cancel": "Disk creation cancelled.",
    "dsk.ok": (path, name) => `Disk created: ${path} → drag into WebMSX, then RUN"${name}"`,
    "dsk.err": (e) => "Disk creation failed: " + e,
    "sav.noerr": "Cannot create .sav: there are errors.", "sav.desktoponly": ".sav creation is available in the desktop app.",
    "sav.cancel": ".sav creation cancelled.",
    "sav.ok": (path, name, backup) =>
      `.sav created: ${path}${backup ? ` (existing file backed up to ${backup})` : ""} → place on the MSXPLAYer work drive, then FILES / RUN"${name}"`,
    "sav.err": (e) => ".sav creation failed: " + e,
    "rev.noerr": "Cannot reverse: there are errors.",
    "import": "Import plain MSX-BASIC…",
    "import.done": (name, warns) => `Imported: ${name}` + (warns ? ` (${warns} item(s) need review — see the ' [未対応] comments)` : " (no warnings)"),
    "import.empty": "Nothing to import (choose a text listing of line-numbered MSX-BASIC).",
    "import.err": (e) => "Import failed: " + e,
    "copy.ok": "Copied.", "copy.err": "Copy failed (select and copy manually).",
    "ok": "OK", "cancel": "Cancel",
    "confirm.title": "Confirm", "confirm.reverse": "Replace the editor with the reverse-converted result (MSX → Structured)?",
    "prompt.goline.title": "Go to Line", "prompt.goline": "Editor line number:",
    "sc.title": "Keyboard Shortcuts",
    "sc.body": `  Save:                 Ctrl/Cmd + S\n  Run in WebMSX:        Ctrl/Cmd + Enter\n  Undo / Redo:          Ctrl/Cmd + Z / Shift + Z\n  Find (toggle):        Ctrl/Cmd + F\n  Replace:              Ctrl/Cmd + R\n  Find everywhere:      Ctrl/Cmd + Shift + F\n  Next / Prev match:    F3 / Shift + F3\n  Duplicate line:       Ctrl/Cmd + D\n  Move line up/down:    Alt + ↑ / ↓\n  Format (uppercase):   Ctrl/Cmd + Alt + L\n  Go to definition:     Ctrl/Cmd + B\n  Rename symbol:        Shift + F6\n  Find usages (cycle):  Alt + F7\n  Back / Forward:       Ctrl/Cmd + Alt + ← / →\n  Go to line:           Ctrl/Cmd + G\n  Bookmark toggle/next: F11 / Shift + F11\n  Snippets:             fn/for/if/while + Tab at line start\n  Indent:               Tab`,
  },
};
let lang = localStorage.getItem("fbe-lang") === "en" ? "en" : "ja";

// ---- 設定（言語は fbe-lang、その他は fbe-settings に永続化）----
const SETTINGS_KEY = "fbe-settings";
const DEFAULT_SETTINGS = {
  webmsxUrl: "https://webmsx.org",
  webmsxMachine: "", // "" = WebMSX 既定機。MSX1/MSX2/MSX2P/MSX2PA/MSXTR 等
  webmsxPresets: "", // 例: "MSXMUSIC"（カンマ区切り）。FM を試す機種で指定
  fontSize: 15,
  autoIndent: true, // Enter で構造に応じて自動字下げ/字上げ
  autoPair: true, // ( と " の自動補完（選択を囲む / 対応閉じはタイプオーバー）
  curLine: true, // 現在行ハイライト
  optimize: false, // 定数畳み込み最適化（オプトイン・既定OFF）
  strengthReduce: false, // べき乗の強度低減 X^2→X*X（オプトイン・既定OFF）
  stripComments: false, // コメント除去（オプトイン・既定OFF）
  hotPlacement: false, // 呼出頻度順に関数を低い行番号へ（GOSUB探索短縮・オプトイン・既定OFF）
  recursionDepth: 100, // 再帰スタックの最大深さ（DIMサイズ）
  findCase: false, // 検索の大文字小文字を区別
  findRegex: false, // 検索を正規表現として扱う（単純/全体で共有）
  watchExternal: true, // 外部ファイル変更の検出と整合（docs/14）。デスクトップのみ
  autoReloadExternal: true, // 非競合の外部変更を自動で再読込（false=毎回確認）
};
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
let settings = loadSettings();
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function t(key, ...args) {
  const v = (I18N[lang] && I18N[lang][key]) ?? I18N.ja[key] ?? key;
  return typeof v === "function" ? v(...args) : v;
}
function applyI18n() {
  document.documentElement.lang = lang;
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-lang]").forEach((mi) => {
    mi.classList.toggle("checked", mi.dataset.lang === lang);
  });
  // ネイティブのウィンドウタイトルも言語連動（デスクトップ）
  if (isDesktop()) {
    try {
      tauri().core.invoke("set_window_title", { title: t("title") });
    } catch (e) {
      logErr("set_window_title", e);
    }
  }
}
function setLang(l) {
  lang = l === "en" ? "en" : "ja";
  localStorage.setItem("fbe-lang", lang);
  applyI18n();
  renderTabs(); // タブ名
  renderHeavy(); // ステータス・プレビュー注記
  if (isDesktop()) {
    try {
      tauri().core.invoke("set_menu_lang", { lang });
    } catch (e) {
      logErr("set_menu_lang", e);
    }
  }
}

function setStatus(kind, msg) {
  statusEl.className = kind; // "" | "ok" | "err"
  statusEl.textContent = msg;
  log("status:", kind || "info", msg);
}

// 自前モーダル（ネイティブ alert/confirm/prompt を避け、タイトル/言語/見た目を制御）
let modalResolve = null;
// buttons: [{label, value, primary?}] を渡すと OK/Cancel の代わりに任意ボタン群を表示し、
// クリックでその value を resolve する（競合ダイアログの3択などに使う）。
function openModal({ title, body = "", input = null, cancel = false, buttons = null }) {
  $("modalTitle").textContent = title;
  $("modalBody").textContent = body;
  const inp = $("modalInput");
  if (input !== null) {
    inp.hidden = false;
    inp.value = input;
  } else {
    inp.hidden = true;
  }
  const actions = document.querySelector("#modal .modal-actions");
  actions.querySelectorAll(".modal-custom-btn").forEach((b) => b.remove()); // 前回の任意ボタンを撤去
  const ok = $("modalOk");
  const c = $("modalCancel");
  if (buttons) {
    ok.hidden = true;
    c.hidden = true;
    for (const b of buttons) {
      const el = document.createElement("button");
      el.className = "modal-custom-btn";
      el.textContent = b.label;
      el.addEventListener("click", () => resolveModal(b.value));
      actions.appendChild(el);
    }
  } else {
    ok.hidden = false;
    c.hidden = !cancel && input === null;
    c.textContent = t("cancel");
  }
  $("modal").hidden = false;
  const focusEl = buttons ? actions.querySelector(".modal-custom-btn") : (input !== null ? inp : ok);
  focusEl?.focus();
  return new Promise((res) => {
    modalResolve = res;
  });
}
function resolveModal(val) {
  $("modal").hidden = true;
  const r = modalResolve;
  modalResolve = null;
  if (r) r(val);
}
// OK専用（情報表示）
const showModal = (title, body) => openModal({ title, body });
// はい/キャンセル → boolean
const showConfirm = (title, body) => openModal({ title, body, cancel: true }).then((v) => v === true);
// 入力 → string | null
const showPrompt = (title, body = "", def = "") =>
  openModal({ title, body, input: def }).then((v) => (typeof v === "string" ? v : null));

// ---- 設定ダイアログ ----
function openSettings() {
  $("setLang").value = lang;
  $("setFontSize").value = settings.fontSize;
  $("setAutoIndent").checked = settings.autoIndent;
  $("setAutoPair").checked = settings.autoPair;
  $("setCurLine").checked = settings.curLine;
  $("setWatchExternal").checked = settings.watchExternal;
  $("setAutoReload").checked = settings.autoReloadExternal;
  $("setOptimize").checked = settings.optimize;
  $("setStrengthReduce").checked = settings.strengthReduce;
  $("setStripComments").checked = settings.stripComments;
  $("setHotPlacement").checked = settings.hotPlacement;
  $("setRecDepth").value = settings.recursionDepth;
  $("setMachine").value = settings.webmsxMachine;
  $("setPresets").value = settings.webmsxPresets;
  $("setUrl").value = settings.webmsxUrl;
  $("settings").hidden = false;
}
function closeSettings() {
  $("settings").hidden = true;
}
function applySettingsFromForm() {
  setLang($("setLang").value === "en" ? "en" : "ja");
  applyFontSize(parseInt($("setFontSize").value, 10) || settings.fontSize);
  settings.autoIndent = $("setAutoIndent").checked;
  settings.autoPair = $("setAutoPair").checked;
  settings.curLine = $("setCurLine").checked;
  settings.watchExternal = $("setWatchExternal").checked;
  settings.autoReloadExternal = $("setAutoReload").checked;
  settings.optimize = $("setOptimize").checked;
  settings.strengthReduce = $("setStrengthReduce").checked;
  settings.stripComments = $("setStripComments").checked;
  settings.hotPlacement = $("setHotPlacement").checked;
  settings.recursionDepth = Math.min(1000, Math.max(1, parseInt($("setRecDepth").value, 10) || 100));
  settings.webmsxMachine = $("setMachine").value;
  settings.webmsxPresets = $("setPresets").value.trim();
  settings.webmsxUrl = $("setUrl").value.trim() || DEFAULT_SETTINGS.webmsxUrl;
  saveSettings();
  if (isDesktop() && project.dir) startWatching(project.dir); // 外部監視のON/OFFを反映
  applyEditorPrefs();
  render(); // 最適化トグル等の変更を変換プレビューへ即反映
  closeSettings();
}
// 想定外の失敗もコンソールに必ず残す
window.addEventListener("error", (e) =>
  console.error("[editor] uncaught", e.message, e.filename + ":" + e.lineno),
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("[editor] unhandledrejection", e.reason),
);

// ---- 堅牢なクリップボードコピー（secure context 不可でも execCommand で代替）----
function execCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    logErr("execCommand copy 失敗", e);
    return false;
  }
}
async function copyText(text) {
  // デスクトップ(Tauri)は WebView の execCommand/clipboard が不安定なので
  // OS 側（Rust の clipboard プラグイン）で確実に書き込む。
  if (isDesktop()) {
    try {
      await tauri().core.invoke("set_clipboard", { text });
      return true;
    } catch (e) {
      logErr("set_clipboard 失敗 → Web手段へフォールバック", e);
    }
  }
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      logErr("clipboard API 失敗 → execCommand へフォールバック", e);
    }
  }
  return execCopy(text);
}

const SAMPLE = `' ============================================================
'  これはサンプルです。自由に書き換え・削除してください。
'  This is a sample. Feel free to edit or delete it.
' ============================================================

' 配列の中から最初に 0 を見つけて返す
FUNCTION FIND_ZERO(REF IDX)
    GLOBAL A
    FOR I = 1 TO 10
        IF A(I) = 0 THEN
            IDX = I
            RETURN 1
        END IF
    NEXT I
    RETURN 0
END FUNCTION

DIM A(10)
A(3) = 0
RESULT = FIND_ZERO(WHERE)
PRINT "FOUND="; RESULT; " AT "; WHERE
`;

let last = { diags: [], msx: "", map: null, code: [] };

// ============ プロジェクト（Phase A: ブラウザ内仮想プロジェクト＝localStorage）============
// files: { "ファイル名": 内容 }（ユーザ編集可）。lib/* の埋め込みは LIBS（読み取り専用）。
// active: 現在開いているファイル名。WebMSX はファイルではなくツリーの固定ノード。
const PROJECT_KEY = "fbe-project";
let project = loadProject();
function loadProject() {
  try {
    const p = JSON.parse(localStorage.getItem(PROJECT_KEY) || "null");
    if (p && p.files && typeof p.files === "object" && p.active) { if (!p.baseline) p.baseline = {}; return p; }
  } catch (_) {}
  return { files: { "main.msxb": SAMPLE }, active: "main.msxb", baseline: {} };
}
let projSaveTimer = null;
function saveProject() {
  clearTimeout(projSaveTimer);
  projSaveTimer = setTimeout(() => {
    try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch (_) {}
  }, 300);
}

// ---- HTML エスケープ ----
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- シンタックスハイライト（実Lexerを再利用）----
// 設計方針: トークン位置は「色付け」だけに使い、行構造には一切影響させない。
// 文字を1つずつ出力し、改行は必ず span の外にリテラルで出す。こうすると、たとえ
// トークン位置が（全角/日本語行などで）ずれても、overlay の行数はソースと必ず一致する
// ＝ textarea(ネイティブ・キャレット) と色付き表示/行番号/現在行帯が絶対にずれない。
// 旧「境界スライス方式」は特定内容で改行を1つ落とし、overlay が1行短くなってキャレットが
// 隣行へ飛ぶ不具合があった。本方式は原理的にそれが起きない。
function highlightHtml(src) {
  const { tokens } = tokenize(src);
  const n = src.length;
  const lineStarts = [0];
  for (let i = 0; i < n; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const off = (p) => lineStarts[p.line - 1] + (p.column - 1);
  const cls = { KEYWORD: "t-kw", NUMBER: "t-num", STRING: "t-str", COMMENT: "t-com", OP: "t-op" };
  const real = tokens.filter((t) => t.kind !== "EOF");
  // 文字ごとのクラス（色）配列。先勝ち。改行文字は絶対に色付けしない。
  const klassAt = new Array(n).fill(null);
  for (let k = 0; k < real.length; k++) {
    const t = real[k];
    let klass = t.kind === "NEWLINE" ? null : (cls[t.kind] ?? null);
    if (t.kind === "COMMENT" && /^'@/.test(t.raw)) klass = "t-mnem"; // ニーモニック注釈は別色
    if (t.kind === "IDENT" && isBuiltin(t.value)) klass = "t-builtin";
    if (!klass) continue;
    const s = Math.max(0, off(t.pos));
    const e = Math.min(n, k + 1 < real.length ? off(real[k + 1].pos) : n);
    for (let j = s; j < e; j++) if (klassAt[j] == null && src[j] !== "\n") klassAt[j] = klass;
  }
  // 出力: 改行はリテラルで（span を必ず閉じてから）出す＝行数がソースと必ず一致する。
  let html = "";
  let cur = null, buf = "";
  const flush = () => { if (buf) { html += cur ? `<span class="${cur}">${esc(buf)}</span>` : esc(buf); buf = ""; } };
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (ch === "\n") { flush(); cur = null; html += "\n"; continue; }
    const c = klassAt[i];
    if (c !== cur) { flush(); cur = c; }
    buf += ch;
  }
  flush();
  // <textarea> は末尾改行の後の空行も1行として描く（キャレットが置ける）が、<pre> は末尾改行の
  // 後の空行に高さを与えない。末尾が改行なら不可視のプレースホルダ(ZWSP)を足し、行数を一致させる。
  if (src.endsWith("\n")) html += "​";
  return html;
}

// ---- コンパイル ----
// 組み込みライブラリの INCLUDE 解決（ブラウザは実FSが無いので埋め込み辞書を使う）。
// MAIN(エディタ本文)以外は LIBS から path / basename で引く。
const MAIN_PATH = "__main__";
function includeRead(path, src) {
  if (path === MAIN_PATH) return src;
  // 解決順: プロジェクト内ファイル → 埋め込みライブラリ(LIBS) → ベース名
  if (project.files[path] != null) return project.files[path];
  const base = path.split("/").pop();
  if (project.files[base] != null) return project.files[base];
  return LIBS[path] ?? LIBS[base] ?? null;
}

// 統合済みソースを実際にコンパイル（tokenize→parse→transform）。prov=由来情報（複数ファイル）。
function compileSource(source, incDiags, prov, extraOpts) {
  const { tokens, diagnostics: ld } = tokenize(source);
  const { program, diagnostics: pd } = parse(tokens);
  let t;
  try {
    t = transform(program, {
      optimize: settings.optimize, strengthReduce: settings.strengthReduce,
      stripComments: settings.stripComments, hotPlacement: settings.hotPlacement,
      recursionDepth: settings.recursionDepth,
      lineMap: prov?.lineMap, sources: prov?.sources, source: prov?.source,
      ...extraOpts,
    });
  } catch (e) {
    return {
      diags: [...incDiags, ...ld, ...pd, { code: "E_INTERNAL", key: "E_INTERNAL", params: { detail: String(e.message ?? e) }, message: String(e.message ?? e), line: 1, column: 1, severity: "error" }],
      msx: "", map: null, code: [],
    };
  }
  return { diags: [...incDiags, ...ld, ...pd, ...t.diagnostics], msx: renderMsx(t.code), map: t.map, code: t.code };
}

// 単一ソース（＝そのテキストをエントリ扱い）のコンパイル。逆変換プレビュー等で使用。
function compile(src) {
  if (/\bINCLUDE\b/i.test(src)) {
    const inc = resolveIncludes(MAIN_PATH, (p) => includeRead(p, src));
    return compileSource(inc.source, inc.diagnostics, { sources: inc.sources, lineMap: inc.lineMap });
  }
  return compileSource(src, []);
}

// 編集中ファイルは未保存の srcEl.value を使う（active→ライブ）。それ以外は project / LIBS。
function activePath() { return viewingLib ? null : project.active; }
function fileContent(path) {
  const ap = activePath();
  if (ap && path === ap) return srcEl.value;
  return project.files[path];
}
function readForBuild(path) {
  const ap = activePath();
  if (ap && (path === ap || path === ap.split("/").pop())) return srcEl.value;
  if (project.files[path] != null) return project.files[path];
  const base = path.split("/").pop();
  if (project.files[base] != null) return project.files[base];
  return LIBS[path] ?? LIBS[base] ?? null;
}

// ファイル本文の INCLUDE 先（パス）一覧。
function includesOf(text) {
  const out = [];
  const re = /^\s*INCLUDE\s+"([^"]+)"/gim;
  let m;
  while ((m = re.exec(text || "")) !== null) out.push(m[1]);
  return out;
}
// トップレベル（FUNCTION外）に実行コードがあるか（コメント/INCLUDE/空行は除く）。
function hasTopLevelCode(text) {
  let depth = 0;
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.replace(/'.*$/, "").trim();
    if (!line) continue;
    const up = line.toUpperCase();
    if (/^FUNCTION\b/.test(up)) { depth++; continue; }
    if (/^END\s+FUNCTION\b/.test(up)) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue;
    if (/^(INCLUDE|REM)\b/.test(up)) continue;
    return true;
  }
  return false;
}
// エントリ（main）ファイルを解決：明示指定があればそれ、無ければ自動判定。
function currentEntry() {
  if (project.mainFile && project.files[project.mainFile] != null) return project.mainFile;
  return autoEntry();
}
function autoEntry() {
  const files = Object.keys(project.files);
  if (files.length <= 1) return files[0] ?? project.active;
  // 他からINCLUDEされているファイルの集合
  const included = new Set();
  for (const f of files) for (const inc of includesOf(fileContent(f))) {
    if (project.files[inc] != null) included.add(inc);
    else { const b = inc.split("/").pop(); if (project.files[b] != null) included.add(b); }
  }
  const cands = files.filter((f) => !included.has(f) && hasTopLevelCode(fileContent(f)));
  if (cands.length === 1) return cands[0];
  if (cands.length === 0) return project.active; // 全部ライブラリ風 → 編集中をフォールバック
  return cands.includes(project.active) ? project.active : cands.sort()[0]; // 曖昧時はactive優先
}
// プロジェクトのエントリから統合ビルド（編集中の未保存内容も反映）。
function compileProject(extraOpts) {
  const entry = currentEntry();
  const inc = resolveIncludes(entry, readForBuild);
  return compileSource(inc.source, inc.diagnostics, { source: entry, sources: inc.sources, lineMap: inc.lineMap }, extraOpts);
}

// 実行可能な全エントリ（他からINCLUDEされておらず、トップレベルコードを持つファイル）。
function allEntries() {
  const files = Object.keys(project.files);
  if (files.length <= 1) return files.length ? files : [];
  const included = new Set();
  for (const f of files) for (const inc of includesOf(fileContent(f))) {
    if (project.files[inc] != null) included.add(inc);
    else { const b = inc.split("/").pop(); if (project.files[b] != null) included.add(b); }
  }
  const cands = files.filter((f) => !included.has(f) && hasTopLevelCode(fileContent(f)));
  return cands.length ? cands : [currentEntry()];
}
// include の由来ファイル名をプロジェクトのファイルキーへ正規化（パス→basename フォールバック）。
function toProjectKey(f) {
  if (project.files[f] != null) return f;
  const b = f.split("/").pop();
  if (project.files[b] != null) return b;
  return f; // 埋め込みライブラリ等はそのまま（クリック時に openLib で解決）
}
// 全エントリを検証し、診断を由来(file:line)へ再マップして集約（重複除去）。
// current=現エントリのビルド結果（変換後プレビュー用）を併せて返す。
// テキスト内で定義される FUNCTION 名の集合。
function funcNamesIn(text) {
  const names = new Set();
  const toks = tokensAbs(text).map((x) => x.t);
  for (let i = 0; i < toks.length - 1; i++)
    if (toks[i].kind === "KEYWORD" && toks[i].value === "FUNCTION") names.add(toks[i + 1].value);
  return names;
}
// テキスト内に出現する IDENT の集合。
function identsIn(text) {
  const s = new Set();
  for (const x of tokensAbs(text)) if (x.t.kind === "IDENT") s.add(x.t.value);
  return s;
}
// 取り込んだのに定義した関数が一切使われていない INCLUDE を警告（保守的：関数を定義する lib のみ判定）。
function unusedIncludeWarnings(sources) {
  const warns = [];
  const texts = {};
  for (const f of sources) texts[f] = readForBuild(f) ?? "";
  for (const lib of sources.slice(1)) {
    const defs = funcNamesIn(texts[lib]);
    if (!defs.size) continue; // GLOBAL/CONST だけの lib は誤検知回避のため対象外
    let used = false;
    for (const f of sources) {
      if (f === lib) continue;
      const ids = identsIn(texts[f]);
      for (const d of defs) if (ids.has(d)) { used = true; break; }
      if (used) break;
    }
    if (used) continue;
    const base = lib.split("/").pop();
    let loc = null;
    for (const f of sources) {
      const lines = texts[f].split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*INCLUDE\s+"([^"]+)"/i);
        if (m && (m[1] === lib || m[1].split("/").pop() === base)) { loc = { file: f, line: i + 1 }; break; }
      }
      if (loc) break;
    }
    if (loc) warns.push({
      file: toProjectKey(loc.file), line: loc.line, column: 1, code: "W_UNUSED_INCLUDE",
      msg: lang === "en" ? `Unused INCLUDE: nothing from "${lib}" is used` : `未使用の INCLUDE: "${lib}" の定義が使われていません`,
      severity: "warning",
    });
  }
  return warns;
}
function projectDiagnostics() {
  const cur = currentEntry();
  const seen = new Set();
  const list = [];
  let current = null;
  const add = (e) => {
    const key = `${e.file}:${e.line}:${e.column}:${e.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(e);
  };
  const build = (entry) => {
    const inc = resolveIncludes(entry, readForBuild);
    const r = compileSource(inc.source, inc.diagnostics, { source: entry, sources: inc.sources, lineMap: inc.lineMap });
    if (entry === cur) current = r;
    for (const d of r.diags) {
      const o = inc.lineMap && d.line >= 1 ? inc.lineMap[d.line - 1] : null;
      const file = o ? toProjectKey(o.file) : entry;
      const line = o ? o.line : d.line;
      const msg = d.key ? localize(d, lang) : d.message;
      add({ file, line, column: d.column, code: d.code, msg, severity: d.severity,
        path: d.code === "E_INCLUDE_NOT_FOUND" ? d.params?.path : undefined });
    }
    for (const w of unusedIncludeWarnings(inc.sources)) add(w);
  };
  for (const entry of allEntries()) { try { build(entry); } catch (_) {} }
  if (!current) { try { build(cur); } catch (_) {} } // 念のため現エントリ分を確保
  list.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) ||
    a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { list, current };
}

// ---- ガター（行番号＋×＋ブックマーク）----
const bookmarks = new Set();
function renderGutter(lineCount, errsByLine) {
  let html = "";
  for (let i = 1; i <= lineCount; i++) {
    const e = errsByLine.get(i);
    // エラー印は行番号の左に大きく出す（ホバーで内容ツールチップ、aria-labelも）。
    const tip = e ? esc(e.join("\n")) : "";
    const x = e ? `<span class="x" title="${tip}" aria-label="${tip}">×</span>` : "";
    const bm = bookmarks.has(i) ? `<span class="bm">★</span>` : "";
    html += `<div class="gl${e ? " err" : ""}" data-line="${i}">${x}${bm}${i}</div>`;
  }
  gutterEl.innerHTML = html;
}

// ---- Problems パネル（全ファイル横断の診断一覧。クリックで該当箇所へジャンプ）----
const problemsEl = $("problems");
let problemsOpen = false;
let problemsList = [];
function applyProblemsVisibility() {
  problemsEl.hidden = !(problemsOpen && problemsList.length);
  statusEl.classList.toggle("clickable", problemsList.length > 0);
}
function renderProblems(list, active, autoOpen) {
  problemsList = list;
  if (!list.length) { problemsOpen = false; problemsEl.innerHTML = ""; applyProblemsVisibility(); return; }
  if (autoOpen) problemsOpen = true;
  const errs = list.filter((d) => d.severity === "error").length;
  let html = `<div class="ph"><span>${esc(t("prob.title"))}　${esc(t("prob.count", errs, list.length - errs))}</span>` +
    `<span class="pclose" title="${esc(t("find.close"))}">✕</span></div>`;
  for (const d of list) {
    const cls = d.severity === "error" ? "err" : "warn";
    const here = d.file === active ? " here" : "";
    const create = d.path ? `<button class="pcreate" data-path="${esc(d.path)}" title="${esc(t("prob.create"))}">＋${esc(t("prob.createlbl"))}</button>` : "";
    html += `<div class="pr ${cls}${here}" data-file="${esc(d.file)}" data-line="${d.line}">` +
      `<span class="pf">${esc(d.file)}</span><span class="pl">:${d.line}:${d.column}</span>` +
      `<span class="pc">${esc(d.code)}</span><span class="pm">${esc(d.msg)}</span>${create}</div>`;
  }
  problemsEl.innerHTML = html;
  applyProblemsVisibility();
}
function toggleProblems() { if (problemsList.length) { problemsOpen = !problemsOpen; applyProblemsVisibility(); } }
problemsEl.addEventListener("click", (e) => {
  if (e.target.closest(".pclose")) { problemsOpen = false; applyProblemsVisibility(); return; }
  const cb = e.target.closest(".pcreate");
  if (cb) { e.stopPropagation(); createIncludeFile(cb.dataset.path); return; }
  const row = e.target.closest(".pr");
  if (!row) return;
  const file = row.dataset.file;
  const line = parseInt(row.dataset.line);
  if (project.files[file] != null) { openFile(file); recordJump(); scrollToLine(line); }
  else if (LIBS[file] != null || LIBS[file.split("/").pop()] != null) openLib(file, line);
});
statusEl.addEventListener("click", toggleProblems);

// 未解決 INCLUDE のクイックフィックス: その名前のファイルを作って開く。
async function createIncludeFile(path) {
  const name = (path || "").trim();
  if (!name) return;
  if (project.files[name] != null) { openFile(name); flash(t("proj.exists", name)); return; }
  syncActiveFile();
  project.files[name] = `' ${name}\n`;
  if (isDesktop() && project.dir && !name.includes("/")) {
    try { await saveSourceFile(name); } catch (e) { logErr("save_source", e); }
  }
  openFile(name); // renderTree + saveProject を含む
  flash(t("folder.created", name));
}

// ---- 軽い更新：シンタックスハイライトのみ（入力ごとに即時反映）----
// 表示文字は透明テキストエリア背後のハイライト層なので、これを即時更新しないと
// 「入力中は文字が見えない」状態になる。重い変換とは分離してここだけ毎打鍵で回す。
function paintHighlight() {
  hlEl.innerHTML = highlightHtml(srcEl.value);
  syncScroll();
}
// 連続入力時に1フレーム1回へ間引く（高速タイプ/長文ペーストでも詰まらない）
let hlScheduled = false;
function scheduleHighlight() {
  if (hlScheduled) return;
  hlScheduled = true;
  requestAnimationFrame(() => {
    hlScheduled = false;
    paintHighlight();
  });
}

// ---- 重い更新：変換・診断・プレビュー・ステータス（入力停止後にデバウンス実行）----
function renderHeavy() {
  const src = srcEl.value;
  syncActiveFile(); // 現在の編集をプロジェクトへ反映し永続化
  saveProject();
  // 全エントリを検証し、診断は由来(file:line)へ再マップして集約（INCLUDE 跨ぎも捕捉）。
  const proj = projectDiagnostics();
  const r = proj.current ?? { diags: [], msx: "", map: null, code: [] };
  last = r;

  // ガター: アクティブファイルに由来する診断のみ、そのファイル内の行に印を付ける。
  const active = activePath();
  const errsByLine = new Map();
  for (const d of proj.list) {
    if (d.file !== active) continue;
    const arr = errsByLine.get(d.line) ?? [];
    arr.push(`${d.line}:${d.column} ${d.code} ${d.msg}`);
    errsByLine.set(d.line, arr);
  }
  renderGutter(src.split("\n").length, errsByLine);

  const errs = proj.list.filter((d) => d.severity === "error");
  const errorCount = errs.length;
  const otherErrs = errs.filter((d) => d.file !== active).length;

  // 変換後プレビュー（現エントリにエラーが無い時のみ）
  const curErr = r.diags.some((d) => d.severity === "error");
  if (!curErr) {
    msxPane.classList.remove("error");
    msxNote.textContent = t("msx.ok");
    buildMsxLinkView(r.code);
    buildMapTableView(r.map); // 変換テーブル（読み取り専用）も更新
    hiFromStructured(); // 現在行に対応するMSX行を即ハイライト
  } else {
    msxPane.classList.add("error");
    msxNote.textContent = t("msx.err");
    msxOut.textContent = t("msx.errbody");
    linkCode = []; srcToMsxI = new Map();
    buildMapTableView(null); // エラー時はテーブルなしの案内を表示
  }

  // Problems パネル（他ファイルにエラーがあれば自動で開く）
  renderProblems(proj.list, active, otherErrs > 0);

  // ステータス
  if (errorCount > 0) {
    setStatus("err", t("st.err", errorCount) + (otherErrs > 0 ? t("st.elsewhere", otherErrs) : ""));
  } else {
    const warn = proj.list.length;
    setStatus("", warn ? t("st.okwarn", warn) : t("st.ok"));
  }
  // setStatus は className を置き換えるので、クリック可否は最後に付け直す。
  statusEl.classList.toggle("clickable", proj.list.length > 0);
}

// 全更新（整形・読込・タブ切替など、入力以外のタイミング用）
function render() {
  paintHighlight();
  renderHeavy();
  commitHistory(true); // プログラム的編集（整形/行操作/置換/補完等）は1手として記録
}

// ============ Undo / Redo（自前スタック）============
// 理由: moveLines/replaceAll/onFormat は `srcEl.value=` 直接代入で、ブラウザの
// ネイティブ undo 履歴を壊す。setRangeText 系と合わせて一元管理する。
// タイピングは一定時間で1グループに合体、プログラム的編集は常に独立した1手。
let undoStack = [], redoStack = [], undoPrev = "", undoSel = [0, 0], undoTime = 0, undoBusy = false;
const UNDO_MAX = 300;
function resetHistory() {
  undoStack = []; redoStack = [];
  undoPrev = srcEl.value; undoSel = [srcEl.selectionStart, srcEl.selectionEnd]; undoTime = 0;
}
function commitHistory(force) {
  if (undoBusy) return; // undo/redo 適用中は記録しない
  if (srcEl.value === undoPrev) { undoSel = [srcEl.selectionStart, srcEl.selectionEnd]; return; }
  const now = performance.now();
  if (force || now - undoTime > 600) { // 新グループ
    undoStack.push({ v: undoPrev, s: undoSel[0], e: undoSel[1] });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
  }
  undoPrev = srcEl.value;
  undoSel = [srcEl.selectionStart, srcEl.selectionEnd];
  undoTime = now;
}
function applyHistory(st) {
  undoBusy = true;
  srcEl.value = st.v;
  srcEl.setSelectionRange(st.s, st.e);
  undoPrev = st.v; undoSel = [st.s, st.e];
  render();
  undoBusy = false;
  const lh = lineH();
  srcEl.scrollTop = Math.max(0, lineIndexAt(st.s) * lh - srcEl.clientHeight / 2);
  srcEl.focus();
  updateCurLine();
  if (findOpen()) recomputeFind();
}
function doUndo() {
  if (!undoStack.length) { flash(t("undo.none")); return; }
  redoStack.push({ v: srcEl.value, s: srcEl.selectionStart, e: srcEl.selectionEnd });
  applyHistory(undoStack.pop());
}
function doRedo() {
  if (!redoStack.length) { flash(t("redo.none")); return; }
  undoStack.push({ v: srcEl.value, s: srcEl.selectionStart, e: srcEl.selectionEnd });
  applyHistory(redoStack.pop());
}

// ---- スクロール同期 ----
function syncScroll() {
  hlEl.scrollTop = srcEl.scrollTop;
  hlEl.scrollLeft = srcEl.scrollLeft;
  gutterEl.scrollTop = srcEl.scrollTop;
}

// ---- プラットフォーム判定（Tauri デスクトップ or ブラウザ）----
const tauri = () =>
  typeof window !== "undefined" && window.__TAURI__ ? window.__TAURI__ : null;
const isDesktop = () => !!tauri();

// ブラウザ用ダウンロード（フォールバック）
function download(name, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function baseName() {
  return ($("filename").value || "game.msxb").replace(/\.msxb$/i, "");
}
// ---- フォルダ＝プロジェクト（デスクトップ。JetBrains 流）----
// project.dir にバインドしたフォルダのパスを保持。Cmd+S はソースのみ無ダイアログ保存。
async function pickFolder() {
  try { return await tauri().core.invoke("pick_folder"); }
  catch (e) { logErr("pick_folder", e); return null; }
}
async function saveSourceFile(name) {
  await tauri().core.invoke("save_source", { dir: project.dir, name, source: project.files[name] ?? "" });
}
async function saveAllSources() {
  const names = userFiles();
  for (const name of names) await saveSourceFile(name);
  await updateBaselineAfterSave(names); // 保存後 baseline 更新（自己書込みの黙認）
}
// バインド済みフォルダを返す。未バインドなら選択→全ソース書き出し→パスを返す（キャンセルは null）。
async function ensureBound() {
  if (project.dir) return project.dir;
  const dir = await pickFolder();
  if (!dir) return null;
  project.dir = dir;
  saveProject();
  await saveAllSources();
  startWatching(dir); // 紐付けたフォルダの監視を開始
  renderTree();
  return dir;
}
// 実行/変換/ディスク前の自動保存（バインド時のみ全ソースをディスクへ）。
async function autosave() {
  if (isDesktop() && project.dir) {
    await checkExternalChanges({ reason: "run" }); // 実行/変換/ディスク前に外部変更と整合（巻き戻し防止）
    try { await saveAllSources(); } catch (e) { logErr("autosave", e); }
  }
}
// 変換成果物の基準名（エントリ＝ビルド対象のファイル名）。
function entryBase() {
  return String(currentEntry() || project.active || "game.msxb").replace(/\.msxb$/i, "");
}

// Cmd+S: ソース(.msxb)のみ保存（変換なし・無ダイアログ）。
async function onSave() {
  syncActiveFile();
  const name = project.active;
  if (isDesktop()) {
    const dir = await ensureBound();
    if (!dir) return;
    await checkExternalChanges({ reason: "save" }); // 保存前に外部変更と整合（競合ならモーダル）
    try {
      await saveSourceFile(name);
      await updateBaselineAfterSave([name]);
      setStatus("ok", t("save.src"));
    } catch (e) { setStatus("err", t("save.err", e?.message ?? e)); }
    return;
  }
  // ブラウザ: ソース .msxb を単体ダウンロード
  download(`${String(name).replace(/\.msxb$/i, "")}.msxb`, project.files[name] ?? srcEl.value);
  setStatus("ok", t("save.srcdl"));
}

// 「変換して保存」: 全ソース保存 → トランスパイル → 成果物(.bas/.map.json)書き出し。
async function onConvertSave() {
  syncActiveFile();
  await checkExternalChanges({ reason: "run" }); // 変換前に外部変更と整合（巻き戻し防止）
  const r = compileProject();
  const hasError = r.diags.some((d) => d.severity === "error");
  const base = entryBase();

  if (isDesktop()) {
    const dir = await ensureBound();
    if (!dir) return;
    try {
      await saveAllSources();
      if (!hasError) {
        await tauri().core.invoke("save_build", {
          dir, base, msx: r.msx, mapJson: JSON.stringify(r.map, null, 1),
        });
      }
      setStatus(hasError ? "err" : "ok", hasError ? t("save.errchk") : t("save.done"));
    } catch (e) {
      setStatus("err", t("save.err", e?.message ?? e));
    }
    return;
  }

  // ブラウザ: UTF-8 ダウンロード（Shift-JIS化はデスクトップ版で）
  if (hasError) {
    download(`${base}.msxb`, srcEl.value);
    setStatus("err", t("save.errchk"));
    return;
  }
  download(`${base}.msxb`, srcEl.value);
  download(`${base}.map.json`, JSON.stringify(r.map, null, 1));
  download(`${base}.bas`, r.msx);
  setStatus("ok", t("save.dl"));
}

// フォルダを開く: 直下の *.msxb を読み込みプロジェクトにする（空フォルダなら現行を紐付け）。
// 「フォルダを開く」= プロジェクト管理（未保存確認＋バインド＋監視＋最近リスト）に委譲。
async function onOpenFolder() { return openFolderPicker(); }

// バインド済みフォルダをディスクから再読込（外部でファイルが変わった時）。
async function onReloadFolder() {
  if (!isDesktop() || !project.dir) { setStatus("err", t("folder.nobind")); return; }
  syncActiveFile();
  // 明示的な「ディスクから再読込」＝ディスクを正とする。未保存編集があれば破棄確認。
  if (userFiles().some(isDirtyFile) && !(await showConfirm(t("sync.reload.title"), t("sync.reload.body")))) return;
  let files;
  try { files = await tauri().core.invoke("read_folder", { dir: project.dir }); }
  catch (e) { logErr("read_folder", e); setStatus("err", t("save.err", e?.message ?? e)); return; }
  if (!files.length) { setStatus("err", t("folder.empty")); return; }
  const map = {};
  project.baseline = {};
  syncConflicts.clear();
  for (const f of files) {
    const content = lfNormalize(f.content);
    map[f.name] = content;
    project.baseline[f.name] = { content, mtime: f.mtime, size: f.size };
  }
  project.files = map;
  if (map[project.active] == null) project.active = map["main.msxb"] != null ? "main.msxb" : Object.keys(map).sort()[0];
  setReadOnly(false);
  $("filename").value = project.active;
  setSource(project.files[project.active]);
  activateTab("structured");
  startWatching(project.dir);
  renderTree();
  saveProject();
  setStatus("ok", t("folder.reloaded", files.length));
}

// ================= 外部ファイル変更の検出と整合（docs/14）=================
// 3-way モデル: project.baseline[name] = {content, mtime, size}（＝working が基づくディスク版）。
//   dirty = working(project.files[name]) ≠ baseline.content ／ externalChanged = disk ≠ baseline。
let syncBusy = false;                  // 整合の再入防止
let syncConflicts = new Set();         // 非アクティブで競合中のファイル（切替時に解決）
let watcherOk = false;                 // ネイティブウォッチャが動いているか
let syncPollTimer = null, syncDebounce = null;

function setBaseline(name, content, mtime, size) {
  project.baseline[name] = { content, mtime, size };
  saveProject();
}
function isDirtyFile(name) {
  const b = project.baseline[name];
  return b ? project.files[name] !== b.content : project.files[name] != null;
}
async function readFileMeta(name) {
  try {
    const r = await tauri().core.invoke("read_file", { dir: project.dir, name });
    return { content: lfNormalize(r.content), mtime: r.mtime, size: r.size };
  } catch (e) { logErr("read_file", e); return null; }
}
// working+baseline をディスク版へ更新。アクティブ表示中はキャレット/スクロールを保持して反映。
function applyReload(name, content, mtime, size) {
  project.files[name] = content;
  setBaseline(name, content, mtime, size);
  syncConflicts.delete(name);
  if (name === project.active && !viewingLib) {
    const ss = srcEl.selectionStart, se = srcEl.selectionEnd, st = srcEl.scrollTop;
    setSource(content);
    srcEl.selectionStart = Math.min(ss, srcEl.value.length);
    srcEl.selectionEnd = Math.min(se, srcEl.value.length);
    srcEl.scrollTop = st;
    updateCurLine();
  }
}
// 行単位の簡易差分（LCS）。'  '=同一 / '- '=エディタのみ / '+ '=ディスクのみ。
function lineDiff(aStr, bStr) {
  const a = aStr.split("\n"), b = bStr.split("\n");
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push("  " + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push("- " + a[i]); i++; }
    else { out.push("+ " + b[j]); j++; }
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);
  return out.join("\n");
}
async function showDiff(a, b) {
  await openModal({ title: t("sync.diff.title"), body: t("sync.diff.legend") + "\n\n" + lineDiff(a, b) });
}
// 競合の解決（3択）。差分を見たら再び3択へ戻る。null(Esc)=エディタ保持。
async function resolveConflict(name, r) {
  const choice = await openModal({
    title: t("sync.conflict.title", name),
    body: t("sync.conflict.body"),
    buttons: [
      { label: t("sync.conflict.disk"), value: "disk" },
      { label: t("sync.conflict.keep"), value: "keep" },
      { label: t("sync.conflict.diff"), value: "diff" },
    ],
  });
  if (choice === "diff") { await showDiff(project.files[name], r.content); return resolveConflict(name, r); }
  if (choice === "disk") { applyReload(name, r.content, r.mtime, r.size); flash(t("sync.tookdisk", name)); }
  else { setBaseline(name, r.content, r.mtime, r.size); flash(t("sync.tookeditor", name)); } // 外部変更を認識・working維持→次保存で上書き
  syncConflicts.delete(name);
}
async function handleRemoved(name) {
  if (!isDirtyFile(name)) {
    delete project.files[name]; delete project.baseline[name]; syncConflicts.delete(name);
    if (project.active === name) {
      const rest = Object.keys(project.files).sort();
      project.active = rest[0] || null;
      if (project.active) { $("filename").value = project.active; setSource(project.files[project.active]); }
    }
    flash(t("sync.removed", name));
  } else {
    delete project.baseline[name]; // 未保存編集あり→残す（次保存で再作成。baseline消去で新規扱い）
    flash(t("sync.removeddirty", name));
  }
}
// 中核: ディスクを stat して baseline と比較し、追加/削除/変更を整合する。
async function checkExternalChanges({ reason } = {}) {
  if (!isDesktop() || !project.dir || !settings.watchExternal) return;
  if (syncBusy) return;
  syncBusy = true;
  try {
    syncActiveFile();
    let stats;
    try { stats = await tauri().core.invoke("stat_files", { dir: project.dir }); }
    catch (e) { logErr("stat_files", e); return; }
    const disk = new Map(stats.map((s) => [s.name, s]));
    const reloaded = [], added = [];
    for (const s of stats) {
      const base = project.baseline[s.name];
      if (!base) { // 初見（起動時・新規ファイル）: baseline 確立
        const r = await readFileMeta(s.name);
        if (!r) continue;
        setBaseline(s.name, r.content, r.mtime, r.size);
        if (project.files[s.name] == null) { project.files[s.name] = r.content; added.push(s.name); }
        continue;
      }
      if (s.mtime === base.mtime && s.size === base.size) continue; // 未変更
      const r = await readFileMeta(s.name);
      if (!r) continue;
      if (r.content === project.files[s.name]) { setBaseline(s.name, r.content, r.mtime, r.size); continue; } // disk==working（自己書込み含む）
      if (!isDirtyFile(s.name)) { // 外部のみ変更（未dirty）
        if (settings.autoReloadExternal || s.name !== project.active || viewingLib) { applyReload(s.name, r.content, r.mtime, r.size); reloaded.push(s.name); }
        else if (await showConfirm(t("sync.reload.title"), t("sync.confirm.body", s.name))) { applyReload(s.name, r.content, r.mtime, r.size); reloaded.push(s.name); }
        else setBaseline(s.name, project.files[s.name], r.mtime, r.size); // 再読込しない＝既読化（再通知を止める）
      }
      else if (s.name === project.active && !viewingLib) await resolveConflict(s.name, r); // 競合(アクティブ)
      else syncConflicts.add(s.name);                                                      // 競合(非アクティブ)→切替時
    }
    for (const name of Object.keys(project.baseline)) if (!disk.has(name)) await handleRemoved(name); // 外部削除
    if (added.length || reloaded.length || syncConflicts.size) { renderTree(); saveProject(); }
    const names = [...reloaded, ...added];
    if (names.length) flash(t(reason === "startup" ? "sync.synced" : "sync.reloaded", names.join(", ")));
  } finally { syncBusy = false; }
}
// フォルダ監視を開始（Tauri notify）。不可ならポーリングにフォールバック。
async function startWatching(dir) {
  watcherOk = false;
  stopSyncPoll();
  if (!isDesktop() || !dir || !settings.watchExternal) return;
  try { await tauri().core.invoke("watch_folder", { dir }); watcherOk = true; }
  catch (e) { logErr("watch_folder", e); watcherOk = false; }
  if (!watcherOk) startSyncPoll();
}
function startSyncPoll() { stopSyncPoll(); syncPollTimer = setInterval(() => checkExternalChanges({ reason: "poll" }), 2500); }
function stopSyncPoll() { if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; } }
function onFilesChanged() { clearTimeout(syncDebounce); syncDebounce = setTimeout(() => checkExternalChanges({ reason: "watch" }), 300); }
// 保存後: 書いた内容＝working で baseline を更新（ディスクの新 mtime/size を取得）。自己書込みの黙認に効く。
async function updateBaselineAfterSave(names) {
  if (!isDesktop() || !project.dir) return;
  let stats;
  try { stats = await tauri().core.invoke("stat_files", { dir: project.dir }); }
  catch { return; }
  const disk = new Map(stats.map((s) => [s.name, s]));
  for (const name of names) { const s = disk.get(name); if (s) setBaseline(name, project.files[name], s.mtime, s.size); }
}

// ================= プロジェクトディレクトリ（JetBrains 流）=================
// エディタは常にバインド済みプロジェクトで動作する。未バインド（localStorage のみ）は起動時に
// Welcome でフォルダを要求して解消。別プロジェクトへ切替える時は未保存を確認。最近のプロジェクトを記憶。
const RECENTS_KEY = "fbe-recents";
function loadRecents() { try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]").filter((d) => typeof d === "string"); } catch { return []; } }
function saveRecents(a) { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(a.slice(0, 12))); } catch (_) {} }
function addRecent(dir) { if (dir) saveRecents([dir, ...loadRecents().filter((d) => d !== dir)]); }
function removeRecent(dir) { saveRecents(loadRecents().filter((d) => d !== dir)); }
function shortPath(dir) { const p = String(dir).replace(/\/+$/, "").split("/"); return p.length <= 2 ? dir : "…/" + p.slice(-2).join("/"); }
async function dirValid(dir) { if (!dir) return false; try { await tauri().core.invoke("stat_files", { dir }); return true; } catch { return false; } }
function afterProjectLoaded() { syncFindToggles(); applyEditorPrefs(); calibrateLineHeight(); }

// 既知パスのフォルダをプロジェクトとして開く（read_folder→バインド・baseline・監視。空なら starter）。
async function openDir(dir, { addToRecent = true } = {}) {
  let files;
  try { files = await tauri().core.invoke("read_folder", { dir }); }
  catch (e) { logErr("read_folder", e); return false; }
  syncActiveFile();
  project.dir = dir;
  project.baseline = {};
  syncConflicts.clear();
  const map = {};
  for (const f of files) { const content = lfNormalize(f.content); map[f.name] = content; project.baseline[f.name] = { content, mtime: f.mtime, size: f.size }; }
  const empty = !Object.keys(map).length;
  if (empty) map["main.msxb"] = SAMPLE; // 空フォルダ→starter
  project.files = map;
  project.active = map["main.msxb"] != null ? "main.msxb" : Object.keys(map).sort()[0];
  setReadOnly(false);
  $("filename").value = project.active;
  setSource(project.files[project.active]);
  activateTab("structured");
  if (empty) await saveAllSources(); // starter をディスクへ→baseline 確立
  if (addToRecent) addRecent(dir);
  startWatching(dir);
  renderTree();
  saveProject();
  afterProjectLoaded();
  return true;
}

// 別プロジェクトへ切替える前の未保存確認（保存して開く / 保存せず開く / キャンセル）。true=続行可。
async function confirmLeaveProject() {
  if (!isDesktop() || !project.dir) return true;
  if (!(await dirValid(project.dir))) return true; // 現フォルダが消失＝保存先が無い（復旧は Welcome の専用導線で）
  syncActiveFile();
  if (!userFiles().some(isDirtyFile)) return true;
  const c = await openModal({
    title: t("proj.leave.title"), body: t("proj.leave.body"),
    buttons: [
      { label: t("proj.leave.save"), value: "save" },
      { label: t("proj.leave.discard"), value: "discard" },
      { label: t("cancel"), value: "cancel" },
    ],
  });
  if (c === "save") { await saveAllSources(); return true; }
  return c === "discard";
}

// フォルダ選択して開く（ピッカー・未保存確認付き）。
async function openFolderPicker() {
  if (!isDesktop()) { setStatus("err", t("folder.desktoponly")); return; }
  if (!(await confirmLeaveProject())) return;
  const dir = await pickFolder();
  if (!dir) return;
  if (await openDir(dir)) setStatus("ok", t("folder.opened", Object.keys(project.files).length));
}

// 新規プロジェクト: フォルダを選び、空なら starter を作成（既存 .msxb があればそのまま開く）。
async function newProjectFlow() {
  if (!isDesktop()) { setStatus("err", t("folder.desktoponly")); return; }
  if (!(await confirmLeaveProject())) return;
  const dir = await pickFolder();
  if (!dir) return;
  if (await openDir(dir)) setStatus("ok", t("proj.created"));
}

// 消失フォルダ時の復旧: 現在の作業コピー(project.files)を新しく選んだフォルダへ保存して開く。
async function recoverToFolder() {
  const dir = await pickFolder();
  if (!dir) return false;
  syncActiveFile();
  project.dir = dir;
  const names = userFiles();
  try { for (const name of names) await tauri().core.invoke("save_source", { dir, name, source: project.files[name] ?? "" }); }
  catch (e) { logErr("recover save_source", e); setStatus("err", t("save.err", e?.message ?? e)); return false; }
  project.baseline = {};
  syncConflicts.clear();
  await updateBaselineAfterSave(names);
  if (project.files[project.active] == null) project.active = Object.keys(project.files)[0];
  setReadOnly(false);
  $("filename").value = project.active;
  setSource(project.files[project.active] ?? "");
  activateTab("structured");
  addRecent(dir); startWatching(dir); renderTree(); saveProject(); afterProjectLoaded();
  setStatus("ok", t("proj.recovered"));
  return true;
}

// Welcome（プロジェクト選択）。mandatory=true は必ずどれか選ばせる（Esc で再表示）。
async function showWelcome({ mandatory = false, reason = "new" } = {}) {
  const recents = loadRecents();
  const canRecover = reason === "lost" && userFiles().length > 0;
  const choice = await openModal({
    title: t("welcome.title"),
    body: t(reason === "lost" ? "welcome.lost" : "welcome.body"),
    buttons: [
      ...(canRecover ? [{ label: t("welcome.recover"), value: "recover" }] : []),
      { label: t("welcome.open"), value: "open" },
      { label: t("welcome.new"), value: "new" },
      ...recents.slice(0, 8).map((d) => ({ label: shortPath(d), value: "recent:" + d })),
    ],
  });
  const again = () => (mandatory ? showWelcome({ mandatory, reason }) : undefined);
  if (choice === "recover") { if (await recoverToFolder()) return; return again(); }
  if (choice === "open") { if (!(await confirmLeaveProject())) return again(); const dir = await pickFolder(); if (dir && (await openDir(dir))) return; return again(); }
  if (choice === "new") { await newProjectFlow(); return project.dir ? undefined : again(); }
  if (typeof choice === "string" && choice.startsWith("recent:")) {
    const dir = choice.slice(7);
    if (!(await confirmLeaveProject())) return again();
    if (await openDir(dir)) return;
    removeRecent(dir);
    await showModal(t("welcome.gone.title"), t("welcome.gone.body", shortPath(dir)));
    return showWelcome({ mandatory, reason });
  }
  return again(); // Esc/null
}

// 起動時のプロジェクト決定（前回を再開 / 未バインド・消失なら Welcome）。
async function initProject() {
  if (!isDesktop()) { // ブラウザ: 従来通り localStorage サンプル
    if (project.files[project.active] == null) project.active = Object.keys(project.files)[0];
    $("filename").value = project.active;
    setSource(project.files[project.active] ?? "");
    renderTree();
    afterProjectLoaded();
    return;
  }
  if (project.dir && (await dirValid(project.dir))) { // 前回プロジェクトを再開（未保存の作業コピーは保持）
    if (project.files[project.active] == null) project.active = Object.keys(project.files)[0] || "main.msxb";
    $("filename").value = project.active;
    setSource(project.files[project.active] ?? "");
    renderTree();
    afterProjectLoaded();
    startWatching(project.dir);
    checkExternalChanges({ reason: "startup" }); // 起動中の外部変更と整合（未保存は保持）
    return;
  }
  // 未バインド（完全新規）or 消失 → Welcome（必ずバインドさせる）
  renderTree();
  await showWelcome({ mandatory: true, reason: project.dir ? "lost" : "new" });
}

// ---- 再生（WebMSX、1クリック自動実行。docs/10 §10.4）----
// WebMSX の URL パラメータ（DISKA_FILES_URL + BASIC_RUN）を使い、プログラムを
// data: URL の ZIP で直接渡して「自動ロード→自動RUN」させる。同梱せずリンクのみ
// なのでライセンス清潔。localhost/CORS/ドラッグ/保存ダイアログ/手動RUN すべて不要。
// WebMSX の URL/機種/PRESETS は設定画面で変更可（settings）。既定URLは webmsx.org。
// 機種(MACHINE)・PRESETS(例 MSXMUSIC) を指定すると turbo R 例や FM の検証に使える。
// （注: 別オリジンiframe＋毎回リブートの制約で FM 実音は鳴らない。詳細は TODO.md）
const webmsxBaseUrl = () => settings.webmsxUrl || DEFAULT_SETTINGS.webmsxUrl;

// WebMSX へ渡すプログラムは MSX 上で打鍵されないが、ディスク内ファイル名・URL を
// 確実にするため ASCII(改行/タブのみ) に整える。日本語コメント等は実行に不要。
// 完全な原文（Shift-JIS）は 💿 ディスク(.dsk) 保存側で保持する。
function asciiForWebMSX(msx) {
  let stripped = 0;
  const out = msx.replace(/[^\t\n\x20-\x7E]/g, () => {
    stripped++;
    return "";
  });
  return { out, stripped };
}

// base から 8.3 形式のディスク内ファイル名（拡張子 .BAS）
function diskFileName(base) {
  let n = "";
  for (const c of base) {
    if (n.length >= 8) break;
    if (/[A-Za-z0-9]/.test(c)) n += c.toUpperCase();
  }
  return (n || "PROG") + ".BAS";
}

// CRC-32（ZIP 用）
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    let c = (crc ^ bytes[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 1ファイルZIPを組み立てる。method=0:無圧縮(store) / 8:DEFLATE。
// crc/usize は非圧縮データ基準、csize は payload(格納する実バイト)基準。
function zipEntry(name, data, payload, method) {
  const nameB = new TextEncoder().encode(name);
  const crc = crc32(data);
  const usize = data.length;
  const csize = payload.length;
  const a = [];
  const p16 = (v) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const p32 = (v) => a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  // local file header
  p32(0x04034b50); p16(20); p16(0); p16(method); p16(0); p16(0x21);
  p32(crc); p32(csize); p32(usize); p16(nameB.length); p16(0);
  for (const b of nameB) a.push(b);
  for (const b of payload) a.push(b);
  const cdOffset = a.length;
  // central directory
  p32(0x02014b50); p16(20); p16(20); p16(0); p16(method); p16(0); p16(0x21);
  p32(crc); p32(csize); p32(usize);
  p16(nameB.length); p16(0); p16(0); p16(0); p16(0); p32(0); p32(0);
  for (const b of nameB) a.push(b);
  const cdSize = a.length - cdOffset;
  // end of central directory
  p32(0x06054b50); p16(0); p16(0); p16(1); p16(1); p32(cdSize); p32(cdOffset); p16(0);
  return Uint8Array.from(a);
}

// ZIP は raw DEFLATE（zlibヘッダ無し）を格納する。ブラウザ標準の CompressionStream を使用。
async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 1ファイルZIP。DEFLATEで縮むなら圧縮、使えない/逆効果なら無圧縮(store)。
async function zipForWebmsx(name, data) {
  if (typeof CompressionStream !== "undefined") {
    try {
      const def = await deflateRaw(data);
      if (def.length < data.length) return zipEntry(name, data, def, 8);
    } catch (e) {
      logErr("deflate 失敗 → store にフォールバック", e);
    }
  }
  return zipEntry(name, data, data, 0);
}

function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// クエリ値の軽量エンコード：RFC3986 の unreserved に加え、クエリで安全な "/" ":" は
// エスケープしない（base64 の "/" が %2F に膨らむのを防ぐ）。"+" "=" 等は従来どおり %XX。
// これで data URL(base64) を載せた実行URLが数百バイト短くなる（WebViewのURL長対策）。
function encodeDiskParam(s) {
  return s.replace(/[^A-Za-z0-9\-_.~/:]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

// 変換後プログラム → WebMSX 自動実行 URL（DEFLATEでURLを圧縮）
async function webmsxAutorunUrl(name, asciiProgram) {
  const data = new TextEncoder().encode(asciiProgram); // ASCII のみ
  const zip = await zipForWebmsx(name, data);
  const dataUrl = "data:application/zip;base64," + toBase64(zip);
  return (
    `${webmsxBaseUrl()}?DISKA_FILES_URL=${encodeDiskParam(dataUrl)}` +
    (settings.webmsxMachine ? `&MACHINE=${encodeURIComponent(settings.webmsxMachine)}` : "") +
    (settings.webmsxPresets ? `&PRESETS=${encodeURIComponent(settings.webmsxPresets)}` : "") +
    `&BASIC_RUN=${name}`
  );
}

async function onPlayWebMSX() {
  log("WebMSX 実行: 開始");
  await autosave(); // 実行＝全ソース保存 → トランスパイル → 実行
  // 実行ペイロードのみ最適化（URL長対策）。コメント除去＋行パッキング（":"連結）で
  // URLを短縮する。ソース/保存物・実行結果は不変（飛び先/制御フローは保持）。
  const r = compileProject({ stripComments: true, packLines: true });
  if (r.diags.some((d) => d.severity === "error")) {
    setStatus("err", t("run.noerr"));
    return;
  }
  // MSX の ASCII セーブ形式に合わせ CRLF＋EOF(0x1A)
  const body = r.msx.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const { out, stripped } = asciiForWebMSX(body);
  const program = out.split("\n").join("\r\n") + "\x1a";
  const name = diskFileName(baseName());
  const url = await webmsxAutorunUrl(name, program);
  log(`WebMSX 実行: URL長=${url.length} name=${name} stripped=${stripped}`);

  // アプリ内 iframe の src を差し替えて同一画面で再実行（新タブ/別ウィンドウを開かない）。
  // src を毎回付け替えることで WebMSX がリロード→自動ロード→自動RUN する。
  const frame = $("webmsxFrame");
  frame.src = "about:blank"; // 同一URLでも確実にリロードさせる
  frame.src = url;
  revealRun();

  const note = stripped > 0 ? t("run.note", stripped) : "";
  setStatus("ok", t("run.ok", name, note));
}

// ---- 再生（WebMSX、方式B＝ディスクイメージ。打鍵を経由せず確実）----
// FAT12 の .dsk を生成 → WebMSX にドラッグ → RUN"NAME.BAS"。日本語コメントも化けない。
async function onMakeDsk() {
  log("ディスク作成: 開始");
  await autosave();
  const r = compileProject();
  if (r.diags.some((d) => d.severity === "error")) {
    setStatus("err", t("dsk.noerr"));
    return;
  }
  const base = baseName();
  if (!isDesktop()) {
    setStatus("err", t("dsk.desktoponly"));
    return;
  }
  try {
    const res = await tauri().core.invoke("save_dsk", { base, msx: r.msx });
    if (!res) {
      setStatus("", t("dsk.cancel"));
      return; // 保存ダイアログでキャンセル
    }
    // WebMSX も開く（任意）。失敗してもディスクは出来ている。
    try {
      await tauri().core.invoke("plugin:opener|open_url", { url: webmsxBaseUrl() });
    } catch (e) {
      logErr("opener", e);
      window.open(webmsxBaseUrl(), "_blank");
    }
    log("ディスク作成: 完了", res.path);
    setStatus("ok", t("dsk.ok", res.path, res.load_name));
  } catch (e) {
    logErr("save_dsk", e);
    setStatus("err", t("dsk.err", e?.message ?? e));
  }
}

// ---- MSXPLAYer 用 .sav 書き出し ----
// 中身は .dsk と同じ FAT12 イメージを .sav 形式に詰め替えたもの。
// .sav は MSXPLAYer のワークドライブに置いてデータを渡す用途のため、WebMSX は開かない。
async function onMakeSav() {
  log(".sav作成: 開始");
  await autosave();
  const r = compileProject();
  if (r.diags.some((d) => d.severity === "error")) {
    setStatus("err", t("sav.noerr"));
    return;
  }
  const base = baseName();
  if (!isDesktop()) {
    setStatus("err", t("sav.desktoponly"));
    return;
  }
  try {
    const res = await tauri().core.invoke("save_sav", { base, msx: r.msx });
    if (!res) {
      setStatus("", t("sav.cancel"));
      return; // 保存ダイアログでキャンセル
    }
    log(".sav作成: 完了", res.path, res.backup ? "backup=" + res.backup : "");
    setStatus("ok", t("sav.ok", res.path, res.load_name, res.backup));
  } catch (e) {
    logErr("save_sav", e);
    setStatus("err", t("sav.err", e?.message ?? e));
  }
}

// ---- 逆変換プレビュー ----
async function onReverse() {
  const r = compile(srcEl.value);
  if (r.diags.some((d) => d.severity === "error")) {
    setStatus("err", t("rev.noerr"));
    return;
  }
  const rev = reverse(r.code, r.map);
  if (await showConfirm(t("confirm.title"), t("confirm.reverse"))) {
    setSource(rev.source + "\n");
  }
}

// ---- 素のMSX-BASIC取込（デコンパイラ。マップ不要）----
// 行番号付きのMSX-BASICテキストを読み、構造化BASICへ逆変換して「新規ファイル」として開く。
// 既存の編集内容は失わない（新しいファイルを作るだけ）。
function onImportBasic() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".bas,.asc,.txt,.msxbas,.msx";
  input.style.display = "none";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      // MSX のテキスト保存は Shift-JIS。非SJISは置換しつつ読む（UTF-8でも壊れない）。
      let text;
      try { text = new TextDecoder("shift_jis", { fatal: false }).decode(buf); }
      catch (_) { text = new TextDecoder("utf-8", { fatal: false }).decode(buf); }
      importBasicText(text, file.name);
    } catch (e) {
      logErr("取込", e);
      setStatus("err", t("import.err", e && e.message ? e.message : e));
    }
  });
  document.body.appendChild(input);
  input.click();
  // クリック後は不要（change は input への参照が残るので発火する）
  setTimeout(() => input.remove(), 0);
}

function importBasicText(text, srcName) {
  const read = readBasic(text || "");
  if (!read.lines.length) { setStatus("err", t("import.empty")); return; }
  const renamed = renameVars(read.lines);
  const dec = decompile(renamed.lines);
  // 元ファイル名から重複しない .msxb 名を作る
  const base = (srcName || "imported").replace(/\.[^.]*$/, "").replace(/[\\/]/g, "_") || "imported";
  let name = base + ".msxb";
  for (let i = 2; project.files[name] != null; i++) name = base + "-" + i + ".msxb";
  syncActiveFile();
  project.files[name] = (dec.source || "") + "\n";
  saveProject();
  openFile(name); // 新規ファイルを構造化タブで開く
  const warns = [...read.diagnostics, ...dec.diagnostics].filter((d) => d.severity === "warning").length;
  setStatus(warns ? "warn" : "ok", t("import.done", name, warns));
}

// ---- 識別子の安全な一括リネーム（リファクタ）----
// 字句解析でIDENTトークンだけを対象にするので、文字列・コメント・キーワードは触らない。
// 型サフィックス込みで一致（A と A$ は別物）、大小無視（MSXの変数は先頭2文字・大小同一）。
// 逆変換で自動命名された I/J/COUNT 等を意味のある名前へ直すのに有用。
async function renameSymbol() {
  if (viewingLib) { flash(t("rn.readonly")); return; }
  const src = srcEl.value;
  const caret = srcEl.selectionStart;
  let toks;
  try { toks = tokenize(src).tokens; } catch (e) { logErr("rename tokenize", e); return; }
  const ls = lineStartsOf(src);
  const offOf = (tk) => (ls[tk.pos.line - 1] ?? 0) + (tk.pos.column - 1);
  // カーソル位置の IDENT を特定
  let target = null;
  for (const tk of toks) {
    if (tk.kind !== "IDENT") continue;
    const o = offOf(tk);
    if (caret >= o && caret <= o + tk.raw.length) { target = tk; break; }
  }
  if (!target) { flash(t("rn.notident")); return; }
  if (isBuiltin(target.value)) { flash(t("rn.builtin", target.raw)); return; }
  const oldUp = target.value; // 大文字化済み（サフィックス込み）
  // 読み取り専用ライブラリに同名があるか（あると参照が壊れうるので警告）
  const inLib = Object.keys(LIBS).some((k) => {
    try { return tokenize(LIBS[k]).tokens.some((tk) => tk.kind === "IDENT" && tk.value === oldUp); }
    catch { return false; }
  });
  const input = await showPrompt(t("rn.title"), t("rn.msg", target.raw), target.raw);
  if (input == null) return;
  const next = input.trim();
  if (!next || next.toUpperCase() === oldUp) return;
  // 全プロジェクトファイルの出現を集計（アクティブはライブバッファ）
  const active = activePath();
  const perFile = [];
  for (const f of Object.keys(project.files).sort()) {
    const text = f === active ? src : project.files[f];
    let ftoks; try { ftoks = tokenize(text).tokens; } catch { continue; }
    const fls = lineStartsOf(text);
    const foff = (tk) => (fls[tk.pos.line - 1] ?? 0) + (tk.pos.column - 1);
    const spans = [];
    for (const tk of ftoks) if (tk.kind === "IDENT" && tk.value === oldUp) spans.push([foff(tk), foff(tk) + tk.raw.length]);
    if (spans.length) perFile.push({ file: f, spans, text });
  }
  const total = perFile.reduce((n, x) => n + x.spans.length, 0);
  if (!total) { flash(t("rn.none")); return; }
  // 複数ファイル or ライブラリ出現時はプレビュー確認（破壊的操作なので明示）
  if (perFile.length > 1 || inLib) {
    const body = t("rn.preview", target.raw, next, total, perFile.length) + "\n" +
      perFile.map((x) => `  ${x.file}: ${x.spans.length}`).join("\n") +
      (inLib ? "\n\n" + t("rn.libwarn") : "");
    if (!(await showConfirm(t("rn.title"), body))) return;
  }
  // 適用（各ファイルを右から置換してオフセットずれを防ぐ）
  for (const x of perFile) {
    let out = x.text;
    for (let i = x.spans.length - 1; i >= 0; i--) out = out.slice(0, x.spans[i][0]) + next + out.slice(x.spans[i][1]);
    if (x.file === active) setSource(out);
    else project.files[x.file] = out;
  }
  commitHistory(true);
  renderTree();
  saveProject();
  setStatus("ok", perFile.length > 1 ? t("rn.donefiles", total, next, perFile.length) : t("rn.done", total, next));
}

// ---- タブ（JetBrains方式: 2グループ。ドラッグで並べ替え＆グループ間移動=分割/統合。状態は永続化）----
const TAB_PANE = { structured: "structuredPane", msx: "msxPane", webmsx: "webmsxPane", maptable: "maptablePane" };
const ALL_TABS = ["structured", "msx", "webmsx", "maptable"];
const LAYOUT_KEY = "fbe-layout-v1";

// groups.A=主(左) / groups.B=分割(右、空なら統合状態)。active=各グループの選択タブ。
let groups = { A: ["structured", "msx", "webmsx"], B: [] };
let active = { A: "structured", B: null };
let dragTab = null;

function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ groups, active }));
  } catch (e) {
    logErr("レイアウト保存", e);
  }
}
function loadLayout() {
  try {
    const s = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
    if (s && s.groups && Array.isArray(s.groups.A) && Array.isArray(s.groups.B)) {
      // 閉じたタブがあってもよい（A∪B は ALL_TABS の部分集合・重複なし）
      const all = [...s.groups.A, ...s.groups.B];
      const ok = all.every((x) => ALL_TABS.includes(x)) && new Set(all).size === all.length;
      if (ok) {
        groups = s.groups;
        active = s.active || { A: groups.A[0] || null, B: groups.B[0] || null };
      }
    }
  } catch (e) {
    logErr("レイアウト読込", e);
  }
}
function resetLayout() {
  groups = { A: ["structured", "msx", "webmsx"], B: [] };
  active = { A: "structured", B: null };
  renderTabs();
}
function normalizeGroups() {
  // A を主グループに保つ: A が空で B が残れば繰り上げ
  if (groups.A.length === 0 && groups.B.length > 0) {
    groups.A = groups.B;
    groups.B = [];
    active.A = active.B;
    active.B = null;
  }
  for (const g of ["A", "B"]) {
    if (groups[g].length === 0) active[g] = null;
    else if (!groups[g].includes(active[g])) active[g] = groups[g][0];
  }
}
function renderStrip(g) {
  const strip = $("strip" + g);
  strip.innerHTML = "";
  for (const id of groups[g]) {
    const b = document.createElement("div");
    b.className = "tab" + (active[g] === id ? " active" : "");
    b.draggable = true;
    b.dataset.tab = id;
    b.dataset.group = g;
    const label = document.createElement("span");
    label.textContent = t("tab." + id);
    b.appendChild(label);
    const x = document.createElement("button");
    x.className = "tab-x";
    x.textContent = "✕";
    x.title = t("tab.close");
    x.dataset.close = id;
    x.dataset.group = g;
    b.appendChild(x);
    strip.appendChild(b);
  }
}
function renderTabs() {
  normalizeGroups();
  const split = groups.B.length > 0;
  $("panes").classList.toggle("split", split);
  renderStrip("A");
  renderStrip("B");
  $("stripB").hidden = !split;
  for (const id of ALL_TABS) {
    const pane = $(TAB_PANE[id]);
    if (active.A === id) {
      pane.hidden = false;
      pane.style.order = "0";
    } else if (active.B === id) {
      pane.hidden = false;
      pane.style.order = "1";
    } else {
      pane.hidden = true;
    }
  }
  saveLayout();
  hiFromStructured(); // 分割へ切替えた瞬間に現在行の連動を反映（非分割時はゲートで無処理）
}
function moveTab(id, from, to, idx) {
  const origIdx = groups[from].indexOf(id);
  if (origIdx < 0) return;
  groups[from] = groups[from].filter((x) => x !== id);
  if (from === to && origIdx < idx) idx--; // 同一グループ内: 抜いた分を補正
  const arr = groups[to];
  arr.splice(Math.max(0, Math.min(idx, arr.length)), 0, id);
  active[to] = id;
  renderTabs();
}
function dropIndex(strip, x) {
  const tabs = [...strip.querySelectorAll(".tab")];
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return i;
  }
  return tabs.length;
}
function splitActiveRight() {
  if (groups.A.length >= 2 && active.A) moveTab(active.A, "A", "B", groups.B.length);
}
function mergeAll() {
  groups.A = [...groups.A, ...groups.B];
  groups.B = [];
  renderTabs();
}
// タブを開く（無ければ A グループ末尾に追加）してアクティブ化
function openTab(id) {
  if (!ALL_TABS.includes(id)) return;
  for (const g of ["A", "B"]) {
    if (groups[g].includes(id)) { active[g] = id; renderTabs(); return; }
  }
  groups.A.push(id);
  active.A = id;
  renderTabs();
}
// タブを閉じる（左ツリー／表示メニューからいつでも再オープン可能）
function closeTab(id) {
  for (const g of ["A", "B"]) {
    if (groups[g].includes(id)) {
      groups[g] = groups[g].filter((x) => x !== id);
      renderTabs(); // normalizeGroups が active を繰り上げ
      return;
    }
  }
}
// 実行時に WebMSX タブをそのグループでアクティブにする（閉じていれば開く）
function revealRun() {
  openTab("webmsx");
}

// ---- フォントサイズ（設定に永続化）----
function applyFontSize(px) {
  const v = Math.min(28, Math.max(9, px | 0));
  settings.fontSize = v;
  document.documentElement.style.setProperty("--font-size", v + "px");
  // 行高を「整数px」に固定する。unitless(1.5)だと 15px→22.5px の端数になり、
  // WKWebView(デスクトップ)は各行を整数pxに丸めて描画するため、行が下るほど
  // 現在行ハイライト帯と実テキストがズレていく（例: 56行目で約1行分 drift）。
  // 整数pxならgetComputedStyleの値と実描画が一致し、ドリフトしない。
  document.documentElement.style.setProperty("--line", Math.round(v * 1.5) + "px");
  calibrateLineHeight();
}
// WKWebView は <textarea>（キャレット）と、重ねた <pre>#highlight / ガター <div> の
// 行box高を微妙に食い違わせる（片方だけ整数へ丸める等）。ズレの向きは環境依存で、下の行
// ほどキャレットと「見える文字・行番号」がずれる（例: 919行で約1〜2行）。textarea の
// line-height を highlight オーバーレイの実描画行高へ反復収束させ、両方向のズレを吸収する。
// ブラウザ(Chromium)では両者が一致するので初回 break＝実質 no-op。
let measuredLH = 0; // textarea の実描画行高（キャレット/現在行帯/行ジャンプの位置決めに使う）
// textarea の実描画行高。ネイティブ・キャレットはこれに従う。較正後は measuredLH を使う。
function lineH() { return measuredLH || parseFloat(getComputedStyle(srcEl).lineHeight) || 22; }
// WKWebView では <textarea>(#src) と <div>(#highlight/#gutter) が同じ line-height でも実描画
// 行高が僅かに異なり、行数に比例して累積する。数百行下ではキャレットの論理位置と、色付き
// オーバーレイ・行番号・現在行帯がずれ、DATASET 等の行で矢印移動するとキャレットが隣の行へ
// 飛ぶ（実測: 939 行で約 1 行分）。textarea 側は小数 line-height を丸めるため寄せられない。
// よって「見た目レイヤ(div) を textarea の実測行高へ寄せる」。ファイルサイズに依存しないよう、
// 画面外の隠しプローブ(textarea/div)を差分法で実測する（定数オフセットを相殺）。
// 実要素と同一タグ・同一の行高関連スタイルでプローブを作る。以前は overlay を <div> で
// 測っていたが、実オーバーレイは <pre id="highlight"> であり、WKWebView は pre と div を
// 僅かに異なる行高で描くため較正が的外れになっていた。textarea は srcEl、overlay は hlEl の
// 計算済みスタイルを写して測る（行高に効く指定を漏らさない）。
function probeStyle(ref) {
  const cs = getComputedStyle(ref);
  return "position:absolute;left:-9999px;top:0;visibility:hidden;margin:0;padding:0;border:0;"
    + "overflow:hidden;width:600px;box-sizing:content-box;white-space:pre;tab-size:4;"
    + `font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};`
    + `font-weight:${cs.fontWeight};font-style:${cs.fontStyle};letter-spacing:${cs.letterSpacing};`
    + `word-spacing:${cs.wordSpacing};font-feature-settings:${cs.fontFeatureSettings};`
    + `font-variant-ligatures:${cs.fontVariantLigatures};text-transform:${cs.textTransform};`
    + `-webkit-font-smoothing:${cs.webkitFontSmoothing};text-rendering:${cs.textRendering};`;
}
function measureRenderedLH() {
  const ta = document.createElement("textarea"); ta.style.cssText = probeStyle(srcEl); ta.setAttribute("wrap", "off");
  const pr = document.createElement("pre"); pr.style.cssText = probeStyle(hlEl); // 実 overlay と同じ <pre>
  document.body.appendChild(ta); document.body.appendChild(pr);
  const set = (el, n) => {
    const s = Array.from({ length: n }, () => "X").join("\n");
    if (el.tagName === "TEXTAREA") el.value = s; else el.textContent = s;
    return el.scrollHeight;
  };
  const N1 = 20, N2 = 220, D = N2 - N1;
  const taLH = (set(ta, N2) - set(ta, N1)) / D; // 差分で枠/初期行などの定数を相殺
  const dvLH = (set(pr, N2) - set(pr, N1)) / D;
  ta.remove(); pr.remove();
  return { taLH, dvLH };
}
function calibrateLineHeight() {
  measuredLH = 0;
  hlEl.style.lineHeight = ""; gutterEl.style.lineHeight = ""; // 前回の較正をリセット
  srcEl.style.lineHeight = "";                                // textarea は自然行高のまま（丸め対策）
  const { taLH, dvLH } = measureRenderedLH();
  if (!(taLH > 6 && taLH < 80 && dvLH > 6 && dvLH < 80)) { updateCurLine(); return; }
  if (Math.abs(taLH - dvLH) >= 0.005) {
    // div(#highlight/#gutter) を textarea の実描画行高へ寄せる（div は小数 line-height を honor）
    const curCss = parseFloat(getComputedStyle(hlEl).lineHeight) || dvLH;
    const lh = (curCss * taLH / dvLH).toFixed(4) + "px";
    hlEl.style.lineHeight = lh; gutterEl.style.lineHeight = lh;
  }
  measuredLH = taLH; // キャレット/帯/行ジャンプは textarea の実測行高を基準にする
  updateCurLine();
}
function setFont(delta) {
  applyFontSize((settings.fontSize || 15) + delta);
  saveSettings();
}
// 診断: Cmd/Ctrl+Shift+L でキャレット行高の実測値を表示（WKWebViewズレ調査用）。
function caretDiag() {
  const scs = getComputedStyle(srcEl), hcs = getComputedStyle(hlEl);
  const { taLH, dvLH } = measureRenderedLH();
  const lines = srcEl.value.split("\n").length;
  const caretLine = srcEl.value.slice(0, srcEl.selectionStart).split("\n").length;
  alert([
    "=== caret / line-height diag  (v" + APP_VERSION + ") ===",
    "src CSS line-height : " + scs.lineHeight,
    "hl  CSS line-height : " + hcs.lineHeight + "  (calibrated)",
    "measuredLH          : " + measuredLH,
    "probe taLH textarea : " + taLH.toFixed(4),
    "probe dvLH pre      : " + dvLH.toFixed(4),
    "diff (taLH - dvLH)  : " + (taLH - dvLH).toFixed(4),
    "src.scrollHeight    : " + srcEl.scrollHeight,
    "hl .scrollHeight    : " + hlEl.scrollHeight,
    "lines=" + lines + "   caretLine=" + caretLine,
    "font: " + scs.fontFamily.split(",")[0].replace(/["']/g, ""),
  ].join("\n"));
}

// 改行を LF に正規化。構造化ソース(.msxb)は仕様上 LF だが、Windows/エディタ/git 経由で
// CRLF(\r\n) や lone CR(\r) が混入し得る。混入すると保存が CRLF のまま残る等の不整合に
// なるため、エディタに入る全ての構造化ソースを LF へ統一する（出力 .bas は保存時に CRLF 付与）。
const lfNormalize = (s) => (s || "").replace(/\r\n?/g, "\n");
function setSource(text) {
  srcEl.value = lfNormalize(text);
  render();
  calibrateLineHeight(); // 大きなファイル読込後に行高を実測較正（WKWebViewズレ対策）
  resetHistory(); // 読込/逆変換は履歴の起点（巻き戻して消えないように）
}

// ============ プロジェクトツリー（左サイドバー）============
const fileTreeEl = $("fileTree");
const userFiles = () => Object.keys(project.files).sort();        // ユーザ編集可
const libFiles = () => Object.keys(LIBS).filter((k) => k.includes("/")).sort(); // 埋め込み(読み取り専用)

// lib を表示中ならそのパス（読み取り専用）。null=通常のプロジェクトファイル編集。
let viewingLib = null;

// 現在の編集内容をアクティブファイルへ書き戻す（lib 表示中は書き戻さない）
function syncActiveFile() {
  if (viewingLib) return;
  if (project.active && project.files[project.active] != null) {
    project.files[project.active] = srcEl.value;
  }
}
function setReadOnly(on) {
  viewingLib = on || null;
  srcEl.readOnly = !!on;
  $("filename").readOnly = !!on;
  $("editWrap").classList.toggle("readonly", !!on);
}
function openFile(name) {
  if (!(name in project.files)) return;
  syncActiveFile();
  setReadOnly(false);
  project.active = name;
  $("filename").value = name;
  setSource(project.files[name]);
  activateTab("structured");
  renderTree();
  saveProject();
}
// ライブラリ(読み取り専用)を構造化タブで開く。line 指定でその行へジャンプ。
function openLib(path, line) {
  syncActiveFile();
  setReadOnly(path);
  $("filename").value = path;
  setSource(LIBS[path] ?? LIBS[path.split("/").pop()] ?? "");
  activateTab("structured");
  renderTree();
  if (line != null) {
    const off = (lineStartsOf(srcEl.value)[line] ?? 0);
    srcEl.focus();
    srcEl.setSelectionRange(off, off);
    const lh = lineH();
    srcEl.scrollTop = Math.max(0, line * lh - srcEl.clientHeight / 2);
    updateCurLine();
  }
}
async function newFile() {
  const name = await sanitizeName(await showPrompt(t("proj.newfile"), t("proj.newfilemsg"), "untitled.msxb"));
  if (!name) return;
  if (project.files[name] != null) { flash(t("proj.exists", name)); return; }
  syncActiveFile();
  project.files[name] = "";
  openFile(name);
}
async function renameFile(name) {
  const next = await sanitizeName(await showPrompt(t("proj.rename"), t("proj.renamemsg"), name));
  if (!next || next === name) return;
  if (project.files[next] != null) { flash(t("proj.exists", next)); return; }
  project.files[next] = project.files[name];
  delete project.files[name];
  if (project.active === name) project.active = next;
  $("filename").value = project.active;
  renderTree();
  saveProject();
}
async function deleteFile(name) {
  if (userFiles().length <= 1) { flash(t("proj.last")); return; }
  if (!(await showConfirm(t("proj.delete"), t("proj.deletemsg", name)))) return;
  delete project.files[name];
  if (project.active === name) {
    const next = userFiles()[0];
    project.active = next;
    $("filename").value = next;
    setSource(project.files[next]);
    activateTab("structured");
  }
  renderTree();
  saveProject();
}
// 末尾 .msxb を自動付与し前後空白を除去
async function sanitizeName(raw) {
  if (raw == null) return null;
  let n = raw.trim();
  if (!n) return null;
  if (!/\.[a-z0-9]+$/i.test(n)) n += ".msxb";
  return n;
}
// ファイルが直接 INCLUDE するプロジェクトファイル（パス→basename 解決）。
function includeChildren(f) {
  const out = [];
  for (const p of includesOf(fileContent(f))) {
    if (project.files[p] != null) out.push(p);
    else { const b = p.split("/").pop(); if (project.files[b] != null) out.push(b); }
  }
  return out;
}
// ツリー行ホバー用ツールチップ: デスクトップ＆フォルダバインド時は絶対パス、
// それ以外はブラウザ/未バインドの注記（機能#3）。
function pathTip(name) {
  if (isDesktop() && project.dir) {
    const dir = project.dir.replace(/[\/\\]+$/, "");
    const sep = dir.includes("\\") ? "\\" : "/";
    return dir + sep + name;
  }
  return t(isDesktop() ? "tip.unbound" : "tip.browser", name);
}
function renderTree() {
  let html = "";
  const entry = currentEntry();
  const explicit = !!(project.mainFile && project.files[project.mainFile] != null);
  const files = userFiles();
  // include グラフ: 取り込まれているファイルは根から外し、取り込み元の下に入れ子表示する。
  const included = new Set();
  for (const f of files) for (const c of includeChildren(f)) included.add(c);
  const roots = files.filter((f) => !included.has(f)).sort();
  const seen = new Set();
  const nodeHtml = (f, depth) => {
    if (seen.has(f)) return ""; // 循環・重複ぶら下がり防止（各ファイルは1回）
    seen.add(f);
    const a = !viewingLib && f === project.active ? " active" : "";
    const isEntry = f === entry;
    const badge = isEntry
      ? `<span class="ft-main${explicit ? " pinned" : ""}" title="${esc(explicit ? t("proj.mainexplicit") : t("proj.mainauto"))}">▶</span>`
      : "";
    const pin = isEntry && explicit
      ? `<button class="ft-act" data-main="" title="${esc(t("proj.clearmain"))}">📌</button>`
      : `<button class="ft-act" data-main="${esc(f)}" title="${esc(t("proj.setmain"))}">📍</button>`;
    const pad = 12 + depth * 14;
    let h = `<div class="ft-row${a}" data-file="${esc(f)}" title="${esc(pathTip(f))}" style="padding-left:${pad}px">` +
      `<span class="ft-ico">${depth ? "↳" : "📄"}</span>${badge}<span class="ft-name">${esc(f)}</span>` +
      pin +
      `<button class="ft-act" data-ren="${esc(f)}" title="${esc(t("proj.rename"))}">✎</button>` +
      `<button class="ft-act" data-del="${esc(f)}" title="${esc(t("proj.delete"))}">🗑</button></div>`;
    for (const c of includeChildren(f).sort()) h += nodeHtml(c, depth + 1);
    return h;
  };
  for (const f of roots) html += nodeHtml(f, 0);
  for (const f of files) if (!seen.has(f)) html += nodeHtml(f, 0); // 取りこぼし（循環等）
  const libs = libFiles();
  if (libs.length) {
    html += `<div class="ft-group">${esc(t("proj.libs"))}</div>`;
    for (const f of libs) {
      const a = viewingLib === f ? " active" : "";
      html += `<div class="ft-row${a}" data-lib="${esc(f)}" title="${esc(t("tip.lib", f))}"><span class="ft-ico">📦</span><span class="ft-name">${esc(f)}</span></div>`;
    }
  }
  html += `<div class="ft-group">${esc(t("proj.run"))}</div>`;
  html += `<div class="ft-row" data-node="msx" title="${esc(t("tip.node.msx"))}"><span class="ft-ico">📄</span><span class="ft-name">${esc(t("tab.msx"))}</span></div>`;
  html += `<div class="ft-row" data-node="maptable" title="${esc(t("tip.node.maptable"))}"><span class="ft-ico">🔤</span><span class="ft-name">${esc(t("tab.maptable"))}</span></div>`;
  html += `<div class="ft-row node-webmsx" data-node="webmsx" title="${esc(t("tip.node.webmsx"))}"><span class="ft-ico">▶</span><span class="ft-name">WebMSX</span></div>`;
  fileTreeEl.innerHTML = html;
}
// クリック委譲
fileTreeEl.addEventListener("click", (e) => {
  const mainBtn = e.target.closest("[data-main]");
  if (mainBtn) { e.stopPropagation(); setMain(mainBtn.dataset.main || null); return; }
  const ren = e.target.closest("[data-ren]");
  if (ren) { e.stopPropagation(); renameFile(ren.dataset.ren); return; }
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); deleteFile(del.dataset.del); return; }
  const row = e.target.closest(".ft-row");
  if (!row) return;
  if (row.dataset.file) openFile(row.dataset.file);
  else if (row.dataset.lib) openLib(row.dataset.lib);
  else if (row.dataset.node === "msx") openTab("msx");
  else if (row.dataset.node === "maptable") openTab("maptable");
  else if (row.dataset.node === "webmsx") openTab("webmsx");
});
$("newFileBtn").addEventListener("click", newFile);

// エントリ(main)の明示指定／自動に戻す。変換・実行はここから統合ビルドされる。
function setMain(file) {
  if (file) project.mainFile = file;
  else delete project.mainFile;
  saveProject();
  renderTree();
  render(); // エントリが変わったのでプレビューを更新
  setStatus("ok", file ? t("proj.mainset", file) : t("proj.maincleared"));
}

// ============ +α 機能（JetBrains風ナビ・整形・ブックマーク・スニペット）============

const lineStartsOf = (src) => {
  const ls = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") ls.push(i + 1);
  return ls;
};
const caretLine = () => srcEl.value.slice(0, srcEl.selectionStart).split("\n").length;
function scrollToLine(line, col = 0) {
  const ls = lineStartsOf(srcEl.value);
  const off = (ls[line - 1] ?? srcEl.value.length) + col;
  srcEl.focus();
  srcEl.selectionStart = srcEl.selectionEnd = off;
  const lh = lineH();
  srcEl.scrollTop = Math.max(0, (line - 1) * lh - srcEl.clientHeight / 2);
  syncScroll();
}

// ---- トークン＋絶対オフセット ----
function tokensAbs(src) {
  const { tokens } = tokenize(src);
  const ls = lineStartsOf(src);
  return tokens
    .filter((t) => t.kind !== "EOF")
    .map((t) => {
      const start = ls[t.pos.line - 1] + (t.pos.column - 1);
      return { t, start, end: start + t.raw.length };
    });
}
function identAtCaret() {
  const c = srcEl.selectionStart;
  const toks = tokensAbs(srcEl.value);
  return toks.find((x) => x.t.kind === "IDENT" && c >= x.start && c <= x.end)?.t ?? null;
}
// 定義位置（関数定義 / 変数の最初の定義）を探す
function findDefinition(name, src) {
  const toks = tokensAbs(src).map((x) => x.t);
  // 関数定義: FUNCTION の直後の IDENT
  for (let i = 0; i < toks.length - 1; i++)
    if (toks[i].kind === "KEYWORD" && toks[i].value === "FUNCTION" && toks[i + 1].value === name)
      return toks[i + 1].pos;
  // 変数定義: FOR/REF/GLOBAL/DIM の直後、または "=" の直前
  const defKw = new Set(["FOR", "REF", "GLOBAL", "DIM"]);
  let prev = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "NEWLINE") { prev = null; continue; }
    if (t.kind === "IDENT" && t.value === name) {
      const next = toks[i + 1];
      if ((prev && prev.kind === "KEYWORD" && defKw.has(prev.value)) ||
          (next && next.kind === "OP" && next.value === "="))
        return t.pos;
    }
    prev = t;
  }
  // フォールバック: 最初の出現
  const first = toks.find((t) => t.kind === "IDENT" && t.value === name);
  return first ? first.pos : null;
}
// 厳密な定義のみ（FUNCTION 定義 / FOR・REF・GLOBAL・DIM・代入先）。無ければ null（＝呼出だけ）。
function findDefinitionStrict(name, src) {
  const toks = tokensAbs(src).map((x) => x.t);
  for (let i = 0; i < toks.length - 1; i++)
    if (toks[i].kind === "KEYWORD" && toks[i].value === "FUNCTION" && toks[i + 1].value === name)
      return toks[i + 1].pos;
  const defKw = new Set(["FOR", "REF", "GLOBAL", "DIM"]);
  let prev = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "NEWLINE") { prev = null; continue; }
    if (t.kind === "IDENT" && t.value === name) {
      const next = toks[i + 1];
      if ((prev && prev.kind === "KEYWORD" && defKw.has(prev.value)) ||
          (next && next.kind === "OP" && next.value === "="))
        return t.pos;
    }
    prev = t;
  }
  return null;
}
// 他ファイル（プロジェクト＋埋め込みライブラリ）から厳密定義を探す。{file,pos,isLib}|null。
function findDefAcrossFiles(name) {
  const active = activePath();
  for (const f of Object.keys(project.files).sort()) {
    if (f === active) continue;
    const p = findDefinitionStrict(name, project.files[f]);
    if (p) return { file: f, pos: p, isLib: false };
  }
  for (const f of Object.keys(LIBS).sort()) {
    const p = findDefinitionStrict(name, LIBS[f]);
    if (p) return { file: f, pos: p, isLib: true };
  }
  return null;
}

// ---- ジャンプ履歴（戻る/進む）----
const jumpBack = [];
const jumpFwd = [];
const recordJump = () => { jumpBack.push(srcEl.selectionStart); if (jumpBack.length > 100) jumpBack.shift(); jumpFwd.length = 0; };
function goBack() {
  if (!jumpBack.length) return;
  jumpFwd.push(srcEl.selectionStart);
  const off = jumpBack.pop();
  const line = srcEl.value.slice(0, off).split("\n").length;
  scrollToLine(line);
  srcEl.selectionStart = srcEl.selectionEnd = off;
}
function goForward() {
  if (!jumpFwd.length) return;
  jumpBack.push(srcEl.selectionStart);
  const off = jumpFwd.pop();
  const line = srcEl.value.slice(0, off).split("\n").length;
  scrollToLine(line);
  srcEl.selectionStart = srcEl.selectionEnd = off;
}

// ---- 定義へ移動 / 使用箇所 ----
// キャレット行が INCLUDE "パス" なら、そのパスを返す（ジャンプ用）。
function includePathAtLine() {
  const line = srcEl.value.split("\n")[caretLine() - 1] || "";
  const m = line.match(/^\s*INCLUDE\s+"([^"]+)"/i);
  return m ? m[1] : null;
}
// INCLUDE 先を開く（プロジェクトファイル→basename→埋め込みライブラリの順）。
function openInclude(path) {
  if (project.files[path] != null) { openFile(path); return true; }
  const b = path.split("/").pop();
  if (project.files[b] != null) { openFile(b); return true; }
  if (LIBS[path] != null) { openLib(path, 0); return true; }
  if (LIBS[b] != null) { openLib(b, 0); return true; }
  return false;
}
function goToDefinition() {
  // INCLUDE 行なら取り込み先ファイルへジャンプ（JetBrains の Go to file）。
  const incPath = includePathAtLine();
  if (incPath) {
    if (openInclude(incPath)) flash((lang === "en" ? "Open include: " : "INCLUDE を開く: ") + incPath);
    else flash((lang === "en" ? "File not found: " : "ファイルが見つかりません: ") + incPath);
    return;
  }
  const t = identAtCaret();
  if (!t) { flash("識別子の上で実行してください"); return; }
  // 1) アクティブファイル内の厳密な定義
  const localStrict = findDefinitionStrict(t.value, srcEl.value);
  if (localStrict) {
    recordJump();
    scrollToLine(localStrict.line, localStrict.column - 1);
    flash(`定義へ移動: ${t.value} (行 ${localStrict.line})`);
    return;
  }
  // 2) 他ファイル/ライブラリの定義（呼出だけの関数がINCLUDE先で定義されている等）
  const x = findDefAcrossFiles(t.value);
  if (x) {
    if (x.isLib) openLib(x.file, x.pos.line - 1);
    else { openFile(x.file); recordJump(); scrollToLine(x.pos.line, x.pos.column - 1); }
    flash(`定義へ移動: ${t.value} → ${x.file} (行 ${x.pos.line})`);
    return;
  }
  // 3) フォールバック: アクティブファイル内の最初の出現
  const def = findDefinition(t.value, srcEl.value);
  if (!def) { flash(`定義が見つかりません: ${t.value}`); return; }
  recordJump();
  scrollToLine(def.line, def.column - 1);
  flash(`定義へ移動: ${t.value} (行 ${def.line})`);
}
let usage = { name: null, list: [], idx: 0 };
// 名前の使用箇所を全ファイル横断で集める（プロジェクト＋表示ライブラリ）。
// {file,pos,isLib} の配列。ファイル順→行順。アクティブファイルはライブバッファを見る。
function collectUsagesAllFiles(name) {
  const out = [];
  const active = activePath();
  const scan = (file, text, isLib) => {
    for (const x of tokensAbs(text))
      if (x.t.kind === "IDENT" && x.t.value === name) out.push({ file, pos: x.t.pos, isLib });
  };
  for (const f of Object.keys(project.files).sort())
    scan(f, f === active ? srcEl.value : project.files[f], false);
  for (const f of Object.keys(LIBS).filter((k) => k.includes("/")).sort())
    scan(f, LIBS[f], true);
  return out;
}
// 使用箇所へ移動（必要ならファイルを開いてから）。
function gotoUsage(u) {
  if (u.isLib) {
    if (viewingLib !== u.file) { openLib(u.file, u.pos.line - 1); return; }
  } else if (u.file !== activePath() || viewingLib) {
    openFile(u.file);
  }
  recordJump();
  scrollToLine(u.pos.line, u.pos.column - 1);
}
function findUsages() {
  const t = identAtCaret();
  if (!t) { flash("識別子の上で実行してください"); return; }
  if (usage.name !== t.value) usage = { name: t.value, list: collectUsagesAllFiles(t.value), idx: -1 };
  if (!usage.list.length) { flash(`使用箇所なし: ${t.value}`); return; }
  usage.idx = (usage.idx + 1) % usage.list.length;
  const u = usage.list[usage.idx];
  gotoUsage(u);
  flash(`使用箇所 ${usage.idx + 1}/${usage.list.length}: ${t.value}（${u.file}）`);
}
async function goToLine() {
  const n = await showPrompt(t("prompt.goline.title"), t("prompt.goline"));
  if (n == null || n === "") return;
  const line = Math.max(1, Math.min(srcEl.value.split("\n").length, parseInt(n) || 1));
  recordJump();
  scrollToLine(line);
}

// ---- ブックマーク ----
function toggleBookmark() {
  const l = caretLine();
  if (bookmarks.has(l)) bookmarks.delete(l); else bookmarks.add(l);
  render();
  flash(`ブックマーク ${bookmarks.has(l) ? "追加" : "解除"}: 行 ${l}`);
}
function nextBookmark() {
  if (!bookmarks.size) return flash("ブックマークなし");
  const cur = caretLine();
  const sorted = [...bookmarks].sort((a, b) => a - b);
  const next = sorted.find((l) => l > cur) ?? sorted[0];
  recordJump();
  scrollToLine(next);
}

// ---- 整形（reformat）----
// 整形本体（formatSource）は docs/13 §13.2 のリファレンス実装として core（src/format/format.ts）に
// 置き、ここからは import して使う（app.js と test/format.test.ts で同一実装を共有）。
function onFormat() {
  const c = srcEl.selectionStart;
  srcEl.value = formatSource(srcEl.value);
  srcEl.selectionStart = srcEl.selectionEnd = Math.min(c, srcEl.value.length);
  render();
  flash("整形しました");
}

// ---- 機械語DATAの逆アセンブル注釈（ニーモニックコメント '@。MSX変換時に除去）----
function annotateMachineCode() {
  if (viewingLib) return; // 読み取り専用ライブラリには注釈しない
  const base = stripMnemonicComments(srcEl.value); // 既存注釈を除去（冪等）
  let prog;
  try {
    prog = parse(tokenize(base).tokens).program;
  } catch (e) {
    logErr("annotate parse", e);
    return;
  }
  const blobs = findDataBlobs(prog).filter((b) => b.kind === "machine-code");
  if (!blobs.length) {
    srcEl.value = base;
    render();
    flash(t("asm.none"));
    return;
  }
  const lines = base.split("\n");
  // ローダ行の上に注釈ブロックを挿入。行番号ズレ回避のため下から。
  blobs
    .map((b) => ({ line: b.pos.line, block: buildAnnotationLines(b, MSX_BIOS) }))
    .sort((a, b) => b.line - a.line)
    .forEach((ins) => lines.splice(Math.max(0, ins.line - 1), 0, ...ins.block));
  srcEl.value = lines.join("\n");
  render();
  flash(t("asm.done", blobs.length));
}
function clearAnnotations() {
  if (viewingLib) return;
  srcEl.value = stripMnemonicComments(srcEl.value);
  render();
  flash(t("asm.cleared"));
}

// ---- スニペット（行頭の trigger + Tab で展開）----
const SNIPPETS = {
  FN: (ind) => [`FUNCTION NAME()`, `${ind}    `, `${ind}END FUNCTION`],
  FOR: (ind) => [`FOR I = 1 TO 10`, `${ind}    `, `${ind}NEXT`],
  IF: (ind) => [`IF  THEN`, `${ind}    `, `${ind}END IF`],
  WHILE: (ind) => [`WHILE `, `${ind}    `, `${ind}WEND`],
};
function trySnippet() {
  const c = srcEl.selectionStart;
  const text = srcEl.value;
  const lineStart = text.lastIndexOf("\n", c - 1) + 1;
  const lineText = text.slice(lineStart, c);
  const ind = (lineText.match(/^\s*/) || [""])[0];
  const word = lineText.trim().toUpperCase();
  const snip = SNIPPETS[word];
  if (!snip || lineText.slice(ind.length) !== lineText.trim()) return false;
  const lines = snip(ind);
  const body = ind + lines.join("\n");
  srcEl.setRangeText(body, lineStart, c, "end");
  // 本体行（2行目）の末尾へキャレット
  const caret = lineStart + (ind + lines[0]).length + 1 + (ind.length + 4);
  srcEl.selectionStart = srcEl.selectionEnd = caret;
  render();
  return true;
}

// ---- 一時メッセージ ----
let flashTimer = null;
function flash(msg) {
  statusEl.className = "";
  statusEl.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(render, 1800);
}

// ============ エディタ便利機能（自動インデント / 行操作 / 括弧補完 / 現在行 / 検索置換）============

const INDENT = "    "; // 1 段 = 4 スペース
// ブロック構文（この言語は FUNCTION / IF…THEN / FOR / WHILE のみ）
const RE_OPEN = /^(FUNCTION\b|FOR\b|WHILE\b|IF\b.*\bTHEN\s*$)/; // 次行を深くする
const RE_CLOSE = /^(END\s+FUNCTION\b|END\s+IF\b|NEXT\b|WEND\b)/; // 自身を浅くする
const RE_MID = /^(ELSE\b)/; // 自身は浅く・本体は元の深さ（ELSE）
const isOpen = (l) => RE_OPEN.test(l.trim().toUpperCase());
const isClose = (l) => RE_CLOSE.test(l.trim().toUpperCase());
const isMid = (l) => RE_MID.test(l.trim().toUpperCase());

// caret 位置の行インデックス（0始まり）
const lineIndexAt = (off) => srcEl.value.slice(0, off).split("\n").length - 1;
// 指定行までの「上の行」を走査して括弧の深さを数える
function depthBefore(lines, upto) {
  let d = 0;
  for (let k = 0; k < upto; k++) {
    if (isOpen(lines[k])) d++;
    else if (isClose(lines[k])) d--;
    // ELSE は深さを変えない（本体は IF と同じ段、ELSE 自身だけ浅い）
  }
  return Math.max(0, d);
}
// 行 i に与えるべきインデント段数（閉じ/ELSE はその行自身を 1 段浅く）
function targetDepth(lines, i) {
  let d = depthBefore(lines, i);
  if (isClose(lines[i]) || isMid(lines[i])) d -= 1;
  return Math.max(0, d);
}

// Enter: 直前行が opener なら深く、それ以外は維持（深さ走査ベース）
function autoIndentEnter() {
  const v = srcEl.value, s = srcEl.selectionStart, e = srcEl.selectionEnd;
  const lines = v.slice(0, s).split("\n");
  const cur = lineIndexAt(s);
  let d = depthBefore(lines, cur); // cur より上の深さ
  if (isOpen(lines[cur])) d++; // 直前行が opener なら 1 段深く
  if (isClose(lines[cur])) d--; // 直前行が closer ならその行は浅い→次行も
  const indent = INDENT.repeat(Math.max(0, d));
  srcEl.setRangeText("\n" + indent, s, e, "end");
  render();
}

// closer / ELSE を打ち終えた瞬間に、その行を 1 段浅く揃える（冪等）
function electricDedent() {
  const v = srcEl.value, s = srcEl.selectionStart;
  if (s !== srcEl.selectionEnd) return; // 範囲選択中はしない
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  let le = v.indexOf("\n", s); if (le < 0) le = v.length;
  const lineText = v.slice(ls, le);
  if (s !== le) return; // 行末で入力した時だけ（途中編集を邪魔しない）
  if (!isClose(lineText) && !isMid(lineText)) return;
  const lines = v.split("\n");
  const want = INDENT.repeat(targetDepth(lines, lineIndexAt(s)));
  const curInd = (lineText.match(/^\s*/) || [""])[0];
  if (curInd === want) return; // 既に正しい
  srcEl.setRangeText(want + lineText.trimStart(), ls, le, "end");
}

// ---- 行操作 ----
function dupLine() {
  const v = srcEl.value, s = srcEl.selectionStart, e = srcEl.selectionEnd;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  let le = v.indexOf("\n", e); if (le < 0) le = v.length;
  const block = v.slice(ls, le);
  srcEl.setRangeText("\n" + block, le, le, "preserve");
  const d = block.length + 1;
  srcEl.selectionStart = s + d;
  srcEl.selectionEnd = e + d;
  render();
}
function moveLines(dir) {
  const v = srcEl.value, s = srcEl.selectionStart, e = srcEl.selectionEnd;
  const lines = v.split("\n");
  const a = lineIndexAt(s), b = lineIndexAt(e);
  if (dir < 0 && a === 0) return;
  if (dir > 0 && b === lines.length - 1) return;
  const starts = lineStartsOf(v);
  const relS = s - starts[a], relE = e - starts[a]; // ブロック先頭からの相対
  const seg = lines.splice(a, b - a + 1);
  lines.splice(a + dir, 0, ...seg);
  srcEl.value = lines.join("\n");
  const nb = lineStartsOf(srcEl.value)[a + dir];
  srcEl.selectionStart = nb + relS;
  srcEl.selectionEnd = nb + relE;
  render();
}

// ---- 括弧 / 引用符の自動補完 ----
const PAIRS = { "(": ")", '"': '"' };
const CLOSERS = new Set([")", '"']);
// 戻り値 true なら処理済み（既定動作を抑止）
function handleAutoPair(e) {
  const k = e.key;
  const v = srcEl.value, s = srcEl.selectionStart, en = srcEl.selectionEnd;
  if (PAIRS[k]) {
    const close = PAIRS[k];
    if (s !== en) { // 選択を囲む
      const sel = v.slice(s, en);
      srcEl.setRangeText(k + sel + close, s, en, "preserve");
      srcEl.selectionStart = s + 1; srcEl.selectionEnd = en + 1;
      render();
      return true;
    }
    // " の閉じ側（次が "）はタイプオーバー
    if (k === '"' && v[s] === '"') { srcEl.selectionStart = srcEl.selectionEnd = s + 1; return true; }
    srcEl.setRangeText(k + close, s, en, "preserve");
    srcEl.selectionStart = srcEl.selectionEnd = s + 1;
    render();
    return true;
  }
  if (CLOSERS.has(k) && s === en && v[s] === k) { // 対応閉じはタイプオーバー
    srcEl.selectionStart = srcEl.selectionEnd = s + 1;
    return true;
  }
  return false;
}
// Backspace: 空ペア (| ) や "|" は両方消す
function handlePairBackspace() {
  const v = srcEl.value, s = srcEl.selectionStart;
  if (s === srcEl.selectionEnd && PAIRS[v[s - 1]] === v[s]) {
    srcEl.setRangeText("", s - 1, s + 1, "end");
    render();
    return true;
  }
  return false;
}

// ---- 現在行ハイライト ----
const curlineEl = $("curline");
function updateCurLine() {
  if (!settings.curLine) { curlineEl.hidden = true; return; }
  curlineEl.hidden = false;
  // 較正後は textarea の実描画行高(measuredLH)で位置決め＝キャレットと帯が一致する
  const lh = measuredLH || parseFloat(getComputedStyle(srcEl).lineHeight) || 22;
  const padTop = parseFloat(getComputedStyle(srcEl).paddingTop) || 0;
  const line = lineIndexAt(srcEl.selectionStart);
  curlineEl.style.height = lh + "px";
  curlineEl.style.top = padTop + line * lh - srcEl.scrollTop + "px";
}
// 設定変更時に表示状態を反映
function applyEditorPrefs() { updateCurLine(); }

// ---- 構造化 ⇔ 変換後MSX の行リンク（双方向ハイライト）----
// 変換器が各MSX行に付ける src（由来の構造化ソース行）を使う。
//  ・構造化側キャレット → 対応MSX行を緑ハイライト＋スクロール。
//  ・MSX行クリック → 由来の構造化行へ「ネイティブのキャレット移動」（＝標準の現在行
//    ハイライトがそのまま出る）。独自の位置計算オーバーレイは使わない＝ズレない。
let linkCode = [];              // 直近の MsxLine[]（lineNo/text/src）
let srcToMsxI = new Map();      // 構造化ソース行 → MSX行のインデックス配列

function buildMsxLinkView(code) {
  linkCode = code || [];
  srcToMsxI = new Map();
  let html = "";
  linkCode.forEach((l, i) => {
    const srcAttr = l.src && l.src.length ? l.src.join(",") : "";
    if (l.src) for (const sl of l.src) {
      const a = srcToMsxI.get(sl) || []; a.push(i); srcToMsxI.set(sl, a);
    }
    html += `<div class="mln" data-i="${i}" data-src="${srcAttr}">${esc(String(l.lineNo) + " " + l.text)}</div>`;
  });
  msxOut.innerHTML = html;
}
function clearMsxHi() { for (const e of msxOut.querySelectorAll(".mln.hl")) e.classList.remove("hl"); }

// 変換テーブル（読み取り専用）: 変数名の圧縮・関数の対応（先頭行/引数/戻り値/ローカル）・
// 制御フロー(BREAK/CONTINUE)の飛び先を人間が読める表で表示。データは変換結果の map（=.map.json）。
function buildMapTableView(map) {
  if (!map) { maptableNote.textContent = t("maptable.none"); maptableOut.innerHTML = ""; return; }
  maptableNote.textContent = t("maptable.note");
  // コンパイラ内部の一時変数（__sel0/__T1 等、SELECT CASE 展開や関数戻り値の退避）は
  // ユーザ名ではないので表示から除外（.map.json 自体は不変）。
  const userVars = (rows) => (rows || []).filter((r) => !/^__/.test(r.original));
  const globals = userVars(map.globalVarMap), fns = map.functions || [], cf = map.controlFlow || [];
  const nameTable = (rows) => rows.length
    ? `<table class="mt"><thead><tr><th>${esc(t("maptable.col.orig"))}</th><th>${esc(t("maptable.col.msx"))}</th></tr></thead><tbody>`
      + rows.map((r) => `<tr><td class="mt-orig">${esc(r.original)}</td><td class="mt-msx">${esc(r.msxName)}</td></tr>`).join("")
      + `</tbody></table>`
    : `<div class="mt-empty">${esc(t("maptable.none.sub"))}</div>`;
  let h = "";
  h += `<section class="mt-sec"><h3>${esc(t("maptable.globals", globals.length))}</h3>${nameTable(globals)}</section>`;
  h += `<section class="mt-sec"><h3>${esc(t("maptable.functions", fns.length))}</h3>`;
  if (!fns.length) h += `<div class="mt-empty">${esc(t("maptable.none.sub"))}</div>`;
  for (const f of fns) {
    const entry = f.variants && f.variants[0] && f.variants[0].entryLine != null ? f.variants[0].entryLine : null;
    const params = (f.params || []).map((p) => `${esc(p.name)}${p.byRef ? ` <span class="mt-ref">${esc(t("maptable.ref"))}</span>` : ""}`).join(", ") || "—";
    h += `<div class="mt-fn"><div class="mt-fn-head"><span class="mt-fn-name">${esc(f.name + (f.retSuffix || ""))}</span>`;
    if (entry != null) h += `<span class="mt-fn-entry">${esc(t("maptable.entry"))} ${esc(String(entry))}</span>`;
    h += `</div><div class="mt-fn-sig"><span class="mt-lbl">${esc(t("maptable.params"))}:</span> ${params}`;
    if (f.retVar) h += ` &nbsp;·&nbsp; <span class="mt-lbl">${esc(t("maptable.ret"))}:</span> <span class="mt-msx">${esc(f.retVar)}</span>`;
    h += `</div>`;
    const locals = userVars(f.localVarMap);
    if (locals.length) h += `<div class="mt-locals"><span class="mt-lbl">${esc(t("maptable.locals"))}:</span>${nameTable(locals)}</div>`;
    h += `</div>`;
  }
  h += `</section>`;
  if (cf.length) {
    h += `<section class="mt-sec"><h3>${esc(t("maptable.controlflow", cf.length))}</h3><table class="mt"><tbody>`
      + cf.map((c) => `<tr><td class="mt-orig">${esc(c.kind)}</td><td>${esc(t("maptable.cf.to"))} ${esc(String(c.targetLine))}</td></tr>`).join("")
      + `</tbody></table></section>`;
  }
  maptableOut.innerHTML = h;
}

// 行連動は「分割表示（構造化とMSXの両ペインが同時に見えている）」時のみ動作。
// 片方だけ表示中は何もしない（勝手にタブを開いたり移動・ハイライトしたりしない）。
function bothPanesVisible() { return !msxPane.hidden && !$("structuredPane").hidden; }

// 構造化側キャレット行 → 対応MSX行を緑ハイライト＋スクロール＋ヘッダに対応を明示
function hiFromStructured() {
  const cl = caretLine();
  const dbg = (m) => { if (window.__LINK_DEBUG__) console.log("[link]", m); };
  if (!bothPanesVisible()) { dbg("gated (not split)"); return; }
  clearMsxHi();
  if (msxPane.classList.contains("error") || !linkCode.length) return;
  const idxs = srcToMsxI.get(cl);
  if (!idxs || !idxs.length) {
    // この構造化行は変換後に出力が無い（GLOBAL宣言/コメント/空行など）＝ハイライト対象なし。
    // 「無反応で壊れている」と誤解されないよう、ヘッダに理由を明示する。
    msxNote.textContent = t("link.noout", cl);
    dbg("no output for structured line " + cl);
    return;
  }
  let first = null;
  for (const i of idxs) {
    const el = msxOut.querySelector(`.mln[data-i="${i}"]`);
    if (el) { el.classList.add("hl"); if (!first) first = el; }
  }
  if (first) {
    msxOut.scrollTop = Math.max(0, first.offsetTop - msxOut.clientHeight / 2 + first.offsetHeight / 2);
    const nos = idxs.map((i) => linkCode[i] && linkCode[i].lineNo).filter((n) => n != null);
    msxNote.textContent = t("link.map", cl, nos.join(", "));
    dbg("structured " + cl + " -> MSX " + nos.join(","));
  }
}

// MSX行クリック → 由来の構造化行へキャレットを移動（ネイティブ現在行ハイライトが出る）
function hiFromMsx(el) {
  if (!bothPanesVisible()) return;   // 分割表示時のみ
  const s = el.getAttribute("data-src");
  const srcLines = s ? s.split(",").map(Number).filter(Boolean) : [];
  if (!srcLines.length) return;   // MAIN ヘッダ/END など由来なしの行は無反応
  scrollToLine(srcLines[0]);      // 構造化側にキャレット＋スクロール（既存の堅牢な実装）
  updateCurLine();
  hiFromStructured();             // 新しいキャレット行に対応するMSX行を緑ハイライト
}

msxOut.addEventListener("click", (e) => {
  const el = e.target.closest(".mln");
  if (el) hiFromMsx(el);
});

// ---- 検索の共通マッチャ（Aa=大小区別 / .*=正規表現。両バー共有設定）----
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 戻り値: RegExp | null（空クエリ）| "ERR"（正規表現エラー）
function buildMatcher(q) {
  if (!q) return null;
  const flags = settings.findCase ? "g" : "gi";
  try {
    return new RegExp(settings.findRegex ? q : reEsc(q), flags);
  } catch (_) {
    return "ERR";
  }
}
// text 中の全一致 [{index,len}]（置換は $1 展開せずリテラル＝一貫挙動）
function allMatches(text, q) {
  const re = buildMatcher(q);
  if (!re || re === "ERR") return [];
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, len: m[0].length });
    if (m[0].length === 0) re.lastIndex++; // 空マッチの無限ループ回避
  }
  return out;
}

// ============ 単純検索・置換（現在のドキュメント内）============
const findBar = $("findbar");
let findMatches = [], findIdx = -1;
const findOpen = () => !findBar.hidden;
// 検索バーは #structuredPane（縦積み）内の通常フロー要素。開くとエディタ行(#editRow)を
// ブロックごと押し下げるだけなので、テキスト層(#src/#highlight)とガターは互いに一切ずれない
// （旧実装は3要素の padding-top を手で合わせる方式で、バーの有無でズレる余地があった）。
// ここでは残存インライン padding を念のため解除し、表示切替後の位置決めだけ更新する。
function applyFindOffset() {
  srcEl.style.paddingTop = "";
  hlEl.style.paddingTop = "";
  gutterEl.style.paddingTop = "";
  syncScroll();
  updateCurLine();
}
function openFind(replace) {
  activateTab("structured"); // 単純検索はエディタ上で動くので構造化タブへ
  findBar.hidden = false;
  $("findReplaceRow").hidden = !replace;
  applyFindOffset(); // 置換行の有無で高さが変わるので表示確定後に測って反映
  const sel = srcEl.value.slice(srcEl.selectionStart, srcEl.selectionEnd);
  if (sel && !sel.includes("\n")) $("findInput").value = sel;
  syncFindToggles();
  recomputeFind();
  $("findInput").focus();
  $("findInput").select();
}
function closeFind() {
  findBar.hidden = true;
  applyFindOffset(); // オフセットを解除（既定へ戻す）
  srcEl.focus();
}
function recomputeFind(jump) {
  const q = $("findInput").value;
  findMatches = allMatches(srcEl.value, q);
  findIdx = -1;
  const err = q && buildMatcher(q) === "ERR";
  if (findMatches.length) {
    const from = srcEl.selectionStart;
    findIdx = findMatches.findIndex((m) => m.index >= from);
    if (findIdx < 0) findIdx = 0;
  }
  $("findCount").textContent = err ? t("find.badre") : (findMatches.length ? `${findIdx + 1}/${findMatches.length}` : (q ? "0/0" : ""));
  if (jump && findMatches.length) selectMatch();
}
function selectMatch() {
  const m = findMatches[findIdx];
  srcEl.focus();
  srcEl.setSelectionRange(m.index, m.index + m.len);
  const lh = lineH();
  srcEl.scrollTop = Math.max(0, lineIndexAt(m.index) * lh - srcEl.clientHeight / 2);
  updateCurLine();
  $("findInput").focus();
  $("findCount").textContent = `${findIdx + 1}/${findMatches.length}`;
}
function findStep(dir) {
  if (!findMatches.length) { recomputeFind(true); return; }
  findIdx = (findIdx + dir + findMatches.length) % findMatches.length;
  selectMatch();
}
function replaceOne() {
  if (!findMatches.length) return;
  const m = findMatches[findIdx];
  if (srcEl.selectionStart === m.index && srcEl.selectionEnd === m.index + m.len) {
    srcEl.setRangeText($("replaceInput").value, m.index, m.index + m.len, "end");
    render();
    recomputeFind(true);
  } else {
    selectMatch();
  }
}
function replaceAll() {
  const q = $("findInput").value;
  if (!q) return;
  const rep = $("replaceInput").value;
  const text = srcEl.value;
  const ms = allMatches(text, q);
  if (ms.length) {
    let out = "", last = 0;
    for (const m of ms) { out += text.slice(last, m.index) + rep; last = m.index + m.len; }
    out += text.slice(last);
    srcEl.value = out;
    render();
  }
  recomputeFind();
  flash(t("find.replaced", ms.length));
}
// Aa / .* トグル（両バーで状態共有）
function syncFindToggles() {
  for (const id of ["findCase", "gfindCase"]) $(id)?.classList.toggle("on", settings.findCase);
  for (const id of ["findRegex", "gfindRegex"]) $(id)?.classList.toggle("on", settings.findRegex);
}
function toggleFindCase() { settings.findCase = !settings.findCase; saveSettings(); syncFindToggles(); recomputeFind(); if (gfindOpen()) runGlobalSearch(); }
function toggleFindRegex() { settings.findRegex = !settings.findRegex; saveSettings(); syncFindToggles(); recomputeFind(); if (gfindOpen()) runGlobalSearch(); }

// ============ 全体検索（MAIN ＋ INCLUDE した lib ＋ MSX 変換結果。WebMSX 除外）============
const gPanel = $("searchResults");
const gfindOpen = () => !gPanel.hidden;
let gResults = [];

// 検索対象ソースを収集（INCLUDE は MAIN から幅優先で辿る）
function gatherSources() {
  const src = srcEl.value;
  const out = [{ kind: "main", label: t("src.main"), text: src }];
  const findIncs = (text) => [...text.matchAll(/^\s*INCLUDE\s+"([^"]+)"/gim)].map((m) => m[1]);
  const seen = new Set();
  const queue = findIncs(src);
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const text = includeRead(p, src);
    if (text == null) continue;
    out.push({ kind: "lib", label: p, text });
    for (const q of findIncs(text)) if (!seen.has(q)) queue.push(q);
  }
  try {
    const r = compile(src);
    if (r.msx) out.push({ kind: "msx", label: t("src.msx"), text: r.msx.replace(/\r/g, "") });
  } catch (_) {}
  return out;
}
function openGlobal() {
  gPanel.hidden = false;
  const sel = srcEl.value.slice(srcEl.selectionStart, srcEl.selectionEnd);
  if (sel && !sel.includes("\n")) $("gfindInput").value = sel;
  syncFindToggles();
  runGlobalSearch();
  $("gfindInput").focus();
  $("gfindInput").select();
}
function closeGlobal() { gPanel.hidden = true; srcEl.focus(); }
function runGlobalSearch() {
  const q = $("gfindInput").value;
  const list = $("gfindList");
  gResults = [];
  if (!q || buildMatcher(q) === "ERR") {
    list.innerHTML = "";
    $("gfindCount").textContent = q ? t("find.badre") : "";
    return;
  }
  let fileCount = 0;
  for (const s of gatherSources()) {
    const ms = allMatches(s.text, q);
    if (ms.length) fileCount++;
    for (const m of ms) {
      const line = s.text.slice(0, m.index).split("\n").length - 1;
      const ls = s.text.lastIndexOf("\n", m.index - 1) + 1;
      let le = s.text.indexOf("\n", m.index); if (le < 0) le = s.text.length;
      gResults.push({ kind: s.kind, label: s.label, text: s.text, index: m.index, len: m.len, line, lineText: s.text.slice(ls, le) });
    }
  }
  // ファイル別にグルーピングして一覧描画
  let html = "", cur = null;
  gResults.forEach((r, i) => {
    if (r.label !== cur) { cur = r.label; html += `<div class="gf-file">${esc(cur)}</div>`; }
    html += `<div class="gf-row" data-i="${i}"><span class="gf-ln">${r.line + 1}</span><span class="gf-txt">${esc(r.lineText.trim()) || "&nbsp;"}</span></div>`;
  });
  list.innerHTML = html;
  $("gfindCount").textContent = gResults.length ? t("find.gcount", gResults.length, fileCount) : "0";
}
function gotoResult(i) {
  const r = gResults[i];
  if (!r) return;
  const lh2 = (el) => parseFloat(getComputedStyle(el).lineHeight) || 20;
  if (r.kind === "main") {
    if (viewingLib) openFile(project.active); // lib 表示中なら MAIN へ戻す
    else activateTab("structured");
    srcEl.focus();
    srcEl.setSelectionRange(r.index, r.index + r.len);
    srcEl.scrollTop = Math.max(0, r.line * lh2(srcEl) - srcEl.clientHeight / 2);
    updateCurLine();
  } else if (r.kind === "msx") {
    activateTab("msx");
    const pre = $("msxOut");
    pre.scrollTop = Math.max(0, r.line * lh2(pre) - pre.clientHeight / 2);
  } else {
    openLib(r.label, r.line); // lib も構造化タブ（読み取り専用）で開く
  }
  closeGlobal(); // 中央ウィンドウを閉じてエディタを見せる
}
// グループの所属するタブを表示（閉じていれば開く）
const activateTab = (tab) => openTab(tab);

// ---- イベント ----
let timer = null;
// ---- INCLUDE パス補完（INCLUDE "… を打つと候補を出す）----
const acEl = $("acbox");
let ac = { open: false, items: [], sel: 0, prefixLen: 0 };
// 行頭〜キャレットが INCLUDE "partial（閉じ引用符なし）なら prefix を返す。
function acContext() {
  const c = srcEl.selectionStart;
  if (c !== srcEl.selectionEnd) return null;
  const lineStart = srcEl.value.lastIndexOf("\n", c - 1) + 1;
  const head = srcEl.value.slice(lineStart, c);
  const m = head.match(/^\s*INCLUDE\s+"([^"]*)$/i);
  return m ? { prefix: m[1] } : null;
}
function acCandidates(prefix) {
  const active = activePath();
  const proj = Object.keys(project.files).filter((f) => f !== active);
  const libs = Object.keys(LIBS).filter((k) => k.includes("/"));
  const p = prefix.toLowerCase();
  return [...proj, ...libs].filter((f) => f.toLowerCase().includes(p)).sort().slice(0, 12);
}
function acHide() { ac.open = false; acEl.hidden = true; }
function acShow() {
  const ctx = acContext();
  if (!ctx) return acHide();
  const items = acCandidates(ctx.prefix);
  if (!items.length) return acHide();
  ac = { open: true, items, sel: 0, prefixLen: ctx.prefix.length };
  const lh = lineH();
  const line = srcEl.value.slice(0, srcEl.selectionStart).split("\n").length;
  acEl.style.top = (line * lh - srcEl.scrollTop + 2) + "px";
  acEl.style.left = "48px";
  acEl.innerHTML = items.map((f, i) => `<div class="aci${i === 0 ? " sel" : ""}" data-i="${i}">${esc(f)}</div>`).join("");
  acEl.hidden = false;
}
function acMove(d) {
  if (!ac.open) return;
  ac.sel = (ac.sel + d + ac.items.length) % ac.items.length;
  [...acEl.children].forEach((el, i) => el.classList.toggle("sel", i === ac.sel));
  acEl.children[ac.sel]?.scrollIntoView({ block: "nearest" });
}
function acAccept() {
  if (!ac.open) return false;
  const chosen = ac.items[ac.sel];
  const c = srcEl.selectionStart;
  const needClose = !/^"/.test(srcEl.value.slice(c));
  srcEl.setRangeText(chosen + (needClose ? '"' : ""), c - ac.prefixLen, c, "end");
  acHide();
  render();
  return true;
}
acEl.addEventListener("mousedown", (e) => {
  const row = e.target.closest(".aci");
  if (!row) return;
  e.preventDefault(); // フォーカスを textarea に残す
  ac.sel = parseInt(row.dataset.i);
  acAccept();
});
srcEl.addEventListener("blur", () => setTimeout(acHide, 120));

srcEl.addEventListener("input", () => {
  if (settings.autoIndent) electricDedent(); // closer/ELSE 行を自動で揃える
  commitHistory(false); // タイピングは一定時間で1グループに合体して記録
  scheduleHighlight(); // 即時（次フレーム）に見た目を反映＝入力遅延をなくす
  updateCurLine();
  acShow(); // INCLUDE "… なら候補を出す
  if (findOpen()) recomputeFind();
  clearTimeout(timer);
  timer = setTimeout(renderHeavy, 250); // 重い変換・診断は停止後に
});
srcEl.addEventListener("scroll", () => { syncScroll(); updateCurLine(); });
// キャレット移動（クリック/矢印/選択）で現在行を追従＋対応MSX行をリンクハイライト
srcEl.addEventListener("keyup", () => { updateCurLine(); hiFromStructured(); });
srcEl.addEventListener("click", () => { updateCurLine(); hiFromStructured(); });
// Cmd/Ctrl+クリックで定義/INCLUDE先へジャンプ（JetBrains 流）。クリックでキャレットが移った後に判定。
srcEl.addEventListener("click", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) goToDefinition();
});
srcEl.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  // INCLUDE 補完が開いている間は上下/確定/閉じるを最優先で処理
  if (ac.open) {
    if (e.key === "ArrowDown") { e.preventDefault(); acMove(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); acMove(-1); return; }
    if (e.key === "Enter" || e.key === "Tab") { if (acAccept()) { e.preventDefault(); return; } }
    if (e.key === "Escape") { e.preventDefault(); acHide(); return; }
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) acHide();
  }
  // Undo / Redo（自前スタック。ネイティブと二重発火しないよう preventDefault）
  if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
  if (mod && ((e.shiftKey && e.key.toLowerCase() === "z") || (!e.shiftKey && e.key.toLowerCase() === "y"))) { e.preventDefault(); doRedo(); return; }
  // 検索・置換（JetBrains 風キーマップ）
  if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); gfindOpen() ? closeGlobal() : openGlobal(); return; } // 全体検索
  if (mod && !e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); (findOpen() && $("findReplaceRow").hidden) ? closeFind() : openFind(false); return; } // 単純検索（トグル）
  if (mod && !e.shiftKey && e.key.toLowerCase() === "r") { e.preventDefault(); openFind(true); return; } // 置換
  if (mod && !e.shiftKey && e.key.toLowerCase() === "h") { e.preventDefault(); openFind(true); return; } // 置換（別名）
  if (e.key === "F3") { e.preventDefault(); if (findOpen()) findStep(e.shiftKey ? -1 : 1); else { openFind(false); } return; }
  // 行操作: 複製 / 上下移動（常時有効）
  if (mod && !e.altKey && e.key.toLowerCase() === "d") { e.preventDefault(); dupLine(); return; }
  if (e.altKey && !mod && e.key === "ArrowUp") { e.preventDefault(); moveLines(-1); return; }
  if (e.altKey && !mod && e.key === "ArrowDown") { e.preventDefault(); moveLines(1); return; }
  // 括弧 / 引用符の自動補完（設定で ON/OFF）
  if (settings.autoPair && !mod) {
    if (e.key === "Backspace") { if (handlePairBackspace()) { e.preventDefault(); return; } }
    else if (e.key.length === 1) { if (handleAutoPair(e)) { e.preventDefault(); return; } }
  }
  // 自動インデント（設定で ON/OFF）
  if (settings.autoIndent && e.key === "Enter" && !e.shiftKey && !mod && !e.altKey) {
    e.preventDefault();
    autoIndentEnter();
    return;
  }
  // Tab: スニペット展開 or インデント
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    if (trySnippet()) return;
    const s = srcEl.selectionStart, en = srcEl.selectionEnd;
    srcEl.setRangeText("    ", s, en, "end");
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (e.shiftKey) onConvertSave(); else onSave(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); onOpenFolder(); return; }
  if (mod && e.key === "Enter") { e.preventDefault(); onPlayWebMSX(); return; }
  if (mod && e.altKey && e.key.toLowerCase() === "l") { e.preventDefault(); onFormat(); return; } // 整形（JetBrains: Reformat Code）
  if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); goToDefinition(); return; }
  if (e.shiftKey && e.key === "F6") { e.preventDefault(); renameSymbol(); return; } // JetBrains: リネーム
  if (e.altKey && e.key === "F7") { e.preventDefault(); findUsages(); return; }
  if (mod && e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); return; }
  if (mod && e.altKey && e.key === "ArrowRight") { e.preventDefault(); goForward(); return; }
  if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); goToLine(); return; }
  if (e.key === "F11" && !e.shiftKey) { e.preventDefault(); toggleBookmark(); return; }
  if (e.key === "F11" && e.shiftKey) { e.preventDefault(); nextBookmark(); return; }
});
// ガター行クリックで移動
gutterEl.addEventListener("click", (e) => {
  const gl = e.target.closest(".gl");
  if (gl) { recordJump(); scrollToLine(parseInt(gl.dataset.line)); }
});
// ---- アクション・ディスパッチャ（メニューバー / OSネイティブメニュー 共通）----
function runAction(act) {
  switch (act) {
    case "save": return onConvertSave();
    case "savesrc": return onSave();
    case "openfolder": return onOpenFolder();
    case "newproject": return newProjectFlow();
    case "recentprojects": return showWelcome({ mandatory: false, reason: "new" });
    case "reloadfolder": return onReloadFolder();
    case "dsk": return onMakeDsk();
    case "sav": return onMakeSav();
    case "undo": return doUndo();
    case "redo": return doRedo();
    case "find": return openFind(false);
    case "replace": return openFind(true);
    case "gfind": return openGlobal();
    case "format": return onFormat();
    case "rename": return renameSymbol();
    case "asm-annotate": return annotateMachineCode();
    case "asm-clear": return clearAnnotations();
    case "def": return goToDefinition();
    case "usages": return findUsages();
    case "goline": return goToLine();
    case "back": return goBack();
    case "fwd": return goForward();
    case "bm": return toggleBookmark();
    case "bmnext": return nextBookmark();
    case "split-right": return splitActiveRight();
    case "merge": return mergeAll();
    case "layout-reset": return resetLayout();
    case "fontup": return setFont(1);
    case "fontdown": return setFont(-1);
    case "settings": return openSettings();
    case "run": return onPlayWebMSX();
    case "reverse": return onReverse();
    case "import-basic": return onImportBasic();
    case "help": return showModal(t("sc.title"), t("sc.body"));
    case "about": return showModal("FunctionBASIC", t("about.body", APP_VERSION));
    case "lang-ja": return setLang("ja");
    case "lang-en": return setLang("en");
    default: logErr("runAction", "未知のアクション: " + act);
  }
}

// ---- メニューバー操作（クリックで開閉、開いている時はホバーで切替、外側クリック/Escで閉じる）----
const menubar = $("menubar");
function closeMenus() {
  menubar.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
}
menubar.querySelectorAll(".menu").forEach((menu) => {
  menu.querySelector(".mtitle").addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains("open");
    closeMenus();
    if (!wasOpen) menu.classList.add("open");
  });
  menu.addEventListener("mouseenter", () => {
    if (menubar.querySelector(".menu.open")) {
      closeMenus();
      menu.classList.add("open");
    }
  });
});
menubar.querySelectorAll(".mi").forEach((mi) => {
  mi.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenus();
    runAction(mi.dataset.act);
  });
});
document.addEventListener("click", closeMenus);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMenus();
    if (!$("modal").hidden) resolveModal(null);
    else if (gfindOpen()) closeGlobal();
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "L" || e.key === "l")) {
    e.preventDefault(); caretDiag(); // 行高ズレ診断
  }
});

// モーダル: OK=入力値またはtrue / キャンセル・背景=null
$("modalOk").addEventListener("click", () =>
  resolveModal($("modalInput").hidden ? true : $("modalInput").value),
);
$("modalCancel").addEventListener("click", () => resolveModal(null));
$("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") resolveModal(null);
});
$("modalInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") resolveModal($("modalInput").value);
});

// ファイル名欄の編集 → アクティブファイルをリネーム
$("filename").addEventListener("change", async () => {
  const next = await sanitizeName($("filename").value);
  const cur = project.active;
  if (!next || next === cur) { $("filename").value = cur; return; }
  if (project.files[next] != null) { flash(t("proj.exists", next)); $("filename").value = cur; return; }
  project.files[next] = project.files[cur];
  delete project.files[cur];
  project.active = next;
  $("filename").value = next;
  renderTree();
  saveProject();
});
$("saveBtn").addEventListener("click", onConvertSave);
$("playBtn").addEventListener("click", onPlayWebMSX);
$("copyBtn").addEventListener("click", async () => {
  // msxOut は行リンク用に <div> 化しているので、コピーは元の変換テキスト(last.msx)から。
  const ok = await copyText((last.msx || "").replace(/\r/g, ""));
  msxNote.textContent = ok ? t("copy.ok") : t("copy.err");
  log("MSXコピー:", ok);
});
$("mapCopyBtn").addEventListener("click", async () => {
  if (!last.map) { flash(t("maptable.none.sub")); return; }
  const ok = await copyText(JSON.stringify(last.map, null, 1)); // .map.json と同一形式
  flash(t(ok ? "copy.ok" : "copy.err"));
});
$("fontUp").addEventListener("click", () => setFont(1));
$("fontDown").addEventListener("click", () => setFont(-1));
$("setSave").addEventListener("click", applySettingsFromForm);
$("setCancel").addEventListener("click", closeSettings);
$("settings").addEventListener("click", (e) => {
  if (e.target.id === "settings") closeSettings(); // 背景クリックで閉じる
});

// 検索・置換バー
$("findInput").addEventListener("input", () => recomputeFind(false));
$("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});
$("replaceInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); replaceOne(); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});
$("findNext").addEventListener("click", () => findStep(1));
$("findPrev").addEventListener("click", () => findStep(-1));
$("findClose").addEventListener("click", closeFind);
$("replaceOne").addEventListener("click", replaceOne);
$("replaceAllBtn").addEventListener("click", replaceAll);
$("findCase").addEventListener("click", toggleFindCase);
$("findRegex").addEventListener("click", toggleFindRegex);

// 全体検索パネル
$("gfindInput").addEventListener("input", runGlobalSearch);
$("gfindInput").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeGlobal(); }
  else if (e.key === "Enter") { e.preventDefault(); if (gResults.length) gotoResult(0); }
});
$("gfindCase").addEventListener("click", toggleFindCase);
$("gfindRegex").addEventListener("click", toggleFindRegex);
$("gfindClose").addEventListener("click", closeGlobal);
$("searchResults").addEventListener("click", (e) => { if (e.target.id === "searchResults") closeGlobal(); });
$("gfindList").addEventListener("click", (e) => {
  const row = e.target.closest(".gf-row");
  if (row) gotoResult(parseInt(row.dataset.i, 10));
});

// 読み取り専用ビューア

// タブ: クリックで選択、ドラッグで並べ替え／グループ間移動（分割・統合）
$("tabstrips").addEventListener("click", (e) => {
  const x = e.target.closest(".tab-x");
  if (x) { e.stopPropagation(); closeTab(x.dataset.close); return; } // ×で閉じる
  const t = e.target.closest(".tab");
  if (!t) return;
  active[t.dataset.group] = t.dataset.tab;
  renderTabs();
});
$("tabstrips").addEventListener("dragstart", (e) => {
  const t = e.target.closest(".tab");
  if (!t) return;
  dragTab = { id: t.dataset.tab, from: t.dataset.group };
  e.dataTransfer.effectAllowed = "move";
  try {
    e.dataTransfer.setData("text/plain", t.dataset.tab);
  } catch (_) {}
});
["A", "B"].forEach((g) => {
  const strip = $("strip" + g);
  strip.addEventListener("dragover", (e) => {
    if (dragTab) {
      e.preventDefault();
      strip.classList.add("dropping");
    }
  });
  strip.addEventListener("dragleave", () => strip.classList.remove("dropping"));
  strip.addEventListener("drop", (e) => {
    e.preventDefault();
    strip.classList.remove("dropping");
    if (!dragTab) return;
    moveTab(dragTab.id, dragTab.from, g, dropIndex(strip, e.clientX));
    dragTab = null;
  });
});
// ペイン領域へのドロップ: 右60%へ落とすと分割(→B)、左へ落とすと統合(→A)
const panesEl = $("panes");
panesEl.addEventListener("dragover", (e) => {
  if (dragTab) e.preventDefault();
});
panesEl.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!dragTab) return;
  const r = panesEl.getBoundingClientRect();
  const to = e.clientX - r.left > r.width * 0.6 ? "B" : "A";
  moveTab(dragTab.id, dragTab.from, to, groups[to].length);
  dragTab = null;
});

// OSネイティブメニュー（Tauri）のクリックを runAction に流す（アプリ内メニューと共通）
if (isDesktop()) {
  try {
    tauri().event.listen("menu-action", (e) => runAction(e.payload));
    tauri().event.listen("files-changed", onFilesChanged); // 外部ファイル変更の即時検出（docs/14）
    log("ネイティブメニュー: リスナ登録");
  } catch (e) {
    logErr("ネイティブメニュー listen 失敗", e);
  }
  window.addEventListener("focus", () => checkExternalChanges({ reason: "focus" })); // フォーカス復帰で整合
  if (project.dir) startWatching(project.dir); // 起動時: 監視開始（初回整合はエディタ初期化後に実行＝下部）
}

// 起動
log("起動: desktop=", isDesktop(), " secureContext=", window.isSecureContext, " url=", location.href, " lang=", lang);
applyFontSize(settings.fontSize); // 永続化されたフォントサイズを適用
applyI18n();
loadLayout();
renderTabs();
// プロジェクトを決定して開く（前回を再開 / 未バインド・消失なら Welcome）。
// setSource・renderTree・行高較正・外部整合・監視開始まで initProject が担う。
initProject();
// ウィンドウ/ペインサイズ変化で行高較正と現在行帯を再計算
window.addEventListener("resize", () => { calibrateLineHeight(); updateCurLine(); });
// デスクトップは起動時の言語をネイティブメニューにも反映
if (isDesktop()) {
  try {
    tauri().core.invoke("set_menu_lang", { lang });
  } catch (e) {
    logErr("set_menu_lang(初期)", e);
  }
}
log("起動完了: サンプル読込・初回変換OK");
