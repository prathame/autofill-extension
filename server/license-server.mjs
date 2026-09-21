#!/usr/bin/env node
import { createHmac, randomBytes } from "crypto";
import { createServer } from "http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfgSrc = existsSync(join(root, "license-config.js"))
  ? readFileSync(join(root, "license-config.js"), "utf8")
  : "";
const signingSecret =
  process.env.SIGNING_SECRET || cfgSrc.match(/signingSecret:\s*"([^"]+)"/)?.[1] || "";
const maxDevices = Number(process.env.MAX_DEVICES || cfgSrc.match(/maxDevices:\s*(\d+)/)?.[1] || 1) || 1;
const DAYS = { monthly: 31, yearly: 366, lifetime: 3650 };

const dataDir = process.env.DATA_DIR || join(root, "server", "data");
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, "licenses.json");
const tokenPath = join(dataDir, "admin.token");

if (!existsSync(tokenPath)) {
  writeFileSync(tokenPath, randomBytes(18).toString("hex"), "utf8");
}
const adminToken = process.env.LICENSE_ADMIN_TOKEN || readFileSync(tokenPath, "utf8").trim();

let pool = null;

async function initStore() {
  if (!process.env.DATABASE_URL) return;
  const { default: pg } = await import("pg");
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  await pool.query("CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v text NOT NULL)");
}

async function loadDb() {
  if (pool) {
    const r = await pool.query("SELECT v FROM kv WHERE k = $1", ["licenses"]);
    if (!r.rows[0]) return { keys: {} };
    return JSON.parse(r.rows[0].v);
  }
  try {
    return JSON.parse(readFileSync(dbPath, "utf8"));
  } catch {
    return { keys: {} };
  }
}

async function saveDb(db) {
  const payload = JSON.stringify(db);
  if (pool) {
    await pool.query(
      "INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
      ["licenses", payload]
    );
    return;
  }
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function hmac(text) {
  return createHmac("sha256", signingSecret).update(text).digest("hex").slice(0, 20);
}

function verifyKey(raw) {
  const key = String(raw || "").trim();
  const parts = key.split(".");
  if (parts.length !== 4 || parts[0] !== "LF1") return null;
  const [, plan, expRaw, sig] = parts;
  const expiresAt = Number(expRaw);
  if (!plan || !expiresAt || hmac(`${plan}|${expiresAt}`) !== sig) return null;
  if (expiresAt <= Date.now()) return null;
  return { key, plan, expiresAt };
}

function mint(plan) {
  const days = DAYS[plan] || 31;
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  const sig = hmac(`${plan}|${expiresAt}`);
  return { key: `LF1.${plan}.${expiresAt}.${sig}`, plan, expiresAt };
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-admin-token",
    "access-control-allow-methods": "GET, POST, OPTIONS"
  });
  res.end(data);
}

function sendFile(res, filePath, type) {
  if (!existsSync(filePath)) return false;
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(readFileSync(filePath));
  return true;
}

function isAdmin(req) {
  return (req.headers["x-admin-token"] || "") === adminToken;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, maxDevices, persist: pool ? "postgres" : "file" });
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/admin/")) {
      return sendFile(res, join(root, "admin", "index.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/popup.css") {
      return sendFile(res, join(root, "popup.css"), "text/css; charset=utf-8");
    }

    const body = req.method === "POST" ? await readBody(req) : {};
    const db = await loadDb();

    if (req.method === "POST" && url.pathname === "/v1/issue") {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: "Admin token required." });
      const plan = body.plan || "monthly";
      const issued = mint(plan);
      db.keys[issued.key] = {
        plan: issued.plan,
        expiresAt: issued.expiresAt,
        devices: [],
        revoked: false,
        issuedAt: Date.now()
      };
      await saveDb(db);
      return json(res, 200, { ok: true, ...issued, expires: new Date(issued.expiresAt).toISOString().slice(0, 10) });
    }

    if (req.method === "POST" && url.pathname === "/v1/activate") {
      const parsed = verifyKey(body.key);
      const deviceId = String(body.deviceId || "").trim();
      if (!parsed) return json(res, 400, { ok: false, error: "Invalid or expired key." });
      if (!deviceId) return json(res, 400, { ok: false, error: "Missing device id." });
      const rec = db.keys[parsed.key];
      if (!rec) {
        return json(res, 403, { ok: false, error: "This key was not issued. Pay and request a key from support." });
      }
      if (rec.revoked) return json(res, 403, { ok: false, error: "This key was revoked." });
      if (rec.expiresAt <= Date.now()) return json(res, 403, { ok: false, error: "This license has expired." });
      const existing = rec.devices.find((d) => d.id === deviceId);
      if (existing) {
        existing.lastSeen = Date.now();
        await saveDb(db);
        return json(res, 200, { ok: true, plan: rec.plan, expiresAt: rec.expiresAt });
      }
      if (rec.devices.length >= maxDevices) {
        return json(res, 403, {
          ok: false,
          error: "This key is already active on another computer. Ask support to reset the device."
        });
      }
      rec.devices.push({ id: deviceId, firstSeen: Date.now(), lastSeen: Date.now() });
      await saveDb(db);
      return json(res, 200, { ok: true, plan: rec.plan, expiresAt: rec.expiresAt });
    }

    if (req.method === "POST" && url.pathname === "/v1/check") {
      const parsed = verifyKey(body.key);
      const deviceId = String(body.deviceId || "").trim();
      if (!parsed || !deviceId) return json(res, 400, { ok: false, error: "Invalid key." });
      const rec = db.keys[parsed.key];
      if (!rec) return json(res, 403, { ok: false, error: "Unknown key." });
      if (rec.revoked) return json(res, 403, { ok: false, error: "This key was revoked." });
      const hit = rec.devices.find((d) => d.id === deviceId);
      if (!hit) {
        return json(res, 403, { ok: false, error: "This key is registered to a different computer." });
      }
      hit.lastSeen = Date.now();
      await saveDb(db);
      return json(res, 200, { ok: true, plan: rec.plan, expiresAt: rec.expiresAt });
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/lookup") {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: "Admin token required." });
      const rec = db.keys[String(body.key || "").trim()];
      if (!rec) return json(res, 404, { ok: false, error: "Key not found." });
      return json(res, 200, {
        ok: true,
        plan: rec.plan,
        expiresAt: rec.expiresAt,
        revoked: rec.revoked,
        deviceCount: rec.devices.length,
        devices: rec.devices.map((d) => ({ id: d.id.slice(0, 8) + "…", lastSeen: d.lastSeen }))
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/reset") {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: "Admin token required." });
      const rec = db.keys[String(body.key || "").trim()];
      if (!rec) return json(res, 404, { ok: false, error: "Key not found." });
      rec.devices = [];
      await saveDb(db);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/revoke") {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: "Admin token required." });
      const rec = db.keys[String(body.key || "").trim()];
      if (!rec) return json(res, 404, { ok: false, error: "Key not found." });
      rec.revoked = true;
      await saveDb(db);
      return json(res, 200, { ok: true });
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, error: "Server error" });
  }
});

if (!signingSecret || signingSecret.includes("change-this")) {
  console.error("Set SIGNING_SECRET (same value as license-config.js).");
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to your Neon Postgres connection string.");
  process.exit(1);
}

await initStore();

const port = Number(process.env.PORT || 8788);
server.listen(port, "0.0.0.0", () => {
  console.log(`ListFill license server on port ${port}`);
  console.log(`Admin: http://0.0.0.0:${port}/admin/`);
  console.log(`Admin token: ${adminToken}`);
  console.log(`Store: ${pool ? "postgres" : "file"}`);
  console.log(`Max devices per key: ${maxDevices}`);
});
