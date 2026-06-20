// 構造化BASIC エディタ（依存ゼロ）。コアは dist/ から読み込む。
import { tokenize } from "./core/lexer/lexer.js";
import { parse } from "./core/parser/parser.js";
import { transform, renderMsx } from "./core/transform/transformer.js";
import { reverse } from "./core/reverse/reverse.js";
import { isBuiltin } from "./core/core/builtins.js";

const $ = (id) => document.getElementById(id);
const srcEl = $("src");
const hlEl = $("highlight");
const gutterEl = $("gutter");
const statusEl = $("status");
const msxOut = $("msxOut");
const msxNote = $("msxNote");
const msxPane = $("msxPane");

// ---- ログ（失敗を可視化。サンドボックス等での不調を診断しやすく）----
const log = (...a) => console.log("[editor]", ...a);
const logErr = (label, e) => console.error("[editor]", label, e);

// ---- 多言語（日本語 / English）----
const I18N = {
  ja: {
    "title": "構造化BASIC エディタ — MSX-BASIC 変換",
    "m.file": "ファイル", "m.edit": "編集", "m.view": "表示", "m.run": "実行", "m.help": "ヘルプ",
    "save": "変換して保存", "dsk": "ディスク(.dsk)を保存…",
    "format": "整形（大文字化）", "def": "定義へ移動", "usages": "使用箇所（順送り）", "goline": "行へ移動…",
    "back": "戻る", "fwd": "進む", "bm": "ブックマーク切替", "bmnext": "次のブックマーク",
    "splitright": "アクティブタブを右へ分割", "merge": "分割を統合", "reset": "タブ配置をリセット",
    "fontup": "文字を大きく", "fontdown": "文字を小さく",
    "runmsx": "▶ WebMSXで実行", "reverse": "MSX→構造化に逆変換", "helpsc": "キーボードショートカット…",
    "m.app": "FunctionBASIC", "about": "FunctionBASICについて",
    "about.body": "FunctionBASIC  v0.1.0\n\n構造化BASIC → MSX-BASIC 変換エディタ",
    "tb.save": "変換して保存", "tb.play": "▶ WebMSX", "tb.font": "文字",
    "tab.structured": "構造化BASIC", "tab.msx": "MSX-BASIC変換後", "tab.webmsx": "実行 (WebMSX)",
    "note.webmsx": "▶ WebMSX（または Ctrl/Cmd+Enter）を押すと、ここで自動実行します", "note.copy": "📋 コピー",
    "ready": "準備完了",
    "msx.ok": "▶ WebMSX で実行できます", "msx.err": "文法エラーのため変換できません",
    "msx.errbody": "（構造化BASICタブのエラーを修正してください）",
    "st.ok": "OK", "st.okwarn": (n) => `OK（警告 ${n} 件）`, "st.err": (n) => `⚠ エラー ${n} 件`,
    "save.err": (e) => "保存に失敗しました: " + e, "save.errchk": "誤りがあります。確認してください（変換前のみ保存）",
    "save.done": "保存しました（.msxb / .map.json / .bas、Shift-JIS）",
    "save.dl": "保存しました（.msxb / .map.json / .bas）※Shift-JIS化はデスクトップ版で",
    "run.noerr": "エラーがあるため実行できません",
    "run.ok": (name, note) => `アプリ内WebMSXで実行（RUN"${name}"）${note}`,
    "run.note": (n) => `（日本語等${n}字は実行用に除去）`, "run.open.err": "WebMSXを開けませんでした",
    "dsk.noerr": "エラーがあるためディスクを作成できません", "dsk.desktoponly": "ディスク(.dsk)作成はデスクトップ版で利用できます",
    "dsk.cancel": "ディスク作成をキャンセルしました",
    "dsk.ok": (path, name) => `ディスク作成: ${path} → WebMSXにドラッグ後 RUN"${name}"`,
    "dsk.err": (e) => "ディスク作成に失敗: " + e,
    "rev.noerr": "エラーがあるため逆変換できません",
    "copy.ok": "コピーしました", "copy.err": "コピーに失敗（手動で選択してコピー）",
    "ok": "OK", "cancel": "キャンセル",
    "confirm.title": "確認", "confirm.reverse": "逆変換（MSX→構造化）の結果でエディタを置き換えますか？（往復確認）",
    "prompt.goline.title": "行へ移動", "prompt.goline": "移動先のエディタ行番号:",
    "sc.title": "キーボードショートカット",
    "sc.body": `  保存:                Ctrl/Cmd + S\n  WebMSXで実行:        Ctrl/Cmd + Enter\n  整形(大文字化):       Ctrl/Cmd + Shift + F\n  定義へ移動:           Ctrl/Cmd + B\n  使用箇所(順送り):     Alt + F7\n  戻る / 進む:          Ctrl/Cmd + Alt + ← / →\n  行へ移動:             Ctrl/Cmd + G\n  ブックマーク 切替/次:  F11 / Shift + F11\n  スニペット:           行頭で fn/for/if/while + Tab\n  インデント:           Tab`,
  },
  en: {
    "title": "Structured BASIC Editor — MSX-BASIC",
    "m.file": "File", "m.edit": "Edit", "m.view": "View", "m.run": "Run", "m.help": "Help",
    "save": "Convert & Save", "dsk": "Save Disk (.dsk)…",
    "format": "Format (Uppercase)", "def": "Go to Definition", "usages": "Find Usages (cycle)", "goline": "Go to Line…",
    "back": "Back", "fwd": "Forward", "bm": "Toggle Bookmark", "bmnext": "Next Bookmark",
    "splitright": "Split Active Tab Right", "merge": "Unsplit (Merge)", "reset": "Reset Tab Layout",
    "fontup": "Increase Font", "fontdown": "Decrease Font",
    "runmsx": "▶ Run in WebMSX", "reverse": "Reverse: MSX → Structured", "helpsc": "Keyboard Shortcuts…",
    "m.app": "FunctionBASIC", "about": "About FunctionBASIC",
    "about.body": "FunctionBASIC  v0.1.0\n\nStructured BASIC → MSX-BASIC converter/editor",
    "tb.save": "Convert & Save", "tb.play": "▶ WebMSX", "tb.font": "Font",
    "tab.structured": "Structured BASIC", "tab.msx": "MSX-BASIC (output)", "tab.webmsx": "Run (WebMSX)",
    "note.webmsx": "Press ▶ WebMSX (or Ctrl/Cmd+Enter) to run here automatically.", "note.copy": "📋 Copy",
    "ready": "Ready",
    "msx.ok": "Run it with ▶ WebMSX", "msx.err": "Cannot convert: syntax error",
    "msx.errbody": "(Fix the errors in the Structured BASIC tab.)",
    "st.ok": "OK", "st.okwarn": (n) => `OK (${n} warning(s))`, "st.err": (n) => `⚠ ${n} error(s)`,
    "save.err": (e) => "Save failed: " + e, "save.errchk": "There are errors. Saved source only.",
    "save.done": "Saved (.msxb / .map.json / .bas, Shift-JIS)",
    "save.dl": "Saved (.msxb / .map.json / .bas). Shift-JIS encoding is desktop-only.",
    "run.noerr": "Cannot run: there are errors.",
    "run.ok": (name, note) => `Running in the embedded WebMSX (RUN"${name}")${note}`,
    "run.note": (n) => ` (${n} non-ASCII char(s) stripped for run)`, "run.open.err": "Could not open WebMSX.",
    "dsk.noerr": "Cannot create disk: there are errors.", "dsk.desktoponly": "Disk (.dsk) creation is available in the desktop app.",
    "dsk.cancel": "Disk creation cancelled.",
    "dsk.ok": (path, name) => `Disk created: ${path} → drag into WebMSX, then RUN"${name}"`,
    "dsk.err": (e) => "Disk creation failed: " + e,
    "rev.noerr": "Cannot reverse: there are errors.",
    "copy.ok": "Copied.", "copy.err": "Copy failed (select and copy manually).",
    "ok": "OK", "cancel": "Cancel",
    "confirm.title": "Confirm", "confirm.reverse": "Replace the editor with the reverse-converted result (MSX → Structured)?",
    "prompt.goline.title": "Go to Line", "prompt.goline": "Editor line number:",
    "sc.title": "Keyboard Shortcuts",
    "sc.body": `  Save:                 Ctrl/Cmd + S\n  Run in WebMSX:        Ctrl/Cmd + Enter\n  Format (uppercase):   Ctrl/Cmd + Shift + F\n  Go to definition:     Ctrl/Cmd + B\n  Find usages (cycle):  Alt + F7\n  Back / Forward:       Ctrl/Cmd + Alt + ← / →\n  Go to line:           Ctrl/Cmd + G\n  Bookmark toggle/next: F11 / Shift + F11\n  Snippets:             fn/for/if/while + Tab at line start\n  Indent:               Tab`,
  },
};
let lang = localStorage.getItem("fbe-lang") === "en" ? "en" : "ja";
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
function openModal({ title, body = "", input = null, cancel = false }) {
  $("modalTitle").textContent = title;
  $("modalBody").textContent = body;
  const inp = $("modalInput");
  if (input !== null) {
    inp.hidden = false;
    inp.value = input;
  } else {
    inp.hidden = true;
  }
  const c = $("modalCancel");
  c.hidden = !cancel && input === null;
  c.textContent = t("cancel");
  $("modal").hidden = false;
  (input !== null ? inp : $("modalOk")).focus();
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

const SAMPLE = `' 配列の中から最初に 0 を見つけて返す
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
RESULT = FIND_ZERO(POS)
PRINT "FOUND="; RESULT; " AT "; POS
`;

let last = { diags: [], msx: "", map: null, code: [] };

// ---- HTML エスケープ ----
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- シンタックスハイライト（実Lexerを再利用）----
function highlightHtml(src) {
  const { tokens } = tokenize(src);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const off = (p) => lineStarts[p.line - 1] + (p.column - 1);
  const cls = { KEYWORD: "t-kw", NUMBER: "t-num", STRING: "t-str", COMMENT: "t-com", OP: "t-op" };
  let html = "";
  let pos = 0;
  for (const t of tokens) {
    if (t.kind === "EOF") break;
    const s = off(t.pos);
    if (s > pos) {
      html += esc(src.slice(pos, s));
      pos = s;
    }
    if (t.kind === "NEWLINE") {
      html += esc(t.raw);
      pos += t.raw.length;
      continue;
    }
    let klass = cls[t.kind] ?? null;
    if (t.kind === "IDENT" && isBuiltin(t.value)) klass = "t-builtin";
    html += klass ? `<span class="${klass}">${esc(t.raw)}</span>` : esc(t.raw);
    pos = s + t.raw.length;
  }
  if (pos < src.length) html += esc(src.slice(pos));
  return html + "\n"; // 末尾行ぶんの余白
}

// ---- コンパイル ----
function compile(src) {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  let t;
  try {
    t = transform(program);
  } catch (e) {
    return {
      diags: [...ld, ...pd, { code: "E_INTERNAL", message: String(e.message ?? e), line: 1, column: 1, severity: "error" }],
      msx: "",
      map: null,
      code: [],
    };
  }
  return { diags: [...ld, ...pd, ...t.diagnostics], msx: renderMsx(t.code), map: t.map, code: t.code };
}

// ---- ガター（行番号＋×＋ブックマーク）----
const bookmarks = new Set();
function renderGutter(lineCount, errsByLine) {
  let html = "";
  for (let i = 1; i <= lineCount; i++) {
    const e = errsByLine.get(i);
    const x = e ? `<span class="x" title="${esc(e.join("\n"))}">×</span>` : "";
    const bm = bookmarks.has(i) ? `<span class="bm">★</span>` : "";
    html += `<div class="gl" data-line="${i}">${bm}${i}${x}</div>`;
  }
  gutterEl.innerHTML = html;
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
  const r = compile(src);
  last = r;
  const errsByLine = new Map();
  let errorCount = 0;
  for (const d of r.diags) {
    const arr = errsByLine.get(d.line) ?? [];
    arr.push(`${d.line}:${d.column} ${d.code} ${d.message}`);
    errsByLine.set(d.line, arr);
    if (d.severity === "error") errorCount++;
  }
  const lineCount = src.split("\n").length;
  renderGutter(lineCount, errsByLine);

  // 変換後プレビュー（エラー無し時のみ）
  if (errorCount === 0) {
    msxPane.classList.remove("error");
    msxNote.textContent = t("msx.ok");
    msxOut.textContent = r.msx.replace(/\r/g, "");
  } else {
    msxPane.classList.add("error");
    msxNote.textContent = t("msx.err");
    msxOut.textContent = t("msx.errbody");
  }

  // ステータス
  if (errorCount > 0) {
    setStatus("err", t("st.err", errorCount));
  } else {
    const warn = r.diags.length;
    setStatus("", warn ? t("st.okwarn", warn) : t("st.ok"));
  }
}

// 全更新（整形・読込・タブ切替など、入力以外のタイミング用）
function render() {
  paintHighlight();
  renderHeavy();
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
async function onSave() {
  const r = compile(srcEl.value);
  const hasError = r.diags.some((d) => d.severity === "error");
  const base = baseName();

  if (isDesktop()) {
    // デスクトップ: Rust 側で Shift-JIS 保存（docs/08・10）
    try {
      const saved = await tauri().core.invoke("save_project", {
        base,
        source: srcEl.value,
        mapJson: hasError ? "" : JSON.stringify(r.map, null, 1),
        msx: hasError ? "" : r.msx,
        hasError,
      });
      if (saved === false) return; // ダイアログでキャンセル
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

// ---- 再生（WebMSX、1クリック自動実行。docs/10 §10.4）----
// WebMSX の URL パラメータ（DISKA_FILES_URL + BASIC_RUN）を使い、プログラムを
// data: URL の ZIP で直接渡して「自動ロード→自動RUN」させる。同梱せずリンクのみ
// なのでライセンス清潔。localhost/CORS/ドラッグ/保存ダイアログ/手動RUN すべて不要。
const WEBMSX_URL = "https://webmsx.org"; // 設定で変更可（docs/10 §10.9）

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

// 変換後プログラム → WebMSX 自動実行 URL（DEFLATEでURLを圧縮）
async function webmsxAutorunUrl(name, asciiProgram) {
  const data = new TextEncoder().encode(asciiProgram); // ASCII のみ
  const zip = await zipForWebmsx(name, data);
  const dataUrl = "data:application/zip;base64," + toBase64(zip);
  return (
    `${WEBMSX_URL}?DISKA_FILES_URL=${encodeURIComponent(dataUrl)}` +
    `&BASIC_RUN=${name}`
  );
}

async function onPlayWebMSX() {
  log("WebMSX 実行: 開始");
  const r = compile(srcEl.value);
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
  const r = compile(srcEl.value);
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
      await tauri().core.invoke("plugin:opener|open_url", { url: WEBMSX_URL });
    } catch (e) {
      logErr("opener", e);
      window.open(WEBMSX_URL, "_blank");
    }
    log("ディスク作成: 完了", res.path);
    setStatus("ok", t("dsk.ok", res.path, res.load_name));
  } catch (e) {
    logErr("save_dsk", e);
    setStatus("err", t("dsk.err", e?.message ?? e));
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

// ---- タブ（JetBrains方式: 2グループ。ドラッグで並べ替え＆グループ間移動=分割/統合。状態は永続化）----
const TAB_PANE = { structured: "structuredPane", msx: "msxPane", webmsx: "webmsxPane" };
const ALL_TABS = ["structured", "msx", "webmsx"];
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
      const got = [...s.groups.A, ...s.groups.B].slice().sort().join(",");
      if (got === ALL_TABS.slice().sort().join(",")) {
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
    b.textContent = t("tab." + id);
    b.draggable = true;
    b.dataset.tab = id;
    b.dataset.group = g;
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
// 実行時に WebMSX タブをそのグループでアクティブにする
function revealRun() {
  const g = groups.A.includes("webmsx") ? "A" : "B";
  active[g] = "webmsx";
  renderTabs();
}

// ---- フォントサイズ ----
function setFont(delta) {
  const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--font-size"));
  const next = Math.min(28, Math.max(9, cur + delta));
  document.documentElement.style.setProperty("--font-size", next + "px");
}

function setSource(text) {
  srcEl.value = text;
  render();
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
  const lh = parseFloat(getComputedStyle(srcEl).lineHeight) || 22;
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
function goToDefinition() {
  const t = identAtCaret();
  if (!t) { flash("識別子の上で実行してください"); return; }
  const def = findDefinition(t.value, srcEl.value);
  if (!def) { flash(`定義が見つかりません: ${t.value}`); return; }
  recordJump();
  scrollToLine(def.line, def.column - 1);
  flash(`定義へ移動: ${t.value} (行 ${def.line})`);
}
let usage = { name: null, list: [], idx: 0 };
function findUsages() {
  const t = identAtCaret();
  if (!t) { flash("識別子の上で実行してください"); return; }
  const list = tokensAbs(srcEl.value).filter((x) => x.t.kind === "IDENT" && x.t.value === t.value);
  if (usage.name !== t.value) usage = { name: t.value, list, idx: -1 };
  usage.idx = (usage.idx + 1) % list.length;
  const cur = list[usage.idx].t.pos;
  recordJump();
  scrollToLine(cur.line, cur.column - 1);
  flash(`使用箇所 ${usage.idx + 1}/${list.length}: ${t.value}`);
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

// ---- 整形（大文字化。文字列/コメントは保持）----
function formatSource(src) {
  const { tokens } = tokenize(src);
  const ls = lineStartsOf(src);
  const off = (p) => ls[p.line - 1] + (p.column - 1);
  let out = "";
  let pos = 0;
  for (const t of tokens) {
    if (t.kind === "EOF") break;
    const s = off(t.pos);
    if (s > pos) { out += src.slice(pos, s); pos = s; }
    if (t.kind === "NEWLINE") { out += t.raw; pos += t.raw.length; continue; }
    out += t.kind === "KEYWORD" || t.kind === "IDENT" || t.kind === "NUMBER" ? t.value : t.raw;
    pos = s + t.raw.length;
  }
  if (pos < src.length) out += src.slice(pos);
  return out;
}
function onFormat() {
  const c = srcEl.selectionStart;
  srcEl.value = formatSource(srcEl.value);
  srcEl.selectionStart = srcEl.selectionEnd = c;
  render();
  flash("整形しました（大文字化）");
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

// ---- イベント ----
let timer = null;
srcEl.addEventListener("input", () => {
  scheduleHighlight(); // 即時（次フレーム）に見た目を反映＝入力遅延をなくす
  clearTimeout(timer);
  timer = setTimeout(renderHeavy, 250); // 重い変換・診断は停止後に
});
srcEl.addEventListener("scroll", syncScroll);
srcEl.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  // Tab: スニペット展開 or インデント
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    if (trySnippet()) return;
    const s = srcEl.selectionStart, en = srcEl.selectionEnd;
    srcEl.setRangeText("    ", s, en, "end");
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); onSave(); return; }
  if (mod && e.key === "Enter") { e.preventDefault(); onPlayWebMSX(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); onFormat(); return; }
  if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); goToDefinition(); return; }
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
    case "save": return onSave();
    case "dsk": return onMakeDsk();
    case "format": return onFormat();
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
    case "run": return onPlayWebMSX();
    case "reverse": return onReverse();
    case "help": return showModal(t("sc.title"), t("sc.body"));
    case "about": return showModal("FunctionBASIC", t("about.body"));
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

$("saveBtn").addEventListener("click", onSave);
$("playBtn").addEventListener("click", onPlayWebMSX);
$("copyBtn").addEventListener("click", async () => {
  const ok = await copyText(msxOut.textContent);
  msxNote.textContent = ok ? t("copy.ok") : t("copy.err");
  log("MSXコピー:", ok);
});
$("fontUp").addEventListener("click", () => setFont(1));
$("fontDown").addEventListener("click", () => setFont(-1));

// タブ: クリックで選択、ドラッグで並べ替え／グループ間移動（分割・統合）
$("tabstrips").addEventListener("click", (e) => {
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
    log("ネイティブメニュー: リスナ登録");
  } catch (e) {
    logErr("ネイティブメニュー listen 失敗", e);
  }
}

// 起動
log("起動: desktop=", isDesktop(), " secureContext=", window.isSecureContext, " url=", location.href, " lang=", lang);
applyI18n();
loadLayout();
renderTabs();
setSource(SAMPLE);
// デスクトップは起動時の言語をネイティブメニューにも反映
if (isDesktop()) {
  try {
    tauri().core.invoke("set_menu_lang", { lang });
  } catch (e) {
    logErr("set_menu_lang(初期)", e);
  }
}
log("起動完了: サンプル読込・初回変換OK");
