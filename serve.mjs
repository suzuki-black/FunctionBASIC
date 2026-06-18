// 依存ゼロの静的サーバ（エディタ開発用）。`npm run serve` → http://localhost:8123/editor/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "editor");
const PORT = process.env.PORT || 8123;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") url = "/index.html";
    if (url.endsWith("/")) url += "index.html";
    const path = join(ROOT, normalize(url));
    if (!path.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
  }
}).listen(PORT, () => console.log(`serving ${ROOT} → http://localhost:${PORT}/editor/`));
