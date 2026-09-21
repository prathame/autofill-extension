const $ = (id) => document.getElementById(id);

let draft = null;
let meeshoTab = null;
let capturing = false;
const KIND_LABEL = {
  text: "Text",
  textarea: "Rich Text",
  select: "Dropdown",
  size: "Pill",
  checkbox: "Toggle",
  sku: "SKU",
  styleCode: "Style",
  file: "Image",
  radio: "Toggle"
};

function show(id) {
  $("view-home").classList.toggle("hidden", id !== "home");
  $("view-editor").classList.toggle("hidden", id !== "editor");
  $("view-account").classList.toggle("hidden", id !== "account");
  $("tab-home").classList.toggle("tab-on", id === "home");
  $("tab-editor").classList.toggle("tab-on", id === "editor");
  $("tab-account").classList.toggle("tab-on", id === "account");
  $("btn-fill-current").classList.toggle("hidden", id !== "editor");
  $("btn-save").classList.toggle("hidden", id !== "editor");
}

function planTitle(plan) {
  return (
    {
      monthly: "Monthly",
      yearly: "Yearly",
      lifetime: "Lifetime",
      trial: "Free trial",
      expired: "Expired"
    }[plan] || plan || "—"
  );
}

function fmtDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function initialsFrom(name) {
  const parts = String(name || "LF")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "LF";
  return parts
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function renderProfile(access) {
  const name = access.name || (access.plan === "pro" ? "Pro member" : "You");
  $("profile-name").textContent = name;
  $("profile-initials").textContent = initialsFrom(name);
  $("profile-label").textContent = access.label || "—";
  $("profile-plan").textContent = planTitle(access.productPlan || access.plan);
  $("profile-until").textContent = fmtDate(access.until);
  $("profile-left").textContent =
    access.plan === "expired"
      ? "Ended"
      : access.daysLeft === 1
        ? "1 day"
        : `${access.daysLeft || 0} days`;
  $("profile-fills").textContent = String(access.fills || 0);
  $("profile-key").textContent = access.keyMasked || "No key on this computer";
  if (access.plan === "pro") {
    $("profile-status").textContent = "Pro · this computer is licensed";
    $("btn-profile-upgrade").classList.add("hidden");
    $("btn-profile-key").textContent = "Replace license key";
  } else if (access.plan === "trial") {
    $("profile-status").textContent = `${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"} left in free trial`;
    $("btn-profile-upgrade").classList.remove("hidden");
    $("btn-profile-upgrade").textContent = "Upgrade to Pro";
    $("btn-profile-key").textContent = "I already have a key";
  } else {
    $("profile-status").textContent = "Trial ended · Autofill is locked";
    $("btn-profile-upgrade").classList.remove("hidden");
    $("btn-profile-upgrade").textContent = "Subscribe";
    $("btn-profile-key").textContent = "Activate license key";
  }
}

function status(text, bad) {
  const el = $("status");
  if (!text) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.classList.toggle("bad", !!bad);
  el.textContent = text;
  if (!bad) setTimeout(() => el.classList.add("hidden"), 3200);
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function bindContactLinks() {
  const email = LF_BILLING.email || "prathameshbusa@gmail.com";
  const phone = LF_BILLING.phone || "8806907616";
  const mail = $("contact-email");
  const tel = $("contact-phone");
  if (mail) {
    mail.href = `mailto:${email}?subject=${encodeURIComponent("ListFill Pro license")}`;
    mail.textContent = email;
  }
  if (tel) {
    const num = digits(phone);
    tel.href = `tel:+${num.length === 10 ? "91" + num : num}`;
    tel.textContent = phone;
  }
}

async function refreshPlanUI() {
  if (typeof LFLicense === "undefined") return;
  const access = await LFLicense.status();
  const badge = $("plan-badge");
  const price = $("pay-price");
  const year = $("pay-year");
  const banner = $("plan-banner");
  if (badge) badge.textContent = access.label;
  renderProfile(access);
  if (price) price.textContent = LF_BILLING.priceLabel;
  if (year) year.textContent = LF_BILLING.yearlyLabel || "";
  bindContactLinks();
  if (!banner) return;
  if (access.plan === "pro") {
    banner.classList.add("hidden");
    banner.innerHTML = "";
  } else if (access.plan === "trial") {
    banner.classList.remove("hidden");
    banner.innerHTML = `<span>${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"} left in free trial</span><button class="btn-mini" id="btn-upgrade" type="button">Upgrade</button>`;
    $("btn-upgrade")?.addEventListener("click", () => $("paywall")?.classList.remove("hidden"));
  } else {
    banner.classList.remove("hidden");
    banner.innerHTML = `<span>Trial ended · Autofill is locked</span><button class="btn-mini" id="btn-upgrade" type="button">Subscribe</button>`;
    $("btn-upgrade")?.addEventListener("click", () => $("paywall")?.classList.remove("hidden"));
  }
}

async function requireAccess() {
  if (typeof LFLicense === "undefined" || typeof LFLicense.status !== "function") {
    return true;
  }
  const access = await LFLicense.status();
  if (access.ok) return true;
  const wall = $("paywall");
  if (wall) wall.classList.remove("hidden");
  status("Trial ended. Activate a license to Autofill.", true);
  return false;
}
window.requireAccess = requireAccess;

async function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.classList.toggle("light", next === "light");
  await chrome.storage.local.set({ lf_theme: next });
}

async function loadTheme() {
  const data = await chrome.storage.local.get("lf_theme");
  await applyTheme(data.lf_theme || "dark");
}

async function findTargetTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = (url = "") => /meesho\.com|localhost|127\.0\.0\.1/.test(url);
  if (active && ok(active.url)) return active;
  const tabs = await chrome.tabs.query({
    url: ["https://supplier.meesho.com/*", "https://*.meesho.com/*", "http://127.0.0.1/*", "http://localhost/*"]
  });
  return tabs[0] || active || null;
}

async function sendToTab(message) {
  if (!meeshoTab?.id) throw new Error("Open a Meesho Add Product page first");
  try {
    return await chrome.tabs.sendMessage(meeshoTab.id, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: meeshoTab.id },
      files: ["shared.js", "src/locator.js", "src/fill.js", "src/capture.js", "src/content.js"]
    });
    await chrome.scripting.insertCSS({
      target: { tabId: meeshoTab.id },
      files: ["src/content.css"]
    });
    return await chrome.tabs.sendMessage(meeshoTab.id, message);
  }
}

function flushFieldEdits() {
  if (!draft || !draft.fields) return;
  document.querySelectorAll("[data-edit-label]").forEach((el) => {
    const i = Number(el.getAttribute("data-edit-label"));
    if (!draft.fields[i]) return;
    draft.fields[i].label = el.value.trim();
    if (draft.fields[i].locator) draft.fields[i].locator.label = draft.fields[i].label;
  });
  document.querySelectorAll("[data-edit-value]").forEach((el) => {
    const i = Number(el.getAttribute("data-edit-value"));
    if (!draft.fields[i] || el.disabled) return;
    draft.fields[i].value = el.value;
  });
  document.querySelectorAll("[data-edit-kind]").forEach((el) => {
    const i = Number(el.getAttribute("data-edit-kind"));
    if (!draft.fields[i]) return;
    draft.fields[i].kind = el.value;
  });
}

function bindDraftInputs() {
  $("draft-name").value = draft.name || "";
  $("draft-id").textContent = "ID: " + (draft.id || "—").slice(0, 8);
  $("sku-enabled").checked = !!draft.sku?.enabled;
  $("sku-prefix").value = draft.sku?.prefix || "";
  $("sku-next").value = draft.sku?.next || 1;
  $("style-enabled").checked = !!draft.styleCode?.enabled;
  $("style-prefix").value = draft.styleCode?.prefix || "";
  $("style-next").value = draft.styleCode?.next || 1;
  syncCounterUI();
  renderFields();
}

function readDraftInputs() {
  flushFieldEdits();
  draft.name = $("draft-name").value.trim();
  draft.sku = {
    enabled: $("sku-enabled").checked,
    prefix: $("sku-prefix").value,
    next: Number($("sku-next").value) || 1,
    pad: 0
  };
  draft.styleCode = {
    enabled: $("style-enabled").checked,
    prefix: $("style-prefix").value,
    next: Number($("style-next").value) || 1,
    pad: 0
  };
  draft.updatedAt = Date.now();
}

function syncCounterUI() {
  $("sku-row").classList.toggle("hidden", !$("sku-enabled").checked);
  $("sku-preview").classList.toggle("hidden", !$("sku-enabled").checked);
  $("style-row").classList.toggle("hidden", !$("style-enabled").checked);
  $("style-preview").classList.toggle("hidden", $("style-enabled").checked);
  if ($("sku-enabled").checked) {
    $("sku-preview").textContent =
      "Next: " +
      LF.counterText({
        enabled: true,
        prefix: $("sku-prefix").value,
        next: Number($("sku-next").value) || 1
      });
  }
  $("style-preview").textContent = $("style-enabled").checked
    ? "Next: " +
      LF.counterText({
        enabled: true,
        prefix: $("style-prefix").value,
        next: Number($("style-next").value) || 1
      })
    : "Disabled";
}

function renderFields() {
  const box = $("field-list");
  const fields = draft.fields || [];
  $("field-count").textContent = String(fields.length);
  if (!fields.length) {
    box.innerHTML = `<div class="empty">No fields yet. Click “Pick fields on live page”, then tap Size first and every other field you want saved.</div>`;
    return;
  }
  box.innerHTML = fields
    .map((f, i) => {
      const auto = (draft.sku?.enabled && LF.isSkuField(f)) || (draft.styleCode?.enabled && LF.isStyleField(f));
      const shown = auto ? displayValue(f) : f.value || "";
      const kinds = ["text", "textarea", "select", "size", "checkbox", "sku", "styleCode", "file"];
      const kindOptions = kinds
        .map((k) => `<option value="${k}" ${f.kind === k ? "selected" : ""}>${KIND_LABEL[k] || k}</option>`)
        .join("");
      const valueControl =
        f.kind === "textarea"
          ? `<textarea class="input" data-edit-value="${i}" rows="3" ${auto ? "disabled" : ""}>${escapeHtml(shown)}</textarea>`
          : `<input class="input" data-edit-value="${i}" type="text" value="${escapeHtml(shown)}" ${auto ? "disabled" : ""} />`;
      return `
      <article class="field-card" data-i="${i}">
        <div class="field-top">
          <div>
            <div class="field-title">
              ${escapeHtml(f.label || "Field")}
              <span class="kind-pill">${escapeHtml(KIND_LABEL[f.kind] || f.kind || "Text")}</span>
            </div>
            <div class="field-val">${escapeHtml(shown || "—")}</div>
          </div>
          <button class="x" data-del="${i}" title="Remove" type="button">×</button>
        </div>
        <div class="field-edit hidden" data-edit-wrap="${i}">
          <input class="input" data-edit-label="${i}" type="text" value="${escapeHtml(f.label || "")}" placeholder="Field label" />
          ${valueControl}
          ${auto ? `<p class="hint-center">Auto-incremented on Autofill. Turn the SKU toggle off to type a fixed value.</p>` : ""}
          <select class="input" data-edit-kind="${i}">${kindOptions}</select>
        </div>
      </article>`;
    })
    .join("");

  const saveField = async (i, patch) => {
    const field = draft.fields[i];
    if (!field) return;
    Object.assign(field, patch);
    if (patch.label != null && field.locator) field.locator.label = patch.label;
    draft.updatedAt = Date.now();
    await persistDraft();
  };

  box.querySelectorAll(".field-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-del], input, textarea, select, button")) return;
      const wrap = card.querySelector("[data-edit-wrap]");
      wrap.classList.toggle("hidden");
    });
  });
  box.querySelectorAll("[data-edit-label]").forEach((el) => {
    el.addEventListener("change", () => saveField(Number(el.getAttribute("data-edit-label")), { label: el.value.trim() }));
  });
  box.querySelectorAll("[data-edit-value]").forEach((el) => {
    el.addEventListener("change", () => saveField(Number(el.getAttribute("data-edit-value")), { value: el.value }));
  });
  box.querySelectorAll("[data-edit-kind]").forEach((el) => {
    el.addEventListener("change", async () => {
      await saveField(Number(el.getAttribute("data-edit-kind")), { kind: el.value });
      renderFields();
    });
  });
  box.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      draft.fields.splice(Number(btn.getAttribute("data-del")), 1);
      await persistDraft();
      renderFields();
    });
  });
}

function displayValue(field) {
  if (draft.sku?.enabled && LF.isSkuField(field)) return LF.counterText(draft.sku) + " (auto)";
  if (draft.styleCode?.enabled && LF.isStyleField(field)) return LF.counterText(draft.styleCode) + " (auto)";
  return field.value || "—";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderHome() {
  const variants = await LF.getVariants();
  variants.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
  $("variant-count").textContent = String(variants.length);
  const box = $("variant-list");
  if (!variants.length) {
    box.innerHTML = `<div class="empty">No variants yet. Open Active Preset, capture a listing once, then Autofill the next catalog in one click.</div>`;
    return;
  }
  box.innerHTML = variants
    .map(
      (v) => `
      <article class="variant" data-id="${v.id}">
        <h3>${escapeHtml(v.name || "Untitled")}</h3>
        <div class="meta">${(v.fields || []).length} fields${v.sku?.enabled ? " · SKU " + escapeHtml(LF.counterText(v.sku)) : ""}</div>
        <div class="variant-actions">
          <button class="btn-glow" data-fill="${v.id}" type="button">Autofill</button>
          <button class="btn-ghost" data-edit="${v.id}" type="button">Edit</button>
          <button class="btn-ghost pin ${v.pinned ? "on" : ""}" data-pin="${v.id}" type="button">${v.pinned ? "Unpin" : "Pin"}</button>
          <button class="btn-ghost" data-del="${v.id}" type="button">Delete</button>
        </div>
      </article>`
    )
    .join("");

  box.querySelectorAll("[data-fill]").forEach((b) => b.addEventListener("click", () => fillVariant(b.getAttribute("data-fill"))));
  box.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.getAttribute("data-edit"))));
  box.querySelectorAll("[data-pin]").forEach((b) => b.addEventListener("click", () => togglePin(b.getAttribute("data-pin"))));
  box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteVariant(b.getAttribute("data-del"))));
}

async function openEditor(id) {
  if (id) {
    const variants = await LF.getVariants();
    const found = variants.find((v) => v.id === id);
    draft = found ? LF.clone(found) : LF.emptyVariant();
  } else {
    draft = (await LF.getDraft()) || LF.emptyVariant();
    if (!draft.fields) draft.fields = [];
  }
  await LF.saveDraft(draft);
  bindDraftInputs();
  show("editor");
  await refreshCaptureState();
}

async function persistDraft() {
  if (!draft) return;
  readDraftInputs();
  await LF.saveDraft(draft);
  const variants = await LF.getVariants();
  const i = variants.findIndex((v) => v.id === draft.id);
  if (i >= 0) {
    variants[i] = LF.clone(draft);
    await LF.saveVariants(variants);
  }
}

async function saveVariant() {
  await persistDraft();
  if (!draft.name) {
    status("Give this variant a name first.", true);
    return;
  }
  if (!(draft.fields || []).length) {
    status("Capture at least one field before saving.", true);
    return;
  }
  const variants = await LF.getVariants();
  const i = variants.findIndex((v) => v.id === draft.id);
  draft.updatedAt = Date.now();
  if (i >= 0) variants[i] = LF.clone(draft);
  else variants.push(LF.clone(draft));
  await LF.saveVariants(variants);
  await renderHome();
  status("Variant saved. Edited values will be used on Autofill.");
}

async function togglePin(id) {
  const variants = await LF.getVariants();
  const v = variants.find((x) => x.id === id);
  if (!v) return;
  v.pinned = !v.pinned;
  await LF.saveVariants(variants);
  await renderHome();
}

async function deleteVariant(id) {
  const variants = (await LF.getVariants()).filter((v) => v.id !== id);
  await LF.saveVariants(variants);
  await renderHome();
}

async function fillVariant(id) {
  const gate = window.requireAccess;
  if (typeof gate === "function" && !(await gate())) return;
  await persistDraft();
  const variants = await LF.getVariants();
  const variant = variants.find((v) => v.id === id);
  if (!variant) return;
  try {
    const res = await sendToTab({ type: "LF_FILL", variant: LF.clone(variant) });
    if (!res?.ok) {
      status(res?.error || "Autofill failed.", true);
      return;
    }
    if (variant.sku?.enabled && res.results?.skuUsed) variant.sku.next = (Number(variant.sku.next) || 1) + 1;
    if (variant.styleCode?.enabled && res.results?.styleUsed) variant.styleCode.next = (Number(variant.styleCode.next) || 1) + 1;
    variant.updatedAt = Date.now();
    await LF.saveVariants(variants);
    if (draft && draft.id === variant.id) {
      draft.sku = variant.sku;
      draft.styleCode = variant.styleCode;
      bindDraftInputs();
    }
    await renderHome();
    await LFLicense.recordFill();
    const missed = res.results?.failed?.length || 0;
    status(`Filled ${res.results.filled} fields${missed ? `, ${missed} missed` : ""}.`);
  } catch (err) {
    status(err.message || String(err), true);
  }
}

async function fillCurrent() {
  const gate = window.requireAccess;
  if (typeof gate === "function" && !(await gate())) return;
  await persistDraft();
  if (!draft?.name) {
    status("Name this variant first.", true);
    return;
  }
  if (!(draft.fields || []).length) {
    status("Capture at least one field first.", true);
    return;
  }
  const variants = await LF.getVariants();
  const i = variants.findIndex((v) => v.id === draft.id);
  if (i >= 0) variants[i] = LF.clone(draft);
  else variants.push(LF.clone(draft));
  await LF.saveVariants(variants);
  await fillVariant(draft.id);
}

async function refreshCaptureState() {
  capturing = false;
  try {
    const res = await sendToTab({ type: "LF_CAPTURE_STATUS" });
    capturing = !!res?.capturing;
  } catch {
    capturing = false;
  }
  $("btn-capture").classList.toggle("hidden", capturing);
  $("btn-stop-capture").classList.toggle("hidden", !capturing);
  $("btn-hide-popup").classList.toggle("hidden", !capturing);
}

async function startCapture() {
  await persistDraft();
  try {
    await sendToTab({ type: "LF_START_CAPTURE" });
    capturing = true;
    window.close();
  } catch (err) {
    status(err.message || String(err), true);
  }
}

async function stopCapture() {
  try {
    await sendToTab({ type: "LF_STOP_CAPTURE" });
  } catch {
    /* page may have navigated */
  }
  capturing = false;
  draft = (await LF.getDraft()) || draft;
  bindDraftInputs();
  await refreshCaptureState();
}

async function refreshPagePill() {
  meeshoTab = await findTargetTab();
  const pill = $("page-pill");
  const url = meeshoTab?.url || "";
  if (/supplier\.meesho\.com/.test(url)) {
    pill.textContent = "Meesho Ready";
    pill.className = "ready ok";
  } else if (/localhost|127\.0\.0\.1/.test(url)) {
    pill.textContent = "Ready";
    pill.className = "ready ok";
  } else {
    pill.textContent = "Open listing page";
    pill.className = "ready bad";
  }
}

$("tab-home").addEventListener("click", async () => {
  await persistDraft();
  show("home");
  await renderHome();
});
$("tab-editor").addEventListener("click", async () => {
  if (!draft) await openEditor();
  else show("editor");
});
$("tab-account").addEventListener("click", async () => {
  await persistDraft();
  show("account");
  await refreshPlanUI();
});
$("plan-badge").addEventListener("click", async () => {
  await persistDraft();
  show("account");
  await refreshPlanUI();
});
$("btn-profile-upgrade").addEventListener("click", () => $("paywall").classList.remove("hidden"));
$("btn-profile-key").addEventListener("click", () => $("paywall").classList.remove("hidden"));
$("btn-new").addEventListener("click", async () => {
  draft = LF.emptyVariant();
  await LF.saveDraft(draft);
  await openEditor();
});
$("btn-save").addEventListener("click", saveVariant);
$("btn-fill-current").addEventListener("click", fillCurrent);
$("btn-capture").addEventListener("click", startCapture);
$("btn-stop-capture").addEventListener("click", stopCapture);
$("btn-hide-popup").addEventListener("click", () => window.close());
$("paywall-close").addEventListener("click", () => $("paywall").classList.add("hidden"));
$("btn-activate").addEventListener("click", async () => {
  const res = await LFLicense.activate($("license-key").value);
  if (!res.ok) {
    status(res.error || "Could not activate.", true);
    return;
  }
  $("paywall").classList.add("hidden");
  $("license-key").value = "";
  await refreshPlanUI();
  status("Pro activated. Autofill is unlocked.");
});
$("theme-toggle").addEventListener("click", async () => {
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  await applyTheme(next);
});

["draft-name", "sku-prefix", "sku-next", "style-prefix", "style-next"].forEach((id) => {
  $(id).addEventListener("input", async () => {
    syncCounterUI();
    await persistDraft();
  });
});
$("sku-enabled").addEventListener("change", async () => {
  syncCounterUI();
  await persistDraft();
});
$("style-enabled").addEventListener("change", async () => {
  syncCounterUI();
  await persistDraft();
});

$("btn-add-manual").addEventListener("click", () => $("manual-box").classList.toggle("hidden"));
$("manual-cancel").addEventListener("click", () => $("manual-box").classList.add("hidden"));
$("manual-save").addEventListener("click", async () => {
  const label = $("manual-label").value.trim();
  const value = $("manual-value").value;
  const kind = $("manual-kind").value;
  if (!label) return;
  draft.fields = draft.fields || [];
  draft.fields.push({
    id: LF.uid(),
    label,
    kind,
    value,
    locator: { label, strategies: [{ type: "label", value: label }] }
  });
  $("manual-label").value = "";
  $("manual-value").value = "";
  $("manual-box").classList.add("hidden");
  await persistDraft();
  renderFields();
});

$("btn-export").addEventListener("click", async () => {
  const variants = await LF.getVariants();
  const blob = new Blob([JSON.stringify({ variants, exportedAt: new Date().toISOString() }, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "listfill-variants.json";
  a.click();
  URL.revokeObjectURL(url);
});
$("btn-import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.variants;
    if (!Array.isArray(incoming)) throw new Error("Invalid file");
    const current = await LF.getVariants();
    const byId = new Map(current.map((v) => [v.id, v]));
    incoming.forEach((v) => {
      if (!v || !v.id) v.id = LF.uid();
      byId.set(v.id, v);
    });
    await LF.saveVariants([...byId.values()]);
    await renderHome();
    status("Variants imported.");
  } catch (err) {
    status(err.message || "Import failed.", true);
  }
  e.target.value = "";
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes[LF.STORAGE.DRAFT] && draft && $("view-editor").classList.contains("hidden") === false) {
    draft = changes[LF.STORAGE.DRAFT].newValue || draft;
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      $("field-count").textContent = String((draft.fields || []).length);
      return;
    }
    bindDraftInputs();
  }
});

(async function init() {
  await loadTheme();
  await refreshPagePill();
  await refreshPlanUI();
  await renderHome();
  const existingDraft = await LF.getDraft();
  if (existingDraft) await openEditor();
  else {
    show("home");
  }
})();
