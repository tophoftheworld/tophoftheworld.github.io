const MOBILE_BAR_HINTS = ["cup", "cups", "mobile matcha", "matcha bar", "venue", "target venue"];
const WORKSHOP_HINTS = ["workshop", "pax", "participants", "attendees"];

function normalizeText(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function extractDate(text) {
  const value = String(text || "");
  const isoDatePattern = /\b(20\d{2}-\d{2}-\d{2})\b/;
  const slashDatePattern = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/;
  const naturalDatePattern = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/i;

  const match = value.match(isoDatePattern) || value.match(slashDatePattern) || value.match(naturalDatePattern);
  if (!match) return null;

  const parsed = new Date(match[1] || match[0]);
  if (Number.isNaN(parsed.getTime())) return match[0];
  return parsed.toISOString().slice(0, 10);
}

function extractNumberByKeywords(text, keywords) {
  const normalized = normalizeText(text);
  const pattern = new RegExp(`(\\d{1,5})\\s*(?:${keywords.join("|")})`, "i");
  const match = normalized.match(pattern);
  if (!match) return null;
  return Number(match[1]);
}

function extractVenue(text) {
  const value = String(text || "");
  const match = value.match(/(?:target venue|venue|location|at)\s*[:\-]?\s*([^\n,.]{4,80})/i);
  return match ? match[1].trim() : null;
}

function inferInquiryType(text) {
  const normalized = normalizeText(text);
  const workshopScore = WORKSHOP_HINTS.reduce((acc, hint) => acc + (normalized.includes(hint) ? 1 : 0), 0);
  const mobileBarScore = MOBILE_BAR_HINTS.reduce((acc, hint) => acc + (normalized.includes(hint) ? 1 : 0), 0);
  if (workshopScore === 0 && mobileBarScore === 0) return "unknown";
  return workshopScore >= mobileBarScore ? "workshop" : "mobile_bar";
}

function extractBookingDetails(messages = []) {
  const allText = messages
    .map((message) => `${message.role || ""}: ${message.content || ""}`)
    .join("\n");

  const inquiryType = inferInquiryType(allText);
  const targetDate = extractDate(allText);
  const targetVenue = extractVenue(allText);
  const cupsToServe = extractNumberByKeywords(allText, ["cups?", "servings?"]);
  const pax = extractNumberByKeywords(allText, ["pax", "participants?", "attendees?"]);

  let captured = 0;
  if (targetDate) captured += 1;
  if (targetVenue) captured += 1;
  if (cupsToServe) captured += 1;
  if (pax) captured += 1;
  const confidenceScore = Number((captured / 4).toFixed(2));

  return {
    inquiryType,
    targetDate,
    targetVenue,
    cupsToServe,
    pax,
    confidenceScore,
    rawExcerpt: allText.slice(-2000)
  };
}

function hasRequiredFields(inquiryType, details = {}) {
  if (inquiryType === "mobile_bar") {
    return Boolean(details.targetDate && details.targetVenue && details.cupsToServe);
  }
  if (inquiryType === "workshop") {
    return Boolean(details.pax);
  }
  return false;
}

const INQUIRY_TYPES = new Set(["mobile_bar", "workshop", "unknown"]);

/**
 * Map Chatbase custom-action body (camelCase or snake_case) onto booking fields.
 */
function normalizeStructuredBooking(raw = {}) {
  const targetDate =
    raw.targetDate ?? raw.target_date ?? raw.date ?? null;
  const targetVenue =
    raw.targetVenue ?? raw.target_venue ?? raw.venue ?? null;
  const cupsRaw = raw.cupsToServe ?? raw.cups_to_serve ?? raw.cups ?? null;
  const paxRaw = raw.pax ?? raw.num_pax ?? raw.number_of_pax ?? null;

  let cupsToServe = null;
  if (cupsRaw != null && cupsRaw !== "") {
    const n = Number(cupsRaw);
    cupsToServe = Number.isFinite(n) ? n : null;
  }
  let pax = null;
  if (paxRaw != null && paxRaw !== "") {
    const n = Number(paxRaw);
    pax = Number.isFinite(n) ? n : null;
  }

  let inquiryType = raw.inquiryType ?? raw.inquiry_type ?? null;
  if (inquiryType && INQUIRY_TYPES.has(String(inquiryType))) {
    inquiryType = String(inquiryType);
  } else {
    inquiryType = null;
  }

  return {
    targetDate: targetDate ? String(targetDate).trim() || null : null,
    targetVenue: targetVenue ? String(targetVenue).trim() || null : null,
    cupsToServe,
    pax,
    inquiryType
  };
}

function mergeExtractedWithStructured(extracted, structured) {
  if (!structured) return extracted;
  const normalized = normalizeStructuredBooking(structured);
  const merged = {
    ...extracted,
    targetDate: normalized.targetDate ?? extracted.targetDate,
    targetVenue: normalized.targetVenue ?? extracted.targetVenue,
    cupsToServe: normalized.cupsToServe ?? extracted.cupsToServe,
    pax: normalized.pax ?? extracted.pax,
    inquiryType: normalized.inquiryType || extracted.inquiryType,
    confidenceScore: Math.max(Number(extracted.confidenceScore || 0), 0.95),
    rawExcerpt: extracted.rawExcerpt
  };
  return merged;
}

module.exports = {
  extractBookingDetails,
  hasRequiredFields,
  normalizeStructuredBooking,
  mergeExtractedWithStructured
};
