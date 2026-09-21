(function () {
  const ROOT_ID = "listfill-root";
  let active = false;
  let hoverEl = null;
  let ring = null;
  let banner = null;
  let dialog = null;

  function root() {
    let el = document.getElementById(ROOT_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = ROOT_ID;
      el.className = "listfill-root";
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function ensureRing() {
    if (ring) return ring;
    ring = document.createElement("div");
    ring.className = "lf-ring";
    root().appendChild(ring);
    return ring;
  }

  function placeRing(el) {
    const r = el.getBoundingClientRect();
    const box = ensureRing();
    box.style.display = "block";
    box.style.top = `${r.top + window.scrollY - 3}px`;
    box.style.left = `${r.left + window.scrollX - 3}px`;
    box.style.width = `${r.width + 6}px`;
    box.style.height = `${r.height + 6}px`;
  }

  function hideRing() {
    if (ring) ring.style.display = "none";
  }

  function controlFromLabel(node) {
    if (!node || node.tagName !== "LABEL") return null;
    const ctrl =
      node.control || (node.htmlFor && document.getElementById(node.htmlFor)) || node.querySelector("input, textarea, select");
    return ctrl && LFLocator.isCaptureTarget(ctrl) ? ctrl : null;
  }

  function targetFromEvent(e) {
    if (e.target instanceof Element && LFLocator.isOurUI(e.target)) return null;
    const path = e.composedPath ? e.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (LFLocator.isOurUI(node)) return null;
      const fromLabel = controlFromLabel(node);
      if (fromLabel) return fromLabel;
      if (LFLocator.isCaptureTarget(node)) return node;
    }
    return null;
  }

  function closeDialog() {
    if (dialog) {
      dialog.remove();
      dialog = null;
    }
  }

  function showBanner() {
    if (banner) return banner;
    banner = document.createElement("div");
    banner.className = "lf-panel";
    banner.innerHTML = `
      <div class="lf-panel-head" data-lf="drag">
        <strong>ListFill · capturing</strong>
        <span class="lf-panel-hint">Drag to move</span>
      </div>
      <p class="lf-banner-count">Click fields on the form. Size first.</p>
      <div class="lf-panel-fields" data-lf="fields"></div>
      <div class="lf-panel-actions">
        <button type="button" class="lf-btn lf-btn-ghost" data-lf="stop">Stop capture</button>
        <button type="button" class="lf-btn lf-btn-primary" data-lf="save-variant">Save variant</button>
      </div>
    `;
    root().appendChild(banner);
    banner.querySelector("[data-lf='stop']").addEventListener("click", () => stopCapture());
    banner.querySelector("[data-lf='save-variant']").addEventListener("click", () => saveVariantFromPage());
    makeDraggable(banner, banner.querySelector("[data-lf='drag']"));
    return banner;
  }

  function makeDraggable(panel, handle) {
    let ox = 0;
    let oy = 0;
    let dragging = false;
    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const x = Math.min(window.innerWidth - 80, Math.max(8, e.clientX - ox));
      const y = Math.min(window.innerHeight - 80, Math.max(8, e.clientY - oy));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.right = "auto";
    });
    handle.addEventListener("pointerup", () => {
      dragging = false;
    });
  }

  function renderPanelFields(draft) {
    const box = banner && banner.querySelector("[data-lf='fields']");
    if (!box) return;
    const fields = (draft && draft.fields) || [];
    if (!fields.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = fields
      .map((f) => `<div class="lf-panel-row"><b>${escapeHtml(f.label || "Field")}</b><span>${escapeHtml(f.value || "—")}</span></div>`)
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  async function updateBannerCount(n) {
    const el = banner && banner.querySelector(".lf-banner-count");
    const draft = await LF.getDraft();
    if (el) {
      const name = draft?.name ? `“${draft.name}” · ` : "";
      el.textContent = `${name}${n} field${n === 1 ? "" : "s"} saved · click the next field`;
    }
    renderPanelFields(draft);
  }

  async function saveVariantFromPage() {
    const draft = await LF.getDraft();
    if (!draft) return;
    if (!draft.name) {
      const name = window.prompt("Variant name?", "") || "";
      draft.name = name.trim();
      if (!draft.name) return;
      await LF.saveDraft(draft);
    }
    if (!(draft.fields || []).length) return;
    const variants = await LF.getVariants();
    const i = variants.findIndex((v) => v.id === draft.id);
    draft.updatedAt = Date.now();
    if (i >= 0) variants[i] = draft;
    else variants.push(draft);
    await LF.saveVariants(variants);
    await LF.saveDraft(null);
    await stopCapture();
    const note = document.createElement("div");
    note.className = "lf-toast ok";
    note.innerHTML = `<strong>Variant saved</strong><div>${draft.name} · ${draft.fields.length} fields. Open ListFill to Autofill.</div>`;
    root().appendChild(note);
    setTimeout(() => note.remove(), 5000);
  }

  async function fieldCount() {
    const draft = await LF.getDraft();
    return (draft && draft.fields && draft.fields.length) || 0;
  }

  function showDialog(el) {
    closeDialog();
    const locator = LFLocator.buildLocator(el);
    const label = locator.label || LFLocator.textOf(el) || "Untitled field";
    const kind = LFLocator.fieldKind(el, label);
    const current = kind === "size" && !el.value ? LFLocator.textOf(el) : LFLocator.readValue(el);

    dialog = document.createElement("div");
    dialog.className = "lf-dialog";
    const r = el.getBoundingClientRect();
    const dw = 300;
    const dh = 260;
    let left = window.scrollX + r.right + 12;
    if (r.right + 12 + dw > window.innerWidth) left = window.scrollX + r.left - dw - 12;
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    let top = window.scrollY + r.top;
    if (r.top + dh > window.innerHeight) top = window.scrollY + Math.max(8, r.bottom - dh);
    dialog.style.top = `${top}px`;
    dialog.style.left = `${left}px`;

    const isArea = kind === "textarea";
    dialog.innerHTML = `
      <div class="lf-dialog-h">Save this field</div>
      <label>Label</label>
      <input type="text" class="lf-input" data-lf="label" value="">
      <label>Value</label>
      ${isArea ? '<textarea class="lf-input" data-lf="value" rows="4"></textarea>' : '<input type="text" class="lf-input" data-lf="value">'}
      <div class="lf-kind">Detected: <b></b></div>
      <div class="lf-dialog-actions">
        <button type="button" class="lf-btn lf-btn-ghost" data-lf="cancel">Cancel</button>
        <button type="button" class="lf-btn lf-btn-primary" data-lf="save">Save field</button>
      </div>
    `;
    dialog.querySelector('[data-lf="label"]').value = label;
    dialog.querySelector('[data-lf="value"]').value = current || "";
    dialog.querySelector(".lf-kind b").textContent = kind;

    root().appendChild(dialog);
    const valueEl = dialog.querySelector('[data-lf="value"]');
    valueEl.focus();
    valueEl.select?.();

    dialog.querySelector('[data-lf="cancel"]').addEventListener("click", () => closeDialog());
    dialog.querySelector('[data-lf="save"]').addEventListener("click", async () => {
      const nextLabel = dialog.querySelector('[data-lf="label"]').value.trim() || label;
      const nextValue = dialog.querySelector('[data-lf="value"]').value;
      const saved = {
        id: LF.uid(),
        label: nextLabel,
        kind,
        value: nextValue,
        locator: { ...locator, label: nextLabel }
      };
      await persistField(saved);
      try {
        await LFFill.fillOne(el, saved);
      } catch {
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") LFFill.setReactValue(el, nextValue);
      }
      closeDialog();
      updateBannerCount(await fieldCount());
    });
  }

  async function persistField(field) {
    const draft = (await LF.getDraft()) || LF.emptyVariant();
    const key = (field.label || "").trim().toLowerCase();
    const locCss = field.locator?.strategies?.find((s) => s.type === "css")?.value;
    draft.fields = (draft.fields || []).filter((f) => {
      const sameLabel = (f.label || "").trim().toLowerCase() === key;
      const sameCss = locCss && f.locator?.strategies?.find((s) => s.type === "css")?.value === locCss;
      return !(sameLabel || sameCss);
    });
    draft.fields.push(field);
    draft.updatedAt = Date.now();
    await LF.saveDraft(draft);
  }

  function onMove(e) {
    if (!active || dialog) return;
    const el = targetFromEvent(e);
    hoverEl = el;
    if (el) placeRing(el);
    else hideRing();
  }

  function onClick(e) {
    if (!active) return;
    if (LFLocator.isOurUI(e.target)) return;
    const el = targetFromEvent(e) || hoverEl;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    showDialog(el);
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === "Escape") {
      if (dialog) {
        closeDialog();
        e.preventDefault();
        return;
      }
      stopCapture();
    }
  }

  async function startCapture() {
    active = true;
    root();
    showBanner();
    updateBannerCount(await fieldCount());
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    await LF.set(LF.STORAGE.CAPTURE, { active: true, startedAt: Date.now() });
    chrome.runtime.sendMessage({ type: "LF_CAPTURE_STATE", active: true }).catch(() => {});
  }

  async function stopCapture() {
    active = false;
    hoverEl = null;
    hideRing();
    closeDialog();
    if (banner) {
      banner.remove();
      banner = null;
    }
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    await LF.set(LF.STORAGE.CAPTURE, { active: false });
    chrome.runtime.sendMessage({ type: "LF_CAPTURE_STATE", active: false }).catch(() => {});
  }

  function isCapturing() {
    return active;
  }

  window.LFCapture = { startCapture, stopCapture, isCapturing };
})();
