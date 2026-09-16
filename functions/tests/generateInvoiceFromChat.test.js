/**
 * Unit tests for invoice chat normalizers / request builders (no Gemini network).
 * Run: node tests/generateInvoiceFromChat.test.js
 */
const assert = require('assert');
const {
  buildSystemPrompt,
  buildRequestBody,
  sanitizeMessages,
  normalizeInvoice,
  normalizePackageItem,
  normalizeCustomLine,
  normalizeMilestone,
  normalizeResponse,
  normalizeIsoDate,
  MATCHA_WORKSHOP_INCLUSIONS,
  RESPONSE_SCHEMA
} = require('../generateInvoiceFromChat');

function testSystemPromptIncludesCatalogRules() {
  const prompt = buildSystemPrompt('2026-08-26');
  assert.ok(prompt.includes('MATCHANESE'));
  assert.ok(prompt.includes('never wipe') || prompt.includes('CURRENT INVOICE'));
  assert.ok(prompt.includes('starter'));
  assert.ok(prompt.includes('29500'));
  assert.ok(prompt.includes('coffeeAddOn'));
  assert.ok(prompt.includes('paymentStructure'));
  assert.ok(prompt.includes('Quoted price adjustment') || prompt.includes('quoted'));
  assert.ok(prompt.includes(MATCHA_WORKSHOP_INCLUSIONS[0]));
}

function testSystemPromptIncludesDrinkMenu() {
  const { MOBILE_BAR_CHOICE_MENU, MOBILE_BAR_SIGNATURE_DRINKS, MOBILE_BAR_SERVING_DEFAULT } = require('../generateInvoiceFromChat');
  const prompt = buildSystemPrompt('2026-08-26');
  assert.ok(prompt.includes('SLOT SYSTEM') || prompt.includes('Choice slots'));
  assert.ok(prompt.includes('Strawberry Matchanese Latte'));
  assert.ok(prompt.includes('Matchanese Seasalt Latte'));
  assert.ok(prompt.includes('Matchanese Sunrise'));
  assert.ok(prompt.includes('Americano'));
  assert.ok(prompt.includes('Kyoto Latte'));
  assert.ok(prompt.includes(MOBILE_BAR_SIGNATURE_DRINKS[0]));
  assert.ok(prompt.includes('DOCUMENT PREVIEW') || prompt.includes('Dairy or Oat Milk'));
  assert.ok(prompt.includes(MOBILE_BAR_SERVING_DEFAULT) || prompt.includes('Dairy or Oat Milk (choose one)'));
  assert.ok(prompt.includes('Missing-field priority') || prompt.includes('high-value missing'));
  assert.ok(prompt.includes('Dual Milk') || prompt.includes('Dairy and Oat'));
  assert.ok(MOBILE_BAR_CHOICE_MENU.pool.includes('Strawberry Matchanese Latte'));
  assert.ok(!prompt.includes('Matcha Tea'));
}

function testResolvePackageTypeFromText() {
  const { resolvePackageTypeFromText } = require('../generateInvoiceFromChat');
  assert.strictEqual(resolvePackageTypeFromText('change from starter to signature'), 'signature');
  assert.strictEqual(resolvePackageTypeFromText('upgrade to signature'), 'signature');
  assert.strictEqual(resolvePackageTypeFromText('make it special'), 'special');
  assert.strictEqual(resolvePackageTypeFromText('signature'), 'signature');
  assert.strictEqual(resolvePackageTypeFromText('i still shows starter package'), null);
  assert.strictEqual(resolvePackageTypeFromText('it still shows starter on the doc'), null);
}

function testNormalizeChoiceDrinkAliases() {
  const {
    normalizeChoiceDrinkName,
    normalizeChoiceDrinksList,
    extractChoiceDrinksFromText
  } = require('../generateInvoiceFromChat');
  assert.strictEqual(normalizeChoiceDrinkName('Strawberry Matcha Latte'), 'Strawberry Matchanese Latte');
  assert.strictEqual(normalizeChoiceDrinkName('strawberry matcha'), 'Strawberry Matchanese Latte');
  assert.strictEqual(normalizeChoiceDrinkName('Matcha Latte'), '');
  assert.strictEqual(normalizeChoiceDrinkName('signature matcha'), '');
  assert.strictEqual(normalizeChoiceDrinkName('Signature Matchanese Latte'), '');
  assert.strictEqual(normalizeChoiceDrinkName('Seasalt Latte'), 'Matchanese Seasalt Latte');
  assert.strictEqual(normalizeChoiceDrinkName('seasalt latte', { coffeeAddOn: false }), 'Matchanese Seasalt Latte');
  assert.strictEqual(normalizeChoiceDrinkName('coffee seasalt latte', { coffeeAddOn: true }), 'Seasalt Latte');
  assert.strictEqual(normalizeChoiceDrinkName('Matchanese Sunrise'), 'Matchanese Sunrise');
  assert.deepStrictEqual(
    normalizeChoiceDrinksList(['Seasalt Latte', '  ', 'Matchanese Coconut'], 3, { coffeeAddOn: false }),
    ['Matchanese Seasalt Latte', 'Matchanese Coconut']
  );
  assert.deepStrictEqual(
    extractChoiceDrinksFromText('add Strawberry Matcha Latte please'),
    ['Strawberry Matchanese Latte']
  );
  assert.deepStrictEqual(
    extractChoiceDrinksFromText('How about the Seasalt Latte?', false),
    ['Matchanese Seasalt Latte']
  );
}

function testMilkAndMilestonesAndAddressHints() {
  const {
    parseMilkOptionsFromText,
    parseInvoiceHintsFromText,
    finalizeChatResult,
    isAddressSearchRequest,
    isContaminatedAddress,
    wantsThreeMilestones,
    MILK_OAT_OPTIONS,
    MILK_DUAL_OPTIONS,
    DUAL_MILK_ADDON_FEE,
    buildSystemPrompt
  } = require('../generateInvoiceFromChat');

  assert.deepStrictEqual(parseMilkOptionsFromText('oat milk please'), MILK_OAT_OPTIONS);
  assert.deepStrictEqual(parseMilkOptionsFromText('dual milk please'), MILK_DUAL_OPTIONS);
  assert.ok(wantsThreeMilestones('make the payment 3 milestones'));
  assert.ok(isAddressSearchRequest('search for the address of outbox media and add it here'));
  assert.ok(isContaminatedAddress('Of Outbox Media And Add It Here'));
  assert.ok(
    isContaminatedAddress(
      'For The Workshop Is Taguig While The Matcha Bar Is On September 11 On Makati'
    )
  );

  const searchHints = parseInvoiceHintsFromText(
    'search for the address of outbox media and add it here'
  );
  assert.ok(!searchHints.clientAddress);
  assert.ok(!searchHints.eventVenue || !isContaminatedAddress(searchHints.eventVenue));

  // Finalize trusts Gemini JSON for milk — user text alone does not mutate options
  const milkResult = finalizeChatResult(
    {
      assistantMessage: 'Updated milk.',
      invoice: {
        clientName: 'Outbox Media',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '100',
            additionalOptions: MILK_OAT_OPTIONS
          }
        ]
      }
    },
    {
      clientName: 'Outbox Media',
      invoiceItems: [
        {
          eventType: 'mobile_bar',
          packageType: 'starter',
          cups: '100',
          additionalOptions: ['Iced (12oz) Drinks', 'Dairy or Oat Milk (choose one)']
        }
      ]
    },
    [{ role: 'user', content: 'oat milk please' }]
  );
  assert.deepStrictEqual(milkResult.invoice.invoiceItems[0].additionalOptions, MILK_OAT_OPTIONS);

  const dualResult = finalizeChatResult(
    {
      assistantMessage: 'Dual milk added.',
      invoice: {
        clientName: 'Outbox Media',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '100',
            additionalOptions: MILK_DUAL_OPTIONS
          }
        ],
        customLineItems: []
      }
    },
    {
      clientName: 'Outbox Media',
      invoiceItems: [
        {
          eventType: 'mobile_bar',
          packageType: 'starter',
          cups: '100',
          additionalOptions: ['Iced (12oz) Drinks', 'Dairy or Oat Milk (choose one)']
        }
      ],
      customLineItems: []
    },
    [{ role: 'user', content: 'we want dual milk dairy and oat' }]
  );
  assert.deepStrictEqual(dualResult.invoice.invoiceItems[0].additionalOptions, MILK_DUAL_OPTIONS);
  assert.ok(
    dualResult.invoice.customLineItems.some(
      (l) => /dual\s+milk/i.test(l.name) && l.price === DUAL_MILK_ADDON_FEE
    )
  );

  // Milestones: Gemini must emit three-structure JSON (user text no longer forces rebuild)
  const payResult = finalizeChatResult(
    {
      assistantMessage: 'Set three milestones.',
      invoice: {
        clientName: 'Outbox Media',
        paymentStructure: 'three',
        paymentTermsCustomized: false,
        paymentMilestones: [
          { role: 'first', milestone: 'Date Reservation', percentage: 25 },
          { role: 'preEvent', milestone: 'Pre-Event', percentage: 25 },
          { role: 'final', milestone: 'Event Completion', percentage: 50 }
        ],
        invoiceItems: [{ eventType: 'mobile_bar', packageType: 'starter', cups: '100' }]
      }
    },
    {
      clientName: 'Outbox Media',
      paymentStructure: 'two',
      paymentMilestones: [],
      invoiceItems: [{ eventType: 'mobile_bar', packageType: 'starter', cups: '100' }]
    },
    [{ role: 'user', content: 'make the payment 3 milestones' }]
  );
  assert.strictEqual(payResult.invoice.paymentStructure, 'three');
  assert.strictEqual(payResult.invoice.paymentTermsCustomized, false);
  assert.strictEqual(payResult.invoice.paymentMilestones.length, 3);
  assert.strictEqual(payResult.invoice.paymentMilestones[0].milestone, 'Date Reservation');
  assert.strictEqual(payResult.invoice.paymentMilestones[1].role, 'preEvent');

  const addrResult = finalizeChatResult(
    {
      assistantMessage: 'Added address.',
      invoice: {
        clientName: 'Outbox Media',
        clientAddress: 'Of Outbox Media And Add It Here',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '100',
            eventVenue: 'Of Outbox Media And Add It Here'
          }
        ]
      }
    },
    {
      clientName: 'Outbox Media',
      clientAddress: '',
      invoiceItems: [{ eventType: 'mobile_bar', packageType: 'starter', cups: '100' }]
    },
    [{ role: 'user', content: 'search for the address of outbox media and add it here' }]
  );
  assert.strictEqual(addrResult.invoice.clientAddress, '');
  assert.strictEqual(addrResult.invoice.invoiceItems[0].eventVenue, '');

  const prompt = buildSystemPrompt('2026-08-28');
  assert.ok(prompt.includes('high-value missing') || prompt.includes('Missing-field'));
  assert.ok(prompt.includes('Matchanese Seasalt Latte'));
  assert.ok(prompt.includes('SLOT SYSTEM') || prompt.includes('2 Base'));
  assert.ok(prompt.includes('MULTI-PACKAGE') || prompt.includes('OWN eventVenue'));
}

function testFinalizeAppliesPackageAndChoiceDrinks() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const result = finalizeChatResult(
    {
      assistantMessage: 'Updated to Signature with Strawberry Matchanese Latte.',
      invoice: {
        clientName: 'Bea Boldo',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'signature',
            cups: '100',
            choiceDrinks: ['Strawberry Matcha Latte']
          }
        ]
      }
    },
    {
      clientName: 'Bea Boldo',
      invoiceItems: [
        {
          eventType: 'mobile_bar',
          packageType: 'starter',
          cups: '100',
          choiceDrinks: []
        }
      ]
    },
    [{ role: 'user', content: 'change to signature and add Strawberry Matcha Latte' }]
  );
  assert.strictEqual(result.invoice.invoiceItems[0].packageType, 'signature');
  assert.deepStrictEqual(result.invoice.invoiceItems[0].choiceDrinks, [
    'Strawberry Matchanese Latte'
  ]);
}

function testRejectMatchaLatteAndReplaceRemovesIt() {
  const {
    normalizeChoiceDrinkName,
    normalizeChoiceDrinksList,
    applyChoiceDrinkEditsFromText,
    finalizeChatResult
  } = require('../generateInvoiceFromChat');

  assert.strictEqual(normalizeChoiceDrinkName('Matcha Latte'), '');
  assert.deepStrictEqual(
    normalizeChoiceDrinksList(
      ['Matchanese Seasalt Latte', 'Matcha Latte', 'Earl Grey Matchanese Latte'],
      3
    ),
    ['Matchanese Seasalt Latte', 'Earl Grey Matchanese Latte']
  );

  const replaced = applyChoiceDrinkEditsFromText(
    ['Matchanese Seasalt Latte', 'Matcha Latte', 'Earl Grey Matchanese Latte'],
    'Replace it with Strawberry Matchanese Latte',
    3
  );
  assert.deepStrictEqual(replaced, [
    'Matchanese Seasalt Latte',
    'Earl Grey Matchanese Latte',
    'Strawberry Matchanese Latte'
  ]);

  const removed = applyChoiceDrinkEditsFromText(
    ['Matchanese Seasalt Latte', 'Matcha Latte', 'Earl Grey Matchanese Latte'],
    'remove the duplicate Matcha Latte',
    3
  );
  assert.deepStrictEqual(removed, [
    'Matchanese Seasalt Latte',
    'Earl Grey Matchanese Latte'
  ]);

  const result = finalizeChatResult(
    {
      assistantMessage: 'Replaced Matcha Latte with Strawberry.',
      invoice: {
        clientName: 'Outbox Media',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'signature',
            cups: '100',
            choiceDrinks: [
              'Matchanese Seasalt Latte',
              'Earl Grey Matchanese Latte',
              'Strawberry Matchanese Latte'
            ]
          }
        ]
      }
    },
    {
      clientName: 'Outbox Media',
      invoiceItems: [
        {
          eventType: 'mobile_bar',
          packageType: 'signature',
          cups: '100',
          choiceDrinks: [
            'Matchanese Seasalt Latte',
            'Matcha Latte',
            'Earl Grey Matchanese Latte'
          ]
        }
      ]
    },
    [{ role: 'user', content: 'Replace it with Strawberry Matchanese Latte' }]
  );
  assert.deepStrictEqual(result.invoice.invoiceItems[0].choiceDrinks, [
    'Matchanese Seasalt Latte',
    'Earl Grey Matchanese Latte',
    'Strawberry Matchanese Latte'
  ]);
  assert.ok(!result.invoice.invoiceItems[0].choiceDrinks.includes('Matcha Latte'));
}

function testBuildRequestBodyIncludesDocumentPreview() {
  const body = buildRequestBody({
    messages: [{ role: 'user', content: 'what is the milk choice' }],
    currentInvoice: { clientName: 'Bea', invoiceItems: [] },
    documentPreview: 'Dairy or Oat Milk (choose one)\nMenu:\n  - Signature Matchanese Latte'
  });
  const first = body.contents[0].parts[0].text;
  assert.ok(first.includes('DOCUMENT PREVIEW'));
  assert.ok(first.includes('Dairy or Oat Milk (choose one)'));
  assert.ok(!first.includes('premium dairy'));
}

function testResponseSchemaShape() {
  assert.strictEqual(RESPONSE_SCHEMA.type, 'OBJECT');
  assert.ok(RESPONSE_SCHEMA.properties.assistantMessage);
  assert.ok(RESPONSE_SCHEMA.properties.invoice);
  assert.deepStrictEqual(RESPONSE_SCHEMA.required, ['assistantMessage', 'invoice']);
}

function testSanitizeMessagesCapsAndRoles() {
  const msgs = sanitizeMessages([
    { role: 'system', content: 'ignore role' },
    { role: 'assistant', content: 'hi' },
    { role: 'user', content: '  hello  ' },
    { role: 'user', content: '' },
    { role: 'user', content: 'x'.repeat(9000) }
  ]);
  assert.strictEqual(msgs.length, 4);
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[0].content, 'ignore role');
  assert.strictEqual(msgs[1].role, 'assistant');
  assert.strictEqual(msgs[2].content, 'hello');
  assert.strictEqual(msgs[3].content.length, 8000);
}

function testSanitizeMessagesKeepsLastTen() {
  const many = Array.from({ length: 15 }, (_, i) => ({
    role: 'user',
    content: `m${i}`
  }));
  const msgs = sanitizeMessages(many);
  assert.strictEqual(msgs.length, 10);
  assert.strictEqual(msgs[0].content, 'm5');
  assert.strictEqual(msgs[9].content, 'm14');
}

function testNormalizeIsoDate() {
  assert.strictEqual(normalizeIsoDate('2026-09-15'), '2026-09-15');
  assert.strictEqual(normalizeIsoDate('15/09/2026'), '2026-09-15');
  assert.strictEqual(normalizeIsoDate('09/15/2026'), '2026-09-15');
  assert.strictEqual(normalizeIsoDate(''), '');
}

function testNormalizeMobilePackage() {
  const item = normalizePackageItem(
    {
      eventType: 'mobile_bar',
      packageType: 'Signature',
      numberOfPax: '150',
      cups: '150',
      coffeeAddOn: true,
      transportAddOn: 'laguna',
      unitPrice: 99999,
      eventVenue: 'Solaire',
      eventDate: '2026-10-01'
    },
    0
  );
  assert.strictEqual(item.eventType, 'mobile_bar');
  assert.strictEqual(item.packageType, 'signature');
  assert.strictEqual(item.count, 150);
  assert.strictEqual(item.coffeeAddOn, true);
  assert.strictEqual(item.transportAddOn, 'laguna');
  assert.strictEqual(item.unitPrice, 0);
  assert.strictEqual(item.isWorkshop, false);
  assert.strictEqual(item.countLabel, 'cups');
  assert.strictEqual(item.eventDate, '2026-10-01');
}

function testNormalizeCustomCups() {
  const item = normalizePackageItem(
    {
      eventType: 'mobile_bar',
      packageType: 'starter',
      cups: '120'
    },
    1
  );
  assert.strictEqual(item.count, 120);
}

function testNormalizeWorkshopDefaults() {
  const item = normalizePackageItem(
    {
      eventType: 'matcha_workshop',
      cups: '12',
      unitCost: '1500'
    },
    0
  );
  assert.strictEqual(item.isWorkshop, true);
  assert.strictEqual(item.countLabel, 'participants');
  assert.strictEqual(item.packageType, '');
  assert.deepStrictEqual(item.workshopInclusions, MATCHA_WORKSHOP_INCLUSIONS);
  assert.strictEqual(item.coffeeAddOn, false);
}

function testNormalizeCustomLineAndMilestone() {
  const line = normalizeCustomLine({ name: 'Extra hour', quantity: 2, price: '1000' }, 0);
  assert.strictEqual(line.name, 'Extra hour');
  assert.strictEqual(line.quantity, 2);
  assert.strictEqual(line.price, 1000);

  const m = normalizeMilestone(
    { role: 'first', milestone: 'Down Payment', percentage: '50', paid: false },
    0
  );
  assert.strictEqual(m.role, 'first');
  assert.strictEqual(m.percentage, 50);
  assert.strictEqual(m.paid, false);
}

function testNormalizeInvoiceAndResponse() {
  const result = normalizeResponse({
    assistantMessage: '  Built Signature package  ',
    invoice: {
      clientName: 'Acme',
      paymentStructure: 'TWO',
      invoiceItems: [{ eventType: 'mobile_bar', packageType: 'signature', cups: '100' }],
      customLineItems: [{ name: 'Quoted price adjustment', quantity: 1, price: -500 }],
      paymentMilestones: []
    }
  });
  assert.strictEqual(result.assistantMessage, 'Built Signature package');
  assert.strictEqual(result.invoice.clientName, 'Acme');
  assert.strictEqual(result.invoice.paymentStructure, 'two');
  assert.strictEqual(result.invoice.invoiceItems.length, 1);
  assert.strictEqual(result.invoice.customLineItems[0].price, -500);
}

function testNormalizeEmptyInvoice() {
  const inv = normalizeInvoice(null);
  assert.strictEqual(inv.clientName, '');
  assert.deepStrictEqual(inv.invoiceItems, []);
  assert.strictEqual(inv.paymentStructure, 'three');
  assert.strictEqual(inv.paymentTermsCustomized, false);
}

function testBuildRequestBodyIncludesInvoiceAndEndsWithUser() {
  const body = buildRequestBody({
    messages: [
      { role: 'user', content: 'Signature 150 cups at Rockwell Sept 20' },
      { role: 'assistant', content: 'Drafted.' },
      { role: 'user', content: 'Make it 50/50' }
    ],
    currentInvoice: {
      clientName: 'Test Co',
      invoiceItems: [],
      customLineItems: [],
      paymentMilestones: [],
      paymentStructure: 'three'
    },
    now: new Date(2026, 7, 26)
  });

  assert.ok(body.contents.length >= 3);
  assert.ok(body.contents[0].parts[0].text.includes('CURRENT INVOICE JSON'));
  assert.ok(body.contents[0].parts[0].text.includes('Test Co'));
  const last = body.contents[body.contents.length - 1];
  assert.strictEqual(last.role, 'user');
  assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
  assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
  assert.strictEqual(body.generationConfig.responseSchema, undefined);
}

function testBuildRequestBodyAppendsUserIfNeeded() {
  const body = buildRequestBody({
    messages: [{ role: 'assistant', content: 'Only assistant so far' }],
    currentInvoice: {},
    now: new Date(2026, 7, 26)
  });
  const last = body.contents[body.contents.length - 1];
  assert.strictEqual(last.role, 'user');
}

function testExtractClientName() {
  const {
    extractClientNameFromText,
    extractClientNameFromAssistantText,
    isExplicitRenameIntent
  } = require('../generateInvoiceFromChat');
  assert.strictEqual(extractClientNameFromText('Make the invoice for Cathy Dee'), 'Cathy Dee');
  assert.strictEqual(
    extractClientNameFromText(
      'Now write the invoice to Catherine Deederino for 100 pax, Address is in Sulu'
    ),
    'Catherine Deederino'
  );
  assert.strictEqual(extractClientNameFromText("It's catherine deloitte"), 'Catherine Deloitte');
  assert.strictEqual(extractClientNameFromText('invoice for Acme Corp.'), 'Acme Corp');
  // Helper may still parse assistant text, but enrich/finalize must not use it
  assert.strictEqual(
    extractClientNameFromAssistantText('I have updated the client name to Catherine Deloitte.'),
    'Catherine Deloitte'
  );
  assert.ok(extractClientNameFromText('what can you do?') === '');
  assert.strictEqual(
    extractClientNameFromText('Just Make it Bea Boldo (AXS Limited)'),
    'Bea Boldo (axs Limited)'
  );
  assert.ok(isExplicitRenameIntent('Just Make it Bea Boldo (AXS Limited)'));
  assert.strictEqual(extractClientNameFromText('make it 200 cups'), '');
  assert.ok(isExplicitRenameIntent('make it 200 cups'));
}

function testFinalizeFillsClientNameFromUserMessage() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  // Name must come from Gemini JSON — finalize no longer scrapes user text
  const result = finalizeChatResult(
    {
      assistantMessage: 'I have updated the invoice for Cathy Dee.',
      invoice: { clientName: 'Cathy Dee', invoiceItems: [] }
    },
    { clientName: '', invoiceItems: [] },
    [{ role: 'user', content: 'Make the invoice for Cathy Dee' }]
  );
  assert.strictEqual(result.invoice.clientName, 'Cathy Dee');
}

function testFinalizeDoesNotScrapeAssistantProseIntoClientName() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const contaminated =
    'I have updated the client name to Bea Boldo and set the event venue to BGC, Taguig City.';
  const result = finalizeChatResult(
    {
      assistantMessage: contaminated,
      invoice: { clientName: '', invoiceItems: [] }
    },
    { clientName: '', invoiceItems: [] },
    [{ role: 'user', content: "where's the client name" }]
  );
  assert.strictEqual(result.invoice.clientName, '');
  assert.ok(!/and set/i.test(result.invoice.clientName));
}

function testFinalizeKeepsModelClientNameWithoutAssistantScrape() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const result = finalizeChatResult(
    {
      assistantMessage:
        'I have updated the client name to Bea Boldo and set the event venue to BGC, Taguig City.',
      invoice: {
        clientName: 'Bea Boldo',
        clientAddress: 'BGC, Taguig City',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '200',
            eventVenue: 'BGC, Taguig City'
          }
        ]
      }
    },
    { clientName: '', invoiceItems: [] },
    [{ role: 'user', content: "where's the client name" }]
  );
  assert.strictEqual(result.invoice.clientName, 'Bea Boldo');
  assert.strictEqual(result.invoice.clientAddress, 'BGC, Taguig City');
}

function testOverlayKeepsBaseWhenPatchEmpty() {
  const { overlayInvoice } = require('../generateInvoiceFromChat');
  const merged = overlayInvoice(
    {
      clientName: 'Existing Co',
      invoiceItems: [{ eventType: 'mobile_bar', packageType: 'starter', cups: '100' }]
    },
    { clientName: '', invoiceItems: [] }
  );
  assert.strictEqual(merged.clientName, 'Existing Co');
  assert.strictEqual(merged.invoiceItems.length, 1);
}

function testHintsRejectSentenceAsClientName() {
  const { extractClientNameFromText, parseInvoiceHintsFromText } = require('../generateInvoiceFromChat');
  assert.strictEqual(extractClientNameFromText('How about 5 hours of service'), '');
  const hints = parseInvoiceHintsFromText('How about 5 hours of service');
  assert.strictEqual(hints.durationHours, 5);
  assert.ok(!hints.clientAddress);
}

function testHintsSuluMochiWorkshop() {
  const { parseInvoiceHintsFromText, finalizeChatResult } = require('../generateInvoiceFromChat');
  const hints = parseInvoiceHintsFromText(
    'Now write the invoice to Catherine Deederino for 100 pax, Address is in Sulu mochi making workshop'
  );
  assert.strictEqual(hints.eventType, 'mochi_workshop');
  assert.strictEqual(hints.clientAddress, 'Sulu');
  assert.strictEqual(hints.eventVenue, 'Sulu');
  assert.strictEqual(hints.pax, 100);

  // Finalize uses Gemini JSON only (hints above are legacy parsers, unused by finalize)
  const result = finalizeChatResult(
    {
      assistantMessage: 'Drafted a mochi workshop for Catherine.',
      invoice: {
        clientName: 'Catherine Deederino',
        clientAddress: 'Sulu',
        invoiceItems: [
          {
            eventType: 'mochi_workshop',
            cups: '100',
            eventVenue: 'Sulu'
          }
        ],
        customLineItems: []
      }
    },
    { clientName: '', invoiceItems: [] },
    [
      {
        role: 'user',
        content:
          'Now write the invoice to Catherine Deederino for 100 pax, Address is in Sulu mochi making workshop'
      }
    ]
  );
  assert.strictEqual(result.invoice.clientName, 'Catherine Deederino');
  assert.strictEqual(result.invoice.clientAddress, 'Sulu');
  assert.strictEqual(result.invoice.invoiceItems.length, 1);
  assert.strictEqual(result.invoice.invoiceItems[0].eventType, 'mochi_workshop');
  assert.strictEqual(result.invoice.invoiceItems[0].eventVenue, 'Sulu');
  assert.strictEqual(result.invoice.invoiceItems[0].count, 100);
}

function testHints200CupsKeepsMobileBar() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const result = finalizeChatResult(
    {
      assistantMessage: 'Updated to 200 cups.',
      invoice: {
        clientName: 'Cathy',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '200',
            numberOfPax: 'custom',
            customCups: '200',
            durationHours: 3
          }
        ]
      }
    },
    {
      clientName: 'Cathy',
      invoiceItems: [
        {
          eventType: 'mobile_bar',
          packageType: 'starter',
          cups: '100',
          numberOfPax: '100',
          durationHours: 3
        }
      ]
    },
    [{ role: 'user', content: 'change to 200 cups' }]
  );
  assert.strictEqual(result.invoice.invoiceItems[0].eventType, 'mobile_bar');
  assert.strictEqual(result.invoice.invoiceItems[0].count, 200);
}

function testHintsFiveHoursSetsDurationNotCustomLine() {
  const { finalizeChatResult, parseInvoiceHintsFromText } = require('../generateInvoiceFromChat');
  assert.strictEqual(parseInvoiceHintsFromText('How about 5 hours of service').durationHours, 5);

  const result = finalizeChatResult(
    {
      assistantMessage: 'Set service to 5 hours.',
      invoice: {
        clientName: 'Catherine Deederino',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '100',
            numberOfPax: '100',
            durationHours: 5
          }
        ],
        customLineItems: [{ name: '5 Hours of Service', quantity: 1, price: 0 }]
      }
    },
    {
      clientName: 'Catherine Deederino',
      invoiceItems: [
        {
          eventType: 'mobile_bar',
          packageType: 'starter',
          cups: '100',
          numberOfPax: '100',
          durationHours: 3
        }
      ],
      customLineItems: []
    },
    [{ role: 'user', content: 'How about 5 hours of service' }]
  );
  assert.strictEqual(result.invoice.clientName, 'Catherine Deederino');
  assert.strictEqual(result.invoice.invoiceItems[0].durationHours, 5);
  assert.strictEqual(result.invoice.customLineItems.length, 0);
}

function testCupsDoNotConvertWorkshopToBar() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const result = finalizeChatResult(
    {
      assistantMessage: 'Noted.',
      invoice: { clientName: 'Catherine', invoiceItems: [] }
    },
    {
      clientName: 'Catherine',
      invoiceItems: [
        {
          eventType: 'mochi_workshop',
          cups: '100',
          eventVenue: 'Sulu',
          unitCost: ''
        }
      ]
    },
    [{ role: 'user', content: 'make it 200 cups' }]
  );
  assert.strictEqual(result.invoice.invoiceItems[0].eventType, 'mochi_workshop');
}

function testGeminiChatModelsPreferFlash() {
  const { GEMINI_CHAT_MODELS } = require('../generateInvoiceFromChat');
  assert.strictEqual(GEMINI_CHAT_MODELS[0], 'gemini-3.5-flash');
  assert.ok(GEMINI_CHAT_MODELS.includes('gemini-3.1-flash-lite'));
}

function testSystemPromptIncludesFieldMap() {
  const prompt = buildSystemPrompt('2026-08-26');
  assert.ok(prompt.includes('durationHours'));
  assert.ok(prompt.includes('choiceDrinks'));
  assert.ok(prompt.includes('eventVenue'));
  assert.ok(prompt.includes('mochi_workshop'));
}

function testNormalizeDurationAndChoiceDrinks() {
  const item = normalizePackageItem(
    {
      eventType: 'mobile_bar',
      packageType: 'signature',
      cups: '150',
      durationHours: 5,
      choiceDrinks: ['Ube Latte', '  ', 'Strawberry Matcha']
    },
    0
  );
  assert.strictEqual(item.durationHours, 5);
  assert.deepStrictEqual(item.choiceDrinks, ['Ube Latte', 'Strawberry Matchanese Latte']);
}

function testBillThisOneToMatchaWorkshop() {
  const {
    extractClientNameFromText,
    parseInvoiceHintsFromText,
    finalizeChatResult
  } = require('../generateInvoiceFromChat');

  const user =
    'Bill this one to catherine dee 20 pax matcha making workshop';
  assert.strictEqual(extractClientNameFromText(user), 'Catherine Dee');
  const hints = parseInvoiceHintsFromText(user);
  assert.strictEqual(hints.eventType, 'matcha_workshop');
  assert.strictEqual(hints.pax, 20);

  const result = finalizeChatResult(
    {
      assistantMessage:
        "I have updated the invoice for Catherine Dee's 20-participant matcha making workshop.",
      invoice: {
        clientName: 'Catherine Dee',
        invoiceItems: [
          {
            eventType: 'matcha_workshop',
            cups: '20'
          }
        ]
      }
    },
    { clientName: '', invoiceItems: [] },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(result.invoice.clientName, 'Catherine Dee');
  assert.strictEqual(result.invoice.invoiceItems[0].eventType, 'matcha_workshop');
  assert.strictEqual(result.invoice.invoiceItems[0].count, 20);
}

function testSept30TaguigRateFollowUp() {
  const { parseInvoiceHintsFromText, finalizeChatResult } = require('../generateInvoiceFromChat');
  const user = 'sept 30, taguig @ 1950 per pax';
  const hints = parseInvoiceHintsFromText(user);
  assert.strictEqual(hints.eventVenue, 'Taguig');
  assert.strictEqual(hints.unitCost, '1950');
  assert.ok(String(hints.eventDate).endsWith('-09-30'));

  const result = finalizeChatResult(
    {
      assistantMessage: 'Updated date, venue, and rate.',
      invoice: {
        clientName: 'Catherine Dee',
        invoiceItems: [
          {
            eventType: 'matcha_workshop',
            cups: '20',
            unitCost: '1950',
            eventVenue: 'Taguig',
            eventDate: '2026-09-30'
          }
        ]
      }
    },
    {
      clientName: 'Catherine Dee',
      invoiceItems: [
        {
          eventType: 'matcha_workshop',
          cups: '20',
          unitCost: '',
          eventVenue: ''
        }
      ]
    },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(result.invoice.clientName, 'Catherine Dee');
  assert.strictEqual(result.invoice.invoiceItems[0].count, 20);
  assert.strictEqual(result.invoice.invoiceItems[0].unitCost, '1950');
  assert.strictEqual(result.invoice.invoiceItems[0].eventVenue, 'Taguig');
  assert.ok(String(result.invoice.invoiceItems[0].eventDate).endsWith('-09-30'));
}

function testSparseGeminiDoesNotWipeFilledWorkshop() {
  const { overlayInvoice, finalizeChatResult } = require('../generateInvoiceFromChat');
  const merged = overlayInvoice(
    {
      clientName: 'Catherine Dee',
      invoiceItems: [
        {
          eventType: 'matcha_workshop',
          cups: '20',
          unitCost: '1950',
          eventVenue: 'Taguig',
          eventDate: '2026-09-30'
        }
      ]
    },
    {
      clientName: '',
      invoiceItems: [
        {
          eventType: 'matcha_workshop',
          cups: '',
          unitCost: '',
          eventVenue: '',
          eventDate: ''
        }
      ]
    }
  );
  assert.strictEqual(merged.clientName, 'Catherine Dee');
  assert.strictEqual(merged.invoiceItems[0].count, 20);
  assert.strictEqual(merged.invoiceItems[0].unitCost, '1950');
  assert.strictEqual(merged.invoiceItems[0].eventVenue, 'Taguig');

  const result = finalizeChatResult(
    {
      assistantMessage: 'Noted.',
      invoice: {
        clientName: '',
        invoiceItems: [{ eventType: 'matcha_workshop', cups: '', unitCost: '' }]
      }
    },
    {
      clientName: 'Catherine Dee',
      invoiceItems: [
        {
          eventType: 'matcha_workshop',
          cups: '20',
          unitCost: '1950',
          eventVenue: 'Taguig'
        }
      ]
    },
    [{ role: 'user', content: 'thanks' }]
  );
  assert.strictEqual(result.invoice.invoiceItems[0].count, 20);
  assert.strictEqual(result.invoice.invoiceItems[0].unitCost, '1950');
}

function testMatchaBarPaxMapsToCups() {
  const { parseInvoiceHintsFromText, finalizeChatResult } = require('../generateInvoiceFromChat');
  const hints = parseInvoiceHintsFromText(
    'Can you make a package for bea boldo matcha bar 200 pax at taguig city bgc'
  );
  assert.strictEqual(hints.eventType, 'mobile_bar');
  assert.strictEqual(hints.pax, 200);
  assert.strictEqual(hints.cups, 200);

  const result = finalizeChatResult(
    {
      assistantMessage: 'Created a mobile matcha bar for Bea Boldo.',
      invoice: {
        clientName: 'Bea Boldo',
        clientAddress: 'BGC, Taguig City',
        invoiceItems: [
          {
            eventType: 'mobile_bar',
            packageType: '',
            cups: '200',
            numberOfPax: 'custom',
            customCups: '200',
            eventVenue: 'BGC, Taguig City'
          }
        ]
      }
    },
    { clientName: '', invoiceItems: [] },
    [
      {
        role: 'user',
        content: 'Can you make a package for bea boldo matcha bar 200 pax at taguig city bgc'
      }
    ]
  );
  assert.strictEqual(result.invoice.clientName, 'Bea Boldo');
  assert.strictEqual(result.invoice.invoiceItems[0].eventType, 'mobile_bar');
  assert.strictEqual(result.invoice.invoiceItems[0].count, 200);
  assert.ok(/taguig|bgc/i.test(result.invoice.invoiceItems[0].eventVenue));
}

function testStarterFollowUpKeeps200Cups() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const result = finalizeChatResult(
    {
      assistantMessage: 'Updated to Starter.',
      invoice: {
        clientName: 'Bea Boldo',
        invoiceItems: [{ eventType: 'mobile_bar', packageType: 'starter', cups: '' }]
      }
    },
    {
      clientName: 'Bea Boldo',
      clientAddress: 'BGC, Taguig City',
      invoiceItems: [
        {
          eventType: 'mobile_bar',
          packageType: '',
          cups: '200',
          numberOfPax: 'custom',
          customCups: '200',
          eventVenue: 'BGC, Taguig City',
          durationHours: 3
        }
      ]
    },
    [{ role: 'user', content: 'starter' }]
  );
  assert.strictEqual(result.invoice.clientName, 'Bea Boldo');
  assert.strictEqual(result.invoice.invoiceItems[0].packageType, 'starter');
  assert.strictEqual(result.invoice.invoiceItems[0].count, 200);
  assert.strictEqual(result.invoice.invoiceItems[0].eventVenue, 'BGC, Taguig City');
}

function testCompoundInvoiceToAndSetEvent() {
  const {
    extractClientNameFromText,
    sanitizeCompoundClientName,
    normalizeInvoice,
    finalizeChatResult,
    isContaminatedClientName
  } = require('../generateInvoiceFromChat');

  const user = 'Write an invoice to bea boldo and set the event for next next firday.';
  assert.strictEqual(extractClientNameFromText(user), 'Bea Boldo');
  assert.strictEqual(
    sanitizeCompoundClientName('Bea Boldo And Set The Event'),
    'Bea Boldo'
  );
  assert.ok(isContaminatedClientName('Bea Boldo And Set The Event'));
  assert.strictEqual(
    normalizeInvoice({ clientName: 'Bea Boldo And Set The Event' }).clientName,
    'Bea Boldo'
  );

  // Gemini returns clean name — must stay clean even with compound user text
  const keepGemini = finalizeChatResult(
    {
      assistantMessage: 'Created for Bea Boldo.',
      invoice: { clientName: 'Bea Boldo', invoiceItems: [] }
    },
    { clientName: '', invoiceItems: [] },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(keepGemini.invoice.clientName, 'Bea Boldo');

  // Gemini returns compound junk — sanitized
  const fixGemini = finalizeChatResult(
    {
      assistantMessage: 'Created.',
      invoice: { clientName: 'Bea Boldo And Set The Event', invoiceItems: [] }
    },
    { clientName: '', invoiceItems: [] },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(fixGemini.invoice.clientName, 'Bea Boldo');

  // Empty Gemini — user extract no longer fills name (trust JSON only)
  const fromUser = finalizeChatResult(
    {
      assistantMessage: 'Created.',
      invoice: { clientName: '', invoiceItems: [] }
    },
    { clientName: '', invoiceItems: [] },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(fromUser.invoice.clientName, '');
}

function testExplicitRenameOverwritesCleanName() {
  const { finalizeChatResult, extractClientNameFromText } = require('../generateInvoiceFromChat');
  const user = 'Just Make it Bea Boldo (AXS Limited)';
  assert.strictEqual(extractClientNameFromText(user), 'Bea Boldo (axs Limited)');

  // Rename must be in Gemini JSON; finalize does not scrape user text
  const result = finalizeChatResult(
    {
      assistantMessage: 'Updated the client name.',
      invoice: { clientName: 'Bea Boldo (AXS Limited)', invoiceItems: [] }
    },
    { clientName: 'Bea Boldo asd SASD', invoiceItems: [] },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(result.invoice.clientName, 'Bea Boldo (AXS Limited)');
}

function testDualVenueGeminiPreservedAndProseScrubbed() {
  const {
    finalizeChatResult,
    parseInvoiceHintsFromText,
    isContaminatedAddress
  } = require('../generateInvoiceFromChat');

  const user =
    'venue for the workshop is Taguig while the matcha bar is on September 11 on Makati';
  const hints = parseInvoiceHintsFromText(user);
  // Contaminated prose must not become a venue hint (strengthened isContaminatedAddress)
  assert.ok(!hints.eventVenue || isContaminatedAddress(hints.eventVenue));

  const good = finalizeChatResult(
    {
      assistantMessage: 'Set venues per package.',
      invoice: {
        clientName: 'The Loop',
        invoiceItems: [
          {
            eventType: 'matcha_workshop',
            cups: '30',
            eventVenue: 'Taguig',
            eventDate: '2026-09-11'
          },
          {
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '100',
            eventVenue: 'Makati',
            eventDate: '2026-09-11'
          }
        ]
      }
    },
    { clientName: 'The Loop', invoiceItems: [] },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(good.invoice.invoiceItems[0].eventVenue, 'Taguig');
  assert.strictEqual(good.invoice.invoiceItems[1].eventVenue, 'Makati');
  assert.ok(!/while/i.test(good.invoice.invoiceItems[0].eventVenue));

  const scrubbed = finalizeChatResult(
    {
      assistantMessage: 'Updated.',
      invoice: {
        clientName: 'The Loop',
        invoiceItems: [
          {
            eventType: 'matcha_workshop',
            cups: '30',
            eventVenue:
              'For The Workshop Is Taguig While The Matcha Bar Is On September 11 On Makati'
          }
        ]
      }
    },
    { clientName: 'The Loop', invoiceItems: [] },
    [{ role: 'user', content: user }]
  );
  assert.strictEqual(scrubbed.invoice.invoiceItems[0].eventVenue, '');
}

function testLegacyTriadConflictResolvesToNumberOfPax() {
  const { normalizePackageItem, resolvePackageCount } = require('../generateInvoiceFromChat');
  // Legacy docs: numberOfPax was authoritative for pricing over display cups.
  const legacy = {
    eventType: 'mobile_bar',
    packageType: 'starter',
    numberOfPax: '150',
    cups: '100 Cups',
    customCups: ''
  };
  assert.strictEqual(resolvePackageCount(legacy), 150);
  const item = normalizePackageItem(legacy, 0);
  assert.strictEqual(item.count, 150);
  assert.strictEqual(item.cups, undefined);
  assert.strictEqual(item.numberOfPax, undefined);
  assert.strictEqual(item.customCups, undefined);
}

function testCountPatchAppliesAndZeroIsIgnored() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const current = {
    clientName: 'Cathy',
    invoiceItems: [
      {
        id: 2,
        eventType: 'mobile_bar',
        packageType: 'signature',
        count: 150,
        eventVenue: 'Makati',
        coffeeAddOn: true
      }
    ]
  };

  const applied = finalizeChatResult(
    {
      assistantMessage: 'Updated to 260 cups.',
      invoice: { invoiceItems: [{ id: 2, count: 260 }] }
    },
    current,
    [{ role: 'user', content: 'change cups to 260' }]
  );
  assert.strictEqual(applied.invoice.invoiceItems[0].count, 260);
  assert.strictEqual(applied.invoice.invoiceItems[0].eventVenue, 'Makati');
  assert.strictEqual(applied.invoice.invoiceItems[0].coffeeAddOn, true);
  assert.strictEqual(applied.invoice.invoiceItems[0].packageType, 'signature');

  const ignored = finalizeChatResult(
    {
      assistantMessage: 'No change.',
      invoice: { invoiceItems: [{ id: 2, count: 0 }] }
    },
    current,
    [{ role: 'user', content: 'hmm' }]
  );
  assert.strictEqual(ignored.invoice.invoiceItems[0].count, 150);
}

/** Gemini message-only: finalize must NOT invent cups/guests from user text. */
function testFinalizeDoesNotInventCountsFromUserText() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');

  const current = {
    clientName: 'Cristopher David',
    invoiceItems: [
      {
        id: 1,
        eventType: 'matcha_workshop',
        cups: '30',
        unitCost: '1512',
        eventDate: '2026-09-11'
      },
      {
        id: 2,
        eventType: 'mobile_bar',
        packageType: 'starter',
        cups: '100',
        numberOfPax: '100',
        customCups: '',
        eventDate: '2026-09-10'
      }
    ]
  };

  const cupsResult = finalizeChatResult(
    {
      assistantMessage: 'I have updated the mobile bar package to 150 cups.',
      invoice: {
        clientName: 'Cristopher David',
        invoiceItems: [
          { id: 1, eventType: 'matcha_workshop', cups: '30', unitCost: '1512' },
          {
            id: 2,
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '100',
            numberOfPax: '100',
            customCups: ''
          }
        ]
      }
    },
    current,
    [{ role: 'user', content: 'set the mobile bar to 150 cups' }]
  );
  const bar = cupsResult.invoice.invoiceItems.find((x) => x.eventType === 'mobile_bar');
  assert.strictEqual(bar.count, 100);

  const guestsResult = finalizeChatResult(
    {
      assistantMessage: 'I have updated the workshop guest count to 20.',
      invoice: {
        clientName: 'Cristopher David',
        invoiceItems: [
          { id: 1, eventType: 'matcha_workshop', cups: '30', unitCost: '1512' },
          {
            id: 2,
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '100',
            numberOfPax: '100'
          }
        ]
      }
    },
    current,
    [{ role: 'user', content: 'set the workshop to 20 guests' }]
  );
  const workshop = guestsResult.invoice.invoiceItems.find((x) => x.eventType === 'matcha_workshop');
  assert.strictEqual(workshop.count, 30);
}

/** Gemini message-only venue/date — finalize must NOT invent from user text. */
function testFinalizeDoesNotInventVenueDateFromUserText() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');

  const current = {
    clientName: 'Cristopher David',
    invoiceItems: [
      {
        id: 1,
        eventType: 'matcha_workshop',
        cups: '20',
        unitCost: '1512',
        eventVenue: '',
        eventDate: '2026-09-11'
      },
      {
        id: 2,
        eventType: 'mobile_bar',
        packageType: 'starter',
        cups: '150',
        numberOfPax: '150',
        eventVenue: '',
        eventDate: '2026-09-10'
      }
    ]
  };

  const venueResult = finalizeChatResult(
    {
      assistantMessage: 'I have updated the event venue for the private workshop to BGC, Taguig.',
      invoice: {
        clientName: 'Cristopher David',
        invoiceItems: [
          { id: 1, eventType: 'matcha_workshop', cups: '20', eventVenue: '', eventDate: '2026-09-11' },
          {
            id: 2,
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '150',
            numberOfPax: '150',
            eventVenue: '',
            eventDate: '2026-09-10'
          }
        ]
      }
    },
    current,
    [{ role: 'user', content: 'change the venue for the private workshop to bgc, taguig' }]
  );
  const ws = venueResult.invoice.invoiceItems.find((x) => x.eventType === 'matcha_workshop');
  assert.strictEqual(String(ws.eventVenue || ''), '');

  const dateResult = finalizeChatResult(
    {
      assistantMessage: 'I have updated the event date for both packages to September 26, 2026.',
      invoice: {
        clientName: 'Cristopher David',
        invoiceItems: [
          { id: 1, eventType: 'matcha_workshop', cups: '20', eventDate: '2026-09-11' },
          {
            id: 2,
            eventType: 'mobile_bar',
            packageType: 'starter',
            cups: '150',
            numberOfPax: '150',
            eventDate: '2026-09-10'
          }
        ]
      }
    },
    current,
    [{ role: 'user', content: 'change the date of both to sept 26' }]
  );
  assert.strictEqual(dateResult.invoice.invoiceItems[0].eventDate, '2026-09-11');
  assert.strictEqual(dateResult.invoice.invoiceItems[1].eventDate, '2026-09-10');
}

/** Prompt must demand a patch (changed fields only), not a complete invoice echo. */
function testSystemPromptDemandsPatchOnly() {
  const { buildSystemPrompt, buildRequestBody } = require('../generateInvoiceFromChat');
  const prompt = buildSystemPrompt('2026-09-13');
  assert.ok(/PATCH/.test(prompt));
  assert.ok(/ONLY the fields you are changing/i.test(prompt));
  assert.ok(/Omit every field you are not changing/i.test(prompt));
  assert.ok(/invoice: \{\}/.test(prompt));
  assert.ok(!/COMPLETE updated invoice/i.test(prompt));

  const body = buildRequestBody({
    messages: [{ role: 'user', content: 'set cups to 260' }],
    currentInvoice: { clientName: 'Cathy', invoiceItems: [] }
  });
  const contextText = body.contents[0].parts[0].text;
  assert.ok(/PATCH/.test(contextText));
}

/** A sparse patch must change only what it names and leave untouched fields alone. */
function testSparsePatchOnlyTouchesNamedFields() {
  const { finalizeChatResult, MILK_OAT_OPTIONS } = require('../generateInvoiceFromChat');

  const current = {
    clientName: 'Cristopher David',
    clientAddress: '123 Real Street, Makati',
    invoiceItems: [
      {
        id: 1,
        eventType: 'matcha_workshop',
        cups: '30',
        unitCost: '1512',
        eventVenue: 'Taguig',
        eventDate: '2026-09-11'
      },
      {
        id: 2,
        eventType: 'mobile_bar',
        packageType: 'signature',
        cups: '200',
        numberOfPax: 'custom',
        customCups: '200',
        eventVenue: 'The Annex, SM North EDSA',
        eventDate: '2026-09-10',
        coffeeAddOn: true,
        transportAddOn: 'bulacan',
        durationHours: 5,
        choiceDrinks: ['Strawberry Matchanese Latte'],
        additionalOptions: MILK_OAT_OPTIONS
      }
    ]
  };

  // Gemini patches ONLY the bar cup count, by id.
  const result = finalizeChatResult(
    {
      assistantMessage: 'Updated the mobile bar to 260 cups.',
      invoice: {
        invoiceItems: [{ id: 2, count: 260 }]
      }
    },
    current,
    [{ role: 'user', content: 'cups to 260' }]
  );

  const bar = result.invoice.invoiceItems.find((x) => x.id === 2);
  assert.strictEqual(bar.count, 260);
  // Everything the patch did not name survives
  assert.strictEqual(bar.packageType, 'signature');
  assert.strictEqual(bar.eventVenue, 'The Annex, SM North EDSA');
  assert.strictEqual(bar.eventDate, '2026-09-10');
  assert.strictEqual(bar.coffeeAddOn, true);
  assert.strictEqual(bar.transportAddOn, 'bulacan');
  assert.strictEqual(bar.durationHours, 5);
  assert.deepStrictEqual(bar.additionalOptions, MILK_OAT_OPTIONS);
  assert.ok(bar.choiceDrinks.includes('Strawberry Matchanese Latte'));

  const workshop = result.invoice.invoiceItems.find((x) => x.id === 1);
  assert.strictEqual(workshop.count, 30);
  assert.strictEqual(workshop.eventVenue, 'Taguig');
  assert.strictEqual(workshop.unitCost, '1512');
  assert.strictEqual(result.invoice.clientName, 'Cristopher David');
  assert.strictEqual(result.invoice.clientAddress, '123 Real Street, Makati');
}

/** Empty patch = nothing changes, and the raw patch is surfaced for debug. */
function testEmptyPatchChangesNothingAndIsReported() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const current = {
    clientName: 'Cathy',
    invoiceItems: [
      {
        id: 7,
        eventType: 'mobile_bar',
        packageType: 'starter',
        count: 150,
        eventVenue: 'Makati'
      }
    ]
  };

  const result = finalizeChatResult(
    { assistantMessage: 'The invoice shows 150 cups.', invoice: {} },
    current,
    [{ role: 'user', content: 'how many cups is it' }]
  );

  assert.deepStrictEqual(result.geminiPatch, {});
  const bar = result.invoice.invoiceItems[0];
  assert.strictEqual(bar.count, 150);
  assert.strictEqual(bar.packageType, 'starter');
  assert.strictEqual(bar.eventVenue, 'Makati');
  assert.strictEqual(result.invoice.clientName, 'Cathy');
}

/** geminiPatch must be the literal model output, not a normalized full invoice. */
function testGeminiPatchIsRawModelOutput() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const patch = { invoiceItems: [{ id: 3, eventVenue: 'BGC, Taguig' }] };
  const result = finalizeChatResult(
    { assistantMessage: 'Set the venue.', invoice: patch },
    {
      clientName: 'Bea',
      invoiceItems: [{ id: 3, eventType: 'mobile_bar', packageType: 'starter', cups: '100', numberOfPax: '100' }]
    },
    [{ role: 'user', content: 'venue is bgc taguig' }]
  );
  assert.deepStrictEqual(result.geminiPatch, patch);
  assert.deepStrictEqual(Object.keys(result.geminiPatch), ['invoiceItems']);
  assert.deepStrictEqual(Object.keys(result.geminiPatch.invoiceItems[0]), ['id', 'eventVenue']);
  assert.strictEqual(result.invoice.invoiceItems[0].eventVenue, 'BGC, Taguig');
  assert.strictEqual(result.invoice.invoiceItems[0].count, 100);
}

/** A patch item without an id and no matching slot is added as a new package. */
function testPatchCanAddNewPackage() {
  const { finalizeChatResult } = require('../generateInvoiceFromChat');
  const result = finalizeChatResult(
    {
      assistantMessage: 'Added the workshop.',
      invoice: {
        invoiceItems: [
          { id: 1, cups: '260', numberOfPax: 'custom', customCups: '260' },
          { eventType: 'matcha_workshop', cups: '20', unitCost: '1512' }
        ]
      }
    },
    {
      clientName: 'Cathy',
      invoiceItems: [
        { id: 1, eventType: 'mobile_bar', packageType: 'starter', cups: '100', numberOfPax: '100' }
      ]
    },
    [{ role: 'user', content: 'also add a matcha workshop for 20 at 1512' }]
  );
  assert.strictEqual(result.invoice.invoiceItems.length, 2);
  assert.strictEqual(result.invoice.invoiceItems[0].count, 260);
  assert.strictEqual(result.invoice.invoiceItems[1].eventType, 'matcha_workshop');
  assert.strictEqual(result.invoice.invoiceItems[1].count, 20);
}

function run() {
  testSystemPromptIncludesCatalogRules();
  testSystemPromptIncludesDrinkMenu();
  testResolvePackageTypeFromText();
  testNormalizeChoiceDrinkAliases();
  testMilkAndMilestonesAndAddressHints();
  testFinalizeAppliesPackageAndChoiceDrinks();
  testRejectMatchaLatteAndReplaceRemovesIt();
  testBuildRequestBodyIncludesDocumentPreview();
  testSystemPromptIncludesFieldMap();
  testResponseSchemaShape();
  testSanitizeMessagesCapsAndRoles();
  testSanitizeMessagesKeepsLastTen();
  testNormalizeIsoDate();
  testNormalizeMobilePackage();
  testNormalizeCustomCups();
  testNormalizeWorkshopDefaults();
  testNormalizeDurationAndChoiceDrinks();
  testNormalizeCustomLineAndMilestone();
  testNormalizeInvoiceAndResponse();
  testNormalizeEmptyInvoice();
  testBuildRequestBodyIncludesInvoiceAndEndsWithUser();
  testBuildRequestBodyAppendsUserIfNeeded();
  testExtractClientName();
  testFinalizeFillsClientNameFromUserMessage();
  testFinalizeDoesNotScrapeAssistantProseIntoClientName();
  testFinalizeKeepsModelClientNameWithoutAssistantScrape();
  testOverlayKeepsBaseWhenPatchEmpty();
  testHintsRejectSentenceAsClientName();
  testHintsSuluMochiWorkshop();
  testHints200CupsKeepsMobileBar();
  testHintsFiveHoursSetsDurationNotCustomLine();
  testCupsDoNotConvertWorkshopToBar();
  testGeminiChatModelsPreferFlash();
  testBillThisOneToMatchaWorkshop();
  testSept30TaguigRateFollowUp();
  testSparseGeminiDoesNotWipeFilledWorkshop();
  testMatchaBarPaxMapsToCups();
  testStarterFollowUpKeeps200Cups();
  testCompoundInvoiceToAndSetEvent();
  testExplicitRenameOverwritesCleanName();
  testDualVenueGeminiPreservedAndProseScrubbed();
  testLegacyTriadConflictResolvesToNumberOfPax();
  testCountPatchAppliesAndZeroIsIgnored();
  testFinalizeDoesNotInventCountsFromUserText();
  testFinalizeDoesNotInventVenueDateFromUserText();
  testSystemPromptDemandsPatchOnly();
  testSparsePatchOnlyTouchesNamedFields();
  testEmptyPatchChangesNothingAndIsReported();
  testGeminiPatchIsRawModelOutput();
  testPatchCanAddNewPackage();
  console.log('generateInvoiceFromChat.test.js: all tests passed');
}

run();
