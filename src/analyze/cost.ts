// 静的コスト・アナライザ（アルゴリズム・実機なし）。
// AST を歩き、各命令に「実機較正コスト」を付与して、関数別・毎フレーム経路・高コスト箇所を推定する。
//
// なぜ有用か: MSX BASIC は 1 文ごとに実コスト（インタプリタのディスパッチ＋変数表の線形探索＋型処理）を
// 持ち、R800 でも積もって律速になる。実行前に「どこが重いか」を実機なしで順位付けできる。
//
// 単位: すべて「net TIME ティック / 2000 実行」スケール（research/calib.msxb の turbo R 実測較正）。
//   1 回の実行の実時間 = cost/2000 ティック（TIME は 60Hz）。毎フレーム合計/2000 = ティック/フレーム。
//
// 限界（設計上の割り切り）:
//  - IF は「重い方の枝を常時実行」、可変ループ上限は既定値 → 上限見積り（絶対値より順位が用途）。
//  - インライン ASM は z80asm が対応する命令だけを T-state 基準で概算し、後方分岐ループを検出して倍化する。
//    生 POKE でハンドアセンブルした機械語は解析対象外（POKE 文として計上されるのみ）。
import type {
  Program, FunctionDef, Stmt, Expr, LValue, AsmStmt,
} from "../ast/nodes.ts";

// ---- 実機較正コスト表（turbo R / R800, net per 2000）----
const C = {
  litInt: 2, litStr: 3,
  readIntScalar: 5, readRealScalar: 40, readStrScalar: 28,
  readArr1: 23, readArr2: 43, writeArr1: 39, writeArr2: 57,
  writeIntScalar: 20, writeRealScalar: 35, writeStrScalar: 28,
  binInt: 24, binIntMul: 30, binIntDiv: 37, binReal: 80, binStr: 45, cmp: 26,
  unary: 5, callBase: 34, callPerArg: 33,
};
// 関数形の組み込み（net per 2000）
const BUILTIN_FN: Record<string, number> = {
  LEN: 47, "MID$": 90, "LEFT$": 80, "RIGHT$": 80, "CHR$": 52, VAL: 63, "STR$": 63, ASC: 52,
  ABS: 41, INT: 51, SGN: 41, RND: 200, SIN: 200, COS: 200, TAN: 200, SQR: 200, ATN: 200, EXP: 200, LOG: 200,
  PEEK: 37, VPEEK: 69, VARPTR: 40, USR: 40, TIME: 5, STICK: 70, STRIG: 70, "INKEY$": 70, INP: 70,
  POINT: 80, "SPACE$": 60, "STRING$": 60, FIX: 51, "HEX$": 63, "BIN$": 63, "OCT$": 63, CINT: 51, CSNG: 40, CDBL: 40,
  PDL: 70, PAD: 70, ATTR$: 70, CSRLIN: 40, POS: 40, LPOS: 40, FRE: 40, VDP: 40, BASE: 40, INSTR: 90,
};
// 文形の組み込み（net per 2000）
const BUILTIN_STMT: Record<string, number> = {
  PSET: 80, PRESET: 80, LINE: 140, LINE_BF: 300, CIRCLE: 300, PAINT: 600, COPY: 180, DRAW: 300,
  PRINT: 320, LPRINT: 320, LOCATE: 40, POKE: 42, VPOKE: 62, PLAY: 400, SOUND: 80, CLS: 300, BEEP: 80,
  PUT: 180, "PUT SPRITE": 180, GET: 180, SET: 40, COLOR: 60, SCREEN: 300, WIDTH: 40, KEY: 40,
  OPEN: 100, CLOSE: 60, CLEAR: 100, RESTORE: 20, READ: 40, DATA: 0, DIM: 60, DEF: 10,
  OUT: 30, WAIT: 30, MOTOR: 30, SWAP: 40, ERASE: 40, MAXFILES: 40, INPUT: 200, "LINE INPUT": 200,
  BLOAD: 300, BSAVE: 300, "CALL": 100, "_": 100,
};

// ---- Z80 T-state 概算（z80asm 対応命令）。ASM は net スケールへ換算（K）----
const T_DEFAULT = 8;
const TSTATE: Record<string, number> = {
  NOP: 4, RET: 10, RETI: 14, RETN: 14, EI: 4, DI: 4, HALT: 4, EXX: 4,
  RLCA: 4, RRCA: 4, RLA: 4, RRA: 4, DAA: 4, CPL: 4, SCF: 4, CCF: 4, NEG: 8,
  LDI: 16, LDD: 16, LDIR: 21, LDDR: 21, CPI: 16, CPD: 16, CPIR: 21, CPDR: 21,
  INI: 16, IND: 16, INIR: 21, INDR: 21, OUTI: 16, OUTD: 16, OTIR: 21, OTDR: 21,
  EX: 8, DB: 0, DEFB: 0, PUSH: 11, POP: 10, INC: 6, DEC: 6,
  JR: 10, DJNZ: 11, CALL: 17, JP: 10, RST: 11, OUT: 11, IN: 11,
  ADD: 8, ADC: 8, SUB: 6, SBC: 8, AND: 6, XOR: 6, OR: 6, CP: 6,
  RLC: 9, RRC: 9, RL: 9, RR: 9, SLA: 9, SRA: 9, SRL: 9, SLL: 9,
  BIT: 10, RES: 10, SET: 10, LD: 8,
};
const K_ASM = 0.0075; // net(/2000) per T-state（BASIC 表と整合：4T命令≈0.03net。ASMはBASICより桁違いに安い）
const DEFAULT_LOOPN = 8;      // 反復数が定数化できない BASIC ループの既定
const ASM_LOOPN = 16;         // 反復数が判らない ASM ループの既定

export interface CostConfig { defaultLoopN?: number; asmLoopN?: number }
export interface FuncCost { name: string; inclusive: number; self: number; reachable: boolean }
export interface FrameEntry { name: string; cost: number }
// ツリー・ノード（関数→ループ/IF/ブロック→文）。incl=子孫込み, self=自身のみ。
export interface CostNode {
  kind: "func" | "loop" | "if" | "block" | "call" | "funcref" | "op" | "let" | "asm" | "stmt";
  label: string;
  self: number;
  incl: number;
  iters?: number;      // ループの反復係数（子は1周ぶん、実際は×iters）
  line?: number;
  hot?: string;        // hotspot 注記（突出理由）
  children: CostNode[];
}
export interface CostReport {
  functions: FuncCost[];       // 関数別（self/inclusive）降順
  perFrame: FrameEntry[];      // 毎フレーム経路（トップレベル WHILE から呼ばれる関数）降順
  perFrameNet: number;         // 毎フレーム合計（net・全枝max）
  perFrameTicks: number;       // = net/2000（ティック/フレーム）
  estFps: number;              // 60 / ticks（20fps 上限は別途）
  funcTrees: CostNode[];       // 関数ごとのコスト木（inclusive降順）
  frameTree?: CostNode;        // トップレベル WHILE のコスト木（枝が分離表示される）
  note: string;
}

function stripSuffix(name: string): string { return name.replace(/[%!#$]$/, ""); }
function suffix(name: string): string { const c = name.slice(-1); return "%!#$".includes(c) ? c : ""; }

export function analyzeCost(program: Program, opts?: { config?: CostConfig }): CostReport {
  const loopN = opts?.config?.defaultLoopN ?? DEFAULT_LOOPN;
  const asmLoopN = opts?.config?.asmLoopN ?? ASM_LOOPN;
  let inlineCalls = true; // false のとき、ユーザ関数呼びは呼びオーバーヘッドのみ（self コスト計算用）

  // 定数畳み込み（CONST ＋「単一定数で初期化されるグローバル」）でループ上限を解決
  const consts = new Map<string, number>();
  for (const s of program.toplevel) if (s.type === "Const") {
    const v = evalConst(s.expr); if (v !== null) consts.set(stripSuffix(s.name), v);
  }
  foldGlobals(program, consts);

  function evalConst(e: Expr | undefined): number | null {
    if (!e) return null;
    switch (e.type) {
      case "Num": return e.value;
      case "Var": { const k = stripSuffix(e.name); return consts.has(k) ? consts.get(k)! : null; }
      case "Group": return e.items.length === 1 ? evalConst(e.items[0]) : null;
      case "Un": { const v = evalConst(e.operand); return v === null ? null : (e.op === "-" ? -v : v); }
      case "Bin": {
        const a = evalConst(e.left), b = evalConst(e.right); if (a === null || b === null) return null;
        switch (e.op) {
          case "+": return a + b; case "-": return a - b; case "*": return a * b;
          case "\\": return Math.trunc(a / b); case "/": return a / b; case "MOD": return a % b;
        }
        return null;
      }
    }
    return null;
  }
  function foldGlobals(prog: Program, into: Map<string, number>) {
    const vals = new Map<string, Set<number>>();
    const walk = (list: Stmt[]) => { for (const st of list) {
      if (st.type === "Let" && st.target.type === "Var") {
        const k = stripSuffix(st.target.name); const v = evalConst(st.expr);
        if (v !== null) { if (!vals.has(k)) vals.set(k, new Set()); vals.get(k)!.add(v); }
      }
      if (st.type === "If") { walk(st.then); if (st.else) walk(st.else); }
      if (st.type === "For" || st.type === "While" || st.type === "DoLoop") walk(st.body);
    }};
    walk(prog.toplevel); for (const f of prog.functions) walk(f.body);
    for (const [k, set] of vals) if (!into.has(k) && set.size === 1) into.set(k, [...set][0]);
  }

  // ---- 式コスト ----
  const isReal = (n: string) => { const s = suffix(n); return s === "!" || s === "#"; };
  const isRealExpr = (e: Expr): boolean =>
    (e.type === "Var" && isReal(e.name)) || (e.type === "ArrayRef" && isReal(e.name)) ||
    (e.type === "Num" && !Number.isInteger(e.value));
  const isStrExpr = (e: Expr): boolean =>
    (e.type === "Var" && suffix(e.name) === "$") || e.type === "Str" ||
    (e.type === "ArrayRef" && suffix(e.name) === "$") || (e.type === "CallExpr" && suffix(e.name) === "$");
  const readScalar = (n: string) => suffix(n) === "$" ? C.readStrScalar : isReal(n) ? C.readRealScalar : C.readIntScalar;
  const writeScalar = (n: string) => suffix(n) === "$" ? C.writeStrScalar : isReal(n) ? C.writeRealScalar : C.writeIntScalar;

  function costExpr(e: Expr | undefined): number {
    if (!e) return 0;
    switch (e.type) {
      case "Num": return C.litInt;
      case "Str": return C.litStr;
      case "Var": return readScalar(e.name);
      case "ArrayRef": return (e.indices.length >= 2 ? C.readArr2 : C.readArr1) + sum(e.indices, costExpr);
      case "Un": return C.unary + costExpr(e.operand);
      case "Group": return sum(e.items, costExpr);
      case "Bin": {
        let op = C.binInt;
        if (e.op === "*") op = C.binIntMul; else if (e.op === "/" || e.op === "\\") op = C.binIntDiv;
        else if (["=", "<>", "<", ">", "<=", ">="].includes(e.op)) op = C.cmp;
        if (isRealExpr(e.left) || isRealExpr(e.right)) op = C.binReal;
        if (isStrExpr(e.left) || isStrExpr(e.right)) op = C.binStr;
        return op + costExpr(e.left) + costExpr(e.right);
      }
      case "CallExpr": {
        const bn = BUILTIN_FN[e.name.toUpperCase()];
        const args = sum(e.args.map((a) => a.expr), costExpr);
        if (bn !== undefined) return bn + args;
        return C.callBase + e.args.length * C.callPerArg + args + (inlineCalls ? funcInclusive(e.name) : 0);
      }
      case "Field": return C.readArr1 + sum(e.indices, costExpr);
    }
    return 0;
  }
  const lvalWrite = (lv: LValue): number =>
    lv.type === "Var" ? writeScalar(lv.name)
    : lv.type === "ArrayRef" ? (lv.indices.length >= 2 ? C.writeArr2 : C.writeArr1) + sum(lv.indices, costExpr)
    : C.writeArr1;

  // ---- 文コスト ----
  function costStmt(st: Stmt): number {
    switch (st.type) {
      case "Let": return lvalWrite(st.target) + costExpr(st.expr);
      case "Call": {
        const c = st.call; const bn = BUILTIN_FN[c.name.toUpperCase()];
        const args = sum(c.args.map((a) => a.expr), costExpr);
        if (bn !== undefined) return bn + args;
        return C.callBase + c.args.length * C.callPerArg + args + (inlineCalls ? funcInclusive(c.name) : 0);
      }
      case "Builtin": {
        const name = st.name.toUpperCase();
        let base = BUILTIN_STMT[name] ?? 60;
        if (name === "LINE" && st.parts.some((p) => p.kind === "word" && /BF/i.test(p.word))) base = BUILTIN_STMT.LINE_BF;
        const ex = sum(st.parts.map((p) => (p.kind === "expr" ? p.expr : undefined)).filter(Boolean) as Expr[], costExpr);
        return base + ex;
      }
      case "If": return costExpr(st.cond) + 4 + Math.max(costList(st.then), st.else ? costList(st.else) : 0);
      case "For": {
        const iters = loopIters(st.from, st.to, st.step);
        return 6 + costExpr(st.from) + costExpr(st.to) + iters * (costList(st.body) + 6);
      }
      case "While": return costExpr(st.cond) + costList(st.body);
      case "DoLoop": return loopN * costList(st.body);
      case "Return": return 6 + costExpr(st.expr);
      case "On": return 40 + costExpr(st.arg);
      case "Asm": return asmCost(st);
      case "Select": { let m = 0; for (const cl of st.cases) m = Math.max(m, costList(cl.body)); return 26 + m; }
      case "ReadInto": return 40 + st.targets.length * 20;
      case "Dim": case "Global": case "Const": case "Comment": case "Include":
      case "Struct": case "Sprite": case "Dataset": case "Break": case "Continue":
      case "RestoreDataset": case "Event": case "MacroDef" as unknown as Stmt["type"]:
        return 0;
      default: return 5;
    }
  }
  const costList = (list: Stmt[]): number => sum(list, costStmt);
  function loopIters(from?: Expr, to?: Expr, step?: Expr): number {
    const a = evalConst(from), b = evalConst(to); let st = step ? evalConst(step) : 1; if (st === null) st = 1;
    if (a === null || b === null || st === 0) return loopN;
    const n = Math.floor((b - a) / st) + 1; return n > 0 ? n : 1;
  }

  // ---- インライン ASM コスト（z80asm 対応命令のみ・後方分岐ループを倍化）----
  function asmCost(st: AsmStmt): number {
    type L = { label?: string; mne?: string; cond?: string; tgt?: string; t: number; ldbConst?: number };
    const rows: L[] = [];
    for (const raw of st.lines) {
      let s = raw.replace(/;.*$/, "").replace(/'.*$/, "").trim();
      if (!s) continue;
      const lm = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      let label: string | undefined;
      if (lm) { label = lm[1].toUpperCase(); s = lm[2].trim(); if (!s) { rows.push({ label, t: 0 }); continue; } }
      const parts = s.split(/\s+/);
      const mne = parts[0].toUpperCase();
      const rest = s.slice(parts[0].length).trim();
      const args = rest.split(",").map((x) => x.trim());
      let t = TSTATE[mne] ?? T_DEFAULT;
      // (nn) メモリ間接の LD は重い
      if (mne === "LD" && /\([^)]*\)/.test(rest) && !/\((HL|BC|DE|SP)\)/i.test(rest)) t = 16;
      // 条件分岐（ループ検出用）
      let cond: string | undefined, tgt: string | undefined;
      if (mne === "DJNZ") { tgt = (args[0] ?? "").toUpperCase(); cond = "DJNZ"; }
      else if ((mne === "JR" || mne === "JP") && /^(NZ|Z|NC|C|PO|PE|P|M)$/i.test(args[0] ?? "")) { cond = args[0].toUpperCase(); tgt = (args[1] ?? "").toUpperCase(); }
      let ldbConst: number | undefined;
      if (mne === "LD" && (args[0] ?? "").toUpperCase() === "B") { const n = Number((args[1] ?? "").replace(/&H/i, "0x")); if (!Number.isNaN(n)) ldbConst = n; }
      rows.push({ label, mne, cond, tgt, t, ldbConst });
    }
    let baseT = rows.reduce((s, r) => s + r.t, 0);
    // 後方分岐ループ: 条件ジャンプの飛び先ラベルが手前にあれば、その区間本体を (iters-1) 回分足す
    let extraT = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; if (!r.cond || !r.tgt) continue;
      let li = -1;
      for (let j = i - 1; j >= 0; j--) if (rows[j].label === r.tgt) { li = j; break; }
      if (li < 0) continue; // 後方でなければ（前方ジャンプ）ループ扱いしない
      const bodyT = rows.slice(li, i + 1).reduce((s, x) => s + x.t, 0);
      let iters = asmLoopN;
      if (r.cond === "DJNZ") for (let j = i; j >= li; j--) if (rows[j].ldbConst !== undefined) { iters = rows[j].ldbConst!; break; }
      extraT += bodyT * (iters - 1);
    }
    return (baseT + extraT) * K_ASM + 4;
  }

  // ---- 関数インクルーシブ（呼び先展開・再帰ガード・メモ化）----
  const funcs = new Map<string, FunctionDef>();
  for (const f of program.functions) funcs.set(f.name, f);
  const cache = new Map<string, number>();
  const stack = new Set<string>();
  function funcInclusive(name: string): number {
    const f = funcs.get(stripSuffix(name)) ?? funcs.get(name); if (!f) return 0;
    if (cache.has(f.name)) return cache.get(f.name)!;
    if (stack.has(f.name)) return 0;
    stack.add(f.name); const c = costList(f.body); stack.delete(f.name);
    cache.set(f.name, c); return c;
  }

  // ---- self コスト（呼び先を展開しない自身のみ）----
  function selfOf(list: Stmt[]): number { inlineCalls = false; const v = costList(list); inlineCalls = true; return v; }

  // ---- コスト木の構築 ----
  const shortExpr = (e?: Expr): string => {
    if (!e) return "";
    switch (e.type) {
      case "Num": return String(e.value);
      case "Str": return `"${e.value.slice(0, 6)}"`;
      case "Var": return e.name;
      case "ArrayRef": return `${e.name}(${e.indices.map(shortExpr).join(",")})`;
      case "Un": return e.op + shortExpr(e.operand);
      case "Group": return `(${e.items.map(shortExpr).join(",")})`;
      case "Bin": return `${shortExpr(e.left)}${e.op}${shortExpr(e.right)}`;
      case "CallExpr": return `${e.name}(..)`;
      case "Field": return `${e.base}.${e.field}`;
    }
    return "?";
  };
  const opTag = (label: string): string | undefined => {
    const U = label.toUpperCase();
    if (/LINE.*BF/.test(U)) return "LINE塗り(重)";
    if (/\bRND\b/.test(U)) return "RND(重)";
    if (/\bPRINT\b/.test(U)) return "GRP出力(重)";
    if (/PUT SPRITE/.test(U)) return "PUT SPRITE(重)";
    if (/\b(CIRCLE|PAINT|COPY|PLAY)\b/.test(U)) return "描画/音(重)";
    return undefined;
  };
  function block(tag: string, list: Stmt[]): CostNode {
    const children = buildList(list);
    return { kind: "block", label: tag, self: 0, incl: sum(children, (c) => c.incl), children };
  }
  function buildNode(st: Stmt): CostNode {
    const incl = costStmt(st);
    const line = (st as { pos?: { line: number } }).pos?.line;
    switch (st.type) {
      case "For": {
        const iters = loopIters(st.from, st.to, st.step);
        const children = buildList(st.body);
        return { kind: "loop", label: `FOR ${st.varName} (x${iters})`, self: 6, incl, iters, line, children };
      }
      case "While": return { kind: "loop", label: "WHILE", self: costExpr(st.cond), incl, line, children: buildList(st.body) };
      case "DoLoop": return { kind: "loop", label: `DO (x${loopN})`, self: 0, incl, iters: loopN, line, children: buildList(st.body) };
      case "If": {
        const kids = [block("THEN", st.then)];
        if (st.else && st.else.length) kids.push(block("ELSE", st.else));
        return { kind: "if", label: `IF ${shortExpr(st.cond)}`, self: costExpr(st.cond) + 4, incl, line, children: kids };
      }
      case "Call": {
        const ci = funcInclusive(st.call.name);
        const children = ci > 0 ? [{ kind: "funcref" as const, label: `${st.call.name}()`, self: 0, incl: ci, children: [] }] : [];
        return { kind: "call", label: `call ${st.call.name}`, self: incl - ci, incl, line, children };
      }
      case "Asm": return { kind: "asm", label: "ASM", self: incl, incl, line, children: [] };
      case "Builtin": {
        const bf = st.name.toUpperCase() === "LINE" && st.parts.some((p) => p.kind === "word" && /BF/i.test(p.word));
        const label = st.name + (bf ? " BF" : "");
        return { kind: "op", label, self: incl, incl, line, hot: opTag(label), children: [] };
      }
      case "Let": return { kind: "let", label: `${shortExpr(st.target as unknown as Expr)}=${shortExpr(st.expr)}`, self: incl, incl, line, children: [] };
      default: return { kind: "stmt", label: st.type, self: incl, incl, line, children: [] };
    }
  }
  function buildList(list: Stmt[]): CostNode[] {
    return list.map(buildNode).filter((n) => n.incl > 0 || n.children.length > 0);
  }
  // hotspot: 親 incl の 35% 以上を占める子、または重い命令を注記
  function markHot(node: CostNode) {
    // 兄弟が2つ以上あって、親の45%以上を占める子だけ「突出」注記（単独子の100%は注記しない）
    const sibs = node.children.length;
    for (const c of node.children) {
      if (!c.hot && sibs >= 2 && node.incl > 0 && c.incl >= 0.45 * node.incl && c.incl >= 100) c.hot = `${Math.round(100 * c.incl / node.incl)}%`;
      markHot(c);
    }
  }

  const funcTrees: CostNode[] = program.functions.map((f) => {
    const children = buildList(f.body);
    const incl = funcInclusive(f.name);
    const n: CostNode = { kind: "func", label: `FUNCTION ${f.name}`, self: selfOf(f.body), incl, children };
    markHot(n); return n;
  }).sort((a, b) => b.incl - a.incl);

  // 到達可能関数（トップレベルから呼ばれる推移閉包）。DCE 後＝実際に変換される関数集合に対応。
  // INCLUDE ライブラリ(FAST 等)の未使用関数はここに入らない＝ツリーの主対象から外せる。
  const reachable = new Set<string>();
  {
    const q: string[] = [];
    collectCalls(program.toplevel, (n) => { const k = stripSuffix(n); if (funcs.has(k)) q.push(k); });
    while (q.length) {
      const k = q.pop()!; if (reachable.has(k)) continue; reachable.add(k);
      const f = funcs.get(k); if (f) collectCalls(f.body, (n) => { const kk = stripSuffix(n); if (funcs.has(kk)) q.push(kk); });
    }
  }

  const functions: FuncCost[] = program.functions
    .map((f) => ({ name: f.name, inclusive: funcInclusive(f.name), self: selfOf(f.body), reachable: reachable.has(stripSuffix(f.name)) }))
    .sort((a, b) => b.inclusive - a.inclusive);

  // 毎フレーム経路（トップレベル WHILE をツリー化＝状態枝が分離表示される）
  const frameLoop = program.toplevel.find((s) => s.type === "While") as (Extract<Stmt, { type: "While" }> | undefined);
  const perFrameMap = new Map<string, number>();
  let perFrameNet = 0;
  let frameTree: CostNode | undefined;
  if (frameLoop) {
    perFrameNet = costList(frameLoop.body);
    frameTree = { kind: "loop", label: "MAIN WHILE (per frame)", self: 0, incl: perFrameNet, children: buildList(frameLoop.body) };
    markHot(frameTree);
    collectCalls(frameLoop.body, (name) => {
      if (funcs.has(stripSuffix(name)) || funcs.has(name)) {
        perFrameMap.set(name, Math.max(perFrameMap.get(name) ?? 0, funcInclusive(name)));
      }
    });
  }
  const perFrame: FrameEntry[] = [...perFrameMap.entries()]
    .map(([name, cost]) => ({ name, cost })).sort((a, b) => b.cost - a.cost);
  const perFrameTicks = perFrameNet / 2000;
  const estFps = perFrameTicks > 0 ? 60 / perFrameTicks : 0;

  return {
    functions, perFrame, perFrameNet, perFrameTicks, estFps, funcTrees, frameTree,
    note:
      "上限見積り（IFは重い枝を常時実行・可変ループは既定N・ASMは概算）。絶対値より順位を見る。" +
      " 単位=net/2000（実時間ティック=net/2000, TIME 60Hz）。",
  };

  function collectCalls(list: Stmt[], cb: (name: string) => void) {
    for (const st of list) {
      if (st.type === "Call") cb(st.call.name);
      if (st.type === "If") { collectCalls(st.then, cb); if (st.else) collectCalls(st.else, cb); }
      if (st.type === "For" || st.type === "While" || st.type === "DoLoop") collectCalls(st.body, cb);
      if (st.type === "Select") { for (const cl of st.cases) collectCalls(cl.body, cb); if (st.else) collectCalls(st.else, cb); }
    }
  }
}

function sum<T>(xs: T[], f: (x: T) => number): number { let s = 0; for (const x of xs) s += f(x); return s; }
