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
function setStatus(kind, msg) {
  statusEl.className = kind; // "" | "ok" | "err"
  statusEl.textContent = msg;
  log("status:", kind || "info", msg);
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

// ---- レンダー（入力のたび）----
function render() {
  const src = srcEl.value;
  hlEl.innerHTML = highlightHtml(src);
  syncScroll();

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
    msxNote.textContent = "WebMSX等に貼り付けて実行できます";
    msxOut.textContent = r.msx.replace(/\r/g, "");
  } else {
    msxPane.classList.add("error");
    msxNote.textContent = "文法エラーのため変換できません";
    msxOut.textContent = "（構造化BASICタブのエラーを修正してください）";
  }

  // ステータス
  if (errorCount > 0) {
    statusEl.className = "err";
    statusEl.textContent = `⚠ エラー ${errorCount} 件`;
  } else {
    statusEl.className = "";
    const warn = r.diags.length;
    statusEl.textContent = warn ? `OK（警告 ${warn} 件）` : "OK";
  }
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
      statusEl.className = hasError ? "err" : "ok";
      statusEl.textContent = hasError
        ? "誤りがあります。確認してください（変換前のみ保存）"
        : "保存しました（.msxb / .map.json / .bas、Shift-JIS）";
    } catch (e) {
      statusEl.className = "err";
      statusEl.textContent = "保存に失敗しました: " + (e?.message ?? e);
    }
    return;
  }

  // ブラウザ: UTF-8 ダウンロード（Shift-JIS化はデスクトップ版で）
  if (hasError) {
    download(`${base}.msxb`, srcEl.value);
    statusEl.className = "err";
    statusEl.textContent = "誤りがあります。確認してください（変換前のみ保存）";
    return;
  }
  download(`${base}.msxb`, srcEl.value);
  download(`${base}.map.json`, JSON.stringify(r.map, null, 1));
  download(`${base}.bas`, r.msx);
  statusEl.className = "ok";
  statusEl.textContent = "保存しました（.msxb / .map.json / .bas）※Shift-JIS化はデスクトップ版で";
}

// ---- 再生（WebMSX、方式B。docs/10 §10.4）----
const WEBMSX_URL = "https://webmsx.org"; // 設定で変更可（docs/10 §10.9）
async function onPlayWebMSX() {
  log("WebMSX 実行: 開始");
  const r = compile(srcEl.value);
  if (r.diags.some((d) => d.severity === "error")) {
    setStatus("err", "エラーがあるため実行できません");
    return;
  }
  const text = r.msx.replace(/\r/g, "");

  let copied = false;
  let opened = false;
  if (isDesktop()) {
    // デスクトップ: opener はジェスチャ不要。OS側で確実にコピー → URLを開く。
    copied = await copyText(text);
    try {
      await tauri().core.invoke("plugin:opener|open_url", { url: WEBMSX_URL });
      opened = true;
    } catch (e) {
      logErr("opener プラグイン失敗 → window.open へ", e);
      opened = !!window.open(WEBMSX_URL, "_blank");
    }
  } else {
    // ブラウザ: コピーを同期で先に（クリック有効性を維持）→ 直後に open。
    copied = execCopy(text);
    if (!copied) logErr("コピー", "execCommand が false");
    const w = window.open(WEBMSX_URL, "_blank");
    opened = !!w; // noopener を付けると成功でも null になるため付けない
    if (!opened) logErr("window.open", "ブロックされた可能性（ポップアップ許可が必要）");
  }
  log("WebMSX 実行: copied=", copied, "opened=", opened, "desktop=", isDesktop());

  // 3) 結果メッセージ（失敗時は手段を案内）
  if (copied && opened) setStatus("ok", "変換結果をコピーしWebMSXを開きました（貼り付けて RUN）");
  else if (copied && !opened)
    setStatus("err", `コピー済。ポップアップがブロックされました → 手動で ${WEBMSX_URL} を開いて貼り付け`);
  else if (!copied && opened)
    setStatus("err", "WebMSXを開きました。「MSX-BASIC変換後」タブの📋コピーで本文をコピーしてください");
  else setStatus("err", `自動化に失敗。変換後タブからコピーし、${WEBMSX_URL} を手動で開いてください`);
}

// ---- 逆変換プレビュー ----
function onReverse() {
  const r = compile(srcEl.value);
  if (r.diags.some((d) => d.severity === "error")) {
    statusEl.className = "err";
    statusEl.textContent = "エラーがあるため逆変換できません";
    return;
  }
  const rev = reverse(r.code, r.map);
  if (confirm("逆変換（MSX→構造化）の結果でエディタを置き換えますか？（往復確認）")) {
    setSource(rev.source + "\n");
  }
}

// ---- タブ ----
function setTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("structuredPane").hidden = name !== "structured";
  msxPane.hidden = name !== "msx";
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
function goToLine() {
  const n = prompt("移動先のエディタ行番号:");
  if (n == null) return;
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

const SHORTCUTS = `キーボードショートカット
  保存:                Ctrl/Cmd + S
  WebMSXで実行:        Ctrl/Cmd + Enter
  整形(大文字化):       Ctrl/Cmd + Shift + F
  定義へ移動:           Ctrl/Cmd + B
  使用箇所(順送り):     Alt + F7
  戻る / 進む:          Ctrl/Cmd + Alt + ← / →
  行へ移動:             Ctrl/Cmd + G
  ブックマーク 切替/次:  F11 / Shift + F11
  スニペット:           行頭で fn/for/if/while + Tab
  インデント:           Tab`;

// ---- イベント ----
let timer = null;
srcEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(render, 250);
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
$("saveBtn").addEventListener("click", onSave);
$("fmtBtn").addEventListener("click", onFormat);
$("playBtn").addEventListener("click", onPlayWebMSX);
$("reverseBtn").addEventListener("click", onReverse);
$("helpBtn").addEventListener("click", () => alert(SHORTCUTS));
$("copyBtn").addEventListener("click", async () => {
  const ok = await copyText(msxOut.textContent);
  msxNote.textContent = ok ? "コピーしました" : "コピーに失敗（手動で選択してコピー）";
  log("MSXコピー:", ok);
});
$("fontUp").addEventListener("click", () => setFont(1));
$("fontDown").addEventListener("click", () => setFont(-1));
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => setTab(t.dataset.tab)),
);

// 起動
log("起動: desktop=", isDesktop(), " secureContext=", window.isSecureContext, " url=", location.href);
setSource(SAMPLE);
log("起動完了: サンプル読込・初回変換OK");
