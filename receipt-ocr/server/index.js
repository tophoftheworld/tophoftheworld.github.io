/**
 * Minimal HTTPS-capable proxy for Google Cloud Vision documentTextDetection.
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS pointing to service account JSON.
 */

const express = require('express');
const cors = require('cors');
const vision = require('@google-cloud/vision');

const PORT = Number(process.env.PORT) || 8787;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(express.json({ limit: '15mb' }));

const corsOptions =
  CORS_ORIGIN === '*'
    ? { origin: true }
    : { origin: CORS_ORIGIN.split(',').map((s) => s.trim()) };
app.use(cors(corsOptions));

const client = new vision.ImageAnnotatorClient();

function stripDataUrl(base64) {
  if (!base64 || typeof base64 !== 'string') return '';
  const m = base64.match(/^data:image\/\w+;base64,(.+)$/);
  return m ? m[1] : base64.replace(/\s/g, '');
}

function parseMoneyText(value) {
  if (value == null) return null;
  const s = String(value);
  // Keep digits, commas, dot, minus.
  const cleaned = s
    .replace(/[₱]|PHP/gi, '')
    .replace(/,/g, '')
    .replace(/[^\d.\-]/g, '')
    .trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeTin(value) {
  if (!value) return '';
  const s = String(value).trim();
  // Already looks like xxx-xxx-xxx-xxx
  if (/^\d{3}-\d{3}-\d{3}-\d{3}$/.test(s)) return s;

  const digits = s.replace(/\D/g, '');
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(
      9
    )}`;
  }
  return s;
}

function normalizeDateText(value) {
  if (!value) return '';
  const s = String(value);

  // Prefer ISO yyyy-mm-dd.
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // mm/dd/yyyy or dd/mm/yyyy (best-effort).
  const mdy = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (mdy) {
    const a = parseInt(mdy[1], 10);
    const b = parseInt(mdy[2], 10);
    const mm = String(a).padStart(2, '0');
    const dd = String(b).padStart(2, '0');
    return `${mdy[3]}-${mm}-${dd}`;
  }

  return '';
}

function getDocAiEntityValue(entity) {
  const nv = entity?.normalizedValue;
  // normalizedValue.text is usually present for KVP processors.
  let normalizedText = nv?.text;

  // Money values may come through as a structured moneyValue.
  if (!normalizedText && nv?.moneyValue) {
    const units = nv.moneyValue.units;
    const nanos = nv.moneyValue.nanos;
    if (units != null) {
      const amount = nanos != null ? Number(units) + Number(nanos) / 1e9 : Number(units);
      if (Number.isFinite(amount)) normalizedText = String(amount);
    }
  }

  // Dates may come through as year/month/day parts.
  if (!normalizedText && nv?.dateValue) {
    const y = nv.dateValue.year;
    const m = nv.dateValue.month;
    const d = nv.dateValue.day;
    if (y != null && m != null && d != null) {
      normalizedText = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(
        2,
        '0'
      )}`;
    } else if (nv.dateValue.text) {
      normalizedText = nv.dateValue.text;
    } else if (nv.dateValue.value) {
      normalizedText = nv.dateValue.value;
    }
  }

  const anchorText = entity?.textAnchor?.content;
  const mentionText = entity?.mentionText;

  return normalizedText || anchorText || mentionText || '';
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/scan', async (req, res) => {
  try {
    const raw = req.body?.imageBase64;
    const b64 = stripDataUrl(raw);
    if (!b64) {
      return res.status(400).json({
        ok: false,
        fullText: '',
        error: 'Missing imageBase64 in JSON body',
      });
    }

    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) {
      return res.status(400).json({
        ok: false,
        fullText: '',
        error: 'Invalid base64 image',
      });
    }

    const [result] = await client.documentTextDetection({
      image: { content: buffer },
    });

    const fullAnnotation = result.fullTextAnnotation;
    const fullText = fullAnnotation?.text || '';

    const fallback =
      fullText ||
      (result.textAnnotations && result.textAnnotations[0]
        ? result.textAnnotations[0].description
        : '');

    res.json({
      ok: true,
      fullText: fallback || '',
      error: null,
    });
  } catch (err) {
    console.error('Vision error:', err);
    res.status(500).json({
      ok: false,
      fullText: '',
      error: err.message || String(err),
    });
  }
});

app.post('/scan-documentai', async (req, res) => {
  try {
    const raw = req.body?.imageBase64;
    const b64 = stripDataUrl(raw);
    if (!b64) {
      return res.status(400).json({
        ok: false,
        fullText: '',
        error: 'Missing imageBase64 in JSON body',
      });
    }

    const mimeType = req.body?.imageMimeType || 'image/jpeg';

    let processorName = process.env.DOCUMENT_AI_PROCESSOR_NAME;
    if (!processorName) {
      return res.status(500).json({
        ok: false,
        fullText: '',
        error:
          'Missing DOCUMENT_AI_PROCESSOR_NAME in server environment (.env or process env).',
      });
    }

    processorName = String(processorName).trim();

    // Users sometimes paste the "Prediction endpoint" URL (contains `:process`).
    // The Document AI client wants the processor resource name:
    // projects/<project>/locations/<region>/processors/<processorId>
    const resourceMatch = processorName.match(
      /projects\/[^\/]+\/locations\/[^\/]+\/processors\/[^\/]+/i
    );
    if (resourceMatch) processorName = resourceMatch[0];

    if (!/^projects\/.+\/locations\/.+\/processors\/.+$/i.test(processorName)) {
      return res.status(500).json({
        ok: false,
        fullText: '',
        error:
          'DOCUMENT_AI_PROCESSOR_NAME must be a processor resource name like `projects/<projectId>/locations/<region>/processors/<processorId>` (NOT the full prediction endpoint URL).',
      });
    }

    // projects/<project>/locations/<region>/processors/<id>
    const parts = processorName.split('/');
    const region = parts[3]; // locations/<region>
    if (!region) {
      return res.status(500).json({
        ok: false,
        fullText: '',
        error: 'Could not extract region from DOCUMENT_AI_PROCESSOR_NAME.',
      });
    }

    const { DocumentProcessorServiceClient } =
      require('@google-cloud/documentai').v1beta3;
    const docaiClient = new DocumentProcessorServiceClient({
      // Regional endpoints should include :443 (matches Google samples).
      apiEndpoint: `${region}-documentai.googleapis.com:443`,
    });

    const request = {
      name: processorName,
      rawDocument: {
        // Document AI expects base64-encoded content.
        content: b64,
        mimeType,
      },
    };

    const [result] = await docaiClient.processDocument(request);
    const doc = result?.document;

    const fullText = doc?.text || '';

    // Best-effort mapping from Invoice Parser entities into the current UI schema.
    const parsed = {
      supplierName: '',
      businessName: '',
      tin: '',
      address: '',
      invoiceNumber: '',
      date: '',
      items: [],
      totalAmount: 0,
      vatExemptAmount: 0,
      vatComputationEnabled: true,
      printedVat: {
        vatableSale: null,
        vatAmount: null,
        taxableAmount: null,
        totalAmount: null,
      },
      rawText: fullText,
    };

    const entities = doc?.entities || [];
    for (const entity of entities) {
      const type = String(entity?.type || entity?.type_ || '').toLowerCase();
      const valueText = getDocAiEntityValue(entity);
      if (!valueText) continue;

      // Supplier
      if (!parsed.supplierName && /supplier/.test(type) && /name/.test(type)) {
        parsed.supplierName = valueText;
        parsed.businessName = valueText;
        continue;
      }
      if (!parsed.address && /supplier/.test(type) && /address/.test(type)) {
        parsed.address = valueText;
        continue;
      }
      if (!parsed.tin && /tax/.test(type) && /id/.test(type)) {
        parsed.tin = normalizeTin(valueText);
        continue;
      }

      // Invoice number + dates
      if (!parsed.invoiceNumber && /invoice/.test(type) && /(id|number|no)/.test(type)) {
        parsed.invoiceNumber = valueText;
        continue;
      }
      if (!parsed.date && /(invoice|issue|transaction).*(date)/.test(type)) {
        parsed.date = normalizeDateText(valueText);
        continue;
      }

      // Totals & VAT
      if (!parsed.totalAmount && /(invoice|amount_due|total).*(total|amount|due)/.test(type)) {
        const n = parseMoneyText(valueText);
        if (n != null) parsed.totalAmount = n;
        continue;
      }

      if (!parsed.vatExemptAmount && /(exempt|zero).*((tax)|(vat))/.test(type)) {
        const n = parseMoneyText(valueText);
        if (n != null) parsed.vatExemptAmount = n;
        continue;
      }

      if (parsed.printedVat.vatAmount == null && /(tax_amount|vat_amount|taxamount|vat)/.test(type)) {
        const n = parseMoneyText(valueText);
        if (n != null) parsed.printedVat.vatAmount = n;
        continue;
      }

      // For VAT verification: our "vatableSale" is the pre-VAT base.
      if (
        parsed.printedVat.vatableSale == null &&
        /(net_amount|subtotal|vatable_sale|vatablesale|netamount)/.test(type)
      ) {
        const n = parseMoneyText(valueText);
        if (n != null) parsed.printedVat.vatableSale = n;
        continue;
      }
    }

    // Fill the remaining printed VAT values for the UI (verification ignores nulls).
    if (parsed.totalAmount && parsed.totalAmount > 0) {
      parsed.printedVat.totalAmount = parsed.totalAmount;
      // Taxable amount here means "total - VAT exempt" for verification expectations.
      const taxable = parsed.totalAmount - (parsed.vatExemptAmount || 0);
      if (Number.isFinite(taxable) && taxable > 0) parsed.printedVat.taxableAmount = taxable;
    }

    res.json({
      ok: true,
      fullText,
      parsed,
    });
  } catch (err) {
    console.error('Document AI error:', err);
    res.status(500).json({
      ok: false,
      fullText: '',
      error: err.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Receipt OCR proxy listening on http://localhost:${PORT} (Vision + Document AI)`
  );
});
