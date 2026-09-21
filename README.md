# ListFill for Meesho

Independent Chrome extension that saves reusable product variants and autofills the Meesho supplier **Add Product** form. You still review and submit the catalog yourself.

This is not affiliated with Meesho.

## Install (unpacked, for testing)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Pin **ListFill for Meesho**

Practice page: `python3 -m http.server 8787` then open http://127.0.0.1:8787/demo/

## Free install + paid subscription

The Chrome Web Store listing is **free to install**. Autofill is free for **5 days**, then needs Pro.

| Free trial | Pro |
|---|---|
| Capture fields, save variants | Everything in trial |
| 5 days of Autofill | Unlimited Autofill until the key expires |
| Data stays in the browser | Same, plus a license key |

Chrome does **not** bill subscriptions for you anymore. You take payment outside the store (Razorpay is the usual choice in India), then send the seller a license key.

### 1. Set your billing details

Edit `license-config.js`:

- `whatsapp` — digits only, e.g. `9198xxxxxxxx` (Pay button opens WhatsApp)
- `checkoutUrl` — Razorpay / Stripe payment link (used instead of WhatsApp if set)
- `priceLabel` / `yearlyLabel`
- `signingSecret` — change this before you publish, and **never share it**

### 2. Take payment

Create a Razorpay Payment Link or Subscription for ₹199 / month (and optional yearly). After a successful payment, issue a key:

```bash
node tools/issue-license.mjs monthly
node tools/issue-license.mjs yearly
```

Paste that key to the customer. They open ListFill → Upgrade → **Activate**.

Capture and saved variants stay free even after the trial, so a seller can still prepare listings.

License checks run in the extension. A determined user can bypass a client-only key. For real enforcement later, validate keys on a small server.

## Publish on the Chrome Web Store

1. Pay the one-time **$5** developer fee: https://chrome.google.com/webstore/devconsole
2. Host `store/privacy.html` on GitHub Pages or any HTTPS URL
3. Zip this folder **without** `.git`:

```bash
cd /Users/apple/mesho
zip -r ../listfill.zip . -x "*.git*" -x "tools/*" -x ".DS_Store"
```

4. Dashboard → **New item** → upload `listfill.zip`
5. Store listing:
   - Name: ListFill for Meesho
   - Summary: Save variants and autofill the Meesho Add Product form
   - Say it is **unofficial** and not affiliated with Meesho
   - Category: Productivity / Tools
   - Language: English
   - Tick **Offers in-app purchases**
6. Screenshots: 1280×800 or 640×400 (at least one). Icon 128 is already in `icons/`
7. Privacy: paste the privacy policy URL
8. Single purpose: “Autofill Meesho supplier listing forms from saved variants”
9. Submit for review (often a few days)

Review may ask why you need `scripting` and Meesho host permissions — answer: to fill the supplier Add Product form the user already has open.
