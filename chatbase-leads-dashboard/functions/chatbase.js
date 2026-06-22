const DEFAULT_BASE_URL = "https://www.chatbase.co/api/v1";
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

function toDateString(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }
  return null;
}

/** Chatbase often sends Unix seconds; JS Date expects ms. */
function parseActivityTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const str = String(value).trim();
  if (/^\d+$/.test(str)) {
    const num = Number(str);
    const ms = num < 1e12 ? num * 1000 : num;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toActivityIso(value) {
  const d = parseActivityTimestamp(value);
  return d ? d.toISOString() : value || null;
}

function resolveLastActivityIso(row, messages) {
  let best = null;
  const consider = (raw) => {
    const d = parseActivityTimestamp(raw);
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  };

  for (const message of messages) {
    consider(
      pickFirst(message, ["created_at", "createdAt", "timestamp", "date", "updated_at", "updatedAt"])
    );
  }
  if (best) return best.toISOString();

  consider(pickFirst(row, ["updated_at", "updatedAt", "lastMessageAt"]));
  consider(pickFirst(row, ["created_at", "createdAt"]));

  return best ? best.toISOString() : null;
}

function normalizeMessageContent(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((part) => part?.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function normalizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages.map((message) => {
    const rawTs = pickFirst(message, [
      "created_at",
      "createdAt",
      "timestamp",
      "date",
      "updated_at",
      "updatedAt"
    ]);
    return {
      role: message.role || "user",
      content: normalizeMessageContent(message),
      createdAt: toActivityIso(rawTs)
    };
  });
}

function buildPreview(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user" && message.content) {
      const text = message.content.trim();
      return text.length > 140 ? `${text.slice(0, 137)}...` : text;
    }
  }
  const last = messages[messages.length - 1];
  if (!last?.content) return "";
  const text = last.content.trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

const NAME_BLOCKLIST = new Set([
  "currently", "here", "there", "interested", "looking", "wondering", "available",
  "hoping", "good", "hello", "hi", "hey", "sir", "maam", "mam", "po", "opo",
  "just", "also", "very", "really", "calling", "messaging", "reaching", "asking",
  "checking", "sending", "matcha", "marketing", "intern", "dear", "team",
  "thanks", "thank", "yes", "no", "ok", "okay", "the", "and", "for", "with",
  "from", "your", "our", "matchanese", "wondering", "following", "regarding"
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

function extractExplicitUserName(messages) {
  const userText = messages
    .filter((m) => m.role === "user")
    .slice(0, 4)
    .map((m) => m.content)
    .join("\n")
    .slice(0, 2500);

  const patterns = [
    /\bmy name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /\bname(?:'s| is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /\bcall me\s+([A-Z][a-z]+)/i,
    /\bako si\s+([A-Z][a-z]+)/i,
    /\bi am\s+([A-Z][a-z]+)(?=\s*(?:and|,|\.|!|\?|$))/i,
    /\bi'?m\s+([A-Z][a-z]+)(?=\s*(?:and|,|\.|!|\?|$))/i
  ];

  for (const pattern of patterns) {
    const match = userText.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanInferredName(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/** Chatbase often knows the IG/Messenger display name and uses it in the first reply. */
function extractAgentGreetingName(messages) {
  const patterns = [
    /\bHi\s+\*{0,2}([A-Za-z][A-Za-z'’\s-]*[A-Za-z])\*{0,2}(?=[^A-Za-z'’\s-]|$)/i,
    /\bHello\s+\*{0,2}([A-Za-z][A-Za-z'’\s-]*[A-Za-z])\*{0,2}(?=[^A-Za-z'’\s-]|$)/i,
    /\bHey\s+\*{0,2}([A-Za-z][A-Za-z'’\s-]*[A-Za-z])\*{0,2}(?=[^A-Za-z'’\s-]|$)/i,
    /\bHi\s+([A-Za-z][A-Za-z'’\s-]*[A-Za-z])(?=[^A-Za-z'’\s-]|$)/i,
    /\bHello\s+([A-Za-z][A-Za-z'’\s-]*[A-Za-z])(?=[^A-Za-z'’\s-]|$)/i
  ];

  const assistantMessages = messages.filter((m) => m.role === "assistant").slice(0, 6);
  for (const message of assistantMessages) {
    const text = message.content || "";
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const cleaned = cleanInferredName(match[1]);
        if (cleaned) return cleaned;
      }
    }
  }
  return null;
}

function inferContactName(row, messages) {
  const title = pickFirst(row, ["title"]);
  if (title && String(title).trim()) return String(title).trim();

  const named = pickFirst(row, [
    "customerName",
    "customer_name",
    "userName",
    "user_name",
    "name",
    "displayName",
    "display_name"
  ]);
  if (named) return String(named).trim();

  const form = row.form_submission || row.formSubmission;
  if (form && typeof form === "object") {
    const fromForm = form.name || form.customerName || form.fullName;
    if (fromForm) return String(fromForm).trim();
  }

  const fromAgent = extractAgentGreetingName(messages);
  if (fromAgent) return fromAgent;

  const explicit = extractExplicitUserName(messages);
  if (explicit) return explicit;

  return null;
}

function normalizeConversation(row) {
  const messages = normalizeMessages(row.messages);
  const id = pickFirst(row, ["id", "conversationId", "conversation_id"]);
  const source = pickFirst(row, ["source", "channel"]) || "unknown";
  const createdAt = toActivityIso(pickFirst(row, ["created_at", "createdAt"]));
  const updatedAt = toActivityIso(pickFirst(row, ["updated_at", "updatedAt", "lastMessageAt"]));
  const lastActivityAt = resolveLastActivityIso(row, messages) || updatedAt || createdAt;
  const displayName = inferContactName(row, messages);

  return {
    id: id ? String(id) : null,
    source: String(source),
    displayName,
    createdAt,
    updatedAt,
    lastActivityAt,
    messages,
    messageCount: messages.length,
    preview: buildPreview(messages)
  };
}

class ChatbaseClient {
  constructor({ apiKey, chatbotId, baseUrl = DEFAULT_BASE_URL }) {
    this.apiKey = apiKey;
    this.chatbotId = chatbotId;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async request(path, query = {}) {
    if (!this.apiKey) throw new Error("Missing CHATBASE_API_KEY");
    if (!this.chatbotId) throw new Error("Missing CHATBASE_CHATBOT_ID");

    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("chatbotId", this.chatbotId);
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });

    let lastError = null;
    for (let attempt = 1; attempt <= DEFAULT_RETRY_COUNT; attempt += 1) {
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        });

        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) {
          const message = data?.message || `${response.status} ${response.statusText}`;
          const isRetryable = response.status >= 500 || response.status === 429;
          if (isRetryable && attempt < DEFAULT_RETRY_COUNT) {
            await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS * attempt));
            continue;
          }
          throw new Error(`Chatbase request failed: ${message}`);
        }
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < DEFAULT_RETRY_COUNT) {
          await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS * attempt));
          continue;
        }
      }
    }
    throw lastError || new Error("Chatbase request failed");
  }

  async postRequest(path, body = {}) {
    if (!this.apiKey) throw new Error("Missing CHATBASE_API_KEY");
    if (!this.chatbotId) throw new Error("Missing CHATBASE_CHATBOT_ID");

    const url = `${this.baseUrl}${path}`;
    let lastError = null;
    for (let attempt = 1; attempt <= DEFAULT_RETRY_COUNT; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ chatbotId: this.chatbotId, ...body })
        });

        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) {
          const message = data?.message || data?.error || `${response.status} ${response.statusText}`;
          const isRetryable = response.status >= 500 || response.status === 429;
          if (isRetryable && attempt < DEFAULT_RETRY_COUNT) {
            await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS * attempt));
            continue;
          }
          throw new Error(`Chatbase request failed: ${message}`);
        }
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < DEFAULT_RETRY_COUNT) {
          await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS * attempt));
          continue;
        }
      }
    }
    throw lastError || new Error("Chatbase request failed");
  }

  async chat({ messages, temperature = 0 } = {}) {
    if (!Array.isArray(messages) || !messages.length) {
      throw new Error("chat requires at least one message");
    }
    const data = await this.postRequest("/chat", {
      messages,
      temperature,
      stream: false
    });
    const text = data?.text ?? data?.message ?? data?.response ?? "";
    if (!text) throw new Error("Chatbase chat returned empty response");
    return String(text);
  }

  async getConversations({ startDate, endDate, page = 1, size = 50, filteredSources = "" } = {}) {
    return this.request("/get-conversations", {
      startDate: toDateString(startDate),
      endDate: toDateString(endDate),
      page,
      size,
      filteredSources
    });
  }

  async fetchAllConversations({
    startDate,
    endDate,
    filteredSources = "",
    size = 50,
    maxPages = 50
  } = {}) {
    const all = [];
    let pagesFetched = 0;
    let truncated = false;

    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.getConversations({
        startDate,
        endDate,
        page,
        size,
        filteredSources
      });
      const rows = result?.data || [];
      rows.forEach((row) => all.push(normalizeConversation(row)));
      pagesFetched = page;
      if (rows.length < size) break;
      if (page === maxPages) truncated = true;
    }

    return {
      data: all,
      meta: {
        pagesFetched,
        truncated,
        total: all.length
      }
    };
  }

  async findConversationById(conversationId, options = {}) {
    const maxPages = options.maxPages ?? 50;
    const size = options.size ?? 50;
    const wideStart = () => {
      const date = new Date();
      date.setFullYear(date.getFullYear() - 2);
      return toDateString(date);
    };
    const wideEnd = () => toDateString(new Date());

    const dateAttempts = [];
    const pushAttempt = (startDate, endDate) => {
      const key = `${startDate || ""}:${endDate || ""}`;
      if (dateAttempts.some((a) => a.key === key)) return;
      dateAttempts.push({ key, startDate, endDate });
    };

    pushAttempt(options.startDate, options.endDate);
    pushAttempt(wideStart(), wideEnd());

    for (const attempt of dateAttempts) {
      for (let page = 1; page <= maxPages; page += 1) {
        const result = await this.getConversations({
          startDate: attempt.startDate || undefined,
          endDate: attempt.endDate || undefined,
          filteredSources: options.filteredSources || "",
          page,
          size
        });
        const rows = result?.data || [];
        const match = rows.find((row) => {
          const id = pickFirst(row, ["id", "conversationId", "conversation_id"]);
          return id && String(id) === String(conversationId);
        });
        if (match) return normalizeConversation(match);
        if (rows.length < size) break;
      }
    }
    return null;
  }
}

function getChatbaseClientFromEnv() {
  return new ChatbaseClient({
    apiKey: process.env.CHATBASE_API_KEY,
    chatbotId: process.env.CHATBASE_CHATBOT_ID
  });
}

function getDefaultPageSize() {
  return Number(process.env.CHATBASE_PAGE_SIZE || 50);
}

function getDefaultMaxPages() {
  return Number(process.env.CHATBASE_MAX_PAGES || 50);
}

module.exports = {
  ChatbaseClient,
  getChatbaseClientFromEnv,
  getDefaultPageSize,
  getDefaultMaxPages,
  parseActivityTimestamp,
  normalizeConversation,
  normalizeMessages,
  inferContactName
};
