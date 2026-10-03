// ESERAMair REST クライアント CLI (FunctionBASIC 実機デプロイ用)
// 対象: ESERAMair (WiFi付き似非RAMディスク, Raspberry Pi Pico 2W) の REST API (http:8080)
//   仕様: https://github.com/t-bucchi/ESERAMair  docs/RESTAPI.md
// 依存ゼロ (Node 標準 fetch)。実行: node --experimental-strip-types eseramair.mjs <cmd> ...
//
// 重要な前提(仕様より):
//  - 認証/暗号化なし。閉じたLANで使うこと。
//  - 同時に1リクエストのみ。本ツールは逐次実行する。
//  - MSX のリセットは REST に無い(物理RESET/電源のみ)。deploy 系は最後に「RESET押下」を促す。
//
// 使い方:
//   node --experimental-strip-types eseramair.mjs <command> [args] [--host H] [--port 8080] [--yes]
//   環境変数 ESERAMAIR_HOST / ESERAMAIR_PORT でも指定可(既定 eseram.local:8080)。
//
// コマンド:
//   hello                               疎通確認 (GET /hello)
//   status                              Nextor/FAT 状態 (GET /fat/status)
//   ram-clear [--start S] [--size N]    SRAM を 0 で埋める = RAMクリア (POST /ram/fill)
//   ram-fill --data D [--start S] [--size N]   SRAM を値 D で埋める (POST /ram/fill)
//   ram-read <outfile> [--start S] [--size N]  SRAM 吸い出し (GET /ram)
//   ram-write <file> [--start S]        SRAM 生書き = ROM焼き込み相当 (POST /ram)  ※--yes 必須
//   ls [path]                           ファイル一覧 (GET /fat/files)
//   put <localfile> [name] [--mtime T]  ディスクへアップロード (POST /fat/files/<name>)
//   get <name> <localfile>              ダウンロード (GET /fat/files/<name>)
//   rm <name>                           削除 (DELETE /fat/files/<name>)  ※--yes 必須
//   mkdir <dir>                         ディレクトリ作成 (POST /fat/directories/<dir>)
//   mv <src> <dst>                      リネーム/移動 (POST /fat/rename)
//   format                              FAT フォーマット (POST /fat/format)  ※--yes 必須
//   deploy-rom <romfile> [--no-clear]   ram-clear(任意) + ram-write(start 0) + 照合 + RESET案内 ※--yes 必須
//   deploy-file <localfile> [name]      put でディスクへ配置 + 案内 (Nextor から実行)
//
// 破壊的操作(ram-clear/ram-write/rm/format/deploy-rom)は実機データを壊すため --yes を必須にしている。

const argv = process.argv.slice(2);
const cmd = argv[0];

// 値を取らない(真偽)フラグ。これ以外の --key は次トークンを値として取る。
const VALUELESS = new Set(["yes", "no-clear"]);

// --- フラグ解析 (--key value / --flag) ---
const flags = {};
const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && !VALUELESS.has(key)) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  } else pos.push(a);
}
const HOST = flags.host ?? process.env.ESERAMAIR_HOST ?? "eseram.local";
const PORT = flags.port ?? process.env.ESERAMAIR_PORT ?? "8080";
const BASE = `http://${HOST}:${PORT}`;
const YES = flags.yes === true;

const die = (msg, code = 1) => { console.error("error: " + msg); process.exit(code); };
const needYes = (what) => { if (!YES) die(`${what} は破壊的操作です。確認の上 --yes を付けてください。`); };
const q = (obj) => {
  const e = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== true);
  return e.length ? "?" + e.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
};

// ESERAMair の HTTP サーバは「同時1リクエストのみ」の最小実装で壊れやすい（Pico）。
// Node の fetch(undici) は keep-alive でコネクションを使い回し、この種のサーバを固める。
// そこで実 HTTP は常に `curl` を1回呼ぶ＝「1リクエスト=1コネクション=応答後クローズ」を厳守。
//   --http1.1 / -H "Connection: close" / --max-time でkeep-aliveせず必ず閉じる。
//   POSTボディは --data-binary @file で送る（curl が Content-Length を正しく付ける。chunkedにしない）。
// 連打・ポーリング・リトライ連投はしない（呼び出し側の責務）。
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const os = await import("node:os");
const nodefs = await import("node:fs");
const nodepath = await import("node:path");
const execFileP = promisify(execFile);
const CURL_TIMEOUT = String(flags.timeout ?? 30);

async function req(method, path, { body, binary } = {}) {
  const url = BASE + path;
  const args = ["-sS", "--http1.1", "-H", "Connection: close", "--max-time", CURL_TIMEOUT];
  if (method !== "GET") args.push("-X", method);
  let tmp;
  try {
    if (body != null) {
      tmp = nodefs.mkdtempSync(nodepath.join(os.tmpdir(), "eseram-"));
      const bf = nodepath.join(tmp, "body.bin");
      nodefs.writeFileSync(bf, body);
      args.push("-H", "Content-Type: application/octet-stream", "--data-binary", "@" + bf);
    }
    let status, respBody;
    if (binary) {
      tmp = tmp ?? nodefs.mkdtempSync(nodepath.join(os.tmpdir(), "eseram-"));
      const of = nodepath.join(tmp, "out.bin");
      args.push("-o", of, "-w", "%{http_code}", url);
      const { stdout } = await execFileP("curl", args);
      status = parseInt(stdout.trim(), 10);
      respBody = nodefs.readFileSync(of);
    } else {
      args.push("-w", "\n__HTTP__%{http_code}", url);
      const { stdout } = await execFileP("curl", args);
      const i = stdout.lastIndexOf("\n__HTTP__");
      status = i >= 0 ? parseInt(stdout.slice(i + 9), 10) : 0;
      respBody = Buffer.from(i >= 0 ? stdout.slice(0, i) : stdout, "utf8");
    }
    const ok = status >= 200 && status < 300;
    if (binary) {
      if (!ok) die(`HTTP ${status} ${method} ${path} : ${respBody.toString("utf8").slice(0, 200)}`);
      return respBody;
    }
    const text = respBody.toString("utf8");
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!ok) die(`HTTP ${status} ${method} ${path} : ${json ? JSON.stringify(json) : text.slice(0, 200)}`);
    return json ?? text;
  } catch (e) {
    die(`接続失敗 ${method} ${url} : ${e.message}\n  (curl失敗。ESERAMair の電源/WiFi/IP を確認。固まっている場合は無理に再送しない)`);
  } finally {
    if (tmp) try { nodefs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  switch (cmd) {
    case "hello":
      console.log(JSON.stringify(await req("GET", "/hello")));
      break;
    case "status":
      console.log(JSON.stringify(await req("GET", "/fat/status"), null, 2));
      break;
    case "ram-clear": {
      needYes("ram-clear");
      const r = await req("POST", "/ram/fill" + q({ start: flags.start, size: flags.size, data: 0 }));
      console.log("RAMクリア:", JSON.stringify(r));
      break;
    }
    case "ram-fill": {
      needYes("ram-fill");
      if (flags.data === undefined) die("--data が必要です");
      const r = await req("POST", "/ram/fill" + q({ start: flags.start, size: flags.size, data: flags.data }));
      console.log("fill:", JSON.stringify(r));
      break;
    }
    case "ram-read": {
      const out = pos[0] || die("出力ファイル名が必要です");
      const buf = await req("GET", "/ram" + q({ start: flags.start, size: flags.size }), { binary: true });
      (await import("node:fs")).writeFileSync(out, buf);
      console.log(`SRAM ${buf.length} バイトを ${out} に保存`);
      break;
    }
    case "ram-write": {
      needYes("ram-write");
      const file = pos[0] || die("書き込むファイルが必要です");
      const buf = (await import("node:fs")).readFileSync(file);
      const start = Number(flags.start ?? 0);
      const r = await req("POST", "/ram" + q({ start: flags.start }), { body: buf });
      console.log(`ROM書き込み: ${file} (${buf.length}B) -> SRAM start=${start}`, JSON.stringify(r));
      break;
    }
    case "ls": {
      const list = await req("GET", "/fat/files" + q({ path: pos[0] }));
      if (Array.isArray(list)) for (const f of list)
        console.log(`${f.type === "dir" ? "d" : "-"} ${String(f.size).padStart(8)}  ${f.date || ""}  ${f.name}`);
      else console.log(JSON.stringify(list));
      break;
    }
    case "put": {
      const file = pos[0] || die("ローカルファイルが必要です");
      const fs = await import("node:fs");
      const buf = fs.readFileSync(file);
      const name = pos[1] || file.split("/").pop();
      const r = await req("POST", `/fat/files/${encodeURI(name)}` + q({ mtime: flags.mtime }), { body: buf });
      console.log(`アップロード: ${file} (${buf.length}B) -> ${name}`, JSON.stringify(r));
      break;
    }
    case "get": {
      const name = pos[0] || die("リモートファイル名が必要です");
      const out = pos[1] || name.split("/").pop();
      const buf = await req("GET", `/fat/files/${encodeURI(name)}`, { binary: true });
      (await import("node:fs")).writeFileSync(out, buf);
      console.log(`ダウンロード: ${name} -> ${out} (${buf.length}B)`);
      break;
    }
    case "rm": {
      needYes("rm");
      const name = pos[0] || die("削除するファイル名が必要です");
      console.log("削除:", JSON.stringify(await req("DELETE", `/fat/files/${encodeURI(name)}`)));
      break;
    }
    case "mkdir": {
      const dir = pos[0] || die("ディレクトリ名が必要です");
      console.log("作成:", JSON.stringify(await req("POST", `/fat/directories/${encodeURI(dir)}`)));
      break;
    }
    case "mv": {
      const [src, dst] = pos;
      if (!src || !dst) die("src と dst が必要です");
      console.log("rename:", JSON.stringify(await req("POST", "/fat/rename" + q({ src, dst }))));
      break;
    }
    case "format":
      needYes("format");
      console.log("フォーマット:", JSON.stringify(await req("POST", "/fat/format")));
      break;
    case "deploy-rom": {
      needYes("deploy-rom");
      const file = pos[0] || die("ROM ファイルが必要です");
      const fs = await import("node:fs");
      const buf = fs.readFileSync(file);
      if (!flags["no-clear"]) {
        process.stdout.write("1) RAMクリア... ");
        await req("POST", "/ram/fill" + q({ data: 0 }));
        console.log("ok");
      }
      process.stdout.write(`2) ROM書き込み (${buf.length}B, start=0)... `);
      await req("POST", "/ram", { body: buf });
      console.log("ok");
      process.stdout.write("3) 照合(GET /ram で読み戻し)... ");
      const back = await req("GET", "/ram" + q({ start: 0, size: buf.length }), { binary: true });
      const okv = back.length === buf.length && back.equals(buf);
      console.log(okv ? "一致" : `不一致! (書込${buf.length}B / 読戻${back.length}B)`);
      if (!okv) die("照合失敗。再試行してください。");
      console.log("\n==> 完了。MSX の RESET スイッチを押す(または電源OFF/ON)と、書き込んだROMで起動します。");
      console.log("    ※リセットはハードがRESTで公開していないため、ここだけ手動操作です。");
      break;
    }
    case "deploy-file": {
      const file = pos[0] || die("ローカルファイルが必要です");
      const fs = await import("node:fs");
      const buf = fs.readFileSync(file);
      const name = pos[1] || file.split("/").pop();
      process.stdout.write(`ディスクへ配置: ${file} (${buf.length}B) -> ${name}... `);
      await req("POST", `/fat/files/${encodeURI(name)}`, { body: buf });
      console.log("ok");
      console.log(`\n==> 完了。MSX を RESET して Nextor 起動後、"${name}" を実行してください。`);
      console.log('    (BASIC なら例: LOAD"A:' + name + '",R / DOS なら名前を入力)');
      break;
    }
    default:
      console.log(readHelp());
      if (cmd && cmd !== "help") process.exit(2);
  }
}

function readHelp() {
  return `ESERAMair CLI — FunctionBASIC 実機デプロイ用 (http:8080, 認証なし/同時1req)
使い方: node --experimental-strip-types eseramair.mjs <command> [args] [--host H] [--port P] [--yes]
  hello | status
  ram-clear [--start S][--size N]           RAMクリア(0埋め) ※--yes
  ram-fill --data D [--start S][--size N]    ※--yes
  ram-read <out> [--start S][--size N]       SRAM吸出し
  ram-write <file> [--start S]              ROM焼き込み(SRAM生書き) ※--yes
  ls [path] | put <file> [name] | get <name> [out] | rm <name> ※--yes | mkdir <dir> | mv <src> <dst>
  format ※--yes
  deploy-rom <rom> [--no-clear]             クリア+書込+照合+RESET案内 ※--yes
  deploy-file <file> [name]                 ディスク配置+案内
host 既定: ${HOST}:${PORT} (ESERAMAIR_HOST/PORT か --host/--port で変更)
注意: MSXリセットはRESTに無いため手動(物理RESET/電源)。破壊的操作は --yes 必須。`;
}

await main();
