// ============================================================================
//  ZenScriptsAI — local / Render backend
//  Zero-dependency Node.js server (Node 18+).
//  - Serves the landing page (files/index.html) at /
//  - POST /api/generate → AI script generation (logic lives in lib/generate.js)
//
//  Environment variables:
//    LLM_API_KEY or OPENAI_API_KEY   required for /api/generate
//    LLM_BASE_URL                    default https://api.openai.com/v1
//    LLM_MODEL                       default gemini-2.0-flash
//    PORT                            default 3000
//
//  Run:  node server.js   →  http://localhost:3000
//  This exact file is also the entrypoint for Render web services.
// ============================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---- tiny .env loader (no dependencies) — MUST run before requiring lib,
//      because lib/generate.js reads the environment at module load.
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch (_) {
    /* no .env file — fine */
  }
})();

const { handleGenerate } = require("./lib/generate");
const { handlePay } = require("./lib/pay");
const { handleAuth } = require("./lib/auth");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HTML_CANDIDATES = [
  path.join(__dirname, "files", "index.html"),
  path.join(__dirname, "files", "zenscriptai-landing.html")
];
const HTML_PATH = HTML_CANDIDATES.find((p) => fs.existsSync(p)) || HTML_CANDIDATES[0];

// ---- HTTP helpers -------------------------------------------------------------

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        const err = new Error("Payload too large");
        err.status = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---- API handlers ---------------------------------------------------------------

async function handleApi(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "Method not allowed — use POST" }); return; }
  let body;
  try {
    body = JSON.parse(await readBody(req, 20000));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body: " + (e && e.message ? e.message : e) });
    return;
  }
  const { status, json } = await handleGenerate(body);
  sendJson(res, status, json);
}

async function handlePayApi(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "Method not allowed — use POST" }); return; }
  let body;
  try {
    body = JSON.parse(await readBody(req, 10000));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }
  const { status, json } = await handlePay(String(body.action || ""), body);
  sendJson(res, status, json);
}

async function handleAuthApi(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "Method not allowed — use POST" }); return; }
  let body;
  try {
    body = JSON.parse(await readBody(req, 10000));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }
  const { status, json } = await handleAuth(String(body.action || ""), body);
  sendJson(res, status, json);
}

// ---- server ------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  try {
    if (pathname === "/api/generate") { await handleApi(req, res); return; }
    if (pathname === "/api/pay") { await handlePayApi(req, res); return; }
    if (pathname === "/api/auth") { await handleAuthApi(req, res); return; }
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html" || pathname === "/zenscriptai-landing.html")) {
      const html = fs.readFileSync(HTML_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(html);
      return;
    }
    if (pathname.startsWith("/api/")) { sendJson(res, 404, { ok: false, error: "Unknown endpoint" }); return; }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found. ZenScriptsAI backend exposes: GET /  ·  POST /api/generate  ·  POST /api/pay  ·  POST /api/auth\n");
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "Internal server error: " + (err && err.message ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log("ZenScriptsAI server running at http://localhost:" + PORT);
  if (!process.env.LLM_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log("WARNING: no LLM_API_KEY / OPENAI_API_KEY set — /api/generate returns 503.");
    console.log("         The landing page will automatically fall back to its offline engine.");
  }
});
