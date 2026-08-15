// Vercel serverless function — exposed at POST /api/generate
// (Vercel maps every file in api/ to a function route automatically.)
const { handleGenerate } = require("../lib/generate");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

module.exports = async function generate(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed — use POST" });
    return;
  }
  let payload = {};
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }
  const { status, json } = await handleGenerate(payload);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(status).json(json);
};

// LLM calls can take longer than the default 10s (hobby) limit.
module.exports.config = { maxDuration: 60 };
