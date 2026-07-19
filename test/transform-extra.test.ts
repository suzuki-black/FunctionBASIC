import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer/lexer.ts";
import { parse } from "../src/parser/parser.ts";
import { transform, renderMsx } from "../src/transform/transformer.ts";

const compile = (src: string) => {
  const { tokens, diagnostics: ld } = tokenize(src);
  const { program, diagnostics: pd } = parse(tokens);
  const r = transform(program);
  return { ...r, diagnostics: [...ld, ...pd, ...r.diagnostics], msx: renderMsx(r.code).replace(/\r/g, "") };
};

test("配列REF複数variant: 別配列ごとに本体を複製", () => {
  const { msx, diagnostics } = compile(`FUNCTION SUM(REF A, N)
    LET S = 0
    FOR I = 1 TO N
        LET S = S + A(I)
    NEXT
    RETURN S
END FUNCTION
DIM SCORE(10)
DIM DAMAGE(5)
LET T1 = SUM(REF SCORE, 10)
LET T2 = SUM(REF DAMAGE, 5)
PRINT T1
PRINT T2`);
  assert.deepEqual(diagnostics, []);
  // SUM が SCORE版(A->A) と DAMAGE版(A->B) の2ブロックに複製される
  assert.match(msx, /FUNCTION SUM \(A->A\)/);
  assert.match(msx, /FUNCTION SUM \(A->B\)/);
  // 各ブロックが対応する配列を直接参照（コピー無し。局所変数名は2文字割当）
  assert.match(msx, /\+A\(/);
  assert.match(msx, /\+B\(/);
  // 1000番台と2000番台の別セグメント
  assert.match(msx, /1000 ' === FUNCTION SUM/);
  assert.match(msx, /2000 ' === FUNCTION SUM/);
});

test("分割不能な単一文字列(>255)は E_LINE_TOO_LONG", () => {
  const { diagnostics } = compile(`PRINT "${"x".repeat(300)}"`);
  assert.ok(diagnostics.some((d) => d.code === "E_LINE_TOO_LONG"));
});

test("長いPRINTは自動分割される（エラーにならない・各行≤255）", () => {
  const parts = Array.from({ length: 50 }, (_, i) => `"part${i}"`).join("; ");
  const { code, diagnostics } = compile(`PRINT ${parts}`);
  assert.ok(!diagnostics.some((d) => d.code === "E_LINE_TOO_LONG"));
  const printLines = code.filter((l) => /PRINT/.test(l.text));
  assert.ok(printLines.length >= 2, "複数行に分割");
  // 連続表示のため最後以外は末尾 ; で改行抑制
  for (let i = 0; i < printLines.length - 1; i++)
    assert.match(printLines[i].text, /;$/);
});

test("短い行は E_LINE_TOO_LONG にならない（キーワードは1バイト換算）", () => {
  const { diagnostics } = compile(`PRINT "hello"`);
  assert.ok(!diagnostics.some((d) => d.code === "E_LINE_TOO_LONG"));
});

test("式中のネストしたユーザ関数呼び出しを一時変数へlowering", () => {
  const { msx, diagnostics } = compile(`FUNCTION ADD(A, B)
    RETURN A + B
END FUNCTION
LET Z = ADD(ADD(1, 2), 3)
PRINT Z`);
  assert.deepEqual(diagnostics, []);
  // 2回の GOSUB（内側→一時変数、外側→Z）
  assert.equal((msx.match(/GOSUB 1000/g) ?? []).length, 2);
  // E_NOT_IMPLEMENTED が出ない
  assert.ok(!diagnostics.some((d) => d.code === "E_NOT_IMPLEMENTED"));
});

test("MapTable: グローバル/ローカル/variant/refSubst を保持", () => {
  const { map } = compile(`FUNCTION F(REF X)
    GLOBAL G
    LET X = G
    RETURN 0
END FUNCTION
G = 5
F(POS)`);
  assert.ok(map.globalVarMap.some((v) => v.original === "G"));
  const f = map.functions.find((x) => x.name === "F");
  assert.ok(f, "関数Fがマップにある");
  assert.equal(f.params[0].name, "X");
  assert.equal(f.params[0].byRef, true);
  assert.equal(f.variants.length, 1);
  assert.equal(f.variants[0].refSubst[0].param, "X");
});

test("座標タプル(x,y)と組み込み命令の保持: PUT SPRITE / SPRITE$", () => {
  const { msx, diagnostics } = compile(`SCREEN 5, 2
P$ = ""
SPRITE$(0) = P$
X = 100
Y = 50
PUT SPRITE 0, (X, Y), 15, 0`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 組み込み命令名・座標タプルは保持（変数のみ2文字名へ）
  assert.match(msx, /PUT SPRITE 0,\([A-Z]+,[A-Z]+\),15,0/);
  assert.match(msx, /SPRITE\$\(0\)=/); // SPRITE$ は改名されない
});

test("優先順位の括弧は保持される: (A+B)*C", () => {
  const { msx } = compile(`A = 1
B = 2
C = 3
R = (A + B) * C`);
  assert.match(msx, /\([A-Z]+\+[A-Z]+\)\*/); // (..+..)* の括弧が残る
});

test("MSX2: COPY のブロック転送（TO 節キーワードを保持）", () => {
  const { msx, diagnostics } = compile(`SCREEN 5
COPY (0,0)-(15,15) TO (100,100)`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.ok(!diagnostics.some((d) => d.code === "E_UNKNOWN_FUNCTION"));
  assert.match(msx, /COPY \(0,0\)-\(15,15\) TO \(100,100\)/);
});

test("イベントトラップ: ON … GOSUB の飛び先関数が入口行へ解決される", () => {
  const { msx, diagnostics } = compile(`FUNCTION ONHIT()
    GLOBAL SC
    SC = SC + 1
END FUNCTION
FUNCTION ONTICK()
    GLOBAL TK
    TK = TK + 1
END FUNCTION
GLOBAL SC
GLOBAL TK
ON SPRITE GOSUB ONHIT
SPRITE ON
ON INTERVAL = 60 GOSUB ONTICK
INTERVAL ON
ON KEY GOSUB ONHIT, ONTICK
ON ERROR GOTO ONHIT`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // ONHIT=1000台 / ONTICK=2000台 に解決され、ハンドラ名は出力に残らない
  assert.match(msx, /ON SPRITE GOSUB 1000/);
  assert.match(msx, /ON INTERVAL=60 GOSUB 2000/);
  assert.match(msx, /ON KEY GOSUB 1000,2000/);
  assert.match(msx, /ON ERROR GOTO 1000/);
});

test("イベントトラップ: 計算分岐 ON x GOTO/GOSUB と ON ERROR GOTO 0", () => {
  const { msx, diagnostics } = compile(`FUNCTION A1()
    GLOBAL G
    G = 1
END FUNCTION
FUNCTION A2()
    GLOBAL G
    G = 2
END FUNCTION
GLOBAL G
X = 1
ON X GOTO A1, A2
ON X GOSUB A1, A2
ON ERROR GOTO 0`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /ON [A-Z]+ GOTO 1000,2000/); // ON <var> GOTO 行,行
  assert.match(msx, /ON [A-Z]+ GOSUB 1000,2000/);
  assert.match(msx, /ON ERROR GOTO 0/); // 数値リテラルはそのまま
});

test("イベントトラップ: デバイス有効/無効（INTERVAL/STRIG(n)/KEY(n)）", () => {
  const { msx, diagnostics } = compile(`INTERVAL ON
INTERVAL STOP
STRIG(0) ON
KEY(1) STOP
ERROR 5
RESUME NEXT`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  for (const re of [/INTERVAL ON\b/, /INTERVAL STOP\b/, /STRIG\(0\) ON\b/, /KEY\(1\) STOP\b/, /ERROR 5\b/, /RESUME NEXT\b/])
    assert.match(msx, re);
});

test("MSX2+/turboR: ON/OFF/STOP 修飾語は改名されず保持される", () => {
  const { msx, diagnostics } = compile(`_TURBO ON
_TURBO OFF
SPRITE ON
SPRITE OFF
SPRITE STOP
STOP ON
KEY OFF`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  for (const re of [/_TURBO ON\b/, /_TURBO OFF\b/, /SPRITE ON\b/, /SPRITE OFF\b/, /SPRITE STOP\b/, /STOP ON\b/, /KEY OFF\b/])
    assert.match(msx, re);
});

test("ON/OFF はキーワード完全一致のみ（ONX 等のユーザ変数は改名される）", () => {
  const { msx, diagnostics } = compile(`ONX = 5
OFFSET = ONX + 1
PRINT OFFSET`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.ok(!/\bONX\b/.test(msx) && !/\bOFFSET\b/.test(msx), "ONX/OFFSET は通常変数として改名");
});

test("CALL 拡張: 拡張命令名(MUSIC/AUDIO/VOICE)は改名されず引数の変数だけ改名", () => {
  const { msx, diagnostics } = compile(`CALL MUSIC
CALL AUDIO
N = 2
CALL VOICE(N)
CALL PCMPLAY(VARPTR(N), 3)`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /CALL MUSIC/);
  assert.match(msx, /CALL AUDIO/);
  // 命令名は素通し、括弧引数は詰めて出す。変数 N は2文字名へ。
  assert.match(msx, /CALL VOICE\([A-Z]+\)/);
  assert.match(msx, /CALL PCMPLAY\(VARPTR\([A-Z]+\),3\)/);
  assert.ok(!/\bN\b/.test(msx), "変数 N は改名される");
});

test("MSX-MUSIC: FM 初期化/音色/PLAY#2 と @n ボイス、複数語CALL名", () => {
  const { msx, diagnostics } = compile(`CALL MUSIC(0,0,1,1,1)
CALL VOICE(@1,@7,@16)
MYSRC = 1
CALL VOICE COPY(MYSRC, MYDST)
CALL COPY PCM(0, 1)
PLAY #2, "@1 O4 CEG", "O3 CG", "O5 GCE"`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /CALL MUSIC\(0,0,1,1,1\)/);
  assert.match(msx, /CALL VOICE\(@1,@7,@16\)/); // @n ボイス番号は素通し
  assert.match(msx, /CALL VOICE COPY\([A-Z]+,[A-Z]+\)/); // 複数語命令名は保持、引数変数のみ改名
  assert.match(msx, /CALL COPY PCM\(0,1\)/);
  assert.match(msx, /PLAY#2,"@1 O4 CEG"/); // FM は device #2、MML 内 @ も文字列で保持
  assert.ok(!/MYSRC|MYDST/.test(msx), "引数の変数は改名される");
});

test("CALL 拡張: _ 短縮形（_MUSIC = CALL MUSIC）も素通しされる", () => {
  const { msx, diagnostics } = compile(`_MUSIC
_AUDIO
_PLAY(0)`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /^\d+ _MUSIC$/m);
  assert.match(msx, /^\d+ _AUDIO$/m);
  assert.match(msx, /_PLAY\(0\)/); // 括弧は詰めて出す
});

test("印字: PRINT USING の USING 節は改名されない（変数 PRINT PAGE とは区別）", () => {
  const { msx, diagnostics } = compile(`PRINT USING "##.##"; X
LPRINT USING "&"; A$
PAGE = 5
PRINT PAGE`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /PRINT USING "##\.##";/);
  assert.match(msx, /LPRINT USING "&";/);
  // PRINT 直後でも USING 以外（変数 PAGE）は通常どおり改名される
  assert.ok(!/\bPAGE\b/.test(msx), "ユーザ変数 PAGE は改名される");
});

test("ファイル: # 番号・OPEN/FIELD/AS・GET/PUT・KILL/NAME が保持される", () => {
  const { msx, diagnostics } = compile(`OPEN "DATA" FOR INPUT AS #1
FIELD #1, 20 AS N$, 4 AS A$
GET #1, 5
LINE INPUT #1, L$
CLOSE #1
KILL "OLD.DAT"
NAME "A.TXT" AS "B.TXT"`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /OPEN "DATA" FOR INPUT AS#1/);
  assert.match(msx, /FIELD#1,20 AS [A-Z]+\$,4 AS [A-Z]+\$/);
  assert.match(msx, /GET#1,5/);
  assert.match(msx, /LINE INPUT#1,/);
  assert.match(msx, /KILL "OLD\.DAT"/);
  assert.match(msx, /NAME "A\.TXT" AS "B\.TXT"/);
});

test("型変換/ファイル関数: CVI/MKI$/EOF/LOC/USR/DSKF は改名されない", () => {
  const { msx, diagnostics } = compile(`A = CVI(R$) + CVS(S$) + CVD(T$)
B$ = MKI$(1) + MKS$(2) + MKD$(3)
IF EOF(1) THEN
    C = LOC(1) + LOF(1) + DSKF(0) + USR0(5)
END IF`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  for (const re of [/CVI\(/, /MKI\$\(/, /EOF\(1\)/, /LOC\(1\)/, /LOF\(1\)/, /DSKF\(0\)/, /USR0\(5\)/])
    assert.match(msx, re);
});

test("MSX2: COLOR SPRITE(n)= は SPRITE を改名せず保持する", () => {
  const { msx, diagnostics } = compile(`SCREEN 5, 2
COLOR SPRITE(0) = 15
COLOR SPRITE(1) = 8`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /COLOR SPRITE\(0\)=15/);
  assert.match(msx, /COLOR SPRITE\(1\)=8/);
});

test("MSX2: POINT 関数は改名されず素通しされる", () => {
  const { msx, diagnostics } = compile(`SCREEN 5
C = POINT(10, 20)
PRINT C`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /=POINT\(10,20\)/);
});

test("BGM: PLAY は文(演奏)でも関数(残数)でも使える", () => {
  const { msx, diagnostics } = compile(`PLAY "CDEFG"
WHILE PLAY(0)
WEND`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /PLAY "CDEFG"/); // 文形
  assert.match(msx, /PLAY\(0\)/); // 関数形（WHILE 条件内）
});

test("MSX2: SET PAGE / SET SCROLL の節キーワードを保持", () => {
  const { msx, diagnostics } = compile(`SET PAGE 0,1
SET SCROLL 0,0`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /SET PAGE 0,1/);
  assert.match(msx, /SET SCROLL 0,0/);
});

test("MSX2: COLOR= パレット設定（= と NEW を保持）", () => {
  const { msx, diagnostics } = compile(`COLOR=(1,7,7,7)
COLOR=NEW`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /COLOR=\(1,7,7,7\)/);
  assert.match(msx, /COLOR=NEW/);
});

test("グラフィック: LINE の末尾 B/BF（箱・塗り箱）は改名されない", () => {
  const { msx, diagnostics } = compile(`LINE (0,0)-(10,10),15,B
LINE (0,0)-(20,20),4,BF`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /LINE \(0,0\)-\(10,10\),15,B\b/);
  assert.match(msx, /LINE \(0,0\)-\(20,20\),4,BF\b/);
});

test("BF はLINE末尾以外では通常のユーザ変数として改名される", () => {
  const { msx, diagnostics } = compile(`BF = 3
PRINT BF`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 2文字名へ割り当てられ、代入と参照が同じ名前に解決される（生の BF は残らない）
  assert.ok(!/\bBF\b/.test(msx), "BF が改名される");
  const m = msx.match(/(\b[A-Z]{1,2})=3/);
  assert.ok(m, "BF が変数名へ");
  assert.match(msx, new RegExp(`PRINT ${m![1]}\\b`));
});

test("節キーワードと同名のユーザ変数は文脈で区別される（PAGE）", () => {
  // SET の外で使う PAGE は通常のユーザ変数として一貫して改名される
  const { msx, diagnostics } = compile(`PAGE = 5
PRINT PAGE`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 代入先と参照が同じ2文字名に解決される（不整合で壊れない）
  const m = msx.match(/(\b[A-Z]{1,2})=5/);
  assert.ok(m, "PAGE が2文字名へ");
  assert.match(msx, new RegExp(`PRINT ${m![1]}\\b`));
  assert.ok(!/\bPAGE\b/.test(msx), "生の PAGE は残らない");
});

test("STRICT: 型付き・完全一致の正しいコードは通る（opt-in）", () => {
  const ok = compile(`STRICT
FUNCTION ADD%(A%, B%)
    RETURN A% + B%
END FUNCTION
SC% = 0
FOR I% = 1 TO 10
    SC% = SC% + ADD%(I%, 1)
NEXT I%
MSG$ = "score:" + STR$(SC%)
R! = CSNG(SC%) / 3
PRINT MSG$; R!`);
  assert.deepEqual(ok.diagnostics.filter((d) => d.severity === "error"), []);
});

test("STRICT: 未型変数は E_STRICT_UNTYPED", () => {
  assert.ok(compile(`STRICT\nSCORE = 0`).diagnostics.some((d) => d.code === "E_STRICT_UNTYPED"));
  assert.ok(compile(`STRICT\nFOR I = 1 TO 3\nNEXT I`).diagnostics.some((d) => d.code === "E_STRICT_UNTYPED"));
});

test("STRICT: 型不一致は E_TYPE_MISMATCH（縮小/小数→整数/文字列混在/引数/戻り値）", () => {
  const cases = [
    `STRICT\nA% = 3\nB# = 1.5\nA% = B#`, // # → % 縮小
    `STRICT\nA% = 1.5`, // 小数 → 整数
    `STRICT\nN% = 0\nS$ = "x"\nN% = S$`, // 文字列 → 数値
    `STRICT\nFUNCTION F%(A%)\n RETURN A%\nEND FUNCTION\nB# = 1.5\nX% = F%(B#)`, // 引数
    `STRICT\nFUNCTION G%()\n RETURN 1.5\nEND FUNCTION\nX% = G%()`, // 戻り値
  ];
  for (const c of cases)
    assert.ok(compile(c).diagnostics.some((d) => d.code === "E_TYPE_MISMATCH"), c);
});

test("STRICT は opt-in: ディレクティブ無しなら従来どおり型チェックしない", () => {
  // 非strict では #→% も未型変数も許容（MSXの暗黙変換のまま）
  assert.equal(
    compile(`A% = 3\nB# = 1.5\nA% = B#\nSCORE = 0`).diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
});

test("サフィックス付き関数呼び出し ADD%() は関数として解決される（配列誤認しない）", () => {
  const { msx, diagnostics } = compile(`FUNCTION ADD%(A%, B%)
    RETURN A% + B%
END FUNCTION
X% = ADD%(1, 2)
PRINT X%`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(msx, /GOSUB 1000/); // 配列参照でなく関数呼び出し
});

test("STRICT: 前方参照/GLOBAL配列の読み出しは配列扱いで型不一致にしない", () => {
  // DIM が関数より後（前方参照）でも、name%(...) は配列参照＝要素型はサフィックス由来。
  const { diagnostics } = compile(`STRICT
FUNCTION F%()
  GLOBAL IL%
  RETURN IL%(0)
END FUNCTION
DIM IL%(15)
IL%(0) = 7
X% = F()
PRINT X%`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
});

test("E_DUP_FUNCTION は重複した関数定義の位置を持つ（由来行エラー用）", () => {
  const { diagnostics } = compile(`FUNCTION FOO()\nEND FUNCTION\nFUNCTION FOO()\nEND FUNCTION\n`);
  const d = diagnostics.find((x) => x.code === "E_DUP_FUNCTION");
  assert.ok(d, "E_DUP_FUNCTION が報告される");
  assert.ok(d.line >= 3, `2つ目の定義(行3)を指すべき: line=${d.line}`);
});

test("ASM ブロック: HIMEM直下へコード配置＋VARPTRパッチ＋DEFUSR/USR を生成", () => {
  const { msx, diagnostics } = compile(
    `PX% = 100\nASM\n  LD A,(PX%)\n  INC A\n  LD (PX%),A\nEND ASM\nPRINT PX%\n`,
  );
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  // 機械語は 255B 制限のある文字列でなく HIMEM(&HFC4A/4B) 直下の予約領域へ置く。
  assert.match(msx, /CLEAR 1024,\(PEEK\(&HFC4A\)\+PEEK\(&HFC4B\)\*256\)-\d+/);
  assert.doesNotMatch(msx, /STRING\$/); // コードを文字列に入れない（255B超で Illegal function call）
  assert.match(msx, /VARPTR\(A%\)/); // PX% → A%（2文字名）のアドレスをパッチ
  assert.match(msx, /POKE .+,58\b/); // LD A,(nn) の opcode 0x3A=58 を配置
  assert.match(msx, /DEFUSR=/);
  assert.match(msx, /=USR\(0\)/);
});

test("ASM: 未対応命令は E_ASM（黙って壊さない）", () => {
  const { diagnostics } = compile(`ASM\n  FOOBAR 1\nEND ASM\n`);
  assert.ok(diagnostics.some((d) => d.code === "E_ASM"));
});

test("最適化: hotPlacement で呼出の多い関数が低い行番号へ（衝突なし・GOSUB解決維持）", () => {
  const src = `FUNCTION COLD()\n PRINT 1\nEND FUNCTION\nFUNCTION HOT()\n PRINT 2\nEND FUNCTION\nCOLD()\nHOT()\nHOT()\nHOT()\n`;
  const { tokens } = tokenize(src);
  const { program } = parse(tokens);
  const r = transform(program, { hotPlacement: true });
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), []);
  const lineOf = (n) => r.code.find((l) => l.text.includes("=== FUNCTION " + n + " "))?.lineNo;
  assert.ok(lineOf("HOT") < lineOf("COLD"), `HOT(${lineOf("HOT")}) < COLD(${lineOf("COLD")})`);
  const nums = r.code.map((l) => l.lineNo);
  assert.ok(nums.every((v, i) => i === 0 || v > nums[i - 1]), "行番号は昇順・重複なし");
  // 既定(OFF)ではソース順（COLD が先）
  const r2 = transform(parse(tokenize(src).tokens).program);
  const l2 = (n) => r2.code.find((l) => l.text.includes("=== FUNCTION " + n + " "))?.lineNo;
  assert.ok(l2("COLD") < l2("HOT"), "既定はソース順");
});

test("STRICT: PUT SPRITE 等の節キーワードは未型変数と誤検知しない", () => {
  const { diagnostics } = compile(`STRICT
X% = 10
PUT SPRITE 0, (X%, 20), 3, 0`);
  assert.equal(diagnostics.filter((d) => d.code === "E_STRICT_UNTYPED").length, 0);
});

test("DEFINT/DEFSNG/DEFDBL/DEFSTR は未対応エラー（型はサフィックスで）", () => {
  for (const d of ["DEFINT A-Z", "DEFSNG A", "DEFDBL X-Z", "DEFSTR S"])
    assert.ok(
      compile(d).diagnostics.some((x) => x.code === "E_DEF_UNSUPPORTED"),
      `${d} は E_DEF_UNSUPPORTED`,
    );
  // サフィックス型は通る
  assert.equal(
    compile(`A% = 1\nB! = 2\nC# = 3\nD$ = "x"`).diagnostics.filter((x) => x.severity === "error").length,
    0,
  );
});

test("行番号の飛び先/復帰は不可（ON … GOTO 行 / RESUME 行）。0・NEXT・関数名はOK", () => {
  const fn = `FUNCTION H()\n GLOBAL G\n G=1\nEND FUNCTION\n`;
  assert.ok(compile(`X=1\nON X GOTO 100, 200`).diagnostics.some((d) => d.code === "E_ON_LINE_TARGET"));
  assert.ok(compile(`RESUME 100`).diagnostics.some((d) => d.code === "E_RESUME_LINE"));
  // 許可される形
  for (const ok of [`${fn}X=1\nON X GOSUB H`, `${fn}ON ERROR GOTO 0`, `RESUME 0`, `RESUME NEXT`])
    assert.equal(compile(ok).diagnostics.filter((d) => d.severity === "error").length, 0, ok);
});

test("RESTORE に行番号を付けるとエラー（構造化に行番号は無い）。bare はOK", () => {
  assert.ok(compile(`RESTORE 200`).diagnostics.some((d) => d.code === "E_RESTORE_LINE"));
  assert.equal(
    compile(`RESTORE\nREAD A\nDATA 1`).diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
});

test("ON … の飛び先に引数つき関数を指定するとエラー（ハンドラは無引数）", () => {
  const withParam = compile(`FUNCTION H(X)
    GLOBAL G
    G = X
END FUNCTION
ON SPRITE GOSUB H
SPRITE ON`);
  assert.ok(withParam.diagnostics.some((d) => d.code === "E_HANDLER_PARAMS"));
  const noParam = compile(`FUNCTION H()
    GLOBAL G
    G = 1
END FUNCTION
ON SPRITE GOSUB H
SPRITE ON`);
  assert.equal(noParam.diagnostics.filter((d) => d.severity === "error").length, 0);
});

test("1関数が100出力行を超えても行番号が衝突しない（昇順・重複なし）", () => {
  let src = "FUNCTION BIG()\n  GLOBAL G\n";
  for (let i = 0; i < 130; i++) src += `  G = G + ${i}\n`;
  src += "END FUNCTION\nFUNCTION NX()\n  GLOBAL H\n  H = 1\nEND FUNCTION\nBIG()\nNX()";
  const { code, diagnostics } = compile(src);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  const nos = code.map((l) => l.lineNo);
  assert.deepEqual([...new Set(nos)].length, nos.length, "行番号は重複しない");
  assert.ok(nos.every((n, i) => i === 0 || n > nos[i - 1]), "行番号は昇順");
});

test("戻り値の無い手続きFUNCTIONの末尾にRETURNが補われる", () => {
  const { msx, diagnostics } = compile(`FUNCTION SETUP()
    GLOBAL X
    X = 5
END FUNCTION
SETUP()
PRINT X`);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0);
  // 関数ブロックの最後が RETURN で終わる（GOSUB が落ちない）
  const fnPart = msx.slice(msx.indexOf("=== FUNCTION SETUP"));
  assert.match(fnPart.trim(), /RETURN\s*$/);
});

test("AS は OPEN/FIELD 文脈では節キーワード、それ以外では変数名（文脈依存予約）", () => {
  // 変数としての AS（実MSXでも有効。素のBASIC取込で誤検出しないように）
  const v = compile("AS=1.2\nX=10*AS\nPRINT AS\n");
  assert.equal(v.diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(v.msx, /=1\.2/); // AS は変数として扱われる（短縮改名されるが構文エラーにならない）
  // 節キーワードとしての AS（OPEN/FIELD では保護され改名されない）
  const o = compile('OPEN "D" FOR INPUT AS #1\nFIELD #1, 20 AS N$\n');
  assert.equal(o.diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.match(o.msx, /OPEN "D" FOR INPUT AS#1/);
  assert.match(o.msx, /FIELD#1,20 AS [A-Z]+\$/);
});
