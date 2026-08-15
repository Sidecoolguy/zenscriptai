// Netlify function — exposed at /api/pay via the redirect in netlify.toml.
// Body: { action: "create-checkout" | "confirm" | "redeem", ... }
const { handlePay } = require("../../lib/pay");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok: false, error: "Method not allowed — use POST" }) };
  }
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "Invalid JSON body" }) };
  }
  const { status, json } = await handlePay(String(body.action || ""), body);
  return { statusCode: status, headers: CORS, body: JSON.stringify(json) };
};
