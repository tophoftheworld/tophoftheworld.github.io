/**
 * Gemini extraction of Philippine Senior / PWD ID card fields.
 * Reuses the same GEMINI_API_KEY and model list as expense receipt OCR.
 */

const {
  GEMINI_MODELS,
  stripDataUrl
} = require('./extractExpenseReceipt');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS_PER_MODEL = 3;

const ID_FIELDS = [
  'fullName',
  'idNumber',
  'dateOfBirth',
  'sex',
  'disabilityType',
  'address',
  'issuingLgu',
  'dateIssued'
];

const SENIOR_DETAIL_FIELDS = [
  { key: 'fullName', label: 'Name' },
  { key: 'idNumber', label: 'ID number' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'address', label: 'Address' },
  { key: 'issuingLgu', label: 'City / LGU' },
  { key: 'dateIssued', label: 'Date issued' }
];

const PWD_DETAIL_FIELDS = [
  { key: 'fullName', label: 'Name' },
  { key: 'idNumber', label: 'ID number' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'disabilityType', label: 'Disability' },
  { key: 'address', label: 'Address' },
  { key: 'issuingLgu', label: 'City / LGU' },
  { key: 'dateIssued', label: 'Date issued' }
];

function detailFieldsFor(idType) {
  return idType === 'pwd' ? PWD_DETAIL_FIELDS : SENIOR_DETAIL_FIELDS;
}

function detectMimeType(imageBase64, explicitMime) {
  if (explicitMime && String(explicitMime).startsWith('image/')) {
    return explicitMime;
  }
  if (typeof imageBase64 === 'string') {
    const m = imageBase64.match(/^data:(image\/[\w+.-]+);base64,/i);
    if (m) return m[1];
  }
  return 'image/jpeg';
}

function extractJsonText(geminiResponse) {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 500;
}

function isCapacityMessage(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('high demand') ||
    m.includes('resource exhausted') ||
    m.includes('try again later') ||
    m.includes('unavailable') ||
    m.includes('overloaded') ||
    m.includes('capacity')
  );
}

function toIdError(rawMessage, status) {
  if (status === 429 || status === 503 || isCapacityMessage(rawMessage)) {
    const err = new Error('Couldn’t read the ID right now. Try again.');
    err.code = 'resource-exhausted';
    err.staffFacing = true;
    return err;
  }
  const err = new Error('Couldn’t read details from this ID.');
  err.code = 'internal';
  err.staffFacing = true;
  err.causeMessage = rawMessage;
  return err;
}

function normalizeIdDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  const isoMatch = s.match(/\b(19\d{2}|20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slash = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](19\d{2}|20\d{2})\b/);
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[2], 10);
    const y = slash[3];
    if (a > 12 && b <= 12) {
      return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  return s;
}

function normalizeSex(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'm' || s === 'male' || s === 'lalaki') return 'Male';
  if (s === 'f' || s === 'female' || s === 'babae') return 'Female';
  return String(value || '').trim();
}

function emptyIdFields() {
  return ID_FIELDS.reduce((acc, key) => {
    acc[key] = '';
    return acc;
  }, {});
}

function normalizeIdParsed(raw, idType) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const type = idType === 'pwd' ? 'pwd' : 'senior';
  const out = emptyIdFields();
  ID_FIELDS.forEach((key) => {
    out[key] = String(data[key] || '').trim();
  });
  out.dateOfBirth = normalizeIdDate(out.dateOfBirth);
  out.dateIssued = normalizeIdDate(out.dateIssued);
  out.sex = normalizeSex(out.sex);
  if (type === 'senior') out.disabilityType = '';
  out.idType = type;
  let documentType = String(data.documentType || '').trim().toLowerCase();
  if (!['senior', 'pwd', 'other', 'unknown'].includes(documentType)) {
    documentType = 'unknown';
  }
  out.documentType = documentType;
  return out;
}

function buildIdExtractionPrompt(idType) {
  const expected = idType === 'pwd' ? 'PWD / Person with Disability ID' : 'Senior Citizen / OSCA ID';
  return `You extract printed text from a photo of a Philippine government ID card.

Expected card: ${expected}.
Cards vary by city/municipality. Read what is printed. Do not invent values. Use null when a field is missing, unreadable, or not on the card.

Return JSON only matching the schema.

Field rules:
- fullName: person's full name as printed (not the issuing officer).
- idNumber: ID / control / card number.
- dateOfBirth: birth date if printed. Prefer YYYY-MM-DD.
- sex: Male or Female when printed (M/F, lalaki/babae).
- disabilityType: PWD cards only — type of disability as printed. Null on senior cards.
- address: address or barangay/city as printed.
- issuingLgu: city, municipality, or province that issued the card (header / OSCA / PDAO).
- dateIssued: date issued if printed. Prefer YYYY-MM-DD. Do not use expiry unless issued date is absent and clearly labeled issued.
- documentType: "senior" if this is a senior/OSCA card, "pwd" if a PWD/PDAO card, "other" if a different ID (driver's license, PhilID, etc.), "unknown" if you cannot tell.`;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fullName: { type: 'STRING', nullable: true },
    idNumber: { type: 'STRING', nullable: true },
    dateOfBirth: { type: 'STRING', nullable: true },
    sex: { type: 'STRING', nullable: true },
    disabilityType: { type: 'STRING', nullable: true },
    address: { type: 'STRING', nullable: true },
    issuingLgu: { type: 'STRING', nullable: true },
    dateIssued: { type: 'STRING', nullable: true },
    documentType: { type: 'STRING', nullable: true }
  }
};

function buildRequestBody(raw, mime, idType) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildIdExtractionPrompt(idType) },
          { inline_data: { mime_type: mime, data: raw } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
}

async function callGeminiModel({ apiKey, model, raw, mime, idType }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(raw, mime, idType))
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function extractDiscountIdFromImage({ apiKey, imageBase64, mimeType, idType }) {
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.code = 'failed-precondition';
    throw err;
  }

  const type = idType === 'pwd' ? 'pwd' : 'senior';
  const raw = stripDataUrl(imageBase64);
  if (!raw || raw.length < 32) {
    const err = new Error('ID image is missing or empty');
    err.code = 'invalid-argument';
    throw err;
  }
  if (raw.length > MAX_IMAGE_BYTES * 1.4) {
    const err = new Error('ID image is too large');
    err.code = 'invalid-argument';
    throw err;
  }

  const mime = detectMimeType(imageBase64, mimeType);
  let lastStaffError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const { res, payload } = await callGeminiModel({
          apiKey,
          model,
          raw,
          mime,
          idType: type
        });
        if (!res.ok) {
          const rawMessage = payload?.error?.message || `Gemini request failed (${res.status})`;
          console.warn(`[extractDiscountId] ${model} attempt ${attempt} failed:`, rawMessage);
          lastStaffError = toIdError(rawMessage, res.status);
          if (isRetryableStatus(res.status) || isCapacityMessage(rawMessage)) {
            if (attempt < MAX_ATTEMPTS_PER_MODEL) {
              await sleep(400 * attempt * attempt);
              continue;
            }
            break;
          }
          throw lastStaffError;
        }

        const text = extractJsonText(payload);
        if (!text) {
          lastStaffError = toIdError('empty response', 500);
          if (attempt < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(400 * attempt * attempt);
            continue;
          }
          break;
        }

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          lastStaffError = toIdError('invalid JSON', 500);
          if (attempt < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(400 * attempt * attempt);
            continue;
          }
          break;
        }

        return normalizeIdParsed(parsed, type);
      } catch (error) {
        if (error?.staffFacing) throw error;
        console.warn(`[extractDiscountId] ${model} attempt ${attempt} network error:`, error?.message);
        lastStaffError = toIdError(error?.message || 'network error', 503);
        if (attempt < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(400 * attempt * attempt);
          continue;
        }
        break;
      }
    }
  }

  throw lastStaffError || toIdError('all models failed', 503);
}

module.exports = {
  ID_FIELDS,
  SENIOR_DETAIL_FIELDS,
  PWD_DETAIL_FIELDS,
  detailFieldsFor,
  emptyIdFields,
  normalizeIdDate,
  normalizeSex,
  normalizeIdParsed,
  extractDiscountIdFromImage
};
