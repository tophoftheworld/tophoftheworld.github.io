/** Mirrors server greeting logic for rows cached before a name fix. */
const NAME_BLOCKLIST = new Set([
  "currently", "here", "there", "interested", "looking", "wondering", "available",
  "hoping", "good", "hello", "hi", "hey", "sir", "maam", "mam", "po", "opo",
  "just", "also", "very", "really", "calling", "messaging", "reaching", "asking",
  "checking", "sending", "matcha", "marketing", "intern", "dear", "team",
  "thanks", "thank", "yes", "no", "ok", "okay", "the", "and", "for", "with",
  "from", "your", "our", "matchanese", "following", "regarding"
]);

function cleanInferredName(candidate) {
  if (!candidate) return null;
  let name = String(candidate).trim().replace(/\*+/g, "");
  name = name.replace(/[,.!?]+$/, "").trim();
  if (name.length < 2 || name.length > 40) return null;
  if (!/^[A-Za-z]/.test(name)) return null;

  const words = name.split(/\s+/);
  const usable = words.filter((word) => !NAME_BLOCKLIST.has(word.toLowerCase()));
  if (!usable.length) return null;

  return usable.join(" ");
}

const GREETING_PATTERNS = [
  /\bHi\s+\*{0,2}([A-Za-z][A-Za-z'’\s-]*[A-Za-z])\*{0,2}(?=[^A-Za-z'’\s-]|$)/i,
  /\bHello\s+\*{0,2}([A-Za-z][A-Za-z'’\s-]*[A-Za-z])\*{0,2}(?=[^A-Za-z'’\s-]|$)/i,
  /\bHey\s+\*{0,2}([A-Za-z][A-Za-z'’\s-]*[A-Za-z])\*{0,2}(?=[^A-Za-z'’\s-]|$)/i,
  /\bHi\s+([A-Za-z][A-Za-z'’\s-]*[A-Za-z])(?=[^A-Za-z'’\s-]|$)/i,
  /\bHello\s+([A-Za-z][A-Za-z'’\s-]*[A-Za-z])(?=[^A-Za-z'’\s-]|$)/i
];

export function inferNameFromMessages(messages = []) {
  const assistantMessages = messages.filter((m) => m.role === "assistant").slice(0, 6);
  for (const message of assistantMessages) {
    const text = message.content || "";
    for (const pattern of GREETING_PATTERNS) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const cleaned = cleanInferredName(match[1]);
        if (cleaned) return cleaned;
      }
    }
  }
  return null;
}

export function resolveDisplayName(conversation) {
  if (conversation?.displayName) return conversation.displayName;
  return inferNameFromMessages(conversation?.messages || []);
}
