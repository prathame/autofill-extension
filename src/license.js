(function () {
  const KEY = "lf_license";

  async function sign(text) {
    const secret = (typeof LF_BILLING !== "undefined" && LF_BILLING.signingSecret) || "";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
  }

  async function parseKey(raw) {
    const key = String(raw || "").trim();
    const parts = key.split(".");
    if (parts.length !== 4 || parts[0] !== "LF1") return null;
    const [, plan, expRaw, sig] = parts;
    const expiresAt = Number(expRaw);
    if (!plan || !expiresAt) return null;
    const expect = await sign(`${plan}|${expiresAt}`);
    if (expect !== sig) return null;
    return { plan, expiresAt, key };
  }

  async function getState() {
    const data = (await LF.get(KEY, null)) || {};
    if (!data.trialStartedAt) {
      data.trialStartedAt = Date.now();
      data.fills = data.fills || 0;
      await LF.set(KEY, data);
    }
    return data;
  }

  async function saveState(data) {
    await LF.set(KEY, data);
  }

  function trialEnds(state) {
    const days = (typeof LF_BILLING !== "undefined" && LF_BILLING.trialDays) || 5;
    return state.trialStartedAt + days * 24 * 60 * 60 * 1000;
  }

  async function status() {
    const state = await getState();
    const now = Date.now();
    if (state.license && state.license.expiresAt > now) {
      return {
        ok: true,
        plan: "pro",
        label: "PRO",
        until: state.license.expiresAt,
        license: state.license
      };
    }
    const end = trialEnds(state);
    if (now < end) {
      const daysLeft = Math.max(1, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
      return {
        ok: true,
        plan: "trial",
        label: "TRIAL",
        until: end,
        daysLeft
      };
    }
    return { ok: false, plan: "expired", label: "LOCKED", until: end };
  }

  async function activate(rawKey) {
    const parsed = await parseKey(rawKey);
    if (!parsed) return { ok: false, error: "Invalid license key." };
    if (parsed.expiresAt <= Date.now()) return { ok: false, error: "This license has expired." };
    const state = await getState();
    state.license = {
      key: parsed.key,
      plan: parsed.plan,
      expiresAt: parsed.expiresAt,
      activatedAt: Date.now()
    };
    await saveState(state);
    return { ok: true, license: state.license };
  }

  async function recordFill() {
    const state = await getState();
    state.fills = (state.fills || 0) + 1;
    await saveState(state);
  }

  window.LFLicense = { status, activate, recordFill, getState, parseKey };
})();
