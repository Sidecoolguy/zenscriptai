// ============================================================================
//  ZenScriptsAI — shared Premium payment logic (zero-dependency)
//  Used by: server.js (local / Render), api/pay.js (Vercel),
//           netlify/functions/pay.js (Netlify)
//
//  Environment variables:
//    STRIPE_SECRET_KEY   required for real checkout (Stripe API key)
//    STRIPE_PRICE_ID     required — recurring price created in the Stripe dashboard
//    SITE_URL            base URL of your site (used for the checkout success URL)
//    PREMIUM_CODES       optional comma-separated redeem codes, e.g. "TEST-ABC,LAUNCH-2024"
//
//  Endpoints (single POST /api/pay with JSON body { action, ... }):
//    { action: "create-checkout", email? } → { ok, url }   redirect to Stripe Checkout
//    { action: "confirm", session_id }     → { ok }        verify a Stripe session is paid
//    { action: "redeem", code }            → { ok }        redeem a PREMIUM_CODES code
//
//  NOTE: production-grade verification uses Stripe webhooks (checkout.session.completed).
//  The confirm endpoint covers the common MVP flow (redirect back from Checkout).
// ============================================================================

const { setPremium } = require("./auth");

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const SITE_URL = (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
const CODES = (process.env.PREMIUM_CODES || "")
  .split(",")
  .map(function (s) { return s.trim().toUpperCase(); })
  .filter(Boolean);

function stripeAuth() {
  return "Basic " + Buffer.from(STRIPE_KEY + ":").toString("base64");
}

function paymentsConfigured() {
  return !!(STRIPE_KEY && PRICE_ID);
}

// ---- create Stripe Checkout session → returns hosted checkout URL -------------

async function createCheckout(email) {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", PRICE_ID);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", SITE_URL + "/?premium=success&session_id={CHECKOUT_SESSION_ID}");
  form.set("cancel_url", SITE_URL + "/#pricing");
  if (typeof email === "string" && email.includes("@")) form.set("customer_email", email);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { "Authorization": stripeAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : "Stripe error " + res.status;
    throw new Error(msg);
  }
  if (!data.url) throw new Error("Stripe returned no checkout URL");
  return data.url;
}

// ---- verify a Stripe Checkout session is paid -----------------------------------

async function confirmSession(sessionId) {
  const id = String(sessionId || "");
  if (!/^cs_/.test(id)) return false;
  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(id), {
      headers: { "Authorization": stripeAuth() }
    });
    const data = await res.json().catch(function () { return {}; });
    return res.ok && data.payment_status === "paid";
  } catch (e) {
    return false;
  }
}

// ---- redeem a shared code --------------------------------------------------------

function redeem(code) {
  const c = String(code || "").trim().toUpperCase();
  return CODES.includes(c);
}

// ---- unified handler ---------------------------------------------------------------
// Returns { status, json } — identical shape for every host (http, Vercel, Netlify).

async function handlePay(action, payload) {
  switch (action) {
    case "create-checkout": {
      if (!paymentsConfigured()) {
        return { status: 503, json: { ok: false, error: "Payments are not configured yet — the site owner needs to set STRIPE_SECRET_KEY and STRIPE_PRICE_ID." } };
      }
      try {
        const url = await createCheckout(payload && payload.email);
        return { status: 200, json: { ok: true, url: url } };
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        return { status: 502, json: { ok: false, error: "Checkout could not be started: " + msg.slice(0, 300) } };
      }
    }
    case "confirm": {
      const paid = await confirmSession(payload && payload.session_id);
      const json = { ok: !!paid };
      if (paid && payload && payload.token && setPremium(payload.token, true)) json.accountPremium = true;
      return { status: 200, json: json };
    }
    case "redeem": {
      if (!redeem(payload && payload.code)) return { status: 200, json: { ok: false, error: "Invalid or expired code." } };
      const json = { ok: true };
      if (payload && payload.token && setPremium(payload.token, true)) json.accountPremium = true;
      return { status: 200, json: json };
    }
    default:
      return { status: 404, json: { ok: false, error: "Unknown payment action." } };
  }
}

module.exports = { handlePay, createCheckout, confirmSession, redeem, paymentsConfigured };
