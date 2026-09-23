(function () {
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
  const CONTROL_SEL =
    'input, textarea, select, [role="combobox"], [role="listbox"], [role="checkbox"], [role="radio"], [role="switch"], [contenteditable="true"]';

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  }

  function isOurUI(el) {
    return !!(el && el.closest && el.closest("#listfill-root, .listfill-root"));
  }

  function textOf(el) {
    return (el && (el.innerText || el.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function cleanLabel(text, el) {
    let t = String(text || "")
      .replace(/\s+/g, " ")
      .replace(/[ⓘℹ️?]+/g, " ")
      .replace(/\s*[*:：]+\s*$/g, "")
      .replace(/^\s*[*:：]+\s*/g, "")
      .trim();
    t = t.replace(/^(enter|select|choose|pick|add)\s+/i, "").trim();
    if (!t || t.length > 80) return "";
    if (!/\p{L}{2,}/u.test(t)) return "";
    if (el) {
      const val = String(el.value || "").trim();
      if (val && t.toLowerCase() === val.toLowerCase()) return "";
    }
    if (/^(on|off|yes|no|true|false|select|choose|search|filter)$/i.test(t)) return "";
    return t;
  }

  function fromAttr(el, name) {
    return cleanLabel(el.getAttribute(name), el);
  }

  function labelFromContainer(container, el) {
    if (!container) return "";
    const kids = [...container.children];
    for (const kid of kids) {
      if (kid === el || kid.contains(el)) continue;
      if (kid.matches("input, textarea, select, button, svg, img")) continue;
      const direct = cleanLabel(textOf(kid), el);
      if (direct && kid.children.length <= 6 && kid.getBoundingClientRect().height < 80) return direct;
      if (
        kid.matches(
          "label, legend, p, span, h2, h3, h4, h5, h6, [class*='MuiFormLabel'], [class*='MuiInputLabel'], [class*='label' i], [class*='Label']"
        )
      ) {
        if (direct) return direct;
      }
      const nested = kid.querySelector(
        ":scope > label, :scope > legend, :scope > span, :scope > p, :scope > [class*='label' i]"
      );
      if (nested && !nested.contains(el)) {
        const t = cleanLabel(textOf(nested), el);
        if (t) return t;
      }
    }
    return "";
  }

  function labelWalk(el) {
    let node = el;
    for (let depth = 0; depth < 16 && node && node !== document.body; depth++) {
      const parent = node.parentElement;
      if (!parent) break;

      const fromParent = labelFromContainer(parent, el);
      if (fromParent) return fromParent;

      let sib = node.previousElementSibling;
      while (sib) {
        if (!sib.contains(el) && !sib.matches("input, textarea, select, button, svg, img")) {
          const t = cleanLabel(textOf(sib), el);
          if (t) return t;
        }
        sib = sib.previousElementSibling;
      }

      node = parent;
    }
    return "";
  }

  function labelFromRow(el) {
    let node = el;
    for (let i = 0; i < 16 && node && node.parentElement; i++) {
      const parent = node.parentElement;
      let isRow = parent.matches("tr, [class*='Grid-container'], [class*='grid' i]");
      try {
        const d = window.getComputedStyle(parent).display || "";
        const dir = window.getComputedStyle(parent).flexDirection || "";
        if (d.includes("grid")) isRow = true;
        if (d.includes("flex") && (!dir || dir.startsWith("row"))) isRow = true;
      } catch {
        /* ignore */
      }
      if (isRow) {
        let child = el;
        while (child.parentElement && child.parentElement !== parent) child = child.parentElement;
        const prev = child.previousElementSibling;
        const t = cleanLabel(textOf(prev), el);
        if (t) return t;
      }
      node = parent;
    }
    return "";
  }

  function labelBeside(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return "";
    const y = r.top + r.height / 2;
    const xs = [r.left - 16, r.left - 48, r.left - 96, r.left - 140];
    for (const x of xs) {
      if (x < 0) continue;
      let stack = [];
      try {
        stack = document.elementsFromPoint(x, y) || [];
      } catch {
        continue;
      }
      for (const node of stack) {
        if (!(node instanceof Element)) continue;
        if (node === el || el.contains(node) || node.contains(el)) continue;
        if (isOurUI(node)) continue;
        if (node.matches("input, textarea, select, button, svg, img")) continue;
        const t = cleanLabel(textOf(node), el);
        if (t) return t;
      }
    }
    return "";
  }

  function labelByGeometry(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return "";
    const nodes = document.querySelectorAll("label, span, p, div, td, th, dt, h6, h5, h4, legend");
    let best = "";
    let bestGap = 160;
    for (const node of nodes) {
      if (node === el || node.contains(el) || el.contains(node)) continue;
      if (isOurUI(node)) continue;
      const kids = node.children.length;
      if (kids > 6) continue;
      const b = node.getBoundingClientRect();
      if (b.width < 8 || b.height < 10 || b.height > 72 || b.width > 360) continue;
      if (b.bottom < r.top + 4 || b.top > r.bottom - 4) continue;
      const gap = r.left - b.right;
      if (gap < -8 || gap > 150) continue;
      const t = cleanLabel(textOf(node), el);
      if (!t) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = t;
      }
    }
    return best;
  }

  function labelAbove(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return "";
    const x = r.left + Math.min(48, Math.max(8, r.width / 3));
    const y = r.top - 8;
    if (y < 0) return "";
    let stack = [];
    try {
      stack = document.elementsFromPoint(x, y) || [];
    } catch {
      return "";
    }
    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (node === el || el.contains(node) || node.contains(el)) continue;
      if (isOurUI(node)) continue;
      if (node.matches("input, textarea, select, button")) continue;
      const t = cleanLabel(textOf(node), el);
      if (t) return t;
    }
    return "";
  }

  function humanizeToken(value) {
    return cleanLabel(
      String(value || "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_./]+/g, " ")
        .replace(/\d+$/g, ""),
      null
    );
  }

  function isSmallBox(node) {
    if (!node || node === document.body) return false;
    const r = node.getBoundingClientRect();
    return r.height > 0 && r.height < 160 && r.width < Math.min(window.innerWidth * 0.95, 900);
  }

  function uniqueId(el) {
    const id = el && el.id;
    if (!id) return "";
    try {
      if (document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length === 1) return id;
    } catch {
      /* ignore */
    }
    return "";
  }

  function flipkartNameText(name) {
    if (!name) return "";
    const clone = name.cloneNode(true);
    clone.querySelectorAll("svg, [class*='Tooltip'], [class*='star' i], sup").forEach((n) => n.remove());
    let t = cleanLabel(textOf(clone), null);
    t = t.replace(/\s*\*?info\b[\s\S]*$/i, "").trim();
    return t;
  }

  function flipkartAttributeLabel(el) {
    const wrap = el.closest('[class*="AttributeWrapper"]');
    if (wrap) {
      const names = [...wrap.querySelectorAll('[class*="AttributeItemLabelName"]')];
      if (names.length === 1 && !names[0].contains(el)) {
        const t = flipkartNameText(names[0]);
        if (t) return t;
      }
    }
    const item = el.closest('[class*="EditAttributeItemWrapper"]');
    if (!item) return "";
    const names = [...item.querySelectorAll('[class*="AttributeItemLabelName"]')].filter((n) => !n.contains(el));
    if (names.length !== 1) return "";
    return flipkartNameText(names[0]);
  }

  function insideDropdownMenu(el) {
    return !!(
      el &&
      el.closest &&
      el.closest('[popover], [data-testid="content-single-select"], [class*="DropdownContent"], [class*="CheckMarkGroup"]')
    );
  }

  function getLabel(el) {
    if (!el) return "";

    const fk = flipkartAttributeLabel(el);
    if (fk) return fk;

    if (el.labels && el.labels.length) {
      const t = cleanLabel([...el.labels].map(textOf).filter(Boolean).join(" "), el);
      if (t) return t;
    }

    const aria = fromAttr(el, "aria-label");
    if (aria) return aria;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(textOf)
        .filter(Boolean);
      const t = cleanLabel(parts.join(" "), el);
      if (t) return t;
    }

    if (el.id) {
      try {
        const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const t = cleanLabel(textOf(forLabel), el);
        if (t) return t;
      } catch {
        /* ignore */
      }
    }

    const wrapLabel = el.closest("label");
    if (wrapLabel) {
      const clone = wrapLabel.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((n) => n.remove());
      const t = cleanLabel(textOf(clone), el);
      if (t) return t;
    }

    const group = el.closest(
      [
        ".MuiFormControl-root",
        "[class*='FormControl']",
        "[class*='form-control']",
        "[class*='FormField']",
        "[class*='form-field']",
        "[class*='formField']",
        "[class*='InputWrapper']",
        "[class*='input-wrap']",
        ".form-group",
        "[data-testid]",
        ".field",
        "fieldset"
      ].join(",")
    );
    const grouped = isSmallBox(group) ? labelFromContainer(group, el) : "";
    if (grouped) return grouped;

    const row = labelFromRow(el);
    if (row) return row;

    const beside = labelBeside(el);
    if (beside) return beside;

    const geo = labelByGeometry(el);
    if (geo) return geo;

    const walked = labelWalk(el);
    if (walked) return walked;

    const above = labelAbove(el);
    if (above) return above;

    const groupAria = el.closest("[aria-label]");
    if (groupAria && groupAria !== el) {
      const t = fromAttr(groupAria, "aria-label");
      if (t) return t;
    }

    const placeholder = fromAttr(el, "placeholder");
    if (placeholder) return placeholder;

    const title = fromAttr(el, "title");
    if (title) return title;

    const testid = el.getAttribute("data-testid") || el.closest("[data-testid]")?.getAttribute("data-testid");
    const fromTest = humanizeToken(testid);
    if (fromTest) return fromTest;

    const name = humanizeToken(el.getAttribute("name") || el.getAttribute("id"));
    if (name) return name;

    return "";
  }

  function getSection(el) {
    const heading = el.closest("section, form, [class*='section']");
    if (!heading) return "";
    const h = heading.querySelector("h1, h2, h3, h4, h5, h6, [class*='title'], [class*='Title']");
    return h ? textOf(h).slice(0, 80) : "";
  }

  function cssPath(el) {
    const id = uniqueId(el);
    if (id) return `#${CSS.escape(id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 16) {
      let sel = node.tagName.toLowerCase();
      const nodeId = uniqueId(node);
      if (nodeId) {
        parts.unshift(`#${CSS.escape(nodeId)}`);
        break;
      }
      const cls = [...node.classList].filter((c) => c && !c.startsWith("listfill")).slice(0, 2);
      if (cls.length) sel += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((n) => n.tagName === node.tagName);
        if (same.length > 1) sel += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function xpathOf(el) {
    const id = uniqueId(el);
    if (id) return `//*[@id="${id}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let i = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.nodeName === node.nodeName) i += 1;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${node.nodeName.toLowerCase()}[${i}]`);
      node = node.parentElement;
    }
    return "/" + parts.join("/");
  }

  function looksLikeDropdown(el) {
    if (!el) return false;
    if (el.tagName === "SELECT") return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "combobox" || role === "listbox") return true;
    const popup = (el.getAttribute("aria-haspopup") || "").toLowerCase();
    if (popup === "listbox" || popup === "menu" || popup === "true") return true;
    if ((el.getAttribute("aria-autocomplete") || "").toLowerCase() === "list") return true;
    if (el.getAttribute("aria-expanded") === "true" || el.getAttribute("aria-expanded") === "false") return true;

    const host = el.closest(
      [
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        '[class*="MuiSelect"]',
        '[class*="MuiAutocomplete"]',
        '[class*="ant-select"]',
        '[class*="Select"]',
        '[class*="select__"]',
        '[class*="dropdown" i]',
        '[class*="Dropdown"]',
        '[class*="combobox" i]',
        '[class*="AutoComplete"]',
        '[class*="autocomplete" i]'
      ].join(",")
    );
    if (host && isSmallBox(host)) return true;

    const ph = (el.getAttribute("placeholder") || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (/^(select|choose|pick)\b/.test(ph)) return true;
    const shown = textOf(el).toLowerCase();
    if (/^(select|choose|pick)$/.test(shown)) return true;

    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (el.tagName === "INPUT" && (type === "text" || type === "search" || !type) && el.readOnly) return true;

    let node = el;
    const fieldBox = el.getBoundingClientRect();
    for (let i = 0; i < 5 && node && node !== document.body; i++) {
      const box = node.getBoundingClientRect();
      if (box.height > 90) break;
      const icon = node.querySelector(
        "svg, [class*='ArrowDropDown'], [class*='ExpandMore'], [class*='chevron' i], [class*='caret' i], [class*='arrow' i]"
      );
      if (icon && isVisible(icon)) {
        const ir = icon.getBoundingClientRect();
        if (ir.left > fieldBox.left + fieldBox.width * 0.45 && ir.width < 40 && ir.height < 40) {
          if (/^(select|choose|pick)\b/.test(ph) || el.readOnly || popup) return true;
          if (el.tagName !== "TEXTAREA" && type !== "number" && type !== "email") {
            const label = (getLabel(el) || "").toLowerCase();
            if (!/weight|price|mrp|qty|quantity|sku|name|title|description|search/.test(label)) return true;
          }
        }
      }
      node = node.parentElement;
    }
    return false;
  }

  function fieldKind(el, label) {
    const l = (label || "").toLowerCase();
    if (/\bsku\b/.test(l)) return "sku";
    if (/style\s*code|product\s*id|style\s*id/.test(l)) return "styleCode";
    if (/\bsize\b/.test(l) && !/size\s*chart/.test(l) && !looksLikeDropdown(el)) return "size";

    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "checkbox" || el.getAttribute("role") === "checkbox") return "checkbox";
    if (type === "radio" || el.getAttribute("role") === "radio") return "radio";
    if (type === "file") return "file";
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return "textarea";
    if (looksLikeDropdown(el)) return "select";
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") {
      return looksLikeSizeChip(el) ? "size" : "select";
    }
    return "text";
  }

  function readValue(el) {
    if (!el) return "";
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "checkbox" || el.getAttribute("role") === "checkbox") {
      const on = el.checked || el.getAttribute("aria-checked") === "true";
      return on ? "Yes" : "No";
    }
    if (el.tagName === "SELECT") {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? opt.text.trim() : el.value;
    }
    if (el.isContentEditable) return textOf(el);
    if (el.getAttribute("role") === "combobox") {
      const shown = (el.value || textOf(el.querySelector('[class*="ButtonText"]') || el) || el.getAttribute("value") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (/^(select|choose|pick)$/i.test(shown)) return "";
      return shown;
    }
    return (el.value || "").trim();
  }

  function isFieldSized(el) {
    if (el === document.body || el === document.documentElement) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    if (el.tagName === "TEXTAREA") return r.height < window.innerHeight * 0.8;
    if (r.height > window.innerHeight * 0.4) return false;
    if (r.width > window.innerWidth * 0.92 && r.height > 120) return false;
    return true;
  }

  function isFillable(el) {
    if (!el || isOurUI(el) || !isVisible(el) || el.disabled) return false;
    if (!el.matches(CONTROL_SEL)) return false;
    if (insideDropdownMenu(el)) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (SKIP_TYPES.has(type)) return false;
    if (!isFieldSized(el)) return false;
    if (el.closest("a, nav, header") && !el.matches("input, textarea, select, [role='combobox']")) return false;
    return true;
  }

  function looksLikeUpload(el) {
    if (!el || !isVisible(el) || isOurUI(el)) return false;
    if (el.matches('input[type="file"]')) return true;
    const r = el.getBoundingClientRect();
    if (r.width < 36 || r.height < 36 || r.width > 240 || r.height > 240) return false;
    const blob = `${el.className} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${textOf(el)}`.toLowerCase();
    if (!/(photo|image|upload|gallery|add image)/.test(blob)) return false;
    return el.matches(
      'button, [role="button"], [class*="upload" i], [class*="photo" i], [class*="image" i], [class*="drop" i], div, span'
    );
  }

  function isCaptureTarget(el) {
    return isFillable(el) || looksLikeSizeChip(el) || looksLikeUpload(el);
  }

  function collectFillables() {
    const nodes = document.querySelectorAll(CONTROL_SEL);
    const out = [];
    nodes.forEach((el) => {
      if (isFillable(el) && (el.getAttribute("type") || "").toLowerCase() !== "file") out.push(el);
    });
    return out;
  }

  function looksLikeSizeChip(el) {
    if (!el || !isVisible(el) || isOurUI(el)) return false;
    if (el.matches("input, textarea, select")) return false;
    const t = textOf(el);
    if (!t || t.length > 18) return false;
    const sizeLike =
      /^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,4}(\.\d+)?\s*(ml|l|g|kg|cm|mm|in)?|\d{2}|free size|onesize)$/i.test(t);
    const parent = el.parentElement;
    const nearby = `${textOf(parent)} ${textOf(parent && parent.previousElementSibling)} ${
      (parent && parent.getAttribute("aria-label")) || ""
    }`.toLowerCase();
    if (!sizeLike && !/\bsize\b/.test(nearby) && !el.closest('[aria-label*="size" i], [class*="size" i]')) return false;
    return el.matches("button, [role='button'], [role='checkbox'], [role='option'], .chip, [class*='chip'], [class*='Chip']");
  }

  function collectSizeChips() {
    const all = document.querySelectorAll("button, [role='button'], [role='checkbox'], [class*='chip' i]");
    return [...all].filter(looksLikeSizeChip);
  }

  function buildLocator(el) {
    const label = getLabel(el);
    const strategies = [];
    const id = uniqueId(el);
    if (id) strategies.push({ type: "id", value: id });
    if (el.getAttribute("name")) strategies.push({ type: "name", value: el.getAttribute("name") });
    if (el.getAttribute("aria-label")) strategies.push({ type: "aria", value: el.getAttribute("aria-label") });
    if (label) {
      strategies.push({ type: "label", value: label });
      if (el.closest('[class*="EditAttributeItemWrapper"]')) {
        strategies.unshift({ type: "fk-attr", value: label });
      }
    }
    if (el.getAttribute("placeholder")) strategies.push({ type: "placeholder", value: el.getAttribute("placeholder") });
    strategies.push({ type: "css", value: cssPath(el) });
    strategies.push({ type: "xpath", value: xpathOf(el) });
    return {
      label,
      section: getSection(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      type: (el.getAttribute("type") || "").toLowerCase(),
      strategies
    };
  }

  function queryXPath(xp) {
    try {
      const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue;
    } catch {
      return null;
    }
  }

  function byFlipkartAttribute(label) {
    if (!label) return null;
    const want = String(label).replace(/\s+/g, " ").trim().toLowerCase();
    const names = document.querySelectorAll('[class*="AttributeItemLabelName"]');
    for (const name of names) {
      const got = cleanLabel(textOf(name)).replace(/\s+/g, " ").trim().toLowerCase();
      if (got !== want) continue;
      const wrap = name.closest('[class*="AttributeWrapper"]') || name.closest('[class*="EditAttributeItemWrapper"]');
      if (!wrap) continue;
      const control = wrap.querySelector('[role="combobox"], input, textarea, select');
      if (control && isVisible(control) && !isOurUI(control)) return control;
    }
    return null;
  }

  function byLabel(label) {
    if (!label) return null;
    const want = label.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = [...collectFillables(), ...collectSizeChips()];
    for (const el of candidates) {
      const got = getLabel(el).replace(/\s+/g, " ").trim().toLowerCase();
      if (got === want) return el;
    }
    for (const el of candidates) {
      const got = getLabel(el).replace(/\s+/g, " ").trim().toLowerCase();
      if (got.includes(want) || want.includes(got)) return el;
    }
    const chip = collectSizeChips().find((el) => textOf(el).toLowerCase() === want);
    if (chip) return chip;
    return null;
  }

  function resolveLocator(locator) {
    if (!locator) return null;
    const strategies = locator.strategies || [];
    for (const s of strategies) {
      let el = null;
      if (s.type === "id") {
        try {
          if (document.querySelectorAll(`[id="${CSS.escape(s.value)}"]`).length !== 1) el = null;
          else el = document.getElementById(s.value);
        } catch {
          el = document.getElementById(s.value);
        }
      }
      else if (s.type === "name") el = document.querySelector(`[name="${CSS.escape(s.value)}"]`);
      else if (s.type === "aria") el = document.querySelector(`[aria-label="${CSS.escape(s.value)}"]`);
      else if (s.type === "placeholder") el = document.querySelector(`[placeholder="${CSS.escape(s.value)}"]`);
      else if (s.type === "css") {
        try {
          const idOnly = s.value.startsWith("#") && !/[ >+~]/.test(s.value);
          if (idOnly && document.querySelectorAll(`[id="${CSS.escape(s.value.slice(1))}"]`).length !== 1) el = null;
          else el = document.querySelector(s.value);
        } catch {
          el = null;
        }
      } else if (s.type === "xpath") {
        const idMatch = /^\/\/\*\[@id="([^"]+)"\]$/.exec(s.value || "");
        if (idMatch && document.querySelectorAll(`[id="${CSS.escape(idMatch[1])}"]`).length !== 1) el = null;
        else el = queryXPath(s.value);
      } else if (s.type === "fk-attr") el = byFlipkartAttribute(s.value);
      else if (s.type === "label") el = byLabel(s.value);
      if (el && isVisible(el) && !isOurUI(el)) return el;
    }
    return byFlipkartAttribute(locator.label) || byLabel(locator.label);
  }

  function resolveField(field) {
    if ((field.kind === "size" || /\bsize\b/i.test(field.label || "")) && field.value) {
      const chips = collectSizeChips();
      const want = String(field.value).trim().toLowerCase();
      const chip = chips.find((c) => textOf(c).toLowerCase() === want);
      if (chip) return chip;
    }
    const el = resolveLocator(field.locator);
    if (el) return el;
    return byFlipkartAttribute(field.label) || byLabel(field.label);
  }

  window.LFLocator = {
    isVisible,
    isOurUI,
    textOf,
    getLabel,
    fieldKind,
    readValue,
    isFillable,
    collectFillables,
    collectSizeChips,
    buildLocator,
    resolveLocator,
    resolveField,
    looksLikeDropdown,
    looksLikeSizeChip,
    looksLikeUpload,
    isCaptureTarget,
    byLabel
  };
})();
