// 最小 Z80 アセンブラ（インライン ASM ブロック用・PoC）。
// ニーモニック行 → バイト列。実用サブセット（レジスタ転送・メモリ/即値ロード・
// INC/DEC・ALU・IN/OUT・CALL/JP/RET・PUSH/POP・DB）に対応する。
//
// BASIC 変数連携: オペランドが "(NAME)" で NAME が既知の BASIC 変数のとき、
// 16bit オペランドは 0x0000 のプレースホルダで置き、patches に {offset,name} を残す。
// 変換側が実行時に VARPTR(NAME) で得たアドレスをその offset へ POKE してパッチする。
//
// 逆アセンブラ(src/disasm/z80.ts)は「読解」用のデコーダなので表を逆引きできない。
// こちらは「生成」用に独立実装（対応表は必要十分な範囲に絞る）。

export interface AsmResult {
  bytes: number[];
  patches: { offset: number; name: string }[]; // 16bit オペランドの低位バイト位置と変数名
  errors: { line: number; message: string }[];
}

// 8bit レジスタの並び（Z80 の r フィールド 0..7）。
const R8: Record<string, number> = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, "(HL)": 6, A: 7 };
// 16bit レジスタペア（rp: LD rp,nn / INC rp 用）。
const RP: Record<string, number> = { BC: 0, DE: 1, HL: 2, SP: 3 };
// PUSH/POP のペア（rp2）。
const RP2: Record<string, number> = { BC: 0, DE: 1, HL: 2, AF: 3 };
// ALU 演算のベース（A に対する 8bit 演算）。加算系は "ADD A," のように A, を伴う。
const ALU: Record<string, number> = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 };

// 1オペランドを解釈: 数値/16進、または (NAME)/(nnnn)。
type Operand =
  | { kind: "imm"; value: number }
  | { kind: "mem"; value: number } // (nnnn) 直接メモリ
  | { kind: "memvar"; name: string }; // (VARNAME) BASIC 変数

function parseNumber(tok: string): number | null {
  const t = tok.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^&?[Hh]([0-9A-Fa-f]+)$/)) || (m = t.match(/^0?[Xx]([0-9A-Fa-f]+)$/))) return parseInt(m[1], 16);
  if ((m = t.match(/^([0-9A-Fa-f]+)[Hh]$/))) return parseInt(m[1], 16);
  if ((m = t.match(/^&?[Bb]([01]+)$/))) return parseInt(m[1], 2);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

export function assembleZ80(lines: string[], vars: Set<string>): AsmResult {
  const bytes: number[] = [];
  const patches: { offset: number; name: string }[] = [];
  const errors: { line: number; message: string }[] = [];
  const has = (n: string) => vars.has(n.toUpperCase());

  const emit = (...bs: number[]) => { for (const b of bs) bytes.push(b & 0xff); };
  // 16bit オペランドを little-endian で出す。mem/var は patch を残す。
  const emit16 = (op: Operand) => {
    if (op.kind === "memvar") {
      patches.push({ offset: bytes.length, name: op.name.toUpperCase() });
      emit(0x00, 0x00);
    } else {
      emit(op.value & 0xff, (op.value >> 8) & 0xff);
    }
  };

  // "(...)" を除いた中身を返す（メモリ間接判定）。
  const memInner = (s: string): string | null => {
    const m = s.match(/^\(\s*(.*?)\s*\)$/);
    return m ? m[1].trim() : null;
  };
  const parseOperand = (s: string, ln: number): Operand | null => {
    const inner = memInner(s);
    if (inner != null) {
      if (has(inner) || /^[A-Za-z_][A-Za-z0-9_]*[%]?$/.test(inner)) {
        if (!has(inner)) { errors.push({ line: ln, message: `未知の変数: ${inner}（%整数変数のみ対応）` }); return null; }
        return { kind: "memvar", name: inner };
      }
      const v = parseNumber(inner);
      if (v == null) { errors.push({ line: ln, message: `アドレスが解釈できません: ${s}` }); return null; }
      return { kind: "mem", value: v };
    }
    const v = parseNumber(s);
    if (v == null) { errors.push({ line: ln, message: `即値が解釈できません: ${s}` }); return null; }
    return { kind: "imm", value: v };
  };

  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    // コメント除去（; または '）・空行スキップ。ラベルは PoC 非対応。
    const line = raw.replace(/[;'].*$/, "").trim();
    if (!line) return;
    const mne = line.match(/^([A-Za-z]+)\b\s*(.*)$/);
    if (!mne) { errors.push({ line: ln, message: `構文が解釈できません: ${raw.trim()}` }); return; }
    const op = mne[1].toUpperCase();
    const rest = mne[2].trim();
    const args = rest ? rest.split(",").map((s) => s.trim()) : [];
    const A0 = (args[0] ?? "").toUpperCase();
    const A1 = (args[1] ?? "").toUpperCase();

    // --- 引数なし ---
    if (op === "NOP") return void emit(0x00);
    if (op === "RET") { if (!args.length) return void emit(0xc9); }
    if (op === "EI") return void emit(0xfb);
    if (op === "DI") return void emit(0xf3);
    if (op === "HALT") return void emit(0x76);
    if (op === "EXX") return void emit(0xd9);

    if (op === "DB" || op === "DEFB") {
      for (const a of args) { const v = parseNumber(a); if (v == null) { errors.push({ line: ln, message: `DB の値: ${a}` }); return; } emit(v); }
      return;
    }

    if (op === "PUSH" && A0 in RP2) return void emit(0xc5 | (RP2[A0] << 4));
    if (op === "POP" && A0 in RP2) return void emit(0xc1 | (RP2[A0] << 4));

    if (op === "INC" || op === "DEC") {
      if (A0 in RP) return void emit((op === "INC" ? 0x03 : 0x0b) | (RP[A0] << 4));
      if (A0 in R8) return void emit((op === "INC" ? 0x04 : 0x05) | (R8[A0] << 3));
      errors.push({ line: ln, message: `${op} の対象: ${A0}` }); return;
    }

    if (op === "CALL" || op === "JP") {
      const o = parseOperand(args[0] ?? "", ln); if (!o) return;
      emit(op === "CALL" ? 0xcd : 0xc3); emit16(o.kind === "mem" ? o : (o.kind === "imm" ? { kind: "mem", value: o.value } : o)); return;
    }

    if (op === "OUT") { // OUT (n),A
      const inner = memInner(args[0] ?? ""); const v = inner != null ? parseNumber(inner) : null;
      if (v == null || A1 !== "A") { errors.push({ line: ln, message: `OUT は OUT (n),A のみ` }); return; }
      return void emit(0xd3, v);
    }
    if (op === "IN") { // IN A,(n)
      const inner = memInner(args[1] ?? ""); const v = inner != null ? parseNumber(inner) : null;
      if (v == null || A0 !== "A") { errors.push({ line: ln, message: `IN は IN A,(n) のみ` }); return; }
      return void emit(0xdb, v);
    }

    if (op in ALU) {
      // ADD/ADC/SBC は "A," を伴う場合がある。SUB/AND/OR/XOR/CP は単項。
      let target = A0;
      if ((op === "ADD" || op === "ADC" || op === "SBC") && A0 === "A") target = A1;
      const base = ALU[op] << 3;
      if (target in R8) return void emit(0x80 | base | R8[target]);
      const v = parseNumber(target);
      if (v == null) { errors.push({ line: ln, message: `${op} の対象: ${target}` }); return; }
      return void emit(0xc6 | base, v); // ALU A,n は 0xC6 + alu<<3
    }

    if (op === "LD") {
      const dst = A0, srcRaw = args[1] ?? "";
      const src = A1;
      // LD A,(nn) / LD A,(VAR)
      if (dst === "A" && memInner(srcRaw) != null) {
        const o = parseOperand(srcRaw, ln); if (!o) return; emit(0x3a); emit16(o as Operand); return;
      }
      // LD (nn),A / LD (VAR),A
      if (memInner(dst) != null && src === "A") {
        const o = parseOperand(dst, ln); if (!o) return; emit(0x32); emit16(o as Operand); return;
      }
      // LD rp,nn
      if (dst in RP && memInner(srcRaw) == null) {
        const v = parseNumber(src); if (v == null) { errors.push({ line: ln, message: `LD ${dst},nn の値: ${src}` }); return; }
        emit(0x01 | (RP[dst] << 4)); emit(v & 0xff, (v >> 8) & 0xff); return;
      }
      // LD HL,(nn) / LD (nn),HL
      if (dst === "HL" && memInner(srcRaw) != null) { const o = parseOperand(srcRaw, ln); if (!o) return; emit(0x2a); emit16(o as Operand); return; }
      if (memInner(dst) != null && src === "HL") { const o = parseOperand(dst, ln); if (!o) return; emit(0x22); emit16(o as Operand); return; }
      // LD r,n （即値）
      if (dst in R8 && !(src in R8) && memInner(srcRaw) == null) {
        const v = parseNumber(src); if (v == null) { errors.push({ line: ln, message: `LD ${dst},n の値: ${src}` }); return; }
        emit(0x06 | (R8[dst] << 3), v); return;
      }
      // LD r,r'
      if (dst in R8 && src in R8) {
        if (dst === "(HL)" && src === "(HL)") { errors.push({ line: ln, message: `LD (HL),(HL) は不可` }); return; }
        emit(0x40 | (R8[dst] << 3) | R8[src]); return;
      }
      errors.push({ line: ln, message: `LD の形が未対応: ${raw.trim()}` }); return;
    }

    errors.push({ line: ln, message: `未対応の命令: ${op}` });
  });

  return { bytes, patches, errors };
}
