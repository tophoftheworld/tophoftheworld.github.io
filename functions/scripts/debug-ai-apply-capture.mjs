/**
 * One-shot debug capture for AI invoice apply (no product changes).
 * Reproduces screenshot scenario against live Gemini via generateInvoiceFromChat.
 *
 * Usage:
 *   $env:GEMINI_API_KEY = (gcloud secrets versions access latest --secret=GEMINI_API_KEY --project=matchanese-attendance)
 *   node scripts/debug-ai-apply-capture.mjs
 */
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const {
  generateInvoiceFromChat,
  finalizeChatResult,
  cupCountFromItem,
  resolveMobileCupTriad
} = require('../generateInvoiceFromChat.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'debug-ai-apply-evidence.json');

function fixtureInvoice() {
  return {
    invoiceNumber: 'INV-2026-0910-003',
    invoiceDate: '2026-09-10',
    clientName: 'Cristopher David',
    clientCompany: '',
    clientAddress: '',
    clientTIN: '',
    notes: '',
    invoiceItems: [
      {
        id: 1,
        eventType: 'matcha_workshop',
        isWorkshop: true,
        cups: '30',
        unitCost: '1512',
        eventVenue: '',
        eventDate: '2026-09-11',
        packageType: '',
        numberOfPax: '',
        customCups: ''
      },
      {
        id: 2,
        eventType: 'mobile_bar',
        isWorkshop: false,
        packageType: 'starter',
        cups: '100',
        numberOfPax: '100',
        customCups: '',
        eventVenue: '',
        eventDate: '2026-09-10',
        coffeeAddOn: false,
        transportAddOn: 'none',
        durationHours: 3,
        choiceDrinks: [],
        additionalOptions: []
      }
    ],
    customLineItems: [],
    paymentMilestones: [],
    paymentStructure: 'three',
    paymentTermsCustomized: false
  };
}

function summarizeItems(invoice) {
  const items = Array.isArray(invoice?.invoiceItems) ? invoice.invoiceItems : [];
  return items.map((it, i) => ({
    index: i,
    id: it?.id,
    eventType: it?.eventType,
    isWorkshop: !!it?.isWorkshop,
    cups: it?.cups,
    numberOfPax: it?.numberOfPax,
    customCups: it?.customCups,
    resolvedBarCups: it?.eventType === 'mobile_bar' || (!it?.isWorkshop && it?.packageType)
      ? (require('../generateInvoiceFromChat.js').cupCountFromItem
          ? require('../generateInvoiceFromChat.js').cupCountFromItem(it)
          : null)
      : null,
    eventVenue: it?.eventVenue,
    packageType: it?.packageType,
    unitCost: it?.unitCost
  }));
}

function classifyTurn({ label, current, modelInvoice, assistantMessage, finalized }) {
  const before = summarizeItems(current);
  const model = summarizeItems(modelInvoice);
  const after = summarizeItems(finalized);

  const workshopBefore = before.find((x) => x.eventType === 'matcha_workshop' || x.isWorkshop);
  const workshopModel = model.find((x) => x.eventType === 'matcha_workshop' || x.isWorkshop);
  const workshopAfter = after.find((x) => x.eventType === 'matcha_workshop' || x.isWorkshop);
  const barBefore = before.find((x) => x.eventType === 'mobile_bar' || x.packageType);
  const barModel = model.find((x) => x.eventType === 'mobile_bar' || x.packageType);
  const barAfter = after.find((x) => x.eventType === 'mobile_bar' || x.packageType);

  let verdict = 'unknown';
  if (label === 'cups') {
    const modelWrote =
      String(barModel?.numberOfPax) === '150' ||
      String(barModel?.cups) === '150' ||
      String(barModel?.cups || '').startsWith('150');
    const afterOk =
      String(barAfter?.numberOfPax) === '150' ||
      String(barAfter?.cups) === '150' ||
      String(barAfter?.cups || '').startsWith('150');
    if (!modelWrote && !afterOk) verdict = 'gemini_message_only_or_noop';
    else if (modelWrote && !afterOk) verdict = 'merge_normalize_drop';
    else if (afterOk) verdict = 'fields_ok_would_preview_update';
  }
  if (label === 'guests') {
    const modelWrote = String(workshopModel?.cups) === '20';
    const afterOk = String(workshopAfter?.cups) === '20';
    if (!modelWrote && !afterOk) verdict = 'gemini_message_only_or_noop';
    else if (modelWrote && !afterOk) verdict = 'merge_normalize_drop';
    else if (afterOk) verdict = 'fields_ok_would_preview_update';
  }

  return {
    label,
    assistantMessage,
    before,
    model,
    after,
    workshop: { before: workshopBefore, model: workshopModel, after: workshopAfter },
    bar: { before: barBefore, model: barModel, after: barAfter },
    verdict
  };
}

async function runTurn(apiKey, label, userText, current, history) {
  const messages = [...history, { role: 'user', content: userText }];
  const documentPreview = [
    'BILLING INVOICE',
    'Invoice #: INV-2026-0910-003',
    'Name: Cristopher David',
    '--- Package 1 ---',
    'Private Matcha Workshop',
    '30 cups',
    '--- Package 2 ---',
    'Starter Mobile Matcha Bar',
    '100 cups'
  ].join('\n');

  const raw = await generateInvoiceFromChat({
    apiKey,
    messages,
    currentInvoice: current,
    documentPreview
  });

  // generateInvoiceFromChat already finalizes; capture that as "finalized".
  // Also re-run finalize from a synthetic "pre-finalize" if raw exposes invoice.
  const finalized = raw.invoice;
  const turn = classifyTurn({
    label,
    current,
    modelInvoice: raw.invoice,
    assistantMessage: raw.assistantMessage,
    finalized
  });

  return { messages, rawAssistant: raw.assistantMessage, turn, invoice: raw.invoice };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Set GEMINI_API_KEY first');
    process.exit(1);
  }

  const evidence = {
    capturedAt: new Date().toISOString(),
    note: 'Live Gemini capture against screenshot-like two-package invoice. No secrets stored.',
    turns: []
  };

  let current = fixtureInvoice();
  const history = [
    {
      role: 'user',
      content: 'what is this invoice currently set to?'
    },
    {
      role: 'assistant',
      content:
        'This invoice is for Cristopher David and includes a Private Matcha Workshop for 30 pax on September 11, 2026, and a 100-cup Starter Mobile Matcha Bar on September 10, 2026.'
    }
  ];

  console.log('Turn 1: set the mobile bar to 150 cups...');
  const cupsTurn = await runTurn(
    apiKey,
    'cups',
    'set the mobile bar to 150 cups',
    current,
    history
  );
  evidence.turns.push({
    user: 'set the mobile bar to 150 cups',
    ...cupsTurn.turn,
    assistantMessage: cupsTurn.rawAssistant
  });
  history.push({ role: 'user', content: 'set the mobile bar to 150 cups' });
  history.push({ role: 'assistant', content: cupsTurn.rawAssistant });
  // Keep current as fixture (failed apply) to match screenshot honesty path
  // unless fields actually updated — then advance current.
  if (cupsTurn.turn.verdict === 'fields_ok_would_preview_update') {
    current = cupsTurn.invoice;
  }

  console.log('Turn 2: set the workshop to 20 guests...');
  const guestsTurn = await runTurn(
    apiKey,
    'guests',
    'set the workshop to 20 guests',
    current,
    history
  );
  evidence.turns.push({
    user: 'set the workshop to 20 guests',
    ...guestsTurn.turn,
    assistantMessage: guestsTurn.rawAssistant
  });

  // Extra: if model ever returns numberOfPax 150 + stale cups 100 Cups, merge triad works?
  evidence.syntheticMergeCheck = {
    triadNopWins: resolveMobileCupTriad(
      { cups: '100 Cups', numberOfPax: '100', customCups: '' },
      { cups: '100 Cups', numberOfPax: '150', customCups: '' }
    ),
    triadCupsWins: resolveMobileCupTriad(
      { cups: '100', numberOfPax: '100', customCups: '' },
      { cups: '150', numberOfPax: '100', customCups: '' }
    ),
    finalizeStaleCupsDisplay: (() => {
      const r = finalizeChatResult(
        {
          assistantMessage: 'Updated to 150.',
          invoice: {
            invoiceItems: [
              {
                id: 2,
                eventType: 'mobile_bar',
                packageType: 'starter',
                cups: '100 Cups',
                numberOfPax: '150',
                customCups: ''
              }
            ]
          }
        },
        fixtureInvoice(),
        [{ role: 'user', content: 'set to 150 cups' }]
      );
      const bar = r.invoice.invoiceItems.find((x) => x.eventType === 'mobile_bar');
      return { cups: bar.cups, numberOfPax: bar.numberOfPax, customCups: bar.customCups };
    })()
  };

  writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  console.log('Wrote', OUT);
  for (const t of evidence.turns) {
    console.log(`\n=== ${t.user} ===`);
    console.log('verdict:', t.verdict);
    console.log('assistant:', (t.assistantMessage || '').slice(0, 200));
    console.log('bar before/model/after:', t.bar);
    console.log('workshop before/model/after:', t.workshop);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
