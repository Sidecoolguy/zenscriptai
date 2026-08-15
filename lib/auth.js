// ============================================================================
//  ZenScriptsAI — shared account & session logic (zero-dependency)
//  Used by: server.js (local / Render), api/auth.js (Vercel),
//           netlify/functions/auth.js (Netlify)
//
//  Endpoints (single POST /api/auth with JSON body { action, ... }):
//    { action: "register", name?, email, password } → { ok, token, user }
//    { action: "login",    email, password }        → { ok, token, user }
//    { action: "me",       token }                  → { ok, user }
//    { action: "logout",   token }                  → { ok }
//
//  Storage: a JSON file store under DATA_DIR (default ./data), written with the
//  fresh-filename checkpoint pattern (data/users-<ts>.json; the newest file is
//  authoritative). Passwords are hashed with scrypt; tokens are random 48-hex.
//
//  DEPLOYMENT NOTE: file storage works for local runs and hosts with a writable
//  disk (Render paid plans with attached disks). On Vercel/Netlify the filesystem
//  is ephemeral — sessions/users reset on cold start. For durable accounts there,
//  swap loadStore/saveStore for a hosted database (Supabase, Turso, ...) — the
//  rest of this module is storage-agnostic.
// ============================================================================

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- storage (checkpoint pattern — never overwrite an existing store file) ----

function loadStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) return { users: [], tokens: {} };
    const files = fs.readdirSync(DATA_DIR)
      .filter(function (f) { return /^users-\d+\.json$/.test(f); })
      .sort();
    if (!files.length) return { users: [], tokens: {} };
    const raw = fs.readFileSync(path.join(DATA_DIR, files[files.length - 1]), "utf8");
    const d = JSON.parse(raw);
    return {
      users: Array.isArray(d.users) ? d.users : [],
      tokens: d.tokens && typeof d.tokens === "object" ? d.tokens : {}
    };
  } catch (e) {
    return { users: [], tokens: {} };
  }
}

function saveStore(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, "users-" + Date.now() + ".json");
    fs.writeFileSync(file, JSON.stringify(store));
    return file;
  } catch (e) {
    return null;
  }
}

// ---- crypto helpers -------------------------------------------------------------

function hashPass(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString("hex");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const ba = Buffer.from(a, "hex"), bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function newToken() { return crypto.randomBytes(24).toString("hex"); }

function sanitize(s, n) { return typeof s === "string" ? s.trim().slice(0, n) : ""; }

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, premium: !!u.premium, premiumSince: u.premiumSince || null };
}

// ---- operations -------------------------------------------------------------------

function register(payload) {
  const email = sanitize(payload && payload.email, 80).toLowerCase();
  const name = sanitize(payload && payload.name, 40);
  const pw = String((payload && payload.password) || "");
  if (!EMAIL_RE.test(email)) return { status: 400, json: { ok: false, error: "Please enter a valid email address." } };
  if (pw.length < 8) return { status: 400, json: { ok: false, error: "Password must be at least 8 characters." } };
  const store = loadStore();
  if (store.users.some(function (u) { return u.email === email; })) {
    return { status: 409, json: { ok: false, error: "An account with this email already exists." } };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: crypto.randomBytes(8).toString("hex"),
    email: email,
    name: name || email.split("@")[0],
    passHash: hashPass(pw, salt),
    salt: salt,
    premium: false,
    createdAt: new Date().toISOString()
  };
  store.users.push(user);
  const token = newToken();
  store.tokens[token] = user.id;
  saveStore(store);
  return { status: 200, json: { ok: true, token: token, user: publicUser(user) } };
}

function login(payload) {
  const email = sanitize(payload && payload.email, 80).toLowerCase();
  const pw = String((payload && payload.password) || "");
  const store = loadStore();
  const user = store.users.find(function (u) { return u.email === email; });
  if (!user || !safeEqual(hashPass(pw, user.salt), user.passHash)) {
    return { status: 401, json: { ok: false, error: "Incorrect email or password." } };
  }
  const token = newToken();
  store.tokens[token] = user.id;
  saveStore(store);
  return { status: 200, json: { ok: true, token: token, user: publicUser(user) } };
}

function logout(payload) {
  const token = payload && payload.token;
  if (token) {
    const store = loadStore();
    if (store.tokens[token]) {
      delete store.tokens[token];
      saveStore(store);
    }
  }
  return { status: 200, json: { ok: true } };
}

function me(payload) {
  const user = findUserByToken(payload && payload.token);
  if (!user) return { status: 401, json: { ok: false, error: "Session expired. Please log in again." } };
  return { status: 200, json: { ok: true, user: publicUser(user) } };
}

// ---- used by lib/pay.js to link Premium to an account ------------------------------

function findUserByToken(token) {
  if (!token || typeof token !== "string") return null;
  const store = loadStore();
  const id = store.tokens[token];
  if (!id) return null;
  return store.users.find(function (u) { return u.id === id; }) || null;
}

function setPremium(token, premium) {
  const store = loadStore();
  const id = token ? store.tokens[token] : null;
  if (!id) return false;
  const user = store.users.find(function (u) { return u.id === id; });
  if (!user) return false;
  user.premium = !!premium;
  user.premiumSince = user.premiumSince || new Date().toISOString();
  saveStore(store);
  return true;
}

// ---- unified handler ------------------------------------------------------------------
// Returns { status, json } — identical shape for every host (http, Vercel, Netlify).

function handleAuth(action, payload) {
  switch (action) {
    case "register": return register(payload);
    case "login": return login(payload);
    case "logout": return logout(payload);
    case "me": return me(payload);
    default: return { status: 404, json: { ok: false, error: "Unknown auth action." } };
  }
}

module.exports = { handleAuth, findUserByToken, setPremium, register, login, logout, me };
