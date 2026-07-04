/** PDF page coords: bottom-left origin, points. Screen coords: top-left, pixels at render scale. */

export function pdfRectToScreen({ x, y, width, height }, pageHeight, scale) {
  return {
    left: x * scale,
    top: (pageHeight - y - height) * scale,
    width: width * scale,
    height: height * scale,
  };
}

export function screenRectToPdf({ left, top, width, height }, pageHeight, scale) {
  const pdfW = width / scale;
  const pdfH = height / scale;
  return {
    x: left / scale,
    y: pageHeight - top / scale - pdfH,
    width: pdfW,
    height: pdfH,
  };
}

export function screenPointToPdf(x, y, pageHeight, scale) {
  return {
    x: x / scale,
    y: pageHeight - y / scale,
  };
}

const PLACEMENT_MAX_SCREEN_W = 160;
const PLACEMENT_MAX_SCREEN_H = 80;

/** Shared size for ghost preview and placed signature (screen px + PDF points). */
export function getSignaturePlacementSize(imgWidth, imgHeight, renderScale) {
  const aspect = imgWidth / imgHeight;
  let screenW = PLACEMENT_MAX_SCREEN_W;
  let screenH = screenW / aspect;

  if (screenH > PLACEMENT_MAX_SCREEN_H) {
    screenH = PLACEMENT_MAX_SCREEN_H;
    screenW = screenH * aspect;
  }

  return {
    screenWidth: screenW,
    screenHeight: screenH,
    width: screenW / renderScale,
    height: screenH / renderScale,
  };
}

export function centerPdfRect(cx, cy, width, height) {
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  };
}

export function getRectCenter(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function isPngDataUrl(dataUrl) {
  return dataUrl.startsWith('data:image/png');
}
