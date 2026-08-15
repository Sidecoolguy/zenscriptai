// Vercel serverless function — POST /api/pay
// Body: { action: "create-checkout" | "confirm" | "redeem", ... }
const { handlePay } = require("../lib/pay");

module.exports = async function pay(req, res) {
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
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }
  const { status, json } = await handlePay(String(body.action || ""), body);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(status).json(json);
};

module.exports.config = { maxDuration: 60 };
