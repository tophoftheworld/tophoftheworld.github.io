# MMF Merchant Hub

One-stop merchant dashboard for Manila Matcha Fest 2026.

**Live URL:** https://mmf-merchant.web.app/  
**Admin (registrations):** https://mmf-merchant.web.app/admin → redirects to https://mmf-info.web.app/admin  
**Per-merchant sales & freebies:** open a brand in admin → **Sales & Freebies** tab  
**All-merchant report rollup (optional):** https://mmf-merchant.web.app/hub-admin

Registration form: https://mmf-info.web.app/

## Generate merchant access codes

```bash
cd mmf-merchant-hub
npm install
npm run generate-codes
```

Writes hashed codes to Firestore `mmf_hub_merchants` and plaintext codes to
`merchant-codes.csv` (gitignored) for emailing. Use `--force` / `generate-codes:force`
to regenerate.

## Deploy

```bash
cd mmf-merchant-hub
firebase target:apply hosting hub mmf-merchant --project manila-matcha-fest
firebase deploy --only hosting:hub --project manila-matcha-fest
```

## Placeholders to fill

Edit `js/config.js`:

- `CONTACTS` — SM MOA Admin + Matchanese organizer
- `SUPPLIERS` — ice, water, crew meals
- `BOOTH_LAYOUT` / `images/booth-layout.svg` — official floor plan
