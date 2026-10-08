(function () {
  const PRESETS = {
    meesho: { id: "meesho", size: 1080, maxBytes: 1572864, quality: 0.86, tag: "meesho", label: "Meesho", hint: "1080×1080 JPEG · under 1.5 MB" },
    flipkart: { id: "flipkart", size: 1500, maxBytes: 2097152, quality: 0.88, tag: "flipkart", label: "Flipkart", hint: "1500×1500 JPEG · under 2 MB" },
    both: { id: "both", size: 1500, maxBytes: 1572864, quality: 0.86, tag: "listing", label: "Both", hint: "1500×1500 JPEG · fits Meesho and Flipkart" }
  };

  const SHIP_NOTE = `List Pilot shipping-image variants
1080×1080 JPEGs for the Meesho listing photo. Upload each on Add Product and compare the shipping quote Meesho shows. Use the lowest quote that still looks like your product.

List Pilot does not log into Meesho and does not read the rupee amount. Filenames: {photo}-ship-{layout}.jpg
p50 = product uses about 50% of the square (more white). p90 fills more of the frame. line/grey/wide are canvas borders, not product tags.
`;

  function shippingLayouts() {
    const out = [];
    const pads = [0.5, 0.58, 0.66, 0.74, 0.82, 0.9];
    const borders = [
      { id: "plain", w: 0, color: "#ffffff" },
      { id: "line", w: 3, color: "#ececec" },
      { id: "grey", w: 10, color: "#d0d0d0" },
      { id: "wide", w: 28, color: "#f2f2f2" }
    ];
    for (const pad of pads) {
      for (const b of borders) {
        if (pad <= 0.52 && b.id === "wide") continue;
        out.push({
          id: `p${Math.round(pad * 100)}-${b.id}`,
          label: `${Math.round(pad * 100)}% ${b.id}`,
          pad,
          border: b.w,
          borderColor: b.color
        });
      }
    }
    out.push({ id: "fill", label: "fill square", cover: true, zoom: 1 });
    out.push({ id: "zoom", label: "slight zoom", cover: true, zoom: 1.12 });
    out.push({ id: "p70-up", label: "70% up", pad: 0.7, offsetY: -0.04 });
    out.push({ id: "p70-down", label: "70% down", pad: 0.7, offsetY: 0.04 });
    out.push({ id: "p74-bright", label: "74% bright", pad: 0.74, filter: "brightness(1.08) contrast(1.04)" });
    out.push({ id: "p66-soft", label: "66% soft", pad: 0.66, filter: "brightness(1.04) saturate(0.92)" });
    return out;
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  }

  function u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  }

  function concat(parts) {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  function zipStore(files) {
    const now = new Date();
    const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = new TextEncoder().encode(String(f.name).replace(/[\\/:*?"<>|]/g, "_"));
      const data = f.data;
      const crc = crc32(data);
      const local = concat([
        u32(0x04034b50),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(time),
        u16(date),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        name,
        data
      ]);
      chunks.push(local);
      central.push(
        concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(0x0800),
          u16(0),
          u16(time),
          u16(date),
          u32(crc),
          u32(data.length),
          u32(data.length),
          u16(name.length),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          name
        ])
      );
      offset += local.length;
    }
    const cd = concat(central);
    const eocd = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
    return concat(chunks.concat([cd, eocd]));
  }

  function blobToU8(blob) {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode JPEG"))),
        "image/jpeg",
        quality
      );
    });
  }

  async function encodeJpeg(canvas, maxBytes, startQ) {
    let q = startQ;
    let blob = await canvasToBlob(canvas, q);
    while (blob.size > maxBytes && q > 0.52) {
      q = Math.max(0.52, q - 0.08);
      blob = await canvasToBlob(canvas, q);
    }
    return blob;
  }

  async function loadBitmap(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (_) {
        try {
          return await createImageBitmap(file);
        } catch (__) {
          /* fall through */
        }
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not read this file. Use JPG, PNG, or WebP."));
        el.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function stemOf(name) {
    return String(name || "photo")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "photo";
  }

  function uniqueName(name, used) {
    let out = name;
    let n = 2;
    while (used.has(out)) {
      out = name.replace(/\.jpg$/i, `-${n}.jpg`);
      n += 1;
    }
    used.add(out);
    return out;
  }

  function paintSquare(ctx, bitmap, size, layout) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = layout.canvas || "#ffffff";
    ctx.fillRect(0, 0, size, size);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const offsetY = size * (layout.offsetY || 0);
    if (layout.filter) ctx.filter = layout.filter;
    let dw;
    let dh;
    let dx;
    let dy;
    if (layout.cover) {
      const zoom = layout.zoom || 1;
      const scale = Math.max(size / srcW, size / srcH) * zoom;
      dw = srcW * scale;
      dh = srcH * scale;
      dx = (size - dw) / 2;
      dy = (size - dh) / 2 + offsetY;
    } else {
      const border = Number(layout.border) || 0;
      const inner = Math.max(8, size - border * 2);
      const pad = layout.pad == null ? 0.86 : layout.pad;
      const frame = inner * pad;
      const scale = Math.min(frame / srcW, frame / srcH);
      dw = srcW * scale;
      dh = srcH * scale;
      dx = (size - dw) / 2;
      dy = (size - dh) / 2 + offsetY;
    }
    ctx.drawImage(bitmap, dx, dy, dw, dh);
    ctx.filter = "none";
    if (!layout.cover && layout.border > 0) {
      ctx.strokeStyle = layout.borderColor || "#e5e5e5";
      ctx.lineWidth = layout.border;
      ctx.strokeRect(layout.border / 2, layout.border / 2, size - layout.border, size - layout.border);
    }
    ctx.restore();
  }

  function sourceWarn(srcW, srcH, size, blob, maxBytes) {
    const warn = [];
    if (Math.min(srcW, srcH) < 500) warn.push("Source is under 500px — it may look soft on zoom.");
    else if (Math.min(srcW, srcH) < size * 0.7) warn.push("Source is smaller than the target size — edges may look soft.");
    if (blob.size > maxBytes) warn.push("Still over the size cap after compress. Try a simpler photo.");
    return warn;
  }

  async function encodeCanvas(canvas, preset, stem, tag, extra) {
    const blob = await encodeJpeg(canvas, preset.maxBytes, preset.quality);
    return {
      blob,
      width: canvas.width,
      height: canvas.height,
      bytes: blob.size,
      name: `${stem}-${tag}.jpg`,
      warn: extra.warn || [],
      originalName: extra.originalName,
      label: extra.label || "",
      layoutId: extra.layoutId || ""
    };
  }

  async function processFile(file, options) {
    const preset = PRESETS[options.preset] || PRESETS.both;
    const white = options.white !== false;
    const size = preset.size;
    const bitmap = await loadBitmap(file);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (!srcW || !srcH) throw new Error("This image has no size.");

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { alpha: false });
    paintSquare(ctx, bitmap, size, white ? { pad: 0.86 } : { cover: true, zoom: 1 });
    if (typeof bitmap.close === "function") bitmap.close();

    const blob = await encodeJpeg(canvas, preset.maxBytes, preset.quality);
    return {
      blob,
      width: size,
      height: size,
      srcW,
      srcH,
      bytes: blob.size,
      name: `${stemOf(file.name)}-${preset.tag}.jpg`,
      warn: sourceWarn(srcW, srcH, size, blob, preset.maxBytes),
      originalName: file.name
    };
  }

  async function processShippingFile(file, used) {
    const preset = PRESETS.meesho;
    const bitmap = await loadBitmap(file);
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (!srcW || !srcH) throw new Error("This image has no size.");
    const stem = stemOf(file.name);
    const canvas = document.createElement("canvas");
    canvas.width = preset.size;
    canvas.height = preset.size;
    const ctx = canvas.getContext("2d", { alpha: false });
    const items = [];
    for (const layout of shippingLayouts()) {
      paintSquare(ctx, bitmap, preset.size, layout);
      const item = await encodeCanvas(canvas, preset, stem, `ship-${layout.id}`, {
        originalName: file.name,
        label: layout.label,
        layoutId: layout.id
      });
      item.warn = sourceWarn(srcW, srcH, preset.size, item.blob, preset.maxBytes);
      item.name = uniqueName(item.name, used);
      items.push(item);
    }
    if (typeof bitmap.close === "function") bitmap.close();
    return items;
  }

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${Math.round(n / 102.4) / 10} KB`;
    return `${Math.round(n / 104857.6) / 10} MB`;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function gate() {
    if (typeof window.requireAccess === "function") return window.requireAccess();
    if (typeof LFLicense !== "undefined" && LFLicense.status) {
      const access = await LFLicense.status();
      if (access.ok) return true;
      const wall = document.getElementById("paywall");
      if (wall) wall.classList.remove("hidden");
      return false;
    }
    return true;
  }

  function optionsFrom(root) {
    const preset = root.querySelector('input[name="photo-preset"]:checked')?.value || "both";
    const white = root.querySelector("#photo-white")?.checked !== false;
    return { preset, white };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderItem(item, i) {
    if (!item.blob) {
      const msg = (item.warn && item.warn[0]) || "Could not process";
      return `<article class="photo-card photo-card-err" data-i="${i}">
      <div>
        <strong>${esc(item.name || "Photo")}</strong>
        <p class="photo-warn">${esc(msg)}</p>
      </div>
    </article>`;
    }
    if (!item.previewUrl) item.previewUrl = URL.createObjectURL(item.blob);
    const url = item.previewUrl;
    const warn = item.warn.length ? `<p class="photo-warn">${esc(item.warn[0])}</p>` : "";
    const title = item.label ? item.label : item.name;
    const meta = item.label
      ? `${esc(item.name)} · ${fmtBytes(item.bytes)}`
      : `${item.width}×${item.height} · ${fmtBytes(item.bytes)} · EXIF stripped`;
    return `<article class="photo-card" data-i="${i}">
      <img alt="" src="${url}" />
      <div>
        <strong>${esc(title)}</strong>
        <p class="muted tiny">${meta}</p>
        ${warn}
        <button class="btn-ghost sm-btn photo-one" type="button" data-i="${i}">Download</button>
      </div>
    </article>`;
  }

  function mount(root, opts) {
    const compact = !!(opts && opts.compact);
    root.innerHTML = `
      <section class="card">
        <p class="section-label">Listing photo kit</p>
        <div class="photo-seg photo-seg-2" role="radiogroup" aria-label="Photo kit mode">
          <label class="photo-seg-item">
            <input type="radio" name="photo-mode" value="listing" checked />
            <span>Listing square</span>
          </label>
          <label class="photo-seg-item">
            <input type="radio" name="photo-mode" value="shipping" />
            <span>Shipping variants</span>
          </label>
        </div>
        <p id="photo-mode-hint" class="sku-hint">Resize to a square, compress, strip EXIF. Optional white canvas pads the photo — it does not cut out an existing background.</p>
        <div id="photo-listing-opts">
          <div class="photo-seg" role="radiogroup" aria-label="Marketplace size">
            ${Object.values(PRESETS)
              .map(
                (p, i) => `<label class="photo-seg-item">
              <input type="radio" name="photo-preset" value="${p.id}" ${i === 2 ? "checked" : ""} />
              <span>${p.label}</span>
            </label>`
              )
              .join("")}
          </div>
          <p id="photo-hint" class="muted tiny">${PRESETS.both.hint}</p>
          <label class="check photo-white">
            <input id="photo-white" type="checkbox" checked />
            <span>White background (pad on a square)</span>
          </label>
        </div>
        <p id="photo-ship-hint" class="muted tiny hidden">29 Meesho 1080×1080 layouts per photo (how large the product sits in the square, plus a few borders). Upload them on Add Product and compare Meesho’s shipping quote yourself. List Pilot does not log in or read the rupee amount. No fake sale tags.</p>
      </section>
      <label class="photo-drop" id="photo-drop">
        <input id="photo-files" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.bmp" multiple hidden />
        <strong id="photo-drop-title">Drop photos here</strong>
        <span id="photo-drop-sub" class="muted tiny">or click to choose · JPG, PNG, WebP</span>
      </label>
      ${compact ? `<button id="photo-open-tab" class="btn-ghost" type="button">Open in a larger window</button>` : ""}
      <div class="label-row">
        <span class="section-label">Ready files <span id="photo-count" class="count">0</span></span>
        <button id="photo-download-all" class="btn-mini hidden" type="button">Download zip</button>
      </div>
      <div id="photo-list" class="photo-list"></div>
      <p id="photo-status" class="muted tiny"></p>
    `;

    const filesInput = root.querySelector("#photo-files");
    const drop = root.querySelector("#photo-drop");
    const list = root.querySelector("#photo-list");
    const countEl = root.querySelector("#photo-count");
    const zipBtn = root.querySelector("#photo-download-all");
    const statusEl = root.querySelector("#photo-status");
    const hint = root.querySelector("#photo-hint");
    const listingOpts = root.querySelector("#photo-listing-opts");
    const shipHint = root.querySelector("#photo-ship-hint");
    const modeHint = root.querySelector("#photo-mode-hint");
    const dropTitle = root.querySelector("#photo-drop-title");
    const dropSub = root.querySelector("#photo-drop-sub");
    let results = [];
    let shipMode = false;

    function isShipMode() {
      return root.querySelector('input[name="photo-mode"]:checked')?.value === "shipping";
    }

    function syncMode() {
      shipMode = isShipMode();
      listingOpts.classList.toggle("hidden", shipMode);
      shipHint.classList.toggle("hidden", !shipMode);
      root.querySelector("#photo-list").classList.toggle("photo-list-ship", shipMode);
      modeHint.textContent = shipMode
        ? "Makes several white-canvas layouts from one product photo. You still compare shipping on the Meesho listing page."
        : "Resize to a square, compress, strip EXIF. Optional white canvas pads the photo — it does not cut out an existing background.";
      dropTitle.textContent = shipMode ? "Drop 1–3 product photos" : "Drop photos here";
      dropSub.textContent = shipMode
        ? "Meesho 1080×1080 variants · JPG, PNG, WebP"
        : "or click to choose · JPG, PNG, WebP";
      zipBtn.textContent = shipMode ? "Download variants zip" : "Download zip";
    }

    function setStatus(text, bad) {
      statusEl.textContent = text || "";
      statusEl.classList.toggle("photo-bad", !!bad);
    }

    function paintResults() {
      list.innerHTML = results.map(renderItem).join("");
      countEl.textContent = String(results.length);
      zipBtn.classList.toggle("hidden", results.length === 0);
    }

    root.querySelectorAll('input[name="photo-preset"]').forEach((el) => {
      el.addEventListener("change", () => {
        const p = PRESETS[el.value] || PRESETS.both;
        hint.textContent = p.hint;
      });
    });
    root.querySelectorAll('input[name="photo-mode"]').forEach((el) => {
      el.addEventListener("change", () => {
        syncMode();
        results.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl));
        results = [];
        paintResults();
        setStatus("");
      });
    });
    syncMode();

    async function run(fileList) {
      const incoming = [...fileList].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(f.name));
      if (!incoming.length) {
        setStatus("Choose JPG, PNG, or WebP photos.", true);
        return;
      }
      if (isShipMode() && incoming.length > 3) incoming.length = 3;
      results.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl));
      results = [];
      paintResults();
      setStatus(`Working… 0/${incoming.length}`);
      const used = new Set();
      if (isShipMode()) {
        for (let i = 0; i < incoming.length; i++) {
          setStatus(`Shipping layouts… ${i + 1}/${incoming.length}`);
          try {
            const batch = await processShippingFile(incoming[i], used);
            results.push(...batch);
            paintResults();
          } catch (err) {
            results.push({
              error: true,
              name: incoming[i].name,
              warn: [err.message || "Could not process"],
              blob: null
            });
            paintResults();
          }
        }
        const ok = results.filter((r) => r.blob).length;
        setStatus(
          ok
            ? `${ok} shipping layouts. Download the zip, upload on Meesho Add Product, and compare the shipping quote there.`
            : "Nothing processed.",
          !ok
        );
        return;
      }
      const opts = optionsFrom(root);
      for (let i = 0; i < incoming.length; i++) {
        setStatus(`Working… ${i + 1}/${incoming.length}`);
        try {
          const item = await processFile(incoming[i], opts);
          item.name = uniqueName(item.name, used);
          results.push(item);
          paintResults();
        } catch (err) {
          results.push({
            error: true,
            name: incoming[i].name,
            warn: [err.message || "Could not process"],
            blob: null
          });
          paintResults();
        }
      }
      const ok = results.filter((r) => r.blob).length;
      setStatus(ok ? `${ok} listing-ready JPEG${ok === 1 ? "" : "s"}.` : "Nothing processed.", !ok);
    }

    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("photo-drop-on");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("photo-drop-on"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("photo-drop-on");
      run(e.dataTransfer.files);
    });
    filesInput.addEventListener("change", () => {
      run(filesInput.files);
      filesInput.value = "";
    });

    list.addEventListener("click", async (e) => {
      const btn = e.target.closest(".photo-one");
      if (!btn) return;
      if (!(await gate())) return;
      const item = results[Number(btn.dataset.i)];
      if (item?.blob) downloadBlob(item.blob, item.name);
    });

    zipBtn.addEventListener("click", async () => {
      if (!(await gate())) return;
      const ok = results.filter((r) => r.blob);
      if (!ok.length) return;
      const used = new Set();
      const entries = [];
      for (const item of ok) {
        entries.push({ name: uniqueName(item.name, used), data: await blobToU8(item.blob) });
      }
      if (shipMode || results.some((r) => r.layoutId)) {
        entries.unshift({ name: "HOW-TO-COMPARE.txt", data: new TextEncoder().encode(SHIP_NOTE) });
        const zip = zipStore(entries);
        downloadBlob(new Blob([zip], { type: "application/zip" }), "list-pilot-shipping-variants.zip");
        return;
      }
      const zip = zipStore(entries);
      downloadBlob(new Blob([zip], { type: "application/zip" }), "list-pilot-photos.zip");
    });

    const openTab = root.querySelector("#photo-open-tab");
    if (openTab) {
      openTab.addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("photos.html") });
      });
    }
  }

  window.LFPhotos = { PRESETS, processFile, processShippingFile, shippingLayouts, zipStore, mount };
})();
