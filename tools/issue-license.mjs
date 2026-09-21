#!/usr/bin/env node
import { createHmac } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(fileURLToPath(import.meta.url));
const cfg = readFileSync(join(root, "..", "license-config.js"), "utf8");
const secret = cfg.match(/signingSecret:\s*"([^"]+)"/)?.[1];
if (!secret || secret.includes("change-this")) {
  console.error("Set a unique signingSecret in license-config.js before issuing keys.");
  process.exit(1);
}

const plan = process.argv[2] || "monthly";
const days = plan === "yearly" ? 366 : plan === "lifetime" ? 3650 : 31;
const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
const sig = createHmac("sha256", secret).update(`${plan}|${expiresAt}`).digest("hex").slice(0, 20);
const key = `LF1.${plan}.${expiresAt}.${sig}`;
console.log(key);
console.log("Expires:", new Date(expiresAt).toISOString().slice(0, 10));
