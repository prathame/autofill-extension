(function () {
  const PRESETS = {
    meesho: { id: "meesho", size: 1080, maxBytes: 1572864, quality: 0.86, tag: "meesho", label: "Meesho", hint: "1080×1080 JPEG · under 1.5 MB" },
    flipkart: { id: "flipkart", size: 1500, maxBytes: 2097152, quality: 0.88, tag: "flipkart", label: "Flipkart", hint: "1500×1500 JPEG · under 2 MB" },
    both: { id: "both", size: 1500, maxBytes: 1572864, quality: 0.86, tag: "listing", label: "Both", hint: "1500×1500 JPEG · fits Meesho and Flipkart" }
  };

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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    let dw;
    let dh;
    let dx;
    let dy;
    if (white) {
      const inner = size * 0.86;
      const scale = Math.min(inner / srcW, inner / srcH);
      dw = srcW * scale;
      dh = srcH * scale;
      dx = (size - dw) / 2;
      dy = (size - dh) / 2;
    } else {
      const scale = Math.max(size / srcW, size / srcH);
      dw = srcW * scale;
      dh = srcH * scale;
      dx = (size - dw) / 2;
      dy = (size - dh) / 2;
    }
    ctx.drawImage(bitmap, dx, dy, dw, dh);
    if (typeof bitmap.close === "function") bitmap.close();

    const blob = await encodeJpeg(canvas, preset.maxBytes, preset.quality);
    const warn = [];
    if (Math.min(srcW, srcH) < 500) warn.push("Source is under 500px — it may look soft on zoom.");
    else if (Math.min(srcW, srcH) < size * 0.7) warn.push("Source is smaller than the target size — edges may look soft.");
    if (blob.size > preset.maxBytes) warn.push("Still over the size cap after compress. Try a simpler photo.");

    return {
      blob,
      width: size,
      height: size,
      srcW,
      srcH,
      bytes: blob.size,
      name: `${stemOf(file.name)}-${preset.tag}.jpg`,
      warn,
      originalName: file.name
    };
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
    return `<article class="photo-card" data-i="${i}">
      <img alt="" src="${url}" />
      <div>
        <strong>${esc(item.name)}</strong>
        <p class="muted tiny">${item.width}×${item.height} · ${fmtBytes(item.bytes)} · EXIF stripped</p>
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
        <p class="sku-hint">Resize to a square, compress, strip EXIF. Optional white canvas pads the photo — it does not cut out an existing background.</p>
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
      </section>
      <label class="photo-drop" id="photo-drop">
        <input id="photo-files" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.bmp" multiple hidden />
        <strong>Drop photos here</strong>
        <span class="muted tiny">or click to choose · JPG, PNG, WebP</span>
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
    let results = [];

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

    async function run(fileList) {
      const incoming = [...fileList].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(f.name));
      if (!incoming.length) {
        setStatus("Choose JPG, PNG, or WebP photos.", true);
        return;
      }
      results.forEach((r) => r.previewUrl && URL.revokeObjectURL(r.previewUrl));
      results = [];
      paintResults();
      setStatus(`Working… 0/${incoming.length}`);
      const used = new Set();
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

  window.LFPhotos = { PRESETS, processFile, zipStore, mount };
})();
