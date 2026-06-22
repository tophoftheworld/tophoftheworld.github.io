const SOURCE_SHORT = {
  instagram: "IG",
  messenger: "FB",
  facebook: "FB",
  "facebook messenger": "FB",
  whatsapp: "WA",
  "widget or iframe": "Web",
  iframe: "Web",
  api: "API",
  slack: "SL",
  "chatbase site": "Site",
  playground: "Test",
  active: "Test",
  activity: "Test",
  "agent page": "Test",
  unspecified: "—"
};

/** Website / dashboard test channels (Chatbase often sends "Activity", not "Active"). */
function isTestSource(key) {
  return (
    /playground|agent\s*page|chatbase\s*site/.test(key) ||
    key === "active" ||
    key === "activity" ||
    key.startsWith("acti") ||
    /\btest\b/.test(key)
  );
}

export function shortenSource(source) {
  const key = String(source || "").trim().toLowerCase();
  if (SOURCE_SHORT[key]) return SOURCE_SHORT[key];
  if (isTestSource(key)) return "Test";
  if (/messenger|facebook/.test(key)) return "FB";
  return source ? String(source).slice(0, 4) : "—";
}

export function formatLeadActivityDate(row) {
  return formatActivityDate(row?.lastActivityAt || row?.updatedAt || row?.createdAt);
}

export function formatShortId(id) {
  if (!id) return "—";
  const text = String(id);
  return text.length <= 10 ? text : `${text.slice(0, 8)}…`;
}

const TARGET_DATE_DISPLAY = { month: "short", day: "numeric", year: "numeric" };

export function formatTargetDate(value) {
  if (!value) return "—";
  const str = String(value).trim();
  const isoOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (isoOnly) {
    const date = new Date(
      Number(isoOnly[1]),
      Number(isoOnly[2]) - 1,
      Number(isoOnly[3])
    );
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, TARGET_DATE_DISPLAY);
    }
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString(undefined, TARGET_DATE_DISPLAY);
  }
  const shortMatch = str.match(/[A-Za-z]{3}\s+\d{1,2}\s+\d{4}/);
  if (shortMatch) {
    const fromShort = new Date(shortMatch[0]);
    if (!Number.isNaN(fromShort.getTime())) {
      return fromShort.toLocaleDateString(undefined, TARGET_DATE_DISPLAY);
    }
  }
  return "—";
}

export function formatPesoAmount(value) {
  if (value === "" || value == null) return "—";
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^\d.-]/g, ""));
  if (Number.isNaN(n)) return String(value);
  return `₱${n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/** Chatbase often sends Unix seconds; JS Date expects ms. */
export function parseActivityTimestamp(value) {
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

export function conversationLastActivityAt(conversation) {
  if (!conversation) return null;

  let best = null;
  const consider = (raw) => {
    const d = parseActivityTimestamp(raw);
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  };

  for (const message of conversation.messages || []) {
    consider(message.createdAt);
    consider(message.created_at);
    consider(message.timestamp);
  }
  consider(conversation.lastActivityAt);
  consider(conversation.updatedAt);
  consider(conversation.createdAt);

  return best ? best.toISOString() : null;
}

export function formatActivityDate(value) {
  if (!value) return "—";
  const date = parseActivityTimestamp(value);
  if (!date) return String(value);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday - startOfThat) / (24 * 60 * 60 * 1000));

  let dayPart;
  if (dayDiff === 0) dayPart = "Today";
  else if (dayDiff === 1) dayPart = "Yesterday";
  else {
    dayPart = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
    });
  }

  const timePart = date
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    })
    .toLowerCase()
    .replace(/\s/g, " ");

  return `${dayPart} at ${timePart}`;
}

/** Compact date/time for inbox thread list (messaging-app style). */
export function formatInboxListDate(value) {
  if (!value) return "—";
  const date = parseActivityTimestamp(value);
  if (!date) return String(value);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday - startOfThat) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) {
    return date
      .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
      .toLowerCase()
      .replace(/\s/g, " ");
  }
  if (dayDiff === 1) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}

export function getDisplayName(conversation) {
  if (conversation?.displayName) return conversation.displayName;
  return null;
}

export function getConversationHeading(conversation, resolvedName = null) {
  return resolvedName || conversation?.displayName || conversation?.preview || "Conversation";
}

const SERVICE_LABELS = {
  private_mobile_matcha_bar: "Private Mobile Matcha Bar",
  private_matcha_workshop: "Private Matcha Workshop"
};

export const SERVICE_OPTIONS = [
  { value: "private_mobile_matcha_bar", label: SERVICE_LABELS.private_mobile_matcha_bar },
  { value: "private_matcha_workshop", label: SERVICE_LABELS.private_matcha_workshop }
];

export function formatServiceLabel(service) {
  return SERVICE_LABELS[service] || service || "—";
}

export function orderNumberSearchTerms(orderNumber) {
  const normalized = String(orderNumber || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) return [];
  const terms = new Set([normalized, normalized.toLowerCase()]);
  const digits = normalized.replace(/^M#?/i, "");
  if (digits) {
    terms.add(digits);
    terms.add(`#${digits}`);
    terms.add(`m#${digits}`);
    terms.add(`M#${digits}`);
  }
  return [...terms];
}

export function quoteReferenceSearchTerms(quoteReference) {
  const ref = String(quoteReference || "").trim().toUpperCase();
  if (!ref) return [];
  return [ref, ref.toLowerCase(), `reference ${ref}`, `quote ${ref}`, `ref ${ref}`];
}

/** Name variants for inbox fallback when order# / quote ref is missing from chat. */
export function clientNameSearchTerms(clientName) {
  const raw = String(clientName || "").trim();
  if (!raw) return [];

  const terms = new Set([raw, raw.toLowerCase()]);
  const parts = raw.split(/\s+/).filter((p) => p.length >= 2);

  for (const part of parts) {
    terms.add(part);
    terms.add(part.toLowerCase());
  }

  if (parts.length >= 2) {
    terms.add(parts.join(" "));
    terms.add(`${parts[0]} ${parts[parts.length - 1]}`);
    terms.add(`${parts[0]} ${parts[parts.length - 1]}`.toLowerCase());
  }

  return [...terms].sort((a, b) => b.length - a.length);
}
