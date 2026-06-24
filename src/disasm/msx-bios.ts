// MSX BIOS の主要エントリ（MAIN-ROM）。逆アセンブル時に CALL/JP の絶対アドレスを
// 名前に解決して可読性を上げる。網羅ではなく「よく出るもの」中心の実用セット。
// 出典: MSX Technical Data Book / 標準 BIOS エントリ表。
export const MSX_BIOS: ReadonlyMap<number, string> = new Map([
  [0x0000, "CHKRAM"], [0x0008, "SYNCHR"], [0x000c, "RDSLT"], [0x0010, "CHRGTR"],
  [0x0014, "WRSLT"], [0x0018, "OUTDO"], [0x001c, "CALSLT"], [0x0020, "DCOMPR"],
  [0x0024, "ENASLT"], [0x0028, "GETYPR"], [0x0030, "CALLF"], [0x0038, "KEYINT"],
  [0x003b, "INITIO"], [0x003e, "INIFNK"], [0x0041, "DISSCR"], [0x0044, "ENASCR"],
  [0x0047, "WRTVDP"], [0x004a, "RDVRM"], [0x004d, "WRTVRM"], [0x0050, "SETRD"],
  [0x0053, "SETWRT"], [0x0056, "FILVRM"], [0x0059, "LDIRMV"], [0x005c, "LDIRVM"],
  [0x005f, "CHGMOD"], [0x0062, "CHGCLR"], [0x0066, "NMI"], [0x0069, "CLRSPR"],
  [0x006b, "INITXT"], [0x006e, "INIT32"], [0x0071, "INIGRP"], [0x0074, "INIMLT"],
  [0x0077, "SETTXT"], [0x007a, "SETT32"], [0x007d, "SETGRP"], [0x0080, "SETMLT"],
  [0x0084, "CALPAT"], [0x0087, "CALATR"], [0x008a, "GSPSIZ"], [0x008d, "GRPPRT"],
  [0x0090, "GICINI"], [0x0093, "WRTPSG"], [0x0096, "RDPSG"], [0x0099, "STRTMS"],
  [0x009c, "CHSNS"], [0x009f, "CHGET"], [0x00a2, "CHPUT"], [0x00a5, "LPTOUT"],
  [0x00a8, "LPTSTT"], [0x00ab, "CNVCHR"], [0x00ae, "PINLIN"], [0x00b1, "INLIN"],
  [0x00b4, "QINLIN"], [0x00b7, "BREAKX"], [0x00ba, "ISCNTC"], [0x00bd, "CKCNTC"],
  [0x00c0, "BEEP"], [0x00c3, "CLS"], [0x00c6, "POSIT"], [0x00c9, "FNKSB"],
  [0x00cc, "ERAFNK"], [0x00cf, "DSPFNK"], [0x00d2, "TOTEXT"], [0x00d5, "GTSTCK"],
  [0x00d8, "GTTRIG"], [0x00db, "GTPAD"], [0x00de, "GTPDL"], [0x00e1, "TAPION"],
  [0x00e4, "TAPIN"], [0x00e7, "TAPIOF"], [0x00ea, "TAPOON"], [0x00ed, "TAPOUT"],
  [0x00f0, "TAPOOF"], [0x00f3, "STMOTR"], [0x0108, "GETVCP"], [0x010b, "GETVC2"],
  [0x0132, "CHGCAP"], [0x0135, "CHGSND"], [0x0138, "RSLREG"], [0x013b, "WSLREG"],
  [0x013e, "RDVDP"], [0x0141, "SNSMAT"], [0x0144, "PHYDIO"], [0x0147, "FORMAT"],
  [0x014a, "ISFLIO"], [0x014d, "OUTDLP"], [0x0156, "KILBUF"], [0x0159, "CALBAS"],
]);
