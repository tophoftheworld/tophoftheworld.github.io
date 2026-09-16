/**
 * One-off: call Gemini directly with the same invoice chat payload as the app.
 * Usage: GEMINI_API_KEY=... node scripts/direct-gemini-cups-test.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildRequestBody,
  GEMINI_CHAT_MODELS
} = require('../functions/generateInvoiceFromChat.js');

const currentInvoice = {
  invoiceNumber: 'INV-2026-0910-003',
  invoiceDate: '2026-09-10',
  clientName: 'Cristopher David',
  clientAddress: '',
  clientTIN: '',
  notes: '',
  invoiceItems: [
    {
      id: 1789052904049,
      eventType: 'matcha_workshop',
      eventVenue: 'Makati',
      eventDate: '2026-09-26',
      packageType: '',
      count: 20,
      coffeeAddOn: false,
      transportAddOn: 'none',
      durationHours: 3,
      choiceDrinks: [],
      additionalOptions: ['Iced (12oz) Drinks', 'Dairy or Oat Milk (choose one)'],
      unitCost: '1512',
      workshopInclusions: [
        'Guided matcha workshop',
        'Use of all matcha tools during the session',
        'Two rounds of hands-on matcha making (one cup + one bottled drink to take home)',
        'Printed reference guides',
        'Sticker pack',
        'Mini tote bag',
        'Transportation within Metro Manila'
      ],
      workshopDetails: '',
      otherInclusions: [],
      isWorkshop: true
    },
    {
      id: 1789140784625,
      eventType: 'mobile_bar',
      eventVenue: 'Bgc',
      eventDate: '2026-09-25',
      packageType: 'starter',
      count: 250,
      coffeeAddOn: false,
      transportAddOn: 'none',
      durationHours: 3,
      choiceDrinks: [],
      additionalOptions: ['Iced (12oz) Drinks', 'Dairy or Oat Milk (choose one)'],
      unitCost: '57500',
      workshopInclusions: [
        '3 Hours of Service',
        '1 Hour Ingress (Setup)',
        '1 Hour Egress (Teardown)',
        '5–7 On-Site Baristas',
        'Mobile Matcha Bar Setup',
        'Ingredients, cups, ice, and standard supplies',
        'Transportation within Metro Manila'
      ],
      workshopDetails: '',
      otherInclusions: [
        'Mobile Matcha Bar Setup',
        'Ingredients, cups, ice, and standard supplies',
        'Transportation within Metro Manila'
      ],
      isWorkshop: false
    }
  ],
  customLineItems: [],
  paymentMilestones: [
    {
      id: 1789082370840,
      role: 'first',
      milestone: 'Payment',
      date: '2026-09-12',
      percentage: 25,
      amount: 101740,
      paid: false
    }
  ],
  paymentStructure: 'three',
  paymentTermsCustomized: false
};

const documentPreview = `BILLING INVOICE
Invoice #: INV-2026-0910-003
Date: September 10, 2026
Name: Cristopher David
Company: matchanese Inc.

--- Package 1 ---
Private Matcha Workshop
Iced (12oz) Drinks · Dairy or Oat Milk (choose one)
Inclusions:
  - Guided matcha workshop
  - Use of all matcha tools during the session
  - Two rounds of hands-on matcha making (one cup + one bottled drink to take home)
  - Printed reference guides
  - Sticker pack
  - Mini tote bag
  - Transportation within Metro Manila
Venue: Makati · Date: September 26, 2026
Unit / Subtotal: Php 30,240.00

--- Package 2 ---
Mobile Matcha Bar - STARTER PACKAGE
Menu:
  - Signature Matchanese Latte
  - Hojicha Latte
  - 1 additional drink of choice
Iced (12oz) Drinks · Dairy or Oat Milk (choose one)
Inclusions:
  - 3 Hours of Service
  - 1 Hour Ingress (Setup)
  - 1 Hour Egress (Teardown)
  - 6–9 On-Site Baristas
  - Mobile Matcha Bar Setup
  - Ingredients, cups, ice, and standard supplies
  - Transportation within Metro Manila
Venue: Bgc · Date: September 25, 2026
Unit / Subtotal: Php 71,500.00

Payment schedule:
- Payment: September 12, 2026 25% Php 101,740.00`;

const messages = [{ role: 'user', content: 'change the mobile matcha bar to 150 cups' }];

const body = buildRequestBody({
  messages,
  currentInvoice,
  documentPreview,
  now: new Date(2026, 8, 13)
});

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Set GEMINI_API_KEY');
  process.exit(1);
}

const model = GEMINI_CHAT_MODELS[0];
console.log('model:', model);

async function call(label, requestBody) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  const payload = await res.json();
  console.log(`\n==== ${label} status=${res.status} ====`);
  if (!res.ok) {
    console.log(JSON.stringify(payload, null, 2).slice(0, 2500));
    return;
  }
  const text =
    payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  console.log(text);
  try {
    const parsed = JSON.parse(text);
    console.log('\n--- invoice ---');
    console.log(JSON.stringify(parsed.invoice, null, 2));
  } catch (e) {
    console.log('(parse failed)', e.message);
  }
}

await call('WITH responseSchema (app path)', body);

const noSchema = structuredClone(body);
delete noSchema.generationConfig.responseSchema;
await call('WITHOUT responseSchema', noSchema);
