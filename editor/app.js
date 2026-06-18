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

// ---- ガター（行番号＋×）----
function renderGutter(lineCount, errsByLine) {
  let html = "";
  for (let i = 1; i <= lineCount; i++) {
    const e = errsByLine.get(i);
    const x = e ? `<span class="x" title="${esc(e.join("\n"))}">×</span>` : "";
    html += `<div class="gl">${i}${x}</div>`;
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

// ---- イベント ----
let timer = null;
srcEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(render, 250);
});
srcEl.addEventListener("scroll", syncScroll);
// Tab キーでインデント挿入
srcEl.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = srcEl.selectionStart;
    const en = srcEl.selectionEnd;
    srcEl.setRangeText("    ", s, en, "end");
    render();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    onSave();
  }
});
$("saveBtn").addEventListener("click", onSave);
$("reverseBtn").addEventListener("click", onReverse);
$("copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(msxOut.textContent);
  msxNote.textContent = "コピーしました";
});
$("fontUp").addEventListener("click", () => setFont(1));
$("fontDown").addEventListener("click", () => setFont(-1));
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => setTab(t.dataset.tab)),
);

// 起動
setSource(SAMPLE);
