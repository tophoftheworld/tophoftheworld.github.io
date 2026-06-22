import {
  buildInvoiceDocumentFromLead,
  fillInvoiceDocument,
  waitForInvoiceLayout
} from "./invoice-core.js";

const RANGE_PAX =
  /\d+\s*[-–—to]+\s*\d+|\d+\s*[-–—]\s*\d+|about\s+\d+|around\s+\d+|approximately\s+\d+|up\s+to\s+\d+/i;
const VAGUE_PAX = /^(tbd|n\/a|na|unknown|-+)$/i;

export function isFinalPaxCount(value) {
  if (!value) return false;
  const str = String(value).trim();
  if (!str || VAGUE_PAX.test(str)) return false;
  if (RANGE_PAX.test(str)) return false;
  const numbers = str.match(/\d+/g);
  if (!numbers || numbers.length !== 1) return false;
  const n = Number(numbers[0]);
  return Number.isFinite(n) && n > 0;
}

export function parseQuotedPrice(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (RANGE_PAX.test(str) || /\bto\b/i.test(str.replace(/[₱php,\s]/gi, ""))) {
    const amounts = [...str.matchAll(/[\d,]+(?:\.\d{1,2})?/g)].map((m) =>
      Number(m[0].replace(/,/g, ""))
    );
    if (amounts.length > 1 && amounts[0] !== amounts[1]) return null;
  }
  const match = str.match(/[\d,]+(?:\.\d{1,2})?/);
  if (!match) return null;
  const amount = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function canGenerateInvoice(lead) {
  return Boolean(
    lead?.clientName?.trim() &&
      lead?.service &&
      lead?.targetDate &&
      isFinalPaxCount(lead.targetPax) &&
      parseQuotedPrice(lead.quotedPrice)
  );
}

export function invoiceDisabledReason(lead) {
  if (!lead?.clientName?.trim()) return "Client name is required.";
  if (!lead?.service) return "Service is required.";
  if (!lead?.targetDate) return "Event date is required.";
  if (!isFinalPaxCount(lead?.targetPax)) {
    return "Confirm final guest/cup count before generating invoice.";
  }
  if (!parseQuotedPrice(lead?.quotedPrice)) {
    return "A single finalized quoted price is required (not a range).";
  }
  return "Missing required fields for invoice.";
}

async function downloadInvoicePdf() {
  const invoiceElement = document.getElementById("li-invoice");
  const paymentTermsElement = document.getElementById("li-paymentTermsPage");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const canvas1 = await html2canvas(invoiceElement, {
    scale: 1.5,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    width: 210 * 3.779527559,
    height: 297 * 3.779527559
  });
  const imgData1 = canvas1.toDataURL("image/jpeg", 0.85);
  const imgWidth1 = pageWidth;
  const imgHeight1 = (canvas1.height * imgWidth1) / canvas1.width;
  if (imgHeight1 > pageHeight) {
    const scale = pageHeight / imgHeight1;
    pdf.addImage(imgData1, "JPEG", 0, 0, imgWidth1 * scale, imgHeight1 * scale);
  } else {
    pdf.addImage(imgData1, "JPEG", 0, 0, imgWidth1, imgHeight1);
  }

  if (paymentTermsElement) {
    const canvas2 = await html2canvas(paymentTermsElement, {
      scale: 1.5,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: 210 * 3.779527559,
      height: 297 * 3.779527559
    });
    const imgData2 = canvas2.toDataURL("image/jpeg", 0.85);
    const imgWidth2 = pageWidth;
    const imgHeight2 = (canvas2.height * imgWidth2) / canvas2.width;
    pdf.addPage();
    if (imgHeight2 > pageHeight) {
      const scale = pageHeight / imgHeight2;
      pdf.addImage(imgData2, "JPEG", 0, 0, imgWidth2 * scale, imgHeight2 * scale);
    } else {
      pdf.addImage(imgData2, "JPEG", 0, 0, imgWidth2, imgHeight2);
    }
  }

  return pdf;
}

export async function downloadLeadInvoice(lead) {
  if (!canGenerateInvoice(lead)) {
    throw new Error(invoiceDisabledReason(lead));
  }

  const unitPrice = parseQuotedPrice(lead.quotedPrice);
  const doc = buildInvoiceDocumentFromLead(lead, { unitPrice });
  const root = document.getElementById("lead-invoice-root");
  if (!root) throw new Error("Invoice template not found");

  fillInvoiceDocument(root, doc);
  await waitForInvoiceLayout();

  const pdf = await downloadInvoicePdf();
  const filename = `${doc.invoiceNumber}_${doc.clientName.replace(/\s+/g, "_")}.pdf`;
  pdf.save(filename);
  return doc;
}
