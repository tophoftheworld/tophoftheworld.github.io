const DEFAULT_BASE_URL = "https://www.chatbase.co/api/v1";
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

function toDateString(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
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

  async getLeads({ startDate, endDate, page = 1, size = 100 } = {}) {
    return this.request("/get-leads", {
      startDate: toDateString(startDate),
      endDate: toDateString(endDate),
      page,
      size
    });
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
}

function getChatbaseClientFromEnv() {
  return new ChatbaseClient({
    apiKey: process.env.CHATBASE_API_KEY,
    chatbotId: process.env.CHATBASE_CHATBOT_ID
  });
}

module.exports = {
  ChatbaseClient,
  getChatbaseClientFromEnv
};
