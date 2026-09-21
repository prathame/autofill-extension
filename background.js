chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
  const data = await chrome.storage.local.get("lf_license");
  if (!data.lf_license?.trialStartedAt) {
    await chrome.storage.local.set({
      lf_license: { trialStartedAt: Date.now(), fills: 0 }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "LF_CAPTURE_STATE") {
    chrome.action.setBadgeText({ text: msg.active ? "ON" : "" });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const capture = changes.lf_capture?.newValue;
  if (capture) chrome.action.setBadgeText({ text: capture.active ? "ON" : "" });
});
