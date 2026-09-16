import { getSignature } from './signature-store.js';
import { dataUrlToBytes, isPngDataUrl, getRectCenter } from './coords.js';
import * as pdfViewer from './pdf-viewer.js';

function parseColor(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

export async function exportSignedPdf(annotations) {
  const pdfBytes = pdfViewer.getPdfBytes();
  if (!pdfBytes) throw new Error('No PDF loaded');

  const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const ann of annotations) {
    const page = pages[ann.pageIndex];
    if (!page) continue;

    if (ann.type === 'signature') {
      await drawSignature(pdfDoc, page, ann, degrees);
    } else if (ann.type === 'text') {
      const color = parseColor(ann.color || '#000000');
      page.drawText(ann.text, {
        x: ann.x,
        y: ann.y,
        size: ann.fontSize,
        font: helvetica,
        color: rgb(color.r, color.g, color.b),
        rotate: degrees(ann.rotation || 0),
      });
    } else if (ann.type === 'check') {
      page.drawText('✓', {
        x: ann.x + ann.size * 0.15,
        y: ann.y + ann.size * 0.15,
        size: ann.size * 0.85,
        font: helvetica,
        color: rgb(0, 0, 0),
        rotate: degrees(ann.rotation || 0),
      });
    } else if (ann.type === 'pen') {
      const color = parseColor(ann.color || '#000000');
      const c = rgb(color.r, color.g, color.b);
      for (let i = 1; i < ann.points.length; i++) {
        page.drawLine({
          start: { x: ann.points[i - 1].x, y: ann.points[i - 1].y },
          end: { x: ann.points[i].x, y: ann.points[i].y },
          thickness: ann.lineWidth,
          color: c,
        });
      }
    }
  }

  const saved = await pdfDoc.save();
  const blob = new Blob([saved], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const baseName =
    pdfViewer.getFileName().replace(/\.(pdf|png|jpe?g|webp|gif|bmp)$/i, '') || 'document';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}-signed.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function drawSignature(pdfDoc, page, placed, degrees) {
  const sig = getSignature(placed.signatureId);
  if (!sig) return;

  const bytes = dataUrlToBytes(sig.dataUrl);
  const image = isPngDataUrl(sig.dataUrl)
    ? await pdfDoc.embedPng(bytes)
    : await pdfDoc.embedJpg(bytes);

  const center = getRectCenter(placed);
  const angle = placed.rotation || 0;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = placed.width / 2;
  const hh = placed.height / 2;

  const blX = center.x - hw * cos + hh * sin;
  const blY = center.y - hw * sin - hh * cos;

  page.drawImage(image, {
    x: blX,
    y: blY,
    width: placed.width,
    height: placed.height,
    rotate: degrees(angle),
  });
}
