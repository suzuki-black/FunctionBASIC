// 音楽ツール共有コア: 音符列 (Song) <-> MML方言テキスト <-> 読みやすい PLAY文(構造化BASIC)。
// 純粋な文字列/データ処理のみ（FunctionBASICパーサに非依存）。.msxb からの PLAY 抽出は
// src/music/decompile.ts（パーサ利用）が担当し、抽出した ch 別 MML 文字列を playStringsToSong へ渡す。
//
// MSX MML 仕様(一次資料): O=1..8(既定4) / '>'上げ '<'下げ / L=1..64(既定4)+付点 / T=32..255(既定120)
//  / V=0..15(既定8) / R=休符 / 3声 PLAY a$,b$,c$。S/M/Q/N 等サブセット外は ctrl として保持(パススルー)。

export const PPQ = 48; // 内部解像度: 4分音符=48tick。付点/3連(=16)まで表現可
const WHOLE = PPQ * 4; // 全音符=192tick

// ---- 音符イベント（各チャンネルは単声＝逐次列）----
export type Ev =
  | { t: "note"; dur: number; pitch: number; vol?: number } // pitch=絶対半音(オクターブ*12+音名), C=0
  | { t: "rest"; dur: number }
  | { t: "ctrl"; raw: string }; // S/M/Q/N 等の未対応トークン(0長・そのまま再出力)

export interface Channel {
  id: string; // "A" | "B" | "C"
  name?: string; // メタ(コメントに出力)
  events: Ev[];
}
export interface Song {
  tempo: number; // T値
  timesig: [number, number]; // 拍子 [分子, 分母]
  channels: Channel[];
}

// ---- 音長 <-> tick ----
const LEN_NS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]; // 表現可能な音長分母(3連=3,6,12,24含む)
export function lenToTicks(n: number, dots: number): number {
  let base = WHOLE / n;
  let total = base;
  let add = base;
  for (let i = 0; i < dots; i++) {
    add /= 2;
    total += add;
  }
  return Math.round(total);
}
// tick を単一の {n,dots} で表せれば返す。無理なら null。
export function ticksToLen(ticks: number): { n: number; dots: number } | null {
  for (const n of LEN_NS) {
    for (let dots = 0; dots <= 2; dots++) {
      if (lenToTicks(n, dots) === ticks) return { n, dots };
    }
  }
  return null;
}
// 任意 tick を「表現可能な音長の並び」に貪欲分解（休符埋め/端数用）。
function decomposeLen(ticks: number): { n: number; dots: number }[] {
  const out: { n: number; dots: number }[] = [];
  let rest = ticks;
  let guard = 0;
  while (rest > 0 && guard++ < 64) {
    let best: { n: number; dots: number } | null = null;
    let bestT = 0;
    for (const n of LEN_NS) {
      for (let dots = 0; dots <= 2; dots++) {
        const t = lenToTicks(n, dots);
        if (t <= rest && t > bestT) {
          bestT = t;
          best = { n, dots };
        }
      }
    }
    if (!best) break;
    out.push(best);
    rest -= bestT;
  }
  return out;
}

// ---- 音名 <-> 絶対半音 ----
const LETTER_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SEMI_NAME = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function pitchInt(letter: string, accidental: number, octave: number): number {
  return octave * 12 + LETTER_SEMI[letter] + accidental;
}
function splitPitch(pitch: number): { octave: number; name: string } {
  const octave = Math.floor(pitch / 12);
  const semi = ((pitch % 12) + 12) % 12;
  return { octave, name: SEMI_NAME[semi] };
}

// ============================================================
//  デコード: MML文字列 → イベント列（状態機械）
// ============================================================
export interface DecodeState {
  octave: number;
  defLen: number; // tick
  vol: number;
  tempo: number;
}
export function freshState(): DecodeState {
  return { octave: 4, defLen: lenToTicks(4, 0), vol: 8, tempo: 120 };
}
// MML(1ch分・小節|は事前に除去)をデコード。state は継続用に更新される。
export function decodeMml(mml: string, state: DecodeState, warnings: string[]): Ev[] {
  const s = mml.toUpperCase();
  const evs: Ev[] = [];
  let i = 0;
  const readNum = (): number | null => {
    let j = i;
    while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
    if (j === i) return null;
    const v = Number(s.slice(i, j));
    i = j;
    return v;
  };
  const readDots = (): number => {
    let d = 0;
    while (i < s.length && s[i] === ".") {
      d++;
      i++;
    }
    return d;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === "T") {
      i++;
      const n = readNum();
      if (n != null) state.tempo = n;
      continue;
    }
    if (c === "O") {
      i++;
      const n = readNum();
      if (n != null) state.octave = n;
      continue;
    }
    if (c === ">") {
      i++;
      state.octave++;
      continue;
    }
    if (c === "<") {
      i++;
      state.octave--;
      continue;
    }
    if (c === "L") {
      i++;
      const n = readNum();
      const d = readDots();
      if (n != null) state.defLen = lenToTicks(n, d);
      continue;
    }
    if (c === "V") {
      i++;
      const n = readNum();
      if (n != null) state.vol = n;
      continue;
    }
    if (c === "R") {
      i++;
      const n = readNum();
      const d = readDots();
      const dur = n != null ? lenToTicks(n, d) : state.defLen;
      evs.push({ t: "rest", dur });
      continue;
    }
    if (c >= "A" && c <= "G") {
      i++;
      let acc = 0;
      while (i < s.length && (s[i] === "#" || s[i] === "+" || s[i] === "-")) {
        acc += s[i] === "-" ? -1 : 1;
        i++;
      }
      const n = readNum();
      const d = readDots();
      const dur = n != null ? lenToTicks(n, d) : state.defLen;
      evs.push({ t: "note", dur, pitch: pitchInt(c, acc, state.octave), vol: state.vol });
      continue;
    }
    // 未対応トークン(S/M/Q/N 等): 記号＋続く数字を1塊として ctrl 保持
    if (c === "S" || c === "M" || c === "Q" || c === "N" || c === "@") {
      const start = i;
      i++;
      readNum();
      const raw = s.slice(start, i);
      evs.push({ t: "ctrl", raw });
      warnings.push(`未対応MMLトークンを保持(パススルー): ${raw}`);
      continue;
    }
    // 不明文字はスキップ（1文字）
    warnings.push(`不明なMML文字を無視: '${s[i]}'`);
    i++;
  }
  return evs;
}

// ============================================================
//  エンコード: イベント列 → MML文字列
// ============================================================
interface EncState {
  octave: number | null;
  defLen: number | null;
  vol: number | null;
}
function emitOneLen(dur: number, defLen: number | null, warnings: string[]): string {
  if (defLen != null && dur === defLen) return "";
  const l = ticksToLen(dur);
  if (l) return String(l.n) + ".".repeat(l.dots);
  // 単一で表せない音符長（グリッド外）: 最も近い表現へ丸め、警告
  const parts = decomposeLen(dur);
  if (parts.length) {
    warnings.push(`音長 ${dur}tick を単一MML長で表せず近似`);
    return String(parts[0].n) + ".".repeat(parts[0].dots);
  }
  return "";
}
// 1音符/休符を MML へ。state を更新。
function emitEvent(ev: Ev, st: EncState, warnings: string[]): string {
  if (ev.t === "ctrl") return ev.raw;
  let out = "";
  if (ev.t === "note" && ev.vol != null && ev.vol !== st.vol) {
    out += "V" + ev.vol;
    st.vol = ev.vol;
  }
  if (ev.t === "note") {
    const { octave, name } = splitPitch(ev.pitch);
    if (st.octave == null) {
      out += "O" + octave;
      st.octave = octave;
    } else {
      const delta = octave - st.octave;
      if (delta === 1) out += ">";
      else if (delta === -1) out += "<";
      else if (delta === 2) out += ">>";
      else if (delta === -2) out += "<<";
      else if (delta !== 0) out += "O" + octave;
      st.octave = octave;
    }
    out += name; // 例: "C" / "C#"
    out += emitOneLen(ev.dur, st.defLen, warnings);
  } else {
    // rest: 単一で表せなければ複数Rへ分解
    const l = ticksToLen(ev.dur);
    if (l && st.defLen != null && ev.dur === st.defLen) out += "R";
    else if (l) out += "R" + l.n + ".".repeat(l.dots);
    else {
      for (const p of decomposeLen(ev.dur)) out += "R" + p.n + ".".repeat(p.dots);
    }
  }
  return out;
}

// ============================================================
//  中間フォーマット(MML方言) の parse / serialize
// ============================================================
export function parseMmlDoc(text: string): { song: Song; warnings: string[] } {
  const warnings: string[] = [];
  let tempo = 120;
  let timesig: [number, number] = [4, 4];
  const names: Record<string, string> = {};
  const raw: Record<string, string> = {}; // ch別 連結MML(小節|除去)
  const order: string[] = [];
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith(";")) continue;
    if (line.startsWith("@")) {
      const m = line.match(/^@(\w+)\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === "tempo") tempo = Number(val) || tempo;
      else if (key === "timesig") {
        const t = val.match(/(\d+)\s*\/\s*(\d+)/);
        if (t) timesig = [Number(t[1]), Number(t[2])];
      } else if (key === "ch") {
        const t = val.match(/^(\w+)\s*(.*)$/);
        if (t) names[t[1].toUpperCase()] = t[2].trim();
      }
      continue;
    }
    const m = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (m) {
      const id = m[1].toUpperCase();
      if (!(id in raw)) {
        raw[id] = "";
        order.push(id);
      }
      raw[id] += " " + m[2].replace(/\|/g, " ");
    }
  }
  const channels: Channel[] = [];
  for (const id of order) {
    const st = freshState();
    st.tempo = tempo;
    const events = decodeMml(raw[id], st, warnings);
    if (st.tempo !== tempo) tempo = st.tempo; // MML内Tを尊重
    channels.push({ id, name: names[id], events });
  }
  return { song: { tempo, timesig, channels }, warnings };
}

// ch別の(連結済み)MML文字列群 → Song。デコンパイル用。
export function playStringsToSong(
  chStrings: string[],
  meta: { tempo?: number; timesig?: [number, number]; names?: string[] },
): { song: Song; warnings: string[] } {
  const warnings: string[] = [];
  let tempo = meta.tempo ?? 120;
  const timesig = meta.timesig ?? ([4, 4] as [number, number]);
  const channels: Channel[] = [];
  const ids = ["A", "B", "C", "D", "E", "F"];
  chStrings.forEach((mml, idx) => {
    const st = freshState();
    st.tempo = tempo;
    const events = decodeMml(mml, st, warnings);
    tempo = st.tempo;
    channels.push({ id: ids[idx] ?? String(idx), name: meta.names?.[idx], events });
  });
  return { song: { tempo, timesig, channels }, warnings };
}

export function songToMml(song: Song): string {
  const lines: string[] = [];
  lines.push(`@tempo ${song.tempo}`);
  lines.push(`@timesig ${song.timesig[0]}/${song.timesig[1]}`);
  for (const ch of song.channels) if (ch.name) lines.push(`@ch ${ch.id} ${ch.name}`);
  const warnings: string[] = [];
  const measure = measureTicks(song);
  for (const ch of song.channels) {
    const st: EncState = { octave: null, defLen: null, vol: 8 };
    // 小節ごとに | で区切って可読化
    const slices = sliceByMeasure(ch.events, measure, warnings);
    const bars = slices.map((evs) => {
      st.octave = null; // 各小節頭で O/L を明示
      st.defLen = pickDefLen(evs);
      let head = "";
      if (st.defLen != null) head = "L" + ticksToLen(st.defLen)!.n + ".".repeat(ticksToLen(st.defLen)!.dots);
      let body = "";
      for (const ev of evs) body += emitEvent(ev, st, warnings);
      return (head + body).trim();
    });
    lines.push(`${ch.id}: ${bars.join(" | ")}`);
  }
  return lines.join("\n") + "\n";
}

// ============================================================
//  Song → 読みやすい PLAY文(構造化BASIC)
// ============================================================
export interface PlayBasicOpts {
  func?: string; // 生成する FUNCTION 名（既定 BGM_MAIN）
  minState?: boolean; // O/L を変化時のみ出力（既定 false=毎小節明示）
}
export function measureTicks(song: Song): number {
  const [n, d] = song.timesig;
  return Math.round((PPQ * 4 * n) / d);
}
function pickDefLen(evs: Ev[]): number {
  // 小節内の音符/休符で最頻の長さを既定Lに（表現可能なもの）
  const count: Record<number, number> = {};
  for (const ev of evs) if (ev.t !== "ctrl" && ticksToLen(ev.dur)) count[ev.dur] = (count[ev.dur] || 0) + 1;
  let best = lenToTicks(4, 0);
  let bestC = -1;
  for (const k of Object.keys(count)) {
    const t = Number(k);
    if (count[t] > bestC) {
      bestC = count[t];
      best = t;
    }
  }
  return best;
}
// events を小節境界で区切る。音符が境界をまたぐ場合は分割(アーティキュレーション)＋警告。
function sliceByMeasure(events: Ev[], measure: number, warnings: string[]): Ev[][] {
  const total = events.reduce((a, e) => a + (e.t === "ctrl" ? 0 : e.dur), 0);
  const nBars = Math.max(1, Math.ceil(total / measure));
  const slices: Ev[][] = Array.from({ length: nBars }, () => []);
  let pos = 0;
  for (const ev of events) {
    if (ev.t === "ctrl") {
      slices[Math.min(nBars - 1, Math.floor(pos / measure))].push(ev);
      continue;
    }
    let start = pos;
    let remain = ev.dur;
    while (remain > 0) {
      const bar = Math.floor(start / measure);
      const barEnd = (bar + 1) * measure;
      const take = Math.min(remain, barEnd - start);
      const idx = Math.min(nBars - 1, bar);
      if (take < ev.dur && ev.t === "note")
        warnings.push(`音符が小節境界をまたぐため分割(発音が切れます): pitch=${ev.pitch}`);
      slices[idx].push({ ...ev, dur: take } as Ev);
      start += take;
      remain -= take;
    }
    pos += ev.dur;
  }
  return slices;
}

// 1小節分の ch別 MML を作る（PLAY 引数用）。空/短い ch は休符で埋めて等長に。
function measureMmlForChannel(evs: Ev[], measure: number, minState: boolean, prev: EncState, warnings: string[]): string {
  const st: EncState = minState ? prev : { octave: null, defLen: null, vol: 8 };
  let head = "";
  if (!minState) {
    const dl = pickDefLen(evs);
    st.defLen = dl;
    const l = ticksToLen(dl)!;
    head = "L" + l.n + ".".repeat(l.dots);
  }
  let body = "";
  let sum = 0;
  for (const ev of evs) {
    body += emitEvent(ev, st, warnings);
    if (ev.t !== "ctrl") sum += ev.dur;
  }
  // 埋め: この小節が measure に満たない分は休符
  if (sum < measure) {
    for (const p of decomposeLen(measure - sum)) body += "R" + p.n + ".".repeat(p.dots);
  }
  // minState時は状態を持ち越し
  if (minState) {
    prev.octave = st.octave;
    prev.defLen = st.defLen;
    prev.vol = st.vol;
  }
  return head + body;
}

export function songToPlayBasic(song: Song, opts: PlayBasicOpts = {}): { code: string; warnings: string[] } {
  const warnings: string[] = [];
  const func = opts.func ?? "BGM_MAIN";
  const minState = !!opts.minState;
  const measure = measureTicks(song);
  const chs = song.channels;
  // 各chを小節分割
  const sliced = chs.map((ch) => sliceByMeasure(ch.events, measure, warnings));
  const nBars = Math.max(1, ...sliced.map((s) => s.length));
  const encStates: EncState[] = chs.map(() => ({ octave: null, defLen: null, vol: 8 }));

  const lines: string[] = [];
  lines.push("' " + "=".repeat(56));
  lines.push(`'  BGM: ${func}  (PSG ${chs.length}ch)   ※music tool 生成 / 再編集は tool 推奨`);
  lines.push("' " + "=".repeat(56));
  lines.push(`FUNCTION ${func}()`);
  // テンポ設定(3ch共通)
  const tset = chs.map(() => `"T${song.tempo}"`).join(", ");
  lines.push(`    PLAY ${tset}`);
  const nameComment = chs.map((c, i) => `[${c.id}]${c.name ?? ""}`).join(" ");
  for (let bar = 0; bar < nBars; bar++) {
    lines.push(`    ' -- 小節${bar + 1} --` + (bar === 0 ? "   " + nameComment : ""));
    const args = chs.map((_, ci) => {
      const evs = sliced[ci][bar] ?? [];
      const mml = measureMmlForChannel(evs, measure, minState, encStates[ci], warnings);
      return `"${mml}"`;
    });
    lines.push(`    PLAY ${args.join(", ")}`);
  }
  lines.push("END FUNCTION");
  return { code: lines.join("\n") + "\n", warnings };
}

// ============================================================
//  Song <-> 絶対時刻ノート（ピアノロールGUI用）
// ============================================================
export interface GridNote {
  start: number; // tick
  dur: number; // tick
  pitch: number; // 絶対半音
  vol?: number;
}
export interface GridChannel {
  id: string;
  name?: string;
  notes: GridNote[]; // 発音のみ（休符は隙間として表す）
  ctrls: { start: number; raw: string }[]; // S/M/Q/N 等（位置つきで保持）
}
// Song(逐次イベント) → ch別の絶対ノート。休符は隙間になる。
export function songToNotes(song: Song): { tempo: number; timesig: [number, number]; channels: GridChannel[] } {
  const channels: GridChannel[] = song.channels.map((ch) => {
    const notes: GridNote[] = [];
    const ctrls: { start: number; raw: string }[] = [];
    let t = 0;
    for (const ev of ch.events) {
      if (ev.t === "note") {
        notes.push({ start: t, dur: ev.dur, pitch: ev.pitch, vol: ev.vol });
        t += ev.dur;
      } else if (ev.t === "rest") {
        t += ev.dur;
      } else {
        ctrls.push({ start: t, raw: ev.raw });
      }
    }
    return { id: ch.id, name: ch.name, notes, ctrls };
  });
  return { tempo: song.tempo, timesig: song.timesig, channels };
}
// ch別の絶対ノート → Song(逐次イベント)。隙間は休符で埋める。単声前提で重なりは詰める。
export function notesToSong(
  channels: GridChannel[],
  meta: { tempo: number; timesig: [number, number] },
): Song {
  const outCh: Channel[] = channels.map((ch) => {
    const items = [
      ...ch.notes.map((n) => ({ start: n.start, kind: "note" as const, n })),
      ...ch.ctrls.map((c) => ({ start: c.start, kind: "ctrl" as const, raw: c.raw })),
    ].sort((a, b) => a.start - b.start);
    const events: Ev[] = [];
    let cursor = 0;
    for (const it of items) {
      if (it.kind === "note") {
        if (it.n.start > cursor) events.push({ t: "rest", dur: it.n.start - cursor });
        const start = Math.max(cursor, it.n.start);
        events.push({ t: "note", dur: it.n.dur, pitch: it.n.pitch, vol: it.n.vol });
        cursor = start + it.n.dur;
      } else {
        events.push({ t: "ctrl", raw: it.raw });
      }
    }
    return { id: ch.id, name: ch.name, events };
  });
  return { tempo: meta.tempo, timesig: meta.timesig, channels: outCh };
}
