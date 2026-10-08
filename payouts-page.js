const $ = (id) => document.getElementById(id);

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function applyTheme() {
  const data = await chrome.storage.local.get("lf_theme");
  const next = data.lf_theme === "light" ? "light" : "dark";
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.classList.toggle("light", next === "light");
}

async function requireAccess() {
  if (typeof LFLicense === "undefined" || typeof LFLicense.status !== "function") return true;
  const access = await LFLicense.status();
  if (access.ok) return true;
  $("paywall")?.classList.remove("hidden");
  return false;
}
window.requireAccess = requireAccess;

async function refreshPlanUI() {
  if (typeof LFLicense === "undefined") return;
  const access = await LFLicense.status();
  const badge = $("plan-badge");
  if (badge) badge.textContent = access.label;
  if ($("pay-price") && typeof LF_BILLING !== "undefined") $("pay-price").textContent = LF_BILLING.priceLabel;
  if ($("pay-year") && typeof LF_BILLING !== "undefined") $("pay-year").textContent = LF_BILLING.yearlyLabel || "";
  const email = (typeof LF_BILLING !== "undefined" && LF_BILLING.email) || "prathameshbusa@gmail.com";
  const phone = (typeof LF_BILLING !== "undefined" && LF_BILLING.phone) || "8806907616";
  const mail = $("contact-email");
  const tel = $("contact-phone");
  if (mail) {
    mail.href = `mailto:${email}?subject=${encodeURIComponent("List Pilot Pro license")}`;
    mail.textContent = email;
  }
  if (tel) {
    const num = digits(phone);
    tel.href = `tel:+${num.length === 10 ? "91" + num : num}`;
    tel.textContent = phone;
  }
}

$("paywall-close").addEventListener("click", () => $("paywall").classList.add("hidden"));
$("btn-activate").addEventListener("click", async () => {
  const res = await LFLicense.activate($("license-key").value);
  if (!res.ok) return;
  $("paywall").classList.add("hidden");
  $("license-key").value = "";
  await refreshPlanUI();
});

applyTheme()
  .catch(() => {})
  .then(() => refreshPlanUI().catch(() => {}))
  .then(() => LFPayouts.mount($("payout-kit"), { compact: false }));
