/**
 * Unit tests for Discord expense channel map + expense builder.
 * Run: node tests/discordExpenseIngest.test.js
 */
const assert = require('assert');
const {
  buildChannelDefaultsMap,
  resolveChannelDefaults,
  defaultPaidBy
} = require('../discordExpenseChannels');
const {
  buildExpenseFromParsed,
  calculateVatBreakdown,
  todayLocalIso
} = require('../createExpenseFromReceipt');
const {
  pickFirstImage,
  isImageAttachment,
  isHeicAttachment,
  isHeicBuffer,
  formatPeso,
  ackContent,
  withTimeoutAndAbort
} = require('../discordExpenseBot');

// --- channel map ---
{
  const map = buildChannelDefaultsMap({
    DISCORD_EXPENSE_CHANNEL_GENERAL: '111'
  });
  assert.equal(map.size, 1);
  const d = resolveChannelDefaults('111', map);
  assert.equal(d.allocation, 'General');
  assert.equal(d.branch, null);
  assert.equal(resolveChannelDefaults('999', map), null);
}

{
  const map = buildChannelDefaultsMap({
    DISCORD_EXPENSE_CHANNEL_GENERAL: '111',
    DISCORD_EXPENSE_CHANNEL_SM_NORTH: '222'
  });
  assert.equal(map.size, 2);
  assert.equal(resolveChannelDefaults('222', map).branch, 'SM North');
  assert.equal(resolveChannelDefaults('222', map).allocation, 'Store');
}

assert.equal(defaultPaidBy('General'), 'Company');
assert.equal(defaultPaidBy('Store'), 'Store Cash');
assert.equal(defaultPaidBy('Popup'), 'Store Cash');

// --- expense builder forces channel defaults (ignores OCR allocation) ---
{
  const expense = buildExpenseFromParsed(
    {
      date: '2026-09-25',
      supplierName: 'Test Co',
      totalAmount: 1120,
      suggestedCategory: 'Supplies',
      suggestedAllocation: 'Store',
      supplierVatRegistered: true,
      inputVatClaimable: true,
      items: [{ name: 'Item', quantity: 1, price: 1120, total: 1120 }]
    },
    { allocation: 'General', branch: null },
    'exp1',
    'https://example.test/r.jpg',
    { discordAuthor: 'Alex' }
  );
  assert.equal(expense.allocation, 'General');
  assert.equal(expense.branch, null);
  assert.equal(expense.paidBy, 'Company');
  assert.equal(expense.expenseCategory, 'Supplies');
  assert.equal(expense.totalAmount, 1120);
  assert.ok(expense.vatAmount > 0);
  assert.equal(expense.recordedVia, 'discord');
  assert.ok(expense.notes.includes('Alex'));
  assert.equal(expense.hasReceiptImage, true);
}

{
  const expense = buildExpenseFromParsed(
    { totalAmount: 100, suggestedCategory: 'Nope' },
    { allocation: 'Store', branch: 'SM North' },
    'exp2',
    null
  );
  assert.equal(expense.allocation, 'Store');
  assert.equal(expense.branch, 'SM North');
  assert.equal(expense.paidBy, 'Store Cash');
  assert.equal(expense.expenseCategory, 'Supplies');
  assert.equal(expense.supplierName, 'Unknown supplier');
}

{
  const vat = calculateVatBreakdown(112, 0, true);
  assert.ok(Math.abs(vat.vatAmount - 12) < 0.01);
  assert.ok(Math.abs(vat.vatableSale - 100) < 0.01);
}

assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayLocalIso()));
assert.equal(formatPeso(1000), '₱1,000.00');

{
  assert.equal(isImageAttachment({ contentType: 'image/jpeg', name: 'a.jpg' }), true);
  assert.equal(isImageAttachment({ contentType: 'application/pdf', name: 'a.pdf' }), false);
  assert.equal(isImageAttachment({ contentType: '', name: 'shot.PNG' }), true);
  assert.equal(isHeicAttachment({ contentType: 'image/heic', name: 'a.heic' }), true);
  assert.equal(isHeicAttachment({ contentType: 'image/jpeg', name: 'a.jpg' }), false);
  // ftyp + brand heic
  const heicHdr = Buffer.alloc(12);
  heicHdr.writeUInt32BE(0, 0);
  heicHdr.write('ftyp', 4);
  heicHdr.write('heic', 8);
  assert.equal(isHeicBuffer('application/octet-stream', heicHdr), true);
  assert.equal(isHeicBuffer('image/jpeg', Buffer.from([0xff, 0xd8, 0xff])), false);

  const msg = {
    attachments: {
      map(fn) {
        return [
          { contentType: 'text/plain', name: 'notes.txt', url: 'http://x/t' },
          { contentType: 'image/png', name: 'r.png', url: 'http://x/r' }
        ].map(fn);
      },
      size: 2
    }
  };
  const img = pickFirstImage(msg);
  assert.equal(img.name, 'r.png');
}

{
  assert.equal(
    ackContent({ label: 'General' }, 1),
    'Got it — processing for **General**…'
  );
  assert.ok(ackContent({ label: 'General' }, 2).includes('Queued #2'));
}

(async () => {
  let err;
  try {
    await withTimeoutAndAbort(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        }),
      40,
      'Receipt OCR'
    );
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.equal(err.staffFacing, true);
  assert.ok(/timed out/i.test(err.message));
  console.log('discordExpenseIngest tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
