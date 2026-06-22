const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeConversation, inferContactName } = require("../chatbase");

test("normalizeConversation maps fields and preview", () => {
  const row = {
    id: "conv_1",
    source: "Instagram",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    messages: [
      { role: "user", content: "Hello there" },
      { role: "assistant", content: "Hi!" }
    ]
  };
  const normalized = normalizeConversation(row);
  assert.equal(normalized.id, "conv_1");
  assert.equal(normalized.source, "Instagram");
  assert.equal(normalized.messageCount, 2);
  assert.equal(normalized.preview, "Hello there");
});

test("normalizeConversation uses last message time not conversation start", () => {
  const normalized = normalizeConversation({
    id: "conv-old",
    source: "Messenger",
    created_at: "2026-05-25T12:29:20.265169+00:00",
    messages: [
      { role: "user", content: "Hello", createdAt: "2026-05-25T12:29:25.000Z" },
      { role: "assistant", content: "Thanks!", createdAt: "2026-06-08T23:10:04.319Z" }
    ]
  });
  assert.equal(normalized.createdAt, "2026-05-25T12:29:20.265Z");
  assert.equal(normalized.lastActivityAt, "2026-06-08T23:10:04.319Z");
});

test("normalizeConversation parses Unix-second timestamps", () => {
  const updatedSeconds = 1770681900;
  const normalized = normalizeConversation({
    id: "epoch-1",
    source: "Instagram",
    updated_at: updatedSeconds,
    messages: [{ role: "user", content: "Hi" }]
  });
  assert.ok(normalized.lastActivityAt);
  const parsed = new Date(normalized.lastActivityAt);
  assert.equal(parsed.getUTCFullYear(), 2026);
});

test("normalizeConversation handles empty messages", () => {
  const normalized = normalizeConversation({ id: "x", source: "Messenger", messages: [] });
  assert.equal(normalized.messageCount, 0);
  assert.equal(normalized.preview, "");
});

test("inferContactName prefers agent greeting over user text", () => {
  const name = inferContactName(
    {},
    [
      {
        role: "user",
        content: "Hi! My name is Fionna, and I'm currently a Marketing Intern."
      },
      { role: "assistant", content: "Hi Fionna, thank you!" }
    ]
  );
  assert.equal(name, "Fionna");
});

test("inferContactName uses agent greeting not random words in user message", () => {
  const name = inferContactName(
    {},
    [
      { role: "user", content: "Si acer po nagawa niyan sir hahahha" },
      { role: "assistant", content: "Hi Tokyo, thanks for messaging Matchanese!" }
    ]
  );
  assert.equal(name, "Tokyo");
});

test("inferContactName rejects currently from i'm currently", () => {
  const name = inferContactName(
    {},
    [{ role: "user", content: "I'm currently looking for part-time work." }]
  );
  assert.equal(name, null);
});

test("inferContactName falls back to my name is when agent has no greeting", () => {
  const name = inferContactName(
    {},
    [{ role: "user", content: "Hello, my name is Marco and I have a question." }]
  );
  assert.equal(name, "Marco");
});

test("inferContactName handles emoji after greeting name", () => {
  const name = inferContactName(
    {},
    [
      { role: "user", content: "Hi may i ask if you have a pop up in SM MOA?" },
      { role: "assistant", content: "Hi Panda🍵, thanks for reaching out to Matchanese!" }
    ]
  );
  assert.equal(name, "Panda");
});

test("inferContactName handles hyphenated business name", () => {
  const name = inferContactName(
    {},
    [
      { role: "user", content: "Hi team! Matcha Fest invite..." },
      { role: "assistant", content: "Hi Salu-Salo Market, thank you so much for thinking of us!" }
    ]
  );
  assert.equal(name, "Salu-Salo Market");
});

test("inferContactName uses Hello Name from agent", () => {
  const name = inferContactName(
    {},
    [
      { role: "user", content: "Good day! This is Bria of Flair Pop Up!" },
      { role: "assistant", content: "Hello Bria! Thank you for considering Matchanese." }
    ]
  );
  assert.equal(name, "Bria");
});
