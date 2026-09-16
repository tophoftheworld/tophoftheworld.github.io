const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DISCORD_CONTENT_LIMIT,
  DASHBOARD_LEADS_URL,
  chunkText,
  withWait,
  inquiryMessageUrl,
  buildInquiryEmbed,
  formatService,
  formatInquiryDate,
  buildInboxSummaryMessages,
  sendInboxSummaryToDiscord,
  upsertInquiryMessage,
  notifyNewInquiry,
  shouldNotifyShopifyOrder,
  buildOrderEmbed,
  notifyShopifyOrder,
  formatOrderMoney
} = require("../discord");

test("chunkText returns empty for blank input", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText(null), []);
});

test("chunkText keeps short text as one chunk", () => {
  assert.deepEqual(chunkText("hello"), ["hello"]);
});

test("chunkText splits on newlines before the limit", () => {
  const line = "x".repeat(20);
  const text = Array.from({ length: 5 }, () => line).join("\n");
  const chunks = chunkText(text, 50);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 50);
  }
  assert.equal(chunks.join("\n"), text);
});

test("chunkText hard-splits a single oversized line", () => {
  const text = "a".repeat(25);
  const chunks = chunkText(text, 10);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(""), text);
});

test("formatService uses dashboard labels", () => {
  assert.equal(formatService("private_mobile_matcha_bar"), "Private Mobile Matcha Bar");
  assert.equal(formatService("private_matcha_workshop"), "Private Matcha Workshop");
});

test("formatInquiryDate uses a long date", () => {
  assert.equal(formatInquiryDate("2026-09-17"), "September 17, 2026");
});

test("buildInquiryEmbed includes known fields and dashboard link", () => {
  const embed = buildInquiryEmbed({
    clientName: "Ana",
    service: "private_mobile_matcha_bar",
    eventType: "Wedding",
    targetDate: "2026-10-12",
    targetPax: "80",
    targetVenue: "Makati",
    quotedPrice: "PHP 45,000",
    quoteReference: "K7M2P",
    pipelineStatus: "inquiry",
    profileStatus: "draft",
    notes: "Outdoor setup"
  });
  assert.equal(embed.title, "New inquiry: Ana");
  assert.equal(embed.url, DASHBOARD_LEADS_URL);
  const byName = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
  assert.equal(byName["Quote ref"], "K7M2P");
  assert.equal(byName.Service, "Private Mobile Matcha Bar");
  assert.equal(byName.Date, "October 12, 2026");
  assert.equal(byName.Status, "Inquiry");
  assert.equal(byName.Profile, "Incomplete");
  assert.equal(byName.Notes, "Outdoor setup");
  assert.doesNotMatch(JSON.stringify(embed), /private_mobile_matcha_bar/);
});

test("buildInquiryEmbed skips N/A placeholders", () => {
  const embed = buildInquiryEmbed({
    clientName: "Cristopher David",
    service: "private_mobile_matcha_bar",
    eventType: "N/A",
    created: false,
    discordMessageId: "1"
  });
  assert.equal(embed.title, "Inquiry updated: Cristopher David");
  const byName = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
  assert.equal(byName.Service, "Private Mobile Matcha Bar");
  assert.equal(byName.Event, undefined);
});

test("buildInquiryEmbed omits empty fields", () => {
  const embed = buildInquiryEmbed({ clientName: "Bo" });
  assert.equal(embed.title, "New inquiry: Bo");
  assert.equal(embed.fields.length, 0);
});

test("buildInquiryEmbed marks updates", () => {
  const embed = buildInquiryEmbed({
    clientName: "Bo",
    created: false,
    discordMessageId: "123"
  });
  assert.equal(embed.title, "Inquiry updated: Bo");
});

test("sendInboxSummaryToDiscord skips when webhook URL is missing", async () => {
  const result = await sendInboxSummaryToDiscord(
    { subject: "Morning", summary: "hi" },
    { webhookUrl: "", fetchImpl: async () => assert.fail("should not fetch") }
  );
  assert.equal(result.skipped, true);
});

test("buildInboxSummaryMessages sends one Discord message per section", () => {
  const messages = buildInboxSummaryMessages({
    subject: "Morning action brief",
    sections: {
      leads: ["Cristopher quote", "Tricia workshop"],
      payments: ["GCash: M#2264"],
      followUps: ["Alice quotation", "Chen proposal"]
    }
  });
  assert.equal(messages.length, 3);
  assert.match(messages[0], /^\*\*Morning action brief\*\*\n\n\*\*Leads\*\*/);
  assert.match(messages[0], /- Cristopher quote/);
  assert.match(messages[1], /^\*\*Payments to verify\*\*/);
  assert.match(messages[2], /^\*\*Follow-ups\*\*/);
  for (const content of messages) {
    assert.doesNotMatch(content, /\(cont\.\)/);
  }
});

test("buildInboxSummaryMessages splits a long section on bullets", () => {
  const items = Array.from({ length: 40 }, (_, i) => `Follow-up item ${i} ${"x".repeat(80)}`);
  const messages = buildInboxSummaryMessages({
    subject: "Evening review",
    sections: { followUps: items }
  });
  assert.ok(messages.length >= 2);
  assert.match(messages[0], /^\*\*Evening review\*\*/);
  assert.match(messages[1], /^\*\*Follow-ups\*\*/);
  for (const content of messages) {
    assert.ok(content.length <= DISCORD_CONTENT_LIMIT);
    assert.doesNotMatch(content, /\(cont\.\)/);
  }
});

test("sendInboxSummaryToDiscord posts one message per section", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 204, text: async () => "" };
  };
  const result = await sendInboxSummaryToDiscord(
    {
      subject: "Morning action brief",
      sections: {
        leads: ["Cristopher quote"],
        payments: ["GCash: M#2264"],
        followUps: ["Alice quotation"]
      }
    },
    { webhookUrl: "https://example.test/hook", fetchImpl }
  );
  assert.equal(result.ok, true);
  assert.equal(result.chunks, 3);
  assert.equal(calls[0].body.username, "Inbox Summary");
  assert.match(calls[0].body.content, /\*\*Leads\*\*/);
  assert.match(calls[1].body.content, /\*\*Payments to verify\*\*/);
  assert.match(calls[2].body.content, /\*\*Follow-ups\*\*/);
});

test("notifyNewInquiry skips when webhook URL is missing", async () => {
  const result = await notifyNewInquiry(
    { created: true, clientName: "Ana" },
    { webhookUrl: "", fetchImpl: async () => assert.fail("should not fetch") }
  );
  assert.equal(result.skipped, true);
});

test("upsertInquiryMessage posts with wait=true and returns message id", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: JSON.parse(opts.body) });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "msg-1" })
    };
  };
  const result = await upsertInquiryMessage(
    { clientName: "Ana", quoteReference: "K7M2P", created: true },
    { webhookUrl: "https://example.test/inq", fetchImpl }
  );
  assert.equal(result.ok, true);
  assert.equal(result.action, "posted");
  assert.equal(result.messageId, "msg-1");
  assert.equal(calls[0].url, withWait("https://example.test/inq"));
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.username, "Inquiries");
  assert.match(calls[0].body.embeds[0].title, /New inquiry: Ana/);
});

test("upsertInquiryMessage edits existing Discord message", async () => {
  const calls = [];
  const webhookUrl = "https://example.test/inq";
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: JSON.parse(opts.body) });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "msg-1" })
    };
  };
  const result = await upsertInquiryMessage(
    {
      clientName: "Ana",
      created: false,
      discordMessageId: "msg-1",
      pipelineStatus: "quoted"
    },
    { webhookUrl, fetchImpl }
  );
  assert.equal(result.action, "edited");
  assert.equal(result.messageId, "msg-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url, inquiryMessageUrl(webhookUrl, "msg-1"));
  assert.match(calls[0].body.embeds[0].title, /Inquiry updated: Ana/);
});

test("upsertInquiryMessage reposts when the previous message is gone", async () => {
  const calls = [];
  const webhookUrl = "https://example.test/inq";
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (opts.method === "PATCH") {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Unknown Message"
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "msg-2" })
    };
  };
  const result = await upsertInquiryMessage(
    { clientName: "Ana", created: false, discordMessageId: "msg-1" },
    { webhookUrl, fetchImpl }
  );
  assert.equal(result.action, "reposted");
  assert.equal(result.messageId, "msg-2");
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[1].method, "POST");
});

test("upsertInquiryMessage throws on Discord error status", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    statusText: "Bad Request",
    text: async () => "username cannot contain discord"
  });
  await assert.rejects(
    () =>
      upsertInquiryMessage(
        { clientName: "Ana" },
        { webhookUrl: "https://example.test/inq", fetchImpl }
      ),
    /Discord webhook failed \(400\)/
  );
});

test("formatOrderMoney uses Php for PHP totals", () => {
  assert.equal(formatOrderMoney("6210", "PHP"), "Php6,210");
  assert.equal(formatOrderMoney("1150.5", "PHP"), "Php1,150.50");
});

test("shouldNotifyShopifyOrder allows create and paid only", () => {
  assert.equal(shouldNotifyShopifyOrder(""), true);
  assert.equal(shouldNotifyShopifyOrder("orders/create"), true);
  assert.equal(shouldNotifyShopifyOrder("orders/paid"), true);
  assert.equal(shouldNotifyShopifyOrder("orders/updated"), false);
});

test("buildOrderEmbed is human readable", () => {
  const prevShop = process.env.SHOPIFY_SHOP;
  process.env.SHOPIFY_SHOP = "matchanese";
  try {
    const embed = buildOrderEmbed({
      id: 123,
      name: "M#2264",
      email: "ana@example.com",
      total_price: "6210.00",
      currency: "PHP",
      financial_status: "paid",
      customer: { first_name: "Gabrielle", last_name: "Andrei" },
      line_items: [
        { title: "Katakuchi + Kusenaoshi Set", quantity: 1, variant_title: "Default Title" }
      ],
      shipping_lines: [{ title: "The Podium pickup" }],
      note: "Pickup at workshop if possible"
    });
    assert.match(embed.title, /M#2264/);
    assert.equal(embed.url, "https://admin.shopify.com/store/matchanese/orders/123");
    const byName = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
    assert.equal(byName.Order, "[M#2264](https://admin.shopify.com/store/matchanese/orders/123)");
    assert.match(byName.Order, /\[M#2264\]\(https:\/\/admin\.shopify\.com\//);
    assert.equal(byName.Customer, "Gabrielle Andrei");
    assert.equal(byName.Total, "Php6,210");
    assert.equal(byName.Payment, "Paid");
    assert.match(byName.Items, /1× Katakuchi/);
    assert.doesNotMatch(byName.Items, /Default Title/);
  } finally {
    if (prevShop === undefined) delete process.env.SHOPIFY_SHOP;
    else process.env.SHOPIFY_SHOP = prevShop;
  }
});

test("notifyShopifyOrder skips updated topics", async () => {
  const result = await notifyShopifyOrder(
    { id: 1, name: "M#1" },
    "orders/updated",
    { webhookUrl: "https://example.test/orders", fetchImpl: async () => assert.fail("should not fetch") }
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "ignored_topic");
});

test("notifyShopifyOrder posts an embed", async () => {
  let posted;
  const fetchImpl = async (_url, opts) => {
    posted = JSON.parse(opts.body);
    return { ok: true, status: 204, text: async () => "" };
  };
  const result = await notifyShopifyOrder(
    { id: 1, name: "M#2264", total_price: "100", currency: "PHP", financial_status: "pending" },
    "orders/create",
    { webhookUrl: "https://example.test/orders", fetchImpl }
  );
  assert.equal(result.ok, true);
  assert.equal(posted.username, "Orders");
  assert.match(posted.embeds[0].title, /M#2264/);
});
