(function () {
  const COST_KEY = "lf_sku_costs";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function nid(v) {
    return String(v || "")
      .trim()
      .toUpperCase()
      .replace(/^OI:\s*/, "")
      .replace(/\s+/g, "");
  }

  function money(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const raw = String(v).trim();
    const neg = /^\(.*\)$/.test(raw);
    const n = Number(raw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return 0;
    return neg && n > 0 ? -n : n;
  }

  function rupee(n) {
    const x = Number(n) || 0;
    const abs = Math.abs(x).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    return (x < 0 ? "-₹" : "₹") + abs;
  }

  function pct(n) {
    return (Number(n) || 0).toFixed(1) + "%";
  }

  function statusGroup(s) {
    const u = String(s || "").toUpperCase();
    if (/CANCEL/.test(u)) return "cancelled";
    if (/RTO/.test(u)) return "rto";
    if (/RETURN/.test(u)) return "return";
    if (/EXCHANGE/.test(u)) return "exchange";
    if (/SHIP/.test(u)) return "shipped";
    if (/LOST/.test(u)) return "lost";
    if (/HOLD|PENDING|READY/.test(u)) return "pending";
    if (/DELIVER/.test(u)) return "delivered";
    return "other";
  }

  function pick(row, names) {
    for (const n of names) {
      if (row[n] != null && String(row[n]).trim() !== "") return row[n];
    }
    const keys = Object.keys(row);
    for (const want of names) {
      const w = want.toLowerCase();
      const hit = keys.find((k) => k.toLowerCase() === w);
      if (hit) return row[hit];
    }
    return "";
  }

  function gstInclusiveShare(amount, gstPct) {
    const g = Number(gstPct) || 0;
    if (g <= 0 || !amount) return 0;
    return amount * (g / (100 + g));
  }

  function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then((b) => new Uint8Array(b));
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
    if (eocd < 0) throw new Error("Could not read this zip/Excel file.");
    const count = view.getUint16(eocd + 10, true);
    let cd = view.getUint32(eocd + 16, true);
    const out = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(cd, true) !== 0x02014b50) throw new Error("Could not read this zip/Excel file.");
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

  function decodeXml(bytes) {
    return new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "application/xml");
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

  function matrixToObjects(matrix) {
    let best = 0;
    let bestScore = -1;
    const max = Math.min(matrix.length, 20);
    for (let i = 0; i < max; i++) {
      const joined = (matrix[i] || []).map((x) => String(x || "").toLowerCase()).join(" ");
      let score = 0;
      if (/sub order/.test(joined)) score += 8;
      if (/ad cost|total ads/.test(joined)) score += 6;
      if (/referral|compensation|recovery/.test(joined) && /amount/.test(joined)) score += 5;
      if (/final settlement|listing price/.test(joined)) score += 4;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (bestScore < 0) return [];
    const headers = (matrix[best] || []).map((h, i) => String(h || "").trim() || `col_${i}`);
    const rows = [];
    for (let r = best + 1; r < matrix.length; r++) {
      const line = matrix[r] || [];
      if (!line.some((c) => String(c).trim())) continue;
      if (/^no data is available/i.test(String(line[0] || ""))) continue;
      if (/^total$/i.test(String(line[0] || "").trim())) continue;
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = line[i] == null ? "" : line[i];
      });
      rows.push(obj);
    }
    return rows;
  }

  async function parseXlsxAll(bytes) {
    const files = await unzip(bytes);
    const sstFile = files["xl/sharedStrings.xml"];
    let sst = [];
    if (sstFile) {
      sst = [...decodeXml(sstFile).getElementsByTagName("si")].map((si) =>
        [...si.getElementsByTagName("t")].map((t) => t.textContent || "").join("")
      );
    }
    const wb = files["xl/workbook.xml"];
    if (!wb) throw new Error("Not a valid Excel workbook.");
    const rels = files["xl/_rels/workbook.xml.rels"];
    const relMap = {};
    if (rels) {
      for (const rel of [...decodeXml(rels).getElementsByTagName("Relationship")]) {
        relMap[rel.getAttribute("Id")] = (rel.getAttribute("Target") || "").replace(/^\//, "");
      }
    }
    const sheets = {};
    for (const sh of [...decodeXml(wb).getElementsByTagName("sheet")]) {
      const name = sh.getAttribute("name") || "Sheet";
      const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let path = rid && relMap[rid] ? relMap[rid] : "";
      if (path && !path.startsWith("xl/")) path = "xl/" + path.replace(/^\.\//, "");
      const data = path && files[path];
      if (!data) continue;
      sheets[name] = matrixToObjects(sheetToMatrix(decodeXml(data), sst));
    }
    return sheets;
  }

  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let q = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    const delim = (src.split(/\r?\n/).find((l) => l.trim()) || "").includes(";") &&
      (src.match(/;/g) || []).length > (src.match(/,/g) || []).length
      ? ";"
      : ",";
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
    return matrixToObjects(rows.filter((r) => r.some((c) => String(c).trim())));
  }

  async function fileBytes(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  async function parseOrders(file) {
    const buf = await fileBytes(file);
    const name = file.name || "orders";
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const sheets = await parseXlsxAll(buf);
      const first = Object.values(sheets).sort((a, b) => b.length - a.length)[0] || [];
      return first;
    }
    return parseCsvText(new TextDecoder("utf-8").decode(buf));
  }

  async function parsePaymentBundle(file) {
    const buf = await fileBytes(file);
    const name = (file.name || "").toLowerCase();
    let sheets;
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      if (name.endsWith(".zip") && !name.endsWith(".xlsx")) {
        const files = await unzip(buf);
        const inner = Object.keys(files).find((n) => /\.xlsx$/i.test(n) && !n.startsWith("__MACOSX"));
        if (!inner) throw new Error("That zip has no Excel file inside. Upload the Payments to Date zip as downloaded.");
        sheets = await parseXlsxAll(files[inner]);
      } else {
        try {
          sheets = await parseXlsxAll(buf);
        } catch (_) {
          const files = await unzip(buf);
          const inner = Object.keys(files).find((n) => /\.xlsx$/i.test(n) && !n.startsWith("__MACOSX"));
          if (!inner) throw new Error("Could not read payment file " + file.name);
          sheets = await parseXlsxAll(files[inner]);
        }
      }
    } else {
      throw new Error("Payment file must be the Meesho Payments to Date zip or xlsx.");
    }
    const names = Object.keys(sheets);
    const orderPay = sheets[names.find((n) => /order payment/i.test(n)) || ""] || [];
    const ads = sheets[names.find((n) => /ads/i.test(n)) || ""] || [];
    const referral = sheets[names.find((n) => /referral/i.test(n)) || ""] || [];
    const comp = sheets[names.find((n) => /compensation|recovery/i.test(n)) || ""] || [];
    return { orderPay, ads, referral, comp, label: file.name };
  }

  function ingestOrderPay(byId, rows) {
    for (const r of rows) {
      const id = nid(pick(r, ["Sub Order No", "Sub Order ID"]));
      if (!id) continue;
      const rec = byId.get(id) || { id, paid: 0, status: "", sku: "", gst: 0, ship: 0, retShip: 0, tcs: 0, tds: 0, rows: 0 };
      rec.paid += money(pick(r, ["Final Settlement Amount", "Net Settlement Amount", "Settlement Amount"]));
      rec.status = pick(r, ["Live Order Status"]) || rec.status;
      rec.sku = pick(r, ["Supplier SKU", "SKU"]) || rec.sku;
      rec.gst = money(pick(r, ["Product GST %"])) || rec.gst;
      rec.ship += money(pick(r, ["Shipping Charge (Incl. GST)"]));
      rec.retShip += money(pick(r, ["Return Shipping Charge (Incl. GST)"]));
      rec.tcs += money(pick(r, ["TCS"]));
      rec.tds += money(pick(r, ["TDS"]));
      rec.rows += 1;
      byId.set(id, rec);
    }
  }

  function sheetMoney(rows, names) {
    let n = 0;
    for (const r of rows) n += money(pick(r, names));
    return n;
  }

  function mergePayRows(now, next) {
    const byId = new Map();
    ingestOrderPay(byId, now.orderPay);
    if (next) ingestOrderPay(byId, next.orderPay);
    let ads = sheetMoney(now.ads, ["Total Ads Cost", "Ad Cost incl. Credits/Waivers/Discounts", "Ad Cost"]);
    let adsGst = sheetMoney(now.ads, ["GST"]);
    let recovery = sheetMoney(now.comp, ["Amount (inc GST) INR", "Amount", "Compensation"]);
    let referral = sheetMoney(now.referral, ["Net Referral Amount", "Amount"]);
    if (next) {
      for (const r of next.comp) {
        const id = nid(pick(r, ["Sub Order No", "Sub Order ID"]));
        if (id && byId.has(id)) recovery += money(pick(r, ["Amount (inc GST) INR", "Amount", "Compensation"]));
      }
    }
    return { byId, ads: Math.abs(ads), adsGst: Math.abs(adsGst), recovery, referral };
  }

  function buildReport(orderRows, pay, costs, misc) {
    costs = costs || {};
    misc = Number(misc) || 0;
    const orders = [];
    const seen = new Set();
    const dups = [];
    for (const r of orderRows) {
      const id = nid(pick(r, ["Sub Order No", "Sub Order ID", "Sub Order Number"]));
      if (!id) continue;
      if (seen.has(id)) {
        dups.push(id);
        continue;
      }
      seen.add(id);
      const sku = String(pick(r, ["SKU", "Supplier SKU"]) || "").trim();
      const qty = Math.max(1, money(pick(r, ["Quantity"])) || 1);
      const listed = money(pick(r, ["Supplier Discounted Price (Incl GST and Commision)", "Supplier Listed Price (Incl. GST + Commission)", "Listing Price (Incl. taxes)"]));
      const gst = money(pick(r, ["Product GST %", "GST %"])) || 0;
      const statusRaw = pick(r, ["Reason for Credit Entry", "Live Order Status", "Status"]);
      orders.push({
        id,
        sku,
        qty,
        listed,
        gst,
        statusRaw,
        group: statusGroup(statusRaw),
        productName: pick(r, ["Product Name"]),
        date: pick(r, ["Order Date"])
      });
    }

    const lines = [];
    const extra = [];
    const usedPay = new Set();
    let payout = 0;
    let productCost = 0;
    let packCost = 0;
    let outputGst = 0;
    let productItc = 0;
    let packItc = 0;
    const statusN = { delivered: 0, rto: 0, return: 0, cancelled: 0, shipped: 0, exchange: 0, lost: 0, pending: 0, other: 0 };
    const skuMap = new Map();

    for (const o of orders) {
      const p = pay.byId.get(o.id);
      if (p) usedPay.add(o.id);
      const paid = p ? p.paid : 0;
      const gst = o.gst || (p && p.gst) || 0;
      const c = costs[o.sku] || {};
      const unit = Number(c.product) || 0;
      const pack = Number(c.pack) || 0;
      const countCost = o.group !== "cancelled";
      const packMult = o.group === "exchange" ? 2 : 1;
      const pc = countCost ? unit * o.qty : 0;
      const pk = countCost ? pack * o.qty * packMult : 0;
      if (paid > 0) outputGst += gstInclusiveShare(paid, gst);
      if (pc) productItc += gstInclusiveShare(pc, gst || 18);
      if (pk) packItc += gstInclusiveShare(pk, 18);
      payout += paid;
      productCost += pc;
      packCost += pk;
      statusN[o.group] = (statusN[o.group] || 0) + 1;
      const line = { ...o, paid, productCost: pc, packCost: pk, inPayout: !!p, payStatus: p ? p.status : "", payRows: p ? p.rows : 0 };
      lines.push(line);
      const s = skuMap.get(o.sku) || { sku: o.sku, qty: 0, listed: 0, paid: 0, productCost: 0, packCost: 0, n: 0, rto: 0, ret: 0, delivered: 0, cancelled: 0 };
      s.qty += o.qty;
      s.listed += o.listed;
      s.paid += paid;
      s.productCost += pc;
      s.packCost += pk;
      s.n += 1;
      if (o.group === "rto") s.rto += 1;
      if (o.group === "return") s.ret += 1;
      if (o.group === "delivered") s.delivered += 1;
      if (o.group === "cancelled") s.cancelled += 1;
      skuMap.set(o.sku, s);
    }

    for (const [id, p] of pay.byId) {
      if (!usedPay.has(id)) extra.push(p);
    }
    const extraPaid = extra.reduce((s, p) => s + p.paid, 0);

    const ads = pay.ads;
    const adsItc = pay.adsGst;
    const recovery = pay.recovery;
    const referral = pay.referral;
    const profitBeforeGst = payout + recovery + referral - ads - productCost - packCost - misc;
    const netGst = -outputGst + productItc + adsItc + packItc;
    const profitAfterGst = profitBeforeGst + netGst;
    const netOrders = orders.length - (statusN.cancelled || 0);
    const margin = payout ? (profitAfterGst / payout) * 100 : 0;

    const skus = [...skuMap.values()].map((s) => {
      const net = s.paid - s.productCost - s.packCost;
      const retPct = s.n ? ((s.rto + s.ret) / s.n) * 100 : 0;
      let action = "Keep";
      if (net < -1) action = "Stop / Fix First";
      else if (net > 500 && (s.paid ? net / s.paid : 0) > 0.2) action = "Scale";
      return { ...s, net, margin: s.paid ? (net / s.paid) * 100 : 0, retPct, action };
    });
    skus.sort((a, b) => b.net - a.net);
    const profitSkus = skus.filter((s) => s.net > 1);
    const lossSkus = skus.filter((s) => s.net < -1);
    const pendingCost = skus.filter((s) => !((costs[s.sku] || {}).product > 0));

    const deliveredUnpaid = lines.filter((l) => l.group === "delivered" && !l.inPayout);
    const cancelledUnpaid = lines.filter((l) => l.group === "cancelled" && !l.inPayout);
    const rtoUnpaid = lines.filter((l) => l.group === "rto" && !l.inPayout);

    const actions = lossSkus.slice(0, 8).map((s, i) => ({
      rank: i + 1,
      sku: s.sku,
      action: s.action,
      net: s.net,
      margin: s.margin,
      retPct: s.retPct,
      why: "This SKU is losing money after product, pack and settlement in this window."
    }));
    if (profitSkus[0]) {
      actions.unshift({
        rank: 0,
        sku: profitSkus[0].sku,
        action: "Scale",
        net: profitSkus[0].net,
        margin: profitSkus[0].margin,
        retPct: profitSkus[0].retPct,
        why: "Highest net contribution after costs in this file set."
      });
    }

    return {
      orders: orders.length,
      unique: orders.length,
      dups: dups.length,
      netOrders,
      statusN,
      payout,
      extraPaid,
      extra,
      ads,
      adsItc,
      recovery,
      referral,
      misc,
      productCost,
      packCost,
      outputGst,
      productItc,
      packItc,
      netGst,
      profitBeforeGst,
      profitAfterGst,
      margin,
      listed: orders.reduce((s, o) => s + o.listed, 0),
      skus,
      profitSkus,
      lossSkus,
      pendingCost,
      deliveredUnpaid,
      cancelledUnpaid,
      rtoUnpaid,
      actions,
      lines
    };
  }

  async function loadCosts() {
    try {
      if (typeof LF === "undefined") return {};
      return (await LF.get(COST_KEY, {})) || {};
    } catch (_) {
      return {};
    }
  }

  async function saveCosts(costs) {
    try {
      if (typeof LF === "undefined") return;
      await LF.set(COST_KEY, costs);
    } catch (_) {}
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function reportCsv(rep) {
    const lines = [
      ["metric", "amount"].map(csvEscape).join(","),
      ["payout", rep.payout].join(","),
      ["ads", -rep.ads].join(","),
      ["product_cost", -rep.productCost].join(","),
      ["pack_cost", -rep.packCost].join(","),
      ["recovery", rep.recovery].join(","),
      ["referral", rep.referral].join(","),
      ["misc", -rep.misc].join(","),
      ["profit_before_gst", rep.profitBeforeGst].join(","),
      ["output_gst", -rep.outputGst].join(","),
      ["itc_product", rep.productItc].join(","),
      ["itc_ads", rep.adsItc].join(","),
      ["itc_pack", rep.packItc].join(","),
      ["profit_after_gst", rep.profitAfterGst].join(",")
    ];
    const head = ["bucket", "id", "sku", "status", "listed", "paid", "product_cost", "pack_cost", "in_payout"].map(csvEscape).join(",");
    lines.push("");
    lines.push(head);
    for (const l of rep.lines) {
      let bucket = l.inPayout ? "in_payout" : "not_in_payout";
      if (l.group === "delivered" && !l.inPayout) bucket = "delivered_unpaid";
      if (l.group === "cancelled") bucket = "cancelled";
      lines.push([bucket, l.id, l.sku, l.statusRaw, l.listed, l.paid, l.productCost, l.packCost, l.inPayout].map(csvEscape).join(","));
    }
    for (const p of rep.extra) {
      lines.push(["payout_prior_period", p.id, p.sku, p.status, "", p.paid, "", "", "yes"].map(csvEscape).join(","));
    }
    return lines.join("\n");
  }

  async function run(files, costs, misc) {
    const orderRows = await parseOrders(files.orders);
    if (!orderRows.length) throw new Error("No Sub Order rows in the order file.");
    const now = await parsePaymentBundle(files.payNow);
    const next = files.payNext ? await parsePaymentBundle(files.payNext) : null;
    const pay = mergePayRows(now, next);
    return buildReport(orderRows, pay, costs, misc);
  }

  window.LFPnl = { run, loadCosts, saveCosts, reportCsv, rupee, pct, esc, statusGroup };
})();
