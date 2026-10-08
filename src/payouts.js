(function () {
  const ID_SPECS = [
    { kind: "sub", re: /^(sub order( no| id| num| number)?|suborder( no| id| num)?|sub_order_(no|id|num)|sub orderno)$/ },
    { kind: "item", re: /^(order item id|order_item_id|orderitemid|oi id)$/ },
    { kind: "order", re: /^(order id|order_id|order no|order_no|order num|order_num|order number|order_number)$/ }
  ];
  const SKIP_SHEET = /disclaimer|ads cost|^ads$|referral|compensation and recovery|^summary$|^tcs$|^tds$|^pla$|overview|^cover$/i;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function normHeader(h) {
    return String(h || "")
      .toLowerCase()
      .replace(/[_./-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normId(v) {
    return String(v || "")
      .trim()
      .toUpperCase()
      .replace(/^OI:\s*/, "")
      .replace(/\s+/g, "");
  }

  function parseMoney(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const raw = String(v).trim();
    if (!raw) return null;
    const parenNeg = /^\(.*\)$/.test(raw);
    const n = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return null;
    return parenNeg && n > 0 ? -n : n;
  }

  function fmtMoney(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    const abs = Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    return (n < 0 ? "-₹" : "₹") + abs;
  }

  function parseCsvText(text, delim) {
    const rows = [];
    let row = [];
    let cell = "";
    let q = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        if (cell.endsWith("\r")) cell = cell.slice(0, -1);
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += ch;
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim()));
  }

  function detectDelim(text) {
    const line = String(text).split(/\r?\n/).find((l) => l.trim()) || "";
    const commas = (line.match(/,/g) || []).length;
    const semis = (line.match(/;/g) || []).length;
    const tabs = (line.match(/\t/g) || []).length;
    if (tabs > commas && tabs > semis) return "\t";
    if (semis > commas) return ";";
    return ",";
  }

  function findIdCols(headers) {
    const found = [];
    headers.forEach((h, i) => {
      const n = normHeader(h);
      for (const spec of ID_SPECS) {
        if (spec.re.test(n)) found.push({ kind: spec.kind, index: i, header: h });
      }
    });
    return found;
  }

  function amountRank(n) {
    if (/final settlement amount|net settlement amount/.test(n)) return 6;
    if (/settlement amount/.test(n)) return 5;
    if (/supplier discounted price/.test(n)) return 4;
    if (/supplier listed price/.test(n)) return 3;
    if (/^(net amount|payable amount|payout amount|selling price|product price|order amount|gmv|amount)$/.test(n)) return 1;
    return -1;
  }

  function findAmountCol(headers) {
    let best = -1;
    let rank = -1;
    headers.forEach((h, i) => {
      const r = amountRank(normHeader(h));
      if (r > rank) {
        rank = r;
        best = i;
      }
    });
    return best;
  }

  function findSkuCol(headers) {
    return headers.findIndex((h) => /^(supplier sku|seller sku|sku id|sku)$/.test(normHeader(h)));
  }

  function findStatusCol(headers) {
    return headers.findIndex((h) => /live order status|reason for credit entry|^(status|order status|payment status)$/.test(normHeader(h)));
  }

  function headerScore(headers) {
    const ids = findIdCols(headers);
    if (!ids.length) return -1;
    return ids.length * 4 + (findAmountCol(headers) >= 0 ? 3 : 0);
  }

  function tableFromMatrix(matrix, source) {
    let best = -1;
    let bestScore = -1;
    const max = Math.min(matrix.length, 25);
    for (let i = 0; i < max; i++) {
      const score = headerScore(matrix[i] || []);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    const headers = (matrix[best] || []).map((h, i) => String(h || "").trim() || `col_${i}`);
    const objects = [];
    for (let r = best + 1; r < matrix.length; r++) {
      const line = matrix[r] || [];
      if (!line.some((c) => String(c).trim())) continue;
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = line[i] == null ? "" : line[i];
      });
      objects.push(obj);
    }
    return {
      headers,
      rows: objects,
      idCols: findIdCols(headers),
      amountCol: findAmountCol(headers),
      skuCol: findSkuCol(headers),
      statusCol: findStatusCol(headers),
      source
    };
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(u8) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65535; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Could not read this Excel/zip file.");
    const count = view.getUint16(eocd + 10, true);
    let cd = view.getUint32(eocd + 16, true);
    const out = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(cd, true) !== 0x02014b50) throw new Error("Could not read this Excel/zip file.");
      const method = view.getUint16(cd + 10, true);
      const compSize = view.getUint32(cd + 20, true);
      const nameLen = view.getUint16(cd + 28, true);
      const extraLen = view.getUint16(cd + 30, true);
      const commentLen = view.getUint16(cd + 32, true);
      const localOff = view.getUint32(cd + 42, true);
      const name = dec.decode(u8.slice(cd + 46, cd + 46 + nameLen)).replace(/\\/g, "/");
      const localNameLen = view.getUint16(localOff + 26, true);
      const localExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + localNameLen + localExtraLen;
      const packed = u8.slice(start, start + compSize);
      let data = packed;
      if (method === 8) data = await inflateRaw(packed);
      else if (method !== 0) throw new Error("Unsupported zip compression in " + name);
      if (!name.endsWith("/")) out[name] = data;
      cd += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function colFromRef(ref) {
    const m = String(ref).match(/^([A-Z]+)/i);
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function rowFromRef(ref) {
    const m = String(ref).match(/(\d+)$/);
    return m ? Number(m[1]) - 1 : 0;
  }

  function sstValues(doc) {
    const out = [];
    for (const si of [...doc.getElementsByTagName("si")]) {
      out.push([...si.getElementsByTagName("t")].map((t) => t.textContent || "").join(""));
    }
    return out;
  }

  function sheetToMatrix(doc, sst) {
    const rows = [];
    for (const c of [...doc.getElementsByTagName("c")]) {
      const ref = c.getAttribute("r") || "";
      const r = rowFromRef(ref);
      const col = colFromRef(ref);
      if (!rows[r]) rows[r] = [];
      const t = c.getAttribute("t") || "";
      let v = "";
      if (t === "s") {
        const idx = Number((c.getElementsByTagName("v")[0] || {}).textContent || 0);
        v = sst[idx] || "";
      } else if (t === "inlineStr") {
        v = [...c.getElementsByTagName("t")].map((n) => n.textContent || "").join("");
      } else {
        const node = c.getElementsByTagName("v")[0];
        v = node ? node.textContent : "";
      }
      rows[r][col] = v;
    }
    return rows.map((r) => r || []);
  }

  function decodeXml(bytes) {
    const text = new TextDecoder("utf-8").decode(bytes);
    return new DOMParser().parseFromString(text, "application/xml");
  }

  async function parseXlsx(bytes, label) {
    const files = await unzip(bytes);
    const sstFile = files["xl/sharedStrings.xml"];
    const sst = sstFile ? sstValues(decodeXml(sstFile)) : [];
    const wb = files["xl/workbook.xml"];
    if (!wb) throw new Error("Not a valid Excel workbook.");
    const rels = files["xl/_rels/workbook.xml.rels"];
    const relMap = {};
    if (rels) {
      for (const rel of [...decodeXml(rels).getElementsByTagName("Relationship")]) {
        relMap[rel.getAttribute("Id")] = (rel.getAttribute("Target") || "").replace(/^\//, "");
      }
    }
    const wbDoc = decodeXml(wb);
    const candidates = [];
    for (const sh of [...wbDoc.getElementsByTagName("sheet")]) {
      const name = sh.getAttribute("name") || "Sheet";
      if (SKIP_SHEET.test(name.trim())) continue;
      const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let path = rid && relMap[rid] ? relMap[rid] : "";
      if (path && !path.startsWith("xl/")) path = "xl/" + path.replace(/^\.\//, "");
      const data = path && files[path];
      if (!data) continue;
      const matrix = sheetToMatrix(decodeXml(data), sst);
      const table = tableFromMatrix(matrix, `${label} · ${name}`);
      if (table) candidates.push(table);
    }
    if (!candidates.length) {
      const sheetFiles = Object.keys(files).filter((k) => /xl\/worksheets\/sheet\d+\.xml$/i.test(k));
      for (const path of sheetFiles) {
        const table = tableFromMatrix(sheetToMatrix(decodeXml(files[path]), sst), label);
        if (table) candidates.push(table);
      }
    }
    candidates.sort((a, b) => {
      const pref = (t) => (/order payment/i.test(t.source) ? 1 : 0);
      return pref(b) - pref(a) || b.rows.length - a.rows.length || headerScore(b.headers) - headerScore(a.headers);
    });
    if (!candidates.length) throw new Error("No order or payout columns found in " + label);
    return candidates[0];
  }

  async function parseZipBundle(bytes, label) {
    const files = await unzip(bytes);
    const names = Object.keys(files).filter((n) => !n.endsWith("/") && !n.startsWith("__MACOSX"));
    const pick = names.find((n) => /\.(csv|tsv|xlsx)$/i.test(n)) || names.find((n) => /\.xls$/i.test(n));
    if (!pick) throw new Error("The zip has no CSV or Excel file.");
    const inner = new File([files[pick]], pick.split("/").pop(), { type: "application/octet-stream" });
    return parseFile(inner);
  }

  async function parseFile(file) {
    const name = file.name || "file";
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
      const looksXlsx = name.toLowerCase().endsWith(".xlsx") || new TextDecoder("latin1").decode(buf.slice(0, Math.min(buf.length, 800))).includes("xl/");
      if (looksXlsx && !name.toLowerCase().endsWith(".zip")) return parseXlsx(buf, name);
      try {
        return await parseXlsx(buf, name);
      } catch (_) {
        return await parseZipBundle(buf, name);
      }
    }
    if (/\.xls$/i.test(name) && !/\.xlsx$/i.test(name)) {
      throw new Error("Old .xls is not supported. Open it and Save As CSV or .xlsx.");
    }
    const text = new TextDecoder("utf-8").decode(buf);
    const table = tableFromMatrix(parseCsvText(text, detectDelim(text)), name);
    if (!table) throw new Error("Could not find Order ID / Sub Order / Order Item ID in " + name);
    return table;
  }

  function rowIds(table, row) {
    const ids = [];
    for (const col of table.idCols) {
      const v = normId(row[table.headers[col.index]]);
      if (v) ids.push({ kind: col.kind, v });
    }
    return ids;
  }

  function rowAmount(table, row) {
    if (table.amountCol < 0) return null;
    return parseMoney(row[table.headers[table.amountCol]]);
  }

  function rowMeta(table, row) {
    const sku = table.skuCol >= 0 ? String(row[table.headers[table.skuCol]] || "") : "";
    const status = table.statusCol >= 0 ? String(row[table.headers[table.statusCol]] || "") : "";
    return { sku, status };
  }

  function preferKind(a, b) {
    const rank = { sub: 3, item: 3, order: 1 };
    const kinds = new Set([...a.idCols, ...b.idCols].map((c) => c.kind));
    if (kinds.has("sub") && a.idCols.some((c) => c.kind === "sub") && b.idCols.some((c) => c.kind === "sub")) return "sub";
    if (kinds.has("item") && a.idCols.some((c) => c.kind === "item") && b.idCols.some((c) => c.kind === "item")) return "item";
    return [...kinds].sort((x, y) => (rank[y] || 0) - (rank[x] || 0))[0] || "order";
  }

  function matchTables(orders, payouts) {
    const kind = preferKind(orders, payouts);
    const orderIndex = new Map();
    const orderRows = orders.rows.map((row, i) => {
      const ids = rowIds(orders, row).filter((id) => id.kind === kind);
      const fallback = rowIds(orders, row);
      const use = ids.length ? ids : fallback;
      const rec = {
        i,
        ids: use,
        amount: rowAmount(orders, row),
        ...rowMeta(orders, row),
        id: (use[0] && use[0].v) || "",
        matched: false
      };
      for (const id of use) {
        if (!orderIndex.has(id.v)) orderIndex.set(id.v, rec);
      }
      return rec;
    });

    const payRows = [];
    const extra = [];
    for (const row of payouts.rows) {
      const ids = rowIds(payouts, row);
      const preferred = ids.filter((id) => id.kind === kind);
      const use = preferred.length ? preferred : ids;
      if (!use.length) continue;
      const rec = {
        ids: use,
        amount: rowAmount(payouts, row),
        ...rowMeta(payouts, row),
        id: (use[0] && use[0].v) || ""
      };
      let hit = null;
      for (const id of use) {
        hit = orderIndex.get(id.v);
        if (hit) break;
      }
      if (hit) {
        hit.matched = true;
        if (!hit.paid) hit.paid = 0;
        if (rec.amount != null) hit.paid += rec.amount;
        if (!hit.payStatus && rec.status) hit.payStatus = rec.status;
        payRows.push(rec);
      } else extra.push(rec);
    }

    const matched = [];
    const unpaid = [];
    for (const rec of orderRows) {
      if (!rec.id) continue;
      if (rec.matched) {
        rec.delta = (rec.paid || 0) - (rec.amount == null ? rec.paid || 0 : rec.amount);
        matched.push(rec);
      } else unpaid.push(rec);
    }

    const sum = (list, key) => list.reduce((s, r) => s + (r[key] == null ? 0 : r[key]), 0);
    return {
      kind,
      matched,
      unpaid,
      extra,
      totals: {
        orders: orderRows.filter((r) => r.id).length,
        paid: matched.length,
        unpaid: unpaid.length,
        extra: extra.length,
        orderAmount: sum(orderRows, "amount"),
        paidAmount: sum(matched, "paid"),
        unpaidAmount: sum(unpaid, "amount")
      }
    };
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function resultCsv(result) {
    const lines = [["bucket", "id", "sku", "status", "order_amount", "paid_amount", "delta"].map(csvEscape).join(",")];
    const push = (bucket, r) => {
      lines.push(
        [bucket, r.id, r.sku, r.status || r.payStatus || "", r.amount, r.paid, r.delta]
          .map(csvEscape)
          .join(",")
      );
    };
    result.matched.forEach((r) => push("matched", r));
    result.unpaid.forEach((r) => push("unpaid", r));
    result.extra.forEach((r) => push("payout_only", r));
    return lines.join("\n");
  }

  function downloadText(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function gate() {
    if (typeof window.requireAccess === "function") return window.requireAccess();
    return true;
  }

  function listHtml(title, rows, kind) {
    const show = rows.slice(0, 40);
    const more = rows.length > 40 ? `<p class="muted tiny">+ ${rows.length - 40} more in the CSV download</p>` : "";
    const body = show.length
      ? show
          .map((r) => {
            const money =
              kind === "unpaid"
                ? fmtMoney(r.amount)
                : kind === "extra"
                  ? fmtMoney(r.amount)
                  : `${fmtMoney(r.amount)} → ${fmtMoney(r.paid)}`;
            return `<div class="pay-row"><span class="mono">${esc(r.id || "—")}</span><span>${esc(r.sku || "")}</span><span>${money}</span></div>`;
          })
          .join("")
      : `<p class="muted tiny">None</p>`;
    return `<section class="card"><p class="section-label">${esc(title)} <span class="count">${rows.length}</span></p><div class="pay-rows">${body}</div>${more}</section>`;
  }

  function mount(root, opts) {
    const compact = !!(opts && opts.compact);
    const R = typeof LFPnl !== "undefined" ? LFPnl.rupee : fmtMoney;
    root.innerHTML = `
      <section class="card">
        <p class="section-label">Meesho P&amp;L report</p>
        <p class="sku-hint">Same flow as a monthly profit report: orders for the month, Payments to Date zip for that month, then the next month’s zip so late settlements are not counted as unpaid. Files stay on this computer. No seller-panel login.</p>
        <p class="muted tiny">Meesho → Orders → Download order data. Payments → Download → Payments to Date (keep the zip). Repeat Payments to Date for the following month (at least 15 days).</p>
      </section>
      <label class="photo-drop" id="pnl-orders-drop">
        <input id="pnl-orders" type="file" accept=".csv,.tsv,.xlsx,.zip,text/csv" hidden />
        <strong id="pnl-orders-name">1. Order file</strong>
        <span class="muted tiny">Month orders CSV</span>
      </label>
      <label class="photo-drop" id="pnl-pay1-drop">
        <input id="pnl-pay1" type="file" accept=".xlsx,.zip" hidden />
        <strong id="pnl-pay1-name">2. This month payments</strong>
        <span class="muted tiny">Payments to Date zip — do not unzip</span>
      </label>
      <label class="photo-drop" id="pnl-pay2-drop">
        <input id="pnl-pay2" type="file" accept=".xlsx,.zip" hidden />
        <strong id="pnl-pay2-name">3. Next month payments</strong>
        <span class="muted tiny">Needed for delayed payouts</span>
      </label>
      <label class="tiny">Misc monthly cost (rent etc.)
        <input id="pnl-misc" class="input sm" type="number" min="0" step="1" value="0" />
      </label>
      <button id="pay-run" class="btn-glow" type="button">Build P&amp;L</button>
      ${compact ? `<button id="pay-open-tab" class="btn-ghost" type="button">Open in a larger window</button>` : ""}
      <p id="pay-status" class="muted tiny"></p>
      <div id="pay-out"></div>
    `;

    let orderFile = null;
    let payNowFile = null;
    let payNextFile = null;
    let lastReport = null;
    const statusEl = root.querySelector("#pay-status");
    const out = root.querySelector("#pay-out");

    function setStatus(text, bad) {
      statusEl.textContent = text || "";
      statusEl.classList.toggle("photo-bad", !!bad);
    }

    function bindDrop(drop, input, nameEl, assign) {
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop.classList.add("photo-drop-on");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("photo-drop-on"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("photo-drop-on");
        const f = e.dataTransfer.files[0];
        if (f) {
          assign(f);
          nameEl.textContent = f.name;
        }
      });
      input.addEventListener("change", () => {
        const f = input.files[0];
        if (f) {
          assign(f);
          nameEl.textContent = f.name;
        }
        input.value = "";
      });
    }

    bindDrop(root.querySelector("#pnl-orders-drop"), root.querySelector("#pnl-orders"), root.querySelector("#pnl-orders-name"), (f) => {
      orderFile = f;
    });
    bindDrop(root.querySelector("#pnl-pay1-drop"), root.querySelector("#pnl-pay1"), root.querySelector("#pnl-pay1-name"), (f) => {
      payNowFile = f;
    });
    bindDrop(root.querySelector("#pnl-pay2-drop"), root.querySelector("#pnl-pay2"), root.querySelector("#pnl-pay2-name"), (f) => {
      payNextFile = f;
    });

    function share(n, base) {
      if (!base) return "0%";
      return ((Math.abs(n) / Math.abs(base)) * 100).toFixed(1) + "%";
    }

    function barRow(label, n, total, tone) {
      const pct = total ? (n / total) * 100 : 0;
      return `<div class="pnl-bar-row">
        <div class="pnl-bar-meta"><span>${LFPnl.esc(label)}</span><strong>${n.toLocaleString("en-IN")} · ${pct.toFixed(1)}%</strong></div>
        <div class="pnl-bar"><i class="${tone || ""}" style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>
      </div>`;
    }

    function skuTable(rows, kind) {
      const max = Math.max(...rows.map((s) => Math.abs(s.net)), 1);
      return `<div class="pnl-scroll"><table class="pnl-table pnl-table-wide">
        <thead><tr><th>SKU</th><th>Action</th><th>Payout</th><th>Qty</th><th>Net / margin</th><th>Return %</th></tr></thead>
        <tbody>${rows
          .map((s) => {
            const w = (Math.abs(s.net) / max) * 100;
            return `<tr>
              <td><strong>${LFPnl.esc(s.sku || "—")}</strong>${s.catalogId ? `<div class="muted tiny">Catalog ${LFPnl.esc(s.catalogId)}</div>` : ""}</td>
              <td><span class="pnl-pill ${kind}">${LFPnl.esc(s.action)}</span></td>
              <td>${R(s.paid)}</td>
              <td>${s.qty}</td>
              <td>
                <div class="pnl-mini-bar"><i class="${kind}" style="width:${w}%"></i></div>
                ${R(s.net)} · ${LFPnl.pct(s.margin)}
              </td>
              <td>${LFPnl.pct(s.retPct)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="6" class="muted tiny">None in this band.</td></tr>`}
        </tbody></table></div>`;
    }

    function costTable(rep, costs) {
      const rows = rep.skus
        .slice(0, compact ? 12 : 200)
        .map(
          (s) => `<tr>
          <td>${LFPnl.esc(s.sku || "—")}</td>
          <td>${s.n}</td>
          <td><input class="input sm pnl-cost" data-sku="${LFPnl.esc(s.sku)}" data-k="product" type="number" min="0" step="0.01" value="${costs[s.sku]?.product || ""}" /></td>
          <td><input class="input sm pnl-cost" data-sku="${LFPnl.esc(s.sku)}" data-k="pack" type="number" min="0" step="0.01" value="${costs[s.sku]?.pack || ""}" /></td>
          <td>${R(s.net)}</td>
        </tr>`
        )
        .join("");
      return `<section class="card pnl-sec" id="pnl-costs">
        <p class="section-label">SKU product &amp; pack cost</p>
        <p class="muted tiny">Settlement minus these costs, ads and GST. Empty product cost makes profit look too high.</p>
        <div class="pnl-scroll">
          <table class="pnl-table"><thead><tr><th>SKU</th><th>Rows</th><th>Product ₹</th><th>Pack ₹</th><th>Net now</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
        <button id="pnl-save-costs" class="btn-mini" type="button">Save costs &amp; rebuild</button>
      </section>`;
    }

    function bindReport(rep, costs) {
      out.querySelector("#pay-download")?.addEventListener("click", async () => {
        if (!(await gate())) return;
        downloadText("list-pilot-pnl.csv", LFPnl.reportCsv(rep), "text/csv");
      });
      out.querySelector("#pay-pdf")?.addEventListener("click", async () => {
        if (!(await gate())) return;
        document.body.classList.add("pnl-printing");
        window.print();
        setTimeout(() => document.body.classList.remove("pnl-printing"), 400);
      });
      out.querySelectorAll(".pnl-toc a").forEach((a) => {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const el = out.querySelector(a.getAttribute("href"));
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      const search = out.querySelector("#pnl-order-q");
      const tbody = out.querySelector("#pnl-order-body");
      if (search && tbody) {
        search.addEventListener("input", () => {
          const q = search.value.trim().toLowerCase();
          tbody.querySelectorAll("tr").forEach((tr) => {
            tr.classList.toggle("hidden", q && !tr.textContent.toLowerCase().includes(q));
          });
        });
      }
      out.querySelector("#pnl-save-costs")?.addEventListener("click", async () => {
        const next = { ...costs };
        out.querySelectorAll(".pnl-cost").forEach((el) => {
          const sku = el.getAttribute("data-sku");
          const k = el.getAttribute("data-k");
          if (!next[sku]) next[sku] = {};
          next[sku][k] = el.value === "" ? 0 : Number(el.value);
        });
        await LFPnl.saveCosts(next);
        setStatus("Rebuilding with saved costs…");
        const rebuilt = await LFPnl.run({ orders: orderFile, payNow: payNowFile, payNext: payNextFile }, next, Number(root.querySelector("#pnl-misc").value) || 0);
        lastReport = rebuilt;
        paint(rebuilt, next);
        setStatus("Costs saved. Profit uses product + pack on non-cancelled rows.");
      });
    }

    function paint(rep, costs) {
      const st = rep.statusN;
      lastReport = rep;
      const deliveredPct = Math.round(rep.deliveredPct || 0);
      const winner = rep.profitSkus[0];
      const loser = rep.lossSkus[rep.lossSkus.length - 1] ? [...rep.lossSkus].sort((a, b) => a.net - b.net)[0] : null;
      const splitBase = Math.abs(rep.payout) || 1;
      const topStates = (rep.states || []).slice(0, 8);
      const maxDay = Math.max(...(rep.days || []).map((d) => d.paid), 1);
      const orderRows = (rep.lines || []).slice(0, compact ? 0 : 200);

      if (compact) {
        out.innerHTML = `
          <div class="pnl-hero pnl-hero-sm">
            <div>
              <span class="pnl-k">Net profit</span>
              <strong class="pnl-big">${R(rep.profitAfterGst)}</strong>
              <p class="muted tiny">${LFPnl.pct(rep.margin)} margin · ${R(rep.avgPerOrder)} avg/order · ${rep.skus.length} SKUs</p>
            </div>
            <div class="pay-kpis">
              <div><span>Payout</span><strong>${R(rep.payout)}</strong></div>
              <div><span>Net orders</span><strong>${rep.netOrders}</strong></div>
              <div><span>Loss SKUs</span><strong>${rep.lossSkus.length}</strong></div>
              <div><span>RTO</span><strong>${st.rto || 0}</strong></div>
            </div>
          </div>
          <p class="muted tiny">${rep.pendingCost.length ? `${rep.pendingCost.length} SKUs still need a product cost. ` : ""}Open the large window for the full report, GST, ranking and PDF.</p>
          ${costTable(rep, costs)}
          <div class="row-end pnl-print-hide">
            <button id="pay-download" class="btn-mini" type="button">Download CSV</button>
          </div>`;
        bindReport(rep, costs);
        return;
      }

      out.innerHTML = `
        <article class="pnl-report" id="pnl-report">
          <header class="pnl-hero">
            <div class="pnl-hero-main">
              <span class="pnl-k">Net profit</span>
              <strong class="pnl-big">${R(rep.profitAfterGst)}</strong>
              <div class="pnl-chips">
                <span>${LFPnl.pct(rep.margin)} margin</span>
                <span>${R(rep.avgPerOrder)} avg/order</span>
                <span>${rep.skus.length} SKUs analysed</span>
              </div>
              <div class="pnl-hero-stats">
                <div><span>Total payout</span><strong>${R(rep.payout)}</strong></div>
                <div><span>Net orders</span><strong>${rep.netOrders.toLocaleString("en-IN")}</strong></div>
                <div><span>Loss SKUs</span><strong>${rep.lossSkus.length}</strong></div>
              </div>
            </div>
            <div class="pnl-donut" style="background:conic-gradient(var(--accent) 0 ${deliveredPct}%, var(--subtle) ${deliveredPct}% 100%)">
              <span>${deliveredPct}%<small>delivered</small></span>
            </div>
            <p class="pnl-donut-meta">${rep.orders.toLocaleString("en-IN")} total · ${(st.delivered || 0).toLocaleString("en-IN")} delivered rows</p>
          </header>

          <nav class="pnl-toc pnl-print-hide" aria-label="Report sections">
            <a href="#pnl-mix">SKU mix</a>
            <a href="#pnl-split">Cost split</a>
            <a href="#pnl-status">Status</a>
            <a href="#pnl-actions">Actions</a>
            <a href="#pnl-gst">GST</a>
            <a href="#pnl-trend">Trend</a>
            <a href="#pnl-rank">SKU ranking</a>
            <a href="#pnl-costs">Costs</a>
            <a href="#pnl-orders">Orders</a>
            <a href="#pnl-export">Export</a>
          </nav>

          <section class="card pnl-sec" id="pnl-mix">
            <p class="section-label">SKU count summary</p>
            <p class="muted tiny">Unique SKU codes in this month. Cost rows can be more if you track sizes separately.</p>
            <div class="pnl-stat-grid">
              <div><span>Total unique SKUs</span><strong>${rep.skus.length}</strong></div>
              <div><span>Profit SKUs</span><strong>${rep.profitSkus.length}</strong></div>
              <div><span>Loss SKUs</span><strong>${rep.lossSkus.length}</strong></div>
              <div><span>Cost pending</span><strong>${rep.pendingCost.length}</strong></div>
            </div>
          </section>

          <section class="card pnl-sec" id="pnl-states">
            <p class="section-label">State spread</p>
            <p class="muted tiny">Customer State from the orders CSV. Not a live map — counts only.</p>
            ${topStates.map((s) => barRow(s.state, s.n, rep.orders)).join("") || `<p class="muted tiny">No state column in this file.</p>`}
          </section>

          <section class="card pnl-sec" id="pnl-split">
            <p class="section-label">Revenue split</p>
            <p class="muted tiny">How this month’s payout breaks into costs, ads, GST and the result. Percents are of payout, not a perfect pie.</p>
            <div class="pnl-split">
              <div><span>Net profit</span><strong>${R(rep.profitAfterGst)}</strong><em>${share(rep.profitAfterGst, splitBase)}</em></div>
              <div><span>Product cost</span><strong>${R(rep.productCost)}</strong><em>${share(rep.productCost, splitBase)}</em></div>
              <div><span>Packaging</span><strong>${R(rep.packCost)}</strong><em>${share(rep.packCost, splitBase)}</em></div>
              <div><span>Ads cost</span><strong>${R(rep.ads)}</strong><em>${share(rep.ads, splitBase)}</em></div>
              <div><span>GST impact</span><strong>${R(rep.netGst)}</strong><em>${share(rep.netGst, splitBase)}</em></div>
              <div><span>Recovery</span><strong>${R(rep.recovery + rep.referral)}</strong><em>${share(rep.recovery + rep.referral, splitBase)}</em></div>
            </div>
          </section>

          <section class="card pnl-sec" id="pnl-status">
            <p class="section-label">Order status</p>
            ${barRow("Delivered", st.delivered || 0, rep.orders, "ok")}
            ${barRow("RTO", st.rto || 0, rep.orders, "warn")}
            ${barRow("Return", st.return || 0, rep.orders, "warn")}
            ${barRow("Cancelled", st.cancelled || 0, rep.orders)}
            ${barRow("Shipped", st.shipped || 0, rep.orders)}
            ${barRow("Exchange", st.exchange || 0, rep.orders)}
            <p class="muted tiny">Delivered not in these payout files: ${rep.deliveredUnpaid.length} (${R(rep.deliveredUnpaid.reduce((s, l) => s + l.listed, 0))} listed). Prior-period payout IDs: ${rep.extra.length} (${R(rep.extraPaid)}).</p>
          </section>

          <section class="card pnl-sec" id="pnl-actions">
            <p class="section-label">Action plan</p>
            <div class="pnl-callouts">
              ${loser ? `<div><span>Fix top loss SKU</span><strong>${LFPnl.esc(loser.sku)}</strong><em>${R(loser.net)}</em></div>` : ""}
              ${winner ? `<div><span>Protect winner SKU</span><strong>${LFPnl.esc(winner.sku)}</strong><em>${R(winner.net)}</em></div>` : ""}
              <div><span>Profit if loss SKUs were fixed</span><strong>${R(rep.improvement)}</strong><em>${rep.lossSkus.length} loss SKUs</em></div>
            </div>
            <div class="pnl-scroll"><table class="pnl-table pnl-table-wide">
              <thead><tr><th>#</th><th>SKU</th><th>Action</th><th>Net</th><th>Margin</th><th>Return %</th><th>Why</th></tr></thead>
              <tbody>${(rep.actions || [])
                .map(
                  (a) => `<tr>
                  <td>${a.rank || "★"}</td>
                  <td>${LFPnl.esc(a.sku)}</td>
                  <td>${LFPnl.esc(a.action)}</td>
                  <td>${R(a.net)}</td>
                  <td>${LFPnl.pct(a.margin)}</td>
                  <td>${LFPnl.pct(a.retPct)}</td>
                  <td class="muted tiny">${LFPnl.esc(a.why || "")}</td>
                </tr>`
                )
                .join("") || `<tr><td colspan="7" class="muted tiny">Add SKU costs to rank scale vs stop.</td></tr>`}
              </tbody></table></div>
          </section>

          <section class="card pnl-sec" id="pnl-summary">
            <p class="section-label">Monthly summary</p>
            <div class="kv"><span>Gross orders</span><strong>${rep.orders.toLocaleString("en-IN")}</strong></div>
            <div class="kv"><span>Cancelled / net orders</span><strong>${st.cancelled || 0} / ${rep.netOrders.toLocaleString("en-IN")}</strong></div>
            <div class="kv"><span>RTO %</span><strong>${LFPnl.pct(rep.rtoPct)} · ${st.rto || 0} rows</strong></div>
            <div class="kv"><span>Customer return %</span><strong>${LFPnl.pct(rep.returnPct)} · ${st.return || 0} rows</strong></div>
            <div class="kv"><span>Total payout</span><strong>${R(rep.payout)}</strong></div>
            <div class="kv"><span>Misc cost</span><strong>${R(rep.misc)}</strong></div>
            <div class="kv"><span>Product cost</span><strong>${R(rep.productCost)}</strong></div>
            <div class="kv"><span>Pack cost</span><strong>${R(rep.packCost)}</strong></div>
            <div class="kv"><span>Ads total</span><strong>${R(rep.ads)}</strong></div>
            <div class="kv"><span>Recovery / referral</span><strong>${R(rep.recovery + rep.referral)}</strong></div>
            <div class="kv"><span>Profit before GST</span><strong>${R(rep.profitBeforeGst)}</strong></div>
            <div class="kv"><span>Profit after GST</span><strong>${R(rep.profitAfterGst)}</strong></div>
            <p class="muted tiny">− GST ${R(rep.outputGst)} · + product ITC ${R(rep.productItc)} · + ads ITC ${R(rep.adsItc)} · + pack ITC ${R(rep.packItc)}</p>
          </section>

          <section class="card pnl-sec" id="pnl-gst">
            <p class="section-label">GST breakdown</p>
            <div class="kv"><span>Output GST (in settlement)</span><strong>${R(-rep.outputGst)}</strong></div>
            <div class="kv"><span>Product ITC</span><strong>${R(rep.productItc)}</strong></div>
            <div class="kv"><span>Ads ITC</span><strong>${R(rep.adsItc)}</strong></div>
            <div class="kv"><span>Pack ITC</span><strong>${R(rep.packItc)}</strong></div>
            <div class="kv"><span>Net GST</span><strong>${R(rep.netGst)}</strong></div>
            <p class="muted tiny">This is a working estimate from the files, not a GST return.</p>
          </section>

          <section class="card pnl-sec" id="pnl-trend">
            <p class="section-label">Daily trend</p>
            <p class="muted tiny">Ads, recovery, referral and misc are allocated by that day’s share of payout.</p>
            <div class="pnl-days">
              ${(rep.days || [])
                .map(
                  (d) => `<div class="pnl-day" title="${d.date} ${R(d.paid)}">
                    <i style="height:${Math.max(4, (d.paid / maxDay) * 72)}px"></i>
                    <span>${d.date.slice(8)}</span>
                  </div>`
                )
                .join("") || `<p class="muted tiny">No order dates in this file.</p>`}
            </div>
          </section>

          <section class="card pnl-sec" id="pnl-rank">
            <p class="section-label">SKU profitability ranking</p>
            <div class="pnl-stat-grid">
              <div><span>Total SKUs</span><strong>${rep.skus.length}</strong></div>
              <div><span>Profit SKUs</span><strong>${rep.profitSkus.length}</strong></div>
              <div><span>Loss SKUs</span><strong>${rep.lossSkus.length}</strong></div>
              <div><span>Near zero</span><strong>${(rep.nearZero || []).length}</strong></div>
            </div>
            <h3 class="pnl-h">Top profit SKUs</h3>
            ${skuTable(rep.profitSkus.slice(0, 10), "ok")}
            <h3 class="pnl-h">Top loss SKUs</h3>
            ${skuTable([...rep.lossSkus].sort((a, b) => a.net - b.net).slice(0, 10), "bad")}
          </section>

          ${costTable(rep, costs)}

          <section class="card pnl-sec" id="pnl-orders">
            <p class="section-label">Order-wise preview</p>
            <input id="pnl-order-q" class="input pnl-print-hide" type="search" placeholder="Search SKU, product, or sub order" />
            <div class="pnl-scroll"><table class="pnl-table pnl-table-wide">
              <thead><tr><th>Sub order</th><th>SKU</th><th>Product</th><th>Qty</th><th>Status</th><th>GST</th><th>Paid</th></tr></thead>
              <tbody id="pnl-order-body">${orderRows
                .map(
                  (l) => `<tr>
                  <td class="mono">${LFPnl.esc(l.id)}</td>
                  <td>${LFPnl.esc(l.sku)}</td>
                  <td>${LFPnl.esc((l.productName || "").slice(0, 72))}</td>
                  <td>${l.qty}</td>
                  <td>${LFPnl.esc(l.statusRaw)}</td>
                  <td>${l.gst}%</td>
                  <td>${R(l.paid)}</td>
                </tr>`
                )
                .join("")}</tbody>
            </table></div>
            <p class="muted tiny">Showing ${orderRows.length} of ${rep.lines.length} unique sub-orders. Full set is in the CSV.</p>
          </section>

          <section class="card pnl-sec pnl-print-hide" id="pnl-export">
            <p class="section-label">Export</p>
            <p class="muted tiny">PDF opens Chrome’s print dialog — choose Save as PDF. Files never leave this computer.</p>
            <div class="row-end">
              <button id="pay-pdf" class="btn-glow" type="button">Download PDF</button>
              <button id="pay-download" class="btn-mini" type="button">Download CSV</button>
            </div>
          </section>
        </article>`;
      bindReport(rep, costs);
    }

    root.querySelector("#pay-run").addEventListener("click", async () => {
      if (typeof LFPnl === "undefined") {
        setStatus("Reload the extension to load the P&L engine.", true);
        return;
      }
      if (!orderFile || !payNowFile) {
        setStatus("Add the order CSV and this month’s Payments to Date file.", true);
        return;
      }
      if (!payNextFile) setStatus("Next-month payments missing — delivered unpaid will look high until you add it.");
      else setStatus("Reading files…");
      out.innerHTML = "";
      lastReport = null;
      try {
        const costs = await LFPnl.loadCosts();
        const rep = await LFPnl.run(
          { orders: orderFile, payNow: payNowFile, payNext: payNextFile },
          costs,
          Number(root.querySelector("#pnl-misc").value) || 0
        );
        lastReport = rep;
        paint(rep, costs);
        setStatus(
          payNextFile
            ? `${rep.orders} unique sub-orders · payout ${R(rep.payout)} · profit ${R(rep.profitAfterGst)}`
            : `${rep.orders} unique sub-orders. Add next month’s payment zip to catch delayed settlements.`
        );
      } catch (err) {
        setStatus(err.message || "Could not read those files.", true);
      }
    });

    root.querySelector("#pay-open-tab")?.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("payouts.html") });
    });
  }

  window.LFPayouts = { parseFile, matchTables, parseCsvText, mount, resultCsv };
})();
