const LF = {
  STORAGE: {
    VARIANTS: "lf_variants",
    DRAFT: "lf_draft",
    CAPTURE: "lf_capture",
    SETTINGS: "lf_settings"
  },

  emptyVariant() {
    return {
      id: LF.uid(),
      name: "",
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sku: { enabled: false, prefix: "", next: 1, pad: 0 },
      styleCode: { enabled: false, prefix: "", next: 1, pad: 0 },
      fields: []
    };
  },

  uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "lf_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  },

  counterText(cfg) {
    if (!cfg || !cfg.enabled) return "";
    const n = Number(cfg.next) || 1;
    const pad = Number(cfg.pad) || 0;
    const num = pad > 0 ? String(n).padStart(pad, "0") : String(n);
    return `${cfg.prefix || ""}${num}`;
  },

  isSizeField(field) {
    if (!field) return false;
    if (field.kind === "size") return true;
    return /\bsize\b/i.test(field.label || "") && !/size\s*chart/i.test(field.label || "");
  },

  isSkuField(field) {
    if (!field) return false;
    if (field.kind === "sku") return true;
    return /\bsku\b/i.test(field.label || "");
  },

  isStyleField(field) {
    if (!field) return false;
    if (field.kind === "styleCode") return true;
    return /style\s*code|product\s*id|style\s*id/i.test(field.label || "");
  },

  sortForFill(fields) {
    const rank = (f) => (LF.isSizeField(f) ? 0 : 1);
    return [...(fields || [])].sort((a, b) => rank(a) - rank(b));
  },

  async get(key, fallback) {
    const data = await chrome.storage.local.get(key);
    return data[key] === undefined ? fallback : data[key];
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async getVariants() {
    const list = await LF.get(LF.STORAGE.VARIANTS, []);
    return Array.isArray(list) ? list : [];
  },

  async saveVariants(list) {
    await LF.set(LF.STORAGE.VARIANTS, list);
  },

  async getDraft() {
    return await LF.get(LF.STORAGE.DRAFT, null);
  },

  async saveDraft(draft) {
    await LF.set(LF.STORAGE.DRAFT, draft);
  },

  clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
};

if (typeof window !== "undefined") window.LF = LF;
if (typeof self !== "undefined") self.LF = LF;
