(function () {
  function toast(html, kind) {
    const root = document.getElementById("listfill-root") || (() => {
      const el = document.createElement("div");
      el.id = "listfill-root";
      el.className = "listfill-root";
      document.documentElement.appendChild(el);
      return el;
    })();
    root.querySelectorAll(".lf-toast").forEach((n) => n.remove());
    const el = document.createElement("div");
    el.className = `lf-toast ${kind || ""}`;
    el.innerHTML = html;
    root.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }

  function progressBar() {
    const root = document.getElementById("listfill-root") || document.documentElement;
    let bar = document.getElementById("lf-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "lf-progress";
      bar.className = "lf-progress";
      bar.innerHTML = `
        <div class="lf-progress-copy">Filling listing…</div>
        <button type="button" class="lf-btn lf-btn-ghost" data-lf="stop-fill">Stop</button>
      `;
      (document.getElementById("listfill-root") || (() => {
        const el = document.createElement("div");
        el.id = "listfill-root";
        el.className = "listfill-root";
        document.documentElement.appendChild(el);
        return el;
      })()).appendChild(bar);
      bar.querySelector("[data-lf='stop-fill']").addEventListener("click", () => {
        if (window.__listfillAbort) window.__listfillAbort();
      });
    }
    return bar;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg?.type === "LF_PING") {
        sendResponse({ ok: true, url: location.href });
        return;
      }
      if (msg?.type === "LF_START_CAPTURE") {
        await LFCapture.startCapture();
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "LF_STOP_CAPTURE") {
        await LFCapture.stopCapture();
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "LF_CAPTURE_STATUS") {
        sendResponse({ capturing: LFCapture.isCapturing() });
        return;
      }
      if (msg?.type === "LF_FILL") {
        const variant = msg.variant;
        if (!variant) {
          sendResponse({ ok: false, error: "No variant" });
          return;
        }
        await LFCapture.stopCapture();
        const bar = progressBar();
        const results = await LFFill.runFill(variant, (p) => {
          bar.querySelector(".lf-progress-copy").textContent = `Filling ${p.index + 1}/${p.total}: ${p.label || "field"}`;
        });
        bar.remove();
        const fail = results.failed.length
          ? `<div class="lf-toast-fail">${results.failed.map((f) => `${f.label}: ${f.reason}`).join("<br>")}</div>`
          : "";
        toast(
          `<strong>Autofill done</strong><div>Filled ${results.filled} field${results.filled === 1 ? "" : "s"}${results.failed.length ? `, ${results.failed.length} missed` : ""}.</div>${fail}`,
          results.failed.length ? "warn" : "ok"
        );
        sendResponse({ ok: true, results });
        return;
      }
    })();
    return true;
  });

  chrome.storage.local.get(LF.STORAGE.CAPTURE, (data) => {
    if (data[LF.STORAGE.CAPTURE]?.active) LFCapture.startCapture();
  });
})();
