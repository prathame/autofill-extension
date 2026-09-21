(function () {
  const KEY = "lf_license";
  const DEVICE = "lf_device_id";

  function serverUrl() {
    const u = typeof LF_BILLING !== "undefined" ? LF_BILLING.licenseServerUrl : "";
    return String(u || "").replace(/\/$/, "");
  }

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

  async function deviceId() {
    let id = await LF.get(DEVICE, null);
    if (!id) {
      id = crypto.randomUUID();
      await LF.set(DEVICE, id);
    }
    return id;
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

  async function api(path, body) {
    const res = await fetch(`${serverUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { http: res.status, data };
  }

  async function confirmDevice(state) {
    if (!state.license) return { ok: false };
    if (!serverUrl()) return { ok: true };
    const device = await deviceId();
    try {
      const { data } = await api("/v1/check", { key: state.license.key, deviceId: device });
      if (data.ok) {
        state.lastServerOk = Date.now();
        await saveState(state);
        return { ok: true };
      }
      delete state.license;
      await saveState(state);
      return { ok: false, error: data.error || "This key is already used on another computer." };
    } catch {
      const grace = ((typeof LF_BILLING !== "undefined" && LF_BILLING.offlineGraceHours) || 48) * 3600 * 1000;
      if (state.lastServerOk && Date.now() - state.lastServerOk < grace) return { ok: true };
      return { ok: false, error: "Could not verify this license. Check the license server." };
    }
  }

  async function status() {
    const state = await getState();
    const now = Date.now();
    if (state.license && state.license.expiresAt > now) {
      const live = await confirmDevice(state);
      if (live.ok) {
        return {
          ok: true,
          plan: "pro",
          label: "PRO",
          until: state.license.expiresAt,
          license: state.license
        };
      }
    }
    const end = trialEnds(state);
    if (now < end) {
      const daysLeft = Math.max(1, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
      return { ok: true, plan: "trial", label: "TRIAL", until: end, daysLeft };
    }
    return { ok: false, plan: "expired", label: "LOCKED", until: end };
  }

  async function activate(rawKey) {
    const parsed = await parseKey(rawKey);
    if (!parsed) return { ok: false, error: "Invalid license key." };
    if (parsed.expiresAt <= Date.now()) return { ok: false, error: "This license has expired." };
    const device = await deviceId();
    if (serverUrl()) {
      try {
        const { data } = await api("/v1/activate", { key: parsed.key, deviceId: device });
        if (!data.ok) return { ok: false, error: data.error || "Could not activate this key." };
      } catch {
        return { ok: false, error: "License server is not running. Start it before activating." };
      }
    }
    const state = await getState();
    state.license = {
      key: parsed.key,
      plan: parsed.plan,
      expiresAt: parsed.expiresAt,
      activatedAt: Date.now(),
      deviceId: device
    };
    state.lastServerOk = Date.now();
    await saveState(state);
    return { ok: true, license: state.license };
  }

  async function recordFill() {
    const state = await getState();
    state.fills = (state.fills || 0) + 1;
    await saveState(state);
  }

  window.LFLicense = { status, activate, recordFill, getState, parseKey, deviceId };
})();
