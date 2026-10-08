(function () {
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isListingSubmit(el) {
    if (!el || el.nodeType !== 1) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "submit") return true;
    const blob = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.innerText || ""}`
      .toLowerCase()
      .replace(/\s+/g, " ");
    return /send to qc|submit listing|submit product|publish listing|save and submit/.test(blob);
  }

  function nativeSetter(el) {
    if (el.tagName === "TEXTAREA") return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  }

  function setReactValue(el, value) {
    el.focus();
    const setter = nativeSetter(el);
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: String(value), inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function click(el, at) {
    if (!el || isListingSubmit(el)) return;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(50);
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: Math.round(at?.x ?? r.left + Math.min(24, r.width / 2)),
      clientY: Math.round(at?.y ?? r.top + r.height / 2)
    };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    if (typeof el.click === "function") el.click();
  }

  function optionMatch(el, value) {
    const want = String(value).trim().toLowerCase();
    const data = (el.getAttribute("data-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    return data === want || t === want || (data && data.includes(want)) || t.includes(want);
  }

  async function pickFromOpenList(value, root) {
    await sleep(220);
    const scope = root || document;
    const options = [
      ...scope.querySelectorAll(
        '[role="option"], [role="menuitem"], [class*="CheckMarkOptionWrapper"], input[type="radio"][data-label], li[data-value], .MuiMenuItem-root, [class*="MenuItem"], [class*="menu-item" i], [class*="dropdown-item" i], [class*="option"], [class*="Menu"] li, [class*="menu"] li, [class*="listbox"] li, ul[role="listbox"] li, [popover] label'
      )
    ].filter((n) => {
      if (!LFLocator.isVisible(n) || LFLocator.isOurUI(n)) return false;
      if (n.closest("nav, header, aside, [class*='sidebar' i]")) return false;
      const t = (n.getAttribute("data-label") || n.innerText || "").replace(/\s+/g, " ").trim();
      if (/^select one$/i.test(t) && !/^select one$/i.test(String(value).trim())) return false;
      return true;
    });
    const want = String(value).trim().toLowerCase();
    const exact = options.find((o) => {
      const data = (o.getAttribute("data-label") || "").trim().toLowerCase();
      const t = (o.innerText || "").trim().toLowerCase();
      return data === want || t === want;
    });
    const fuzzy = options.find((o) => optionMatch(o, value));
    const hit = exact || fuzzy;
    if (hit) {
      const clickable =
        hit.closest('[class*="CheckMarkOptionWrapper"]') ||
        hit.closest("label") ||
        hit;
      await click(clickable);
      return true;
    }
    return false;
  }

  function dropdownHost(el) {
    return (
      el.closest(
        '[role="combobox"], [aria-haspopup="listbox"], [class*="MuiSelect"], [class*="Select"], [class*="select"], [class*="dropdown" i]'
      ) || el
    );
  }

  function flipkartSelectBox(el) {
    return el.closest('[class*="SingleSelectContainer"]') || null;
  }

  function openPopoverIn(box) {
    if (!box) return null;
    const pop = box.querySelector("[popover], [data-testid='content-single-select']");
    if (pop && typeof pop.showPopover === "function") {
      try {
        pop.showPopover();
      } catch {
        /* already open */
      }
    }
    return pop;
  }

  async function fillSelect(el, value) {
    if (el.tagName === "SELECT") {
      const opts = [...el.options];
      const want = String(value).trim().toLowerCase();
      const opt =
        opts.find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) ||
        opts.find((o) => o.text.trim().toLowerCase().includes(want));
      if (!opt) return false;
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    const box = flipkartSelectBox(el);
    const host = (box && box.querySelector('[role="combobox"]')) || dropdownHost(el);
    const rect = host.getBoundingClientRect();
    await click(host, { x: rect.right - 14, y: rect.top + rect.height / 2 });
    const pop = openPopoverIn(box);
    const arrow = [...(host.parentElement || host).querySelectorAll("svg, [class*='arrow' i], [class*='caret' i], [class*='chevron' i]")].find(
      (n) => LFLocator.isVisible(n) && n.getBoundingClientRect().width < 48
    );
    if (arrow && arrow !== host) await click(arrow);

    const search = (box || host).querySelector('input[aria-label="Search"], input[placeholder="Select"]');
    if (search && search.closest("[popover], [data-testid='content-single-select']")) {
      setReactValue(search, String(value));
      await sleep(160);
    }

    const pickRoot = pop || box || document;
    if (await pickFromOpenList(value, pickRoot)) return true;
    if (pickRoot !== document && (await pickFromOpenList(value))) return true;

    if (host.tagName === "INPUT") {
      setReactValue(host, value);
      await sleep(200);
      if (await pickFromOpenList(value, pickRoot)) return true;
      host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await sleep(120);
      if (await pickFromOpenList(value, pickRoot)) return true;
      host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return true;
    }
    return false;
  }

  async function fillCheckbox(el, value) {
    const want = /^(yes|true|1|on|checked)$/i.test(String(value).trim());
    const isOn = !!(el.checked || el.getAttribute("aria-checked") === "true");
    if (want !== isOn) await click(el);
    return true;
  }

  function isOn(el) {
    return (
      el.classList.contains("selected") ||
      el.getAttribute("aria-pressed") === "true" ||
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("aria-selected") === "true"
    );
  }

  async function fillChipOrButton(el, value) {
    const want = String(value).trim().toLowerCase();
    const selfText = LFLocator.textOf(el).toLowerCase();
    if (selfText === want) {
      if (!isOn(el)) await click(el);
      return true;
    }
    const chips = LFLocator.collectSizeChips();
    const hit = chips.find((c) => LFLocator.textOf(c).toLowerCase() === want);
    if (hit) {
      if (!isOn(hit)) await click(hit);
      return true;
    }
    await click(el);
    return true;
  }

  async function fillOne(el, field) {
    const value = field.value;
    const kind = field.kind || LFLocator.fieldKind(el, field.label);

    if (kind === "file" || (el.getAttribute("type") || "").toLowerCase() === "file") return false;
    if (isListingSubmit(el)) return false;
    if (kind === "checkbox" || kind === "radio") return fillCheckbox(el, value);
    if (kind === "select" || el.tagName === "SELECT" || el.getAttribute("role") === "combobox" || LFLocator.looksLikeDropdown?.(el)) {
      return fillSelect(el, value);
    }
    if (kind === "size" && (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || LFLocator.looksLikeSizeChip(el))) {
      return fillChipOrButton(el, value);
    }
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
      return true;
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      setReactValue(el, value == null ? "" : String(value));
      return true;
    }
    if (kind === "size") return fillChipOrButton(el, value);
    return fillSelect(el, value);
  }

  async function waitForGrid(timeout = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const inputs = LFLocator.collectFillables();
      const hasPriceLike = inputs.some((el) => /price|mrp|inventory|sku|stock/i.test(LFLocator.getLabel(el)));
      if (hasPriceLike) return true;
      await sleep(120);
    }
    return false;
  }

  async function runFill(variant, onProgress) {
    const abort = { stopped: false };
    window.__listfillAbort = () => {
      abort.stopped = true;
    };

    const fields = LF.sortForFill(variant.fields || []);
    const skuText = LF.counterText(variant.sku);
    const styleText = LF.counterText(variant.styleCode);
    const results = { filled: 0, failed: [], skipped: 0, skuUsed: false, styleUsed: false };

    let sawSize = false;
    for (let i = 0; i < fields.length; i++) {
      if (abort.stopped) break;
      const field = fields[i];
      if (onProgress) onProgress({ index: i, total: fields.length, label: field.label, status: "working" });

      let value = field.value;
      if (variant.sku?.enabled && LF.isSkuField(field)) {
        value = skuText;
        results.skuUsed = true;
      }
      if (variant.styleCode?.enabled && LF.isStyleField(field)) {
        value = styleText;
        results.styleUsed = true;
      }

      const el = LFLocator.resolveField({ ...field, value });
      if (!el) {
        results.failed.push({ label: field.label, reason: "Field not found" });
        if (onProgress) onProgress({ index: i, total: fields.length, label: field.label, status: "miss" });
        continue;
      }

      try {
        const ok = await fillOne(el, { ...field, value });
        if (ok) {
          results.filled += 1;
          if (onProgress) onProgress({ index: i, total: fields.length, label: field.label, status: "ok" });
        } else {
          results.failed.push({ label: field.label, reason: "Could not set value" });
          if (onProgress) onProgress({ index: i, total: fields.length, label: field.label, status: "miss" });
        }
      } catch (err) {
        results.failed.push({ label: field.label, reason: String(err.message || err) });
      }

      if (LF.isSizeField(field)) sawSize = true;
      const next = fields[i + 1];
      if (sawSize && next && !LF.isSizeField(next)) {
        await waitForGrid();
        sawSize = false;
      } else {
        await sleep(70);
      }
    }

    window.__listfillAbort = null;
    return results;
  }

  window.LFFill = { runFill, fillOne, setReactValue, sleep };
})();
