// Локальный запуск CRM без Cloudflare: статические файлы из public/ и сервер src/worker.js на базе в памяти.
// node test/devserver.mjs [порт] — ключ входа: dev-key-123456. Данные пропадают при остановке.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import worker from "../src/worker.js";
import { openD1 } from "./d1.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const CSP = (await readFile(new URL("../public/_headers", import.meta.url), "utf8")).match(/Content-Security-Policy: (.*)/)[1];
const env = { DB: openD1(), CRM_KEY: process.env.CRM_KEY || "dev-key-123456" };
const port = +(process.argv[2] || 8799);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + port);
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    const h = Object.fromEntries(r.headers);
    if (h["set-cookie"]) h["set-cookie"] = h["set-cookie"].replace("; Secure", ""); // локально без https
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const path = url.pathname === "/" ? "/index.html" : url.pathname, ext = path.slice(path.lastIndexOf("."));
  try {
    if (!/^\/[\w.-]+$/.test(path) || path === "/_headers") throw new Error("no");
    const body = await readFile(new URL("../public" + path, import.meta.url));
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "content-security-policy": CSP, "x-content-type-options": "nosniff" }); res.end(body);
  } catch (e) { res.writeHead(404); res.end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log("CRM: http://127.0.0.1:" + port + " · ключ " + env.CRM_KEY));
