const LF_BILLING = {
  trialDays: 5,
  priceLabel: "₹199 / month",
  yearlyLabel: "₹1,499 / year",
  whatsapp: "",
  checkoutUrl: "",
  licenseServerUrl: "http://127.0.0.1:8788",
  maxDevices: 1,
  offlineGraceHours: 48,
  signingSecret: "ad13d367f544337856b3861a9d14dd75a060b396ba56f4a4"
};

if (typeof window !== "undefined") window.LF_BILLING = LF_BILLING;
if (typeof self !== "undefined") self.LF_BILLING = LF_BILLING;
