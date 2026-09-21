const LF_BILLING = {
  trialDays: 5,
  priceLabel: "₹199 / month",
  yearlyLabel: "₹1,499 / year",
  email: "prathameshbusa@gmail.com",
  phone: "8806907616",
  licenseServerUrl: "https://autofill-extension.onrender.com",
  maxDevices: 1,
  offlineGraceHours: 48,
  signingSecret: "ad13d367f544337856b3861a9d14dd75a060b396ba56f4a4"
};

if (typeof window !== "undefined") window.LF_BILLING = LF_BILLING;
if (typeof self !== "undefined") self.LF_BILLING = LF_BILLING;
