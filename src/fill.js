(function () {
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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

  async function click(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(50);
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: Math.round(r.left + Math.min(24, r.width / 2)),
      clientY: Math.round(r.top + r.height / 2)
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
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    return t === want || t.includes(want);
  }

  async function pickFromOpenList(value) {
    await sleep(220);
    const options = [
      ...document.querySelectorAll(
        '[role="option"], [role="menuitem"], li[data-value], .MuiMenuItem-root, [class*="MenuItem"], [class*="menu-item" i], [class*="dropdown-item" i], [class*="option"], [class*="Menu"] li, [class*="menu"] li, [class*="listbox"] li, ul[role="listbox"] li'
      )
    ].filter((n) => {
      if (!LFLocator.isVisible(n) || LFLocator.isOurUI(n)) return false;
      if (n.closest("nav, header, aside, [class*='sidebar' i]")) return false;
      return true;
    });
    const exact = options.find(
      (o) => optionMatch(o, value) && (o.innerText || "").trim().toLowerCase() === String(value).trim().toLowerCase()
    );
    const fuzzy = options.find((o) => optionMatch(o, value));
    const hit = exact || fuzzy;
    if (hit) {
      await click(hit);
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

    const host = dropdownHost(el);
    await click(host);
    const arrow = [...(host.parentElement || host).querySelectorAll("svg, [class*='arrow' i], [class*='caret' i], [class*='chevron' i]")].find(
      (n) => LFLocator.isVisible(n) && n.getBoundingClientRect().width < 48
    );
    if (arrow && arrow !== host) await click(arrow);
    if (await pickFromOpenList(value)) return true;

    const input = host.tagName === "INPUT" ? host : host.querySelector("input") || el;
    if (input && (input.tagName === "INPUT" || input.getAttribute("role") === "combobox")) {
      setReactValue(input, value);
      await sleep(200);
      if (await pickFromOpenList(value)) return true;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await sleep(120);
      if (await pickFromOpenList(value)) return true;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
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
