// 依存ゼロの Z80 逆アセンブラ（best-effort・線形掃引）。
// DATA 等に埋め込まれた機械語を、構造化BASIC側にニーモニックとして注釈するためのコア。
// デコードは x/y/z ビットフィールド法（"Decoding Z80 opcodes" 方式）。
// base/CB/ED/DD・FD/DDCB・FDCB に対応。生成ではなく「読解」用途なので、
// コード/データの混在や自己書き換えは追えない（best-effort）。

export interface DisasmLine {
  addr: number; // この命令の開始アドレス
  bytes: number[]; // 命令を構成するバイト列
  text: string; // ニーモニック
}

const R = ["B", "C", "D", "E", "H", "L", "(HL)", "A"];
const RP = ["BC", "DE", "HL", "SP"];
const RP2 = ["BC", "DE", "HL", "AF"];
const CC = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
const ALU = ["ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP "];
const ROT = ["RLC ", "RRC ", "RL ", "RR ", "SLA ", "SRA ", "SLL ", "SRL "];
const IM = ["0", "0", "1", "2", "0", "0", "1", "2"];
const ACC = ["RLCA", "RRCA", "RLA", "RRA", "DAA", "CPL", "SCF", "CCF"];
const BLK = [
  ["LDI", "CPI", "INI", "OUTI"],
  ["LDD", "CPD", "IND", "OUTD"],
  ["LDIR", "CPIR", "INIR", "OTIR"],
  ["LDDR", "CPDR", "INDR", "OTDR"],
];

// アセンブラ慣用の16進表記（先頭が英字なら 0 を前置）。
function hexn(n: number, w: number): string {
  let s = (n & (w === 2 ? 0xff : 0xffff)).toString(16).toUpperCase().padStart(w, "0");
  if (/^[A-F]/.test(s)) s = "0" + s;
  return s + "h";
}
const b8 = (n: number) => hexn(n, 2);

// 1命令をデコード。addr=この命令の開始アドレス。symbols で絶対アドレスを名前解決。
function decodeOne(
  mem: number[],
  start: number,
  addr: number,
  symbols?: ReadonlyMap<number, string>,
): { text: string; len: number } {
  let p = start;
  const u8 = () => (mem[p++] ?? 0) & 0xff;
  const s8 = () => {
    const v = u8();
    return v < 128 ? v : v - 256;
  };
  const u16 = () => {
    const lo = u8();
    const hi = u8();
    return (lo | (hi << 8)) & 0xffff;
  };
  const symw = (a: number) => symbols?.get(a & 0xffff) ?? hexn(a, 4);
  const rel = () => {
    const d = s8();
    return symw((addr + (p - start) + d) & 0xffff); // p は d 読了後 = 次命令位置
  };

  // DD/FD プレフィックス（最後が有効）
  let ix: string | null = null;
  while ((mem[p] & 0xff) === 0xdd || (mem[p] & 0xff) === 0xfd) {
    ix = (mem[p] & 0xff) === 0xdd ? "IX" : "IY";
    p++;
  }

  // DD/FD の (HL)→(IX+d) 用の遅延変位
  let dispDone = false;
  let dispVal = 0;
  const dstr = () => {
    if (!dispDone) {
      dispVal = s8();
      dispDone = true;
    }
    return (dispVal < 0 ? "-" : "+") + b8(Math.abs(dispVal));
  };
  // レジスタ名（idx=6 は (HL)/(IX+d)。ix 時 H/L は IXH/IXL に置換、ただし (HL) 同居時は呼び側で抑制）
  const reg = (idx: number) => {
    if (idx === 6) return ix ? `(${ix}${dstr()})` : "(HL)";
    if (ix && idx === 4) return ix + "H";
    if (ix && idx === 5) return ix + "L";
    return R[idx];
  };
  const rp = (i: number) => (ix && i === 2 ? ix : RP[i]);
  const rp2 = (i: number) => (ix && i === 2 ? ix : RP2[i]);

  const op = u8();

  // ---- CB / DDCB・FDCB ----
  if (op === 0xcb) {
    if (ix) {
      const d = s8();
      const cb = u8();
      const X = (cb >> 6) & 3, Y = (cb >> 3) & 7, Z = cb & 7;
      const tgt = `(${ix}${(d < 0 ? "-" : "+") + b8(Math.abs(d))})`;
      let t: string;
      if (X === 0) t = `${ROT[Y]}${tgt}`;
      else if (X === 1) t = `BIT ${Y},${tgt}`;
      else if (X === 2) t = `RES ${Y},${tgt}`;
      else t = `SET ${Y},${tgt}`;
      if (Z !== 6 && X !== 1) t += `,${R[Z]}`; // 未公開: 結果をレジスタにも
      return { text: t, len: p - start };
    }
    const cb = u8();
    const X = (cb >> 6) & 3, Y = (cb >> 3) & 7, Z = cb & 7;
    let t: string;
    if (X === 0) t = `${ROT[Y]}${R[Z]}`;
    else if (X === 1) t = `BIT ${Y},${R[Z]}`;
    else if (X === 2) t = `RES ${Y},${R[Z]}`;
    else t = `SET ${Y},${R[Z]}`;
    return { text: t, len: p - start };
  }

  // ---- ED ----
  if (op === 0xed) {
    const e = u8();
    const X = (e >> 6) & 3, Y = (e >> 3) & 7, Z = e & 7, P = Y >> 1, Q = Y & 1;
    let t: string | null = null;
    if (X === 1) {
      if (Z === 0) t = Y === 6 ? "IN (C)" : `IN ${R[Y]},(C)`;
      else if (Z === 1) t = Y === 6 ? "OUT (C),0" : `OUT (C),${R[Y]}`;
      else if (Z === 2) t = (Q === 0 ? "SBC HL," : "ADC HL,") + RP[P];
      else if (Z === 3) t = Q === 0 ? `LD (${symw(u16())}),${RP[P]}` : `LD ${RP[P]},(${symw(u16())})`;
      else if (Z === 4) t = "NEG";
      else if (Z === 5) t = Y === 1 ? "RETI" : "RETN";
      else if (Z === 6) t = "IM " + IM[Y];
      else t = ["LD I,A", "LD R,A", "LD A,I", "LD A,R", "RRD", "RLD", "NOP", "NOP"][Y];
    } else if (X === 2 && Z <= 3 && Y >= 4) {
      t = BLK[Y - 4][Z];
    }
    if (t === null) t = `DB 0EDh,${b8(e)}`;
    return { text: t, len: p - start };
  }

  // ---- 無印（DD/FD で HL→IX/IY 置換あり）----
  const X = (op >> 6) & 3, Y = (op >> 3) & 7, Z = op & 7, P = Y >> 1, Q = Y & 1;
  let t: string;

  if (op === 0x76) {
    t = "HALT";
  } else if (X === 0) {
    if (Z === 0) {
      if (Y === 0) t = "NOP";
      else if (Y === 1) t = "EX AF,AF'";
      else if (Y === 2) t = `DJNZ ${rel()}`;
      else if (Y === 3) t = `JR ${rel()}`;
      else t = `JR ${CC[Y - 4]},${rel()}`;
    } else if (Z === 1) {
      t = Q === 0 ? `LD ${rp(P)},${symw(u16())}` : `ADD ${rp(2)},${rp(P)}`;
    } else if (Z === 2) {
      if (Q === 0) {
        if (P === 0) t = "LD (BC),A";
        else if (P === 1) t = "LD (DE),A";
        else if (P === 2) t = `LD (${symw(u16())}),${rp(2)}`;
        else t = `LD (${symw(u16())}),A`;
      } else {
        if (P === 0) t = "LD A,(BC)";
        else if (P === 1) t = "LD A,(DE)";
        else if (P === 2) t = `LD ${rp(2)},(${symw(u16())})`;
        else t = `LD A,(${symw(u16())})`;
      }
    } else if (Z === 3) {
      t = (Q === 0 ? "INC " : "DEC ") + rp(P);
    } else if (Z === 4) {
      t = `INC ${reg(Y)}`;
    } else if (Z === 5) {
      t = `DEC ${reg(Y)}`;
    } else if (Z === 6) {
      t = `LD ${reg(Y)},${b8(u8())}`;
    } else {
      t = ACC[Y];
    }
  } else if (X === 1) {
    if (Z === 6 || Y === 6) {
      // (HL)/(IX+d) 同居時は相手レジスタを置換しない（H/L のまま）
      const dst = Y === 6 ? reg(6) : R[Y];
      const src = Z === 6 ? reg(6) : R[Z];
      t = `LD ${dst},${src}`;
    } else {
      t = `LD ${reg(Y)},${reg(Z)}`;
    }
  } else if (X === 2) {
    t = `${ALU[Y]}${reg(Z)}`;
  } else {
    // X === 3
    if (Z === 0) t = `RET ${CC[Y]}`;
    else if (Z === 1) {
      if (Q === 0) t = `POP ${rp2(P)}`;
      else if (P === 0) t = "RET";
      else if (P === 1) t = "EXX";
      else if (P === 2) t = `JP (${ix ?? "HL"})`;
      else t = `LD SP,${rp(2)}`;
    } else if (Z === 2) {
      t = `JP ${CC[Y]},${symw(u16())}`;
    } else if (Z === 3) {
      if (Y === 0) t = `JP ${symw(u16())}`;
      else if (Y === 2) t = `OUT (${b8(u8())}),A`;
      else if (Y === 3) t = `IN A,(${b8(u8())})`;
      else if (Y === 4) t = `EX (SP),${rp(2)}`;
      else if (Y === 5) t = "EX DE,HL";
      else if (Y === 6) t = "DI";
      else t = "EI";
    } else if (Z === 4) {
      t = `CALL ${CC[Y]},${symw(u16())}`;
    } else if (Z === 5) {
      // q=0: PUSH rp2 / q=1,P=0: CALL nn（P!=0 はプレフィックスで既出）
      t = Q === 0 ? `PUSH ${rp2(P)}` : `CALL ${symw(u16())}`;
    } else if (Z === 6) {
      t = `${ALU[Y]}${b8(u8())}`;
    } else {
      t = `RST ${b8(Y * 8)}`;
    }
  }

  return { text: t, len: p - start };
}

// バイト列を逆アセンブル。base=先頭バイトのアドレス。symbols で絶対アドレスを名前解決。
export function disassemble(
  bytes: number[],
  base = 0,
  symbols?: ReadonlyMap<number, string>,
): DisasmLine[] {
  const out: DisasmLine[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const { text, len } = decodeOne(bytes, pos, (base + pos) & 0xffff, symbols);
    const n = Math.max(1, len);
    out.push({ addr: (base + pos) & 0xffff, bytes: bytes.slice(pos, pos + n), text });
    pos += n;
  }
  return out;
}
