# ListFill for Meesho

Independent Chrome extension that saves reusable product variants and autofills the Meesho supplier **Add Product** form. You still review and submit the catalog yourself.

This is not affiliated with Meesho.

## Install (unpacked, for testing)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder (the one with `manifest.json`, not `node_modules`)
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

### 2. Issue a key (one computer only)

Start the license server (keeps keys from being shared):

```bash
cd /Users/apple/mesho
node server/license-server.mjs
```

Copy the **admin token** it prints. Then open [http://127.0.0.1:8787/admin/](http://127.0.0.1:8787/admin/) (also run `python3 -m http.server 8787` if needed).

1. Paste the admin token
2. Pick Monthly / Yearly / Lifetime → **Issue key** → **Copy key**
3. Customer pastes it in ListFill → Activate

The first computer that activates **owns** that key. A second computer gets: “already active on another computer.”

If the seller gets a new laptop, paste their key in the admin page and click **Reset device**. **Revoke** kills the key for everyone.

Keep `licenseServerUrl` in `license-config.js` pointed at this server (live: `https://autofill-extension.onrender.com`).

Paste that key to the customer. They open ListFill → Upgrade → **Activate**.

### 3. Host the license server (Render + Neon)

Postgres is only used to remember **which keys you issued** and **which computer owns each key**. The trial works without it. Render’s free web service wipes local files when it sleeps, and Render’s free Postgres expires after 30 days — so production uses **Neon** (free Postgres that stays).

1. Create a project at https://console.neon.tech (region close to you, e.g. Singapore / Mumbai)
2. Dashboard → **Connect** → copy the **pooled** URI (host contains `-pooler`)
3. On Render: **New → Web Service** → connect `prathame/autofill-extension`
   - Runtime: Node
   - Build: `npm install --prefix server`
   - Start: `node server/license-server.mjs`
   - Instance: **Free**
   - Health check: `/health`
4. Environment:
   - `DATABASE_URL` = the Neon URI
   - `LICENSE_ADMIN_TOKEN` = a long random string (save this; you need it to issue keys)
   - `MAX_DEVICES` = `1`
5. After deploy, open `https://autofill-extension.onrender.com/health` — it should show `"persist":"postgres"`
6. Issue keys at `https://autofill-extension.onrender.com/admin/` (paste the admin token)
7. Keep `licenseServerUrl` in `license-config.js` as `https://autofill-extension.onrender.com`, then reload the extension

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
