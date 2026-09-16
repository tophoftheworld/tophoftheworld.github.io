const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isActivityOnDate,
  apiEndDateInclusive,
  messagesOnDate,
  messagesInDateRange,
  formatThreadForPrompt,
  formatThreadForPendingPrompt,
  splitThreadsIntoBatches,
  splitThreadsIntoPendingBatches,
  buildSummaryPrompt,
  buildBatchPrompt,
  buildPendingBatchPrompt,
  buildPendingSummaryPrompt,
  dayTranscriptCharBudget,
  pendingTranscriptCharBudget,
  isPlaceholderSummaryBullet,
  stripLeakedImportanceScore,
  normalizeAwaitingReplyAge,
  parseSummarySections,
  mergeSections,
  emptySections,
  sortByLastActivity,
  pendingRangeForSummary,
  CHATBASE_MAX_CHARS,
  MAX_TRANSCRIPT_CHARS
} = require("../inbox-summary");

test("isActivityOnDate matches calendar day in Manila", () => {
  assert.equal(isActivityOnDate("2026-06-05T14:00:00.000Z", "2026-06-05", "Asia/Manila"), true);
  assert.equal(isActivityOnDate("2026-06-04T10:00:00.000Z", "2026-06-05", "Asia/Manila"), false);
});

test("apiEndDateInclusive bumps end date by one day", () => {
  assert.equal(apiEndDateInclusive("2026-06-05"), "2026-06-06");
});

test("messagesOnDate keeps only messages from that calendar day", () => {
  const filtered = messagesOnDate(
    [
      { role: "user", content: "old", createdAt: "2026-06-04T10:00:00.000Z" },
      { role: "user", content: "today", createdAt: "2026-06-05T14:00:00.000Z" }
    ],
    "2026-06-05",
    "Asia/Manila"
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].content, "today");
});

test("messagesInDateRange keeps only messages inside lookback window", () => {
  const { rangeStart, rangeEnd } = pendingRangeForSummary("2026-06-12");
  assert.equal(rangeStart, "2026-06-07");
  assert.equal(rangeEnd, "2026-06-11");

  const filtered = messagesInDateRange(
    [
      { role: "user", content: "too old", createdAt: "2026-06-06T10:00:00Z" },
      { role: "user", content: "in window", createdAt: "2026-06-10T10:00:00Z" },
      { role: "user", content: "summary day", createdAt: "2026-06-12T10:00:00Z" }
    ],
    rangeStart,
    rangeEnd,
    "Asia/Manila"
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].content, "in window");
});

test("formatThreadForPrompt includes only today's messages", () => {
  const block = formatThreadForPrompt(
    {
      source: "Instagram",
      displayName: "Alex",
      messages: [
        { role: "user", content: "Last week", createdAt: "2026-05-28T10:00:00Z" },
        { role: "user", content: "Today question", createdAt: "2026-06-05T14:00:00Z" }
      ]
    },
    { index: 0, date: "2026-06-05", tz: "Asia/Manila" }
  );
  assert.match(block, /Today question/);
  assert.doesNotMatch(block, /Last week/);
});

test("formatThreadForPendingPrompt includes only lookback window messages", () => {
  const { rangeStart, rangeEnd } = pendingRangeForSummary("2026-06-12");
  const block = formatThreadForPendingPrompt(
    {
      source: "Messenger",
      displayName: "Sam",
      messages: [
        { role: "user", content: "Too old", createdAt: "2026-06-01T10:00:00Z" },
        {
          role: "user",
          content: "Can someone follow up on our quote?",
          createdAt: "2026-06-10T10:00:00Z"
        },
        {
          role: "assistant",
          content: "Someone from our team will get back to you."
        },
        { role: "user", content: "Today only", createdAt: "2026-06-12T10:00:00Z" }
      ]
    },
    { index: 0, rangeStart, rangeEnd, tz: "Asia/Manila" }
  );
  assert.match(block, /follow up on our quote/);
  assert.match(block, /Someone from our team/);
  assert.doesNotMatch(block, /Too old/);
  assert.doesNotMatch(block, /Today only/);
});

test("splitThreadsIntoBatches splits without truncating threads", () => {
  const threads = Array.from({ length: 5 }, (_, i) => ({
    source: "Instagram",
    displayName: `User ${i}`,
    messages: [
      {
        role: "user",
        content: "x".repeat(2000),
        createdAt: "2026-06-05T14:00:00.000Z"
      }
    ]
  }));
  const batches = splitThreadsIntoBatches(threads, "2026-06-05", "Asia/Manila", 4500);
  assert.ok(batches.length >= 2);
  const total = batches.reduce((n, b) => n + b.length, 0);
  assert.equal(total, 5);
});

test("splitThreadsIntoPendingBatches splits without truncating threads", () => {
  const { rangeStart, rangeEnd } = pendingRangeForSummary("2026-06-12");
  const threads = Array.from({ length: 4 }, (_, i) => ({
    source: "Instagram",
    displayName: `User ${i}`,
    messages: [
      {
        role: "user",
        content: "y".repeat(1800),
        createdAt: "2026-06-10T14:00:00.000Z"
      },
      { role: "assistant", content: "We'll get back to you." }
    ]
  }));
  const batches = splitThreadsIntoPendingBatches(threads, "2026-06-12", "Asia/Manila", 600);
  assert.ok(batches.length >= 2);
  const total = batches.reduce((n, b) => n + b.length, 0);
  assert.equal(total, 4);
});

test("pendingTranscriptCharBudget accounts for long instruction header", () => {
  const { rangeStart, rangeEnd } = pendingRangeForSummary("2026-06-12");
  const budget = pendingTranscriptCharBudget("2026-06-12", rangeStart, rangeEnd);
  assert.ok(budget < MAX_TRANSCRIPT_CHARS);
  assert.ok(budget >= 1500);
});

test("dayTranscriptCharBudget accounts for long instruction header", () => {
  const budget = dayTranscriptCharBudget("2026-06-05");
  assert.ok(budget < MAX_TRANSCRIPT_CHARS);
  assert.ok(budget >= 1500);
});

test("buildBatchPrompt stays under limit for later batches with high thread offset", () => {
  const threads = Array.from({ length: 24 }, (_, i) => ({
    source: "Instagram",
    displayName: `Customer ${i}`,
    messages: [
      {
        role: "user",
        content: `Question ${i} `.repeat(120),
        createdAt: "2026-06-05T14:00:00.000Z"
      }
    ]
  }));
  const batches = splitThreadsIntoBatches(threads, "2026-06-05", "Asia/Manila");
  assert.ok(batches.length >= 2);
  let offset = 0;
  for (let i = 0; i < batches.length; i += 1) {
    const prompt = buildBatchPrompt(batches[i], "2026-06-05", "Asia/Manila", {
      batchIndex: i,
      totalBatches: batches.length,
      threadOffset: offset
    });
    assert.ok(
      prompt.length <= CHATBASE_MAX_CHARS,
      `batch ${i + 1} len ${prompt.length} offset ${offset}`
    );
    offset += batches[i].length;
  }
});

test("buildBatchPrompt stays under Chatbase limit for heavy day threads", () => {
  const threads = Array.from({ length: 4 }, (_, i) => ({
    source: "Instagram",
    displayName: `User ${i}`,
    messages: Array.from({ length: 12 }, (__, j) => ({
      role: j % 2 ? "assistant" : "user",
      content: `Today message ${j} `.repeat(80),
      createdAt: "2026-06-05T14:00:00.000Z"
    }))
  }));
  const batches = splitThreadsIntoBatches(threads, "2026-06-05", "Asia/Manila");
  assert.ok(batches.length >= 2);
  let offset = 0;
  for (let i = 0; i < batches.length; i += 1) {
    const prompt = buildBatchPrompt(batches[i], "2026-06-05", "Asia/Manila", {
      batchIndex: i,
      totalBatches: batches.length,
      threadOffset: offset
    });
    assert.ok(prompt.length <= CHATBASE_MAX_CHARS);
    offset += batches[i].length;
  }
});

test("buildPendingBatchPrompt stays under Chatbase limit for heavy threads", () => {
  const { rangeStart, rangeEnd } = pendingRangeForSummary("2026-06-12");
  const threads = Array.from({ length: 12 }, (_, i) => ({
    source: "Instagram",
    displayName: `User ${i}`,
    messages: Array.from({ length: 16 }, (__, j) => ({
      role: j % 2 ? "assistant" : "user",
      content: `Message ${j} `.repeat(60),
      createdAt: `2026-06-${10 + (j % 2)}T10:00:00Z`
    }))
  }));
  const batches = splitThreadsIntoPendingBatches(threads, "2026-06-12", "Asia/Manila");
  assert.ok(batches.length >= 2);
  let offset = 0;
  for (let i = 0; i < batches.length; i += 1) {
    const prompt = buildPendingBatchPrompt(batches[i], "2026-06-12", rangeStart, rangeEnd, "Asia/Manila", {
      batchIndex: i,
      totalBatches: batches.length,
      threadOffset: offset
    });
    assert.ok(prompt.length <= CHATBASE_MAX_CHARS);
    offset += batches[i].length;
  }
});

test("buildSummaryPrompt uses concise ops sections without Payments", () => {
  const prompt = buildSummaryPrompt(
    [
      {
        source: "Messenger",
        displayName: "Sam",
        messages: [{ role: "user", content: "Quote for wedding", createdAt: "2026-06-05T12:00:00Z" }]
      }
    ],
    "2026-06-05"
  );
  assert.ok(prompt.length <= CHATBASE_MAX_CHARS);
  assert.match(prompt, /Leads/);
  assert.match(prompt, /Do NOT include a Topics or Payments section/i);
  assert.doesNotMatch(prompt, /By channel/);
});

test("buildPendingSummaryPrompt uses awaiting reply section only", () => {
  const { rangeStart, rangeEnd } = pendingRangeForSummary("2026-06-12");
  const prompt = buildPendingSummaryPrompt(
    [
      {
        source: "Instagram",
        displayName: "Mitch",
        messages: [
          {
            role: "user",
            content: "Can you confirm our wedding quote?",
            createdAt: "2026-06-10T12:00:00Z"
          },
          { role: "assistant", content: "Someone will get back to you soon." }
        ]
      }
    ],
    "2026-06-12"
  );
  assert.ok(prompt.length <= CHATBASE_MAX_CHARS);
  assert.match(prompt, /Awaiting reply/);
  assert.match(prompt, /≥7\.5/);
  assert.match(prompt, /silent after bot greeting/i);
  assert.match(prompt, /2026-06-07.*2026-06-11/);
  assert.match(prompt, /Mitch/);
  assert.doesNotMatch(prompt, /\nUrgent\n/);
});

test("isPlaceholderSummaryBullet detects empty-batch filler", () => {
  assert.equal(isPlaceholderSummaryBullet("None flagged in this batch."), true);
  assert.equal(isPlaceholderSummaryBullet("No payment proofs or confirmations in this batch."), true);
  assert.equal(isPlaceholderSummaryBullet("M#2101 confirmed"), false);
});

test("parseSummarySections drops placeholder bullets", () => {
  const sections = parseSummarySections(`Urgent
None flagged in this batch.
- None flagged in this batch.

Payments
- M#2101 confirmed
- No payment proofs in this batch.`);
  assert.equal(sections.urgent.length, 0);
  assert.equal(sections.payments.length, 1);
});

test("parseSummarySections extracts awaiting reply section", () => {
  const sections = parseSummarySections(`Awaiting reply
- Mitch (IG) — 2d ago — wedding quote pending cup count

Topics
- MOA: location questions`);
  assert.equal(sections.awaitingReply.length, 1);
  assert.match(sections.awaitingReply[0], /Mitch/);
});

test("stripLeakedImportanceScore removes a leaked score segment", () => {
  assert.equal(
    stripLeakedImportanceScore("Komunidad PH (IG) — 8.5 — Team still needs to complete form"),
    "Komunidad PH (IG) — Team still needs to complete form"
  );
  assert.equal(
    stripLeakedImportanceScore("Pauline (IG) — 7.5 — Confirm PWD discount"),
    "Pauline (IG) — Confirm PWD discount"
  );
  assert.equal(
    stripLeakedImportanceScore("Olivia (IG) — 8 — Ensure payment logged"),
    "Olivia (IG) — Ensure payment logged"
  );
});

test("stripLeakedImportanceScore leaves normal bullets untouched", () => {
  const line = "Jenina (FB) — 1d ago — clarify which workshop option";
  assert.equal(stripLeakedImportanceScore(line), line);
  const withOrderRef = "M#2181 — Olivia: confirmed GCash payment";
  assert.equal(stripLeakedImportanceScore(withOrderRef), withOrderRef);
});

test("normalizeAwaitingReplyAge converts open to ago and drops ranges", () => {
  assert.equal(
    normalizeAwaitingReplyAge("Keisa (IG) — 1–4d open — send wedding quote"),
    "Keisa (IG) — send wedding quote"
  );
  assert.equal(
    normalizeAwaitingReplyAge("Monica (IG) — 2d open — ensure payment logged"),
    "Monica (IG) — 2d ago — ensure payment logged"
  );
  assert.equal(
    normalizeAwaitingReplyAge("Eri (IG) — 4d ago — review partnership"),
    "Eri (IG) — 4d ago — review partnership"
  );
});

test("formatThreadForPendingPrompt includes exact days-ago label", () => {
  const { rangeStart, rangeEnd } = pendingRangeForSummary("2026-06-12");
  const block = formatThreadForPendingPrompt(
    {
      source: "Messenger",
      displayName: "Sam",
      messages: [
        {
          role: "user",
          content: "Can someone follow up on our quote?",
          createdAt: "2026-06-10T10:00:00Z"
        },
        { role: "assistant", content: "Someone from our team will get back to you." }
      ]
    },
    { index: 0, rangeStart, rangeEnd, summaryDate: "2026-06-12", tz: "Asia/Manila" }
  );
  assert.match(block, /2d ago/);
});

test("parseSummarySections extracts section bullets", () => {
  const sections = parseSummarySections(`Topics
- MOA: Pop-up inquiries
- Delivery: GrabFood vs website

Payments
- M#2101 confirmed`);
  assert.equal(sections.topics.length, 2);
  assert.equal(sections.payments.length, 1);
  assert.equal(sections.leads.length, 0);
});

test("mergeSections drops placeholder bullets across batches", () => {
  const a = emptySections();
  a.payments.push("No payment proofs or confirmations in this batch.");
  const b = emptySections();
  b.payments.push("M#2101 – Jonathan: confirmed");
  const merged = mergeSections(a, b);
  assert.equal(merged.payments.length, 1);
  assert.match(merged.payments[0], /M#2101/);
});

test("mergeSections dedupes bullets", () => {
  const a = emptySections();
  a.topics.push("MOA: Pop-up inquiries");
  const b = emptySections();
  b.topics.push("MOA: Pop-up inquiries");
  b.leads.push("Mitch Tan — quote pending");
  const merged = mergeSections(a, b);
  assert.equal(merged.topics.length, 1);
  assert.equal(merged.leads.length, 1);
});

test("sortByLastActivity orders newest first", () => {
  const sorted = sortByLastActivity([
    { lastActivityAt: "2026-06-05T08:00:00Z" },
    { lastActivityAt: "2026-06-05T18:00:00Z" }
  ]);
  assert.equal(sorted[0].lastActivityAt, "2026-06-05T18:00:00Z");
});
