// Post share cards — canvas compositor + modal

const SHARE_EXPORT_W = 1080;
const SHARE_EXPORT_H = 1350;
const SHARE_ACCENT = '#239c02';
const SHARE_STORY_SAFE_RATIO = 45 / 64;
const SHARE_OFFSET_MIN = -280;
const SHARE_OFFSET_MAX = 280;

const SHARE_LAYOUT_FIELDS = {
  classic: { username: true, brand: true, location: false, drinkName: true, price: false, caption: false, drinkBars: false, matchaBars: false, flavorTags: false, watermark: true },
  drinkStats: { username: true, brand: true, location: false, drinkName: true, price: false, caption: false, drinkBars: true, matchaBars: false, flavorTags: false, watermark: true },
  fullReview: { username: true, brand: true, location: false, drinkName: true, price: false, caption: false, drinkBars: false, matchaBars: true, flavorTags: true, watermark: true },
  locationDrop: { username: true, brand: true, location: true, drinkName: false, price: false, caption: false, drinkBars: false, matchaBars: false, flavorTags: false, watermark: true },
  minimal: { username: true, brand: false, location: false, drinkName: false, price: false, caption: false, drinkBars: false, matchaBars: false, flavorTags: false, watermark: true },
};

// Default vertical anchor (fraction of canvas height) for each block's top edge
const SHARE_LAYOUT_ANCHORS = {
  classic: { brand: 0.80, details: 0.58 },
  drinkStats: { brand: 0.84, details: 0.48 },
  fullReview: { brand: 0.88, details: 0.36 },
  locationDrop: { brand: 0.10, details: 0.64 },
  minimal: { brand: 0.84, details: 0.84 },
};

function shareSafeZone(w) {
  const safeW = w * SHARE_STORY_SAFE_RATIO;
  return { x: (w - safeW) / 2, w: safeW, cx: w / 2 };
}

function shareSlug(text) {
  return String(text || 'post')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'post';
}

function shareRoundRect(ctx, x, y, rw, rh, r) {
  const radius = Math.min(r, rw / 2, rh / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, rw, rh, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + rw - radius, y);
  ctx.quadraticCurveTo(x + rw, y, x + rw, y + radius);
  ctx.lineTo(x + rw, y + rh - radius);
  ctx.quadraticCurveTo(x + rw, y + rh, x + rw - radius, y + rh);
  ctx.lineTo(x + radius, y + rh);
  ctx.quadraticCurveTo(x, y + rh, x, y + rh - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadShareImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('No photo URL'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      const img2 = new Image();
      img2.onload = () => resolve(img2);
      img2.onerror = () => reject(new Error('Failed to load photo'));
      img2.src = url;
    };
    img.src = url;
  });
}

function drawCoverImage(ctx, img, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = iw * scale;
  const sh = ih * scale;
  ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
}

function setShareFont(ctx, size, weight = '600') {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
}

function truncateToWidth(ctx, text, maxW) {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawCenteredText(ctx, text, cx, y, maxW, fillStyle) {
  if (!text) return;
  ctx.fillStyle = fillStyle;
  ctx.textAlign = 'center';
  ctx.fillText(truncateToWidth(ctx, text, maxW), cx, y);
  ctx.textAlign = 'left';
}

function drawChakaikiWordmark(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  setShareFont(ctx, size, '600');
  const cha = 'cha';
  const kai = 'kaiki';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(cha, x, y);
  const chaW = ctx.measureText(cha).width;
  ctx.fillStyle = SHARE_ACCENT;
  ctx.fillText(kai, x + chaW, y);
  ctx.restore();
}

function drawChakaikiWordmarkCentered(ctx, cx, y, size, alpha = 1) {
  setShareFont(ctx, size, '600');
  const totalW = ctx.measureText('cha').width + ctx.measureText('kaiki').width;
  drawChakaikiWordmark(ctx, cx - totalW / 2, y, size, alpha);
}

function drawBottomScrim(ctx, w, h, topY) {
  const y0 = Math.max(0, topY - 40);
  const grad = ctx.createLinearGradient(0, y0, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y0, w, h - y0);
}

function getNonZeroScales(scales, profile, limit) {
  return scales.filter(({ key }) => Number(profile?.[key]) > 0).slice(0, limit);
}

function drawMiniBarCentered(ctx, cx, y, barW, label, value, barH = 8) {
  const val = Math.min(5, Math.max(0, Number(value) || 0));
  setShareFont(ctx, 22, '500');
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, y);
  ctx.textAlign = 'left';
  const x = cx - barW / 2;
  const barY = y + 10;
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  shareRoundRect(ctx, x, barY, barW, barH, barH / 2);
  ctx.fill();
  if (val > 0) {
    ctx.fillStyle = SHARE_ACCENT;
    shareRoundRect(ctx, x, barY, barW * (val / 5), barH, barH / 2);
    ctx.fill();
  }
  return barY + barH + 18;
}

function drawTagPillsCentered(ctx, tags, cx, y, maxW) {
  if (!tags?.length) return y;
  setShareFont(ctx, 20, '600');
  const padX = 14;
  const gap = 10;
  const lineH = 36;
  const rows = [];
  let row = [];
  let rowW = 0;
  tags.slice(0, 6).forEach((tag) => {
    const tw = ctx.measureText(tag).width + padX * 2;
    if (row.length && rowW + gap + tw > maxW) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    row.push({ tag, tw });
    rowW += (row.length > 1 ? gap : 0) + tw;
  });
  if (row.length) rows.push(row);
  let cy = y;
  rows.forEach((items) => {
    const total = items.reduce((sum, item, i) => sum + item.tw + (i ? gap : 0), 0);
    let x = cx - total / 2;
    items.forEach(({ tag, tw }) => {
      ctx.fillStyle = 'rgba(35,156,2,0.35)';
      shareRoundRect(ctx, x, cy - 22, tw, 30, 15);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(tag, x + tw / 2, cy);
      ctx.textAlign = 'left';
      x += tw + gap;
    });
    cy += lineH + gap;
  });
  return cy;
}

function getShareData(post, drinkIndex = 0) {
  const drinks = Array.isArray(post?.drinks) ? post.drinks : [];
  const drink = drinks[drinkIndex] || drinks[0] || null;
  const handleRaw = String(post?.authorHandle || '').replace(/^@/, '');
  const handle = handleRaw ? `@${handleRaw}` : '';
  const brand = String(post?.brand || '').trim();
  const location = String(post?.branchName || post?.address || '').trim();
  const drinkName = String(drink?.name || '').trim();
  const caption = String(post?.caption || '').trim();
  const captionExcerpt = caption.length > 80 ? `${caption.slice(0, 80)}…` : caption;
  const flavorTags = Array.isArray(drink?.flavorNotes) ? drink.flavorNotes.filter(Boolean) : [];
  const profile = drink?.profile || {};
  return { handle, brand, location, drinkName, captionExcerpt, flavorTags, profile };
}

function blockTopY(h, anchorFrac, offsetPx) {
  return Math.max(24, Math.min(h - 24, anchorFrac * h + offsetPx));
}

function drawBrandBlock(ctx, w, h, safe, data, fields, topY, style = {}) {
  const maxW = safe.w - 24;
  const wmSize = style.watermarkSize || 32;
  const handleSize = style.handleSize || 24;
  const wmAlpha = style.watermarkAlpha ?? 0.92;
  const handleColor = style.handleColor || 'rgba(255,255,255,0.85)';
  const stack = style.stack || 'logo-first';
  let y = topY;

  const drawLogo = () => {
    if (!fields.watermark) return;
    drawChakaikiWordmarkCentered(ctx, safe.cx, y + wmSize, wmSize, wmAlpha);
    y += wmSize + 14;
  };
  const drawHandle = () => {
    if (!fields.username || !data.handle) return;
    if (style.badge) {
      setShareFont(ctx, handleSize, '600');
      const badgeW = Math.min(safe.w, ctx.measureText(data.handle).width + 40);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      shareRoundRect(ctx, safe.cx - badgeW / 2, y, badgeW, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(data.handle, safe.cx, y + 30);
      ctx.textAlign = 'left';
      y += 52;
      return;
    }
    setShareFont(ctx, handleSize, '600');
    if (style.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 4;
    }
    drawCenteredText(ctx, data.handle, safe.cx, y + handleSize, maxW, handleColor);
    ctx.shadowBlur = 0;
    y += handleSize + 10;
  };

  if (stack === 'handle-first') {
    drawHandle();
    drawLogo();
  } else {
    drawLogo();
    drawHandle();
  }
  return y;
}

function drawDetailsBlock(ctx, w, h, safe, data, fields, topY, layoutId) {
  const maxW = safe.w - 24;
  let y = topY;

  if (layoutId === 'fullReview') {
    const innerPad = 28;
    const panelW = safe.w - innerPad;
    let panelH = 56;
    if (fields.drinkName && data.drinkName) panelH += 48;
    if (fields.brand && data.brand) panelH += 36;
    if (fields.flavorTags && data.flavorTags.length) panelH += 48;
    if (fields.matchaBars) panelH += getNonZeroScales(MATCHA_PROFILE_SCALES, data.profile, 3).length * 38;
    if (fields.caption && data.captionExcerpt) panelH += 40;
    panelH = Math.min(panelH, h - topY - 120);
    const panelX = safe.x + innerPad / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    shareRoundRect(ctx, panelX, y, panelW, panelH, 24);
    ctx.fill();
    y += 44;
    const innerMaxW = panelW - 40;
    if (fields.drinkName && data.drinkName) {
      setShareFont(ctx, 36, '700');
      drawCenteredText(ctx, data.drinkName, safe.cx, y, innerMaxW, '#ffffff');
      y += 44;
    }
    if (fields.brand && data.brand) {
      setShareFont(ctx, 26, '600');
      drawCenteredText(ctx, data.brand, safe.cx, y, innerMaxW, 'rgba(255,255,255,0.9)');
      y += 34;
    }
    if (fields.flavorTags && data.flavorTags.length) {
      y = drawTagPillsCentered(ctx, data.flavorTags, safe.cx, y + 8, innerMaxW) + 4;
    }
    if (fields.matchaBars) {
      getNonZeroScales(MATCHA_PROFILE_SCALES, data.profile, 3).forEach(({ key, label }) => {
        y = drawMiniBarCentered(ctx, safe.cx, y, innerMaxW * 0.88, label, data.profile[key], 7);
      });
    }
    if (fields.caption && data.captionExcerpt) {
      setShareFont(ctx, 22, '500');
      drawCenteredText(ctx, data.captionExcerpt, safe.cx, y, innerMaxW, 'rgba(255,255,255,0.8)');
    }
    return y + panelH;
  }

  if (layoutId === 'locationDrop') {
    if (fields.brand && data.brand) {
      setShareFont(ctx, 36, '700');
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 8;
      drawCenteredText(ctx, data.brand, safe.cx, y + 36, maxW, '#ffffff');
      ctx.shadowBlur = 0;
      y += 44;
    }
    if (fields.location && data.location) {
      setShareFont(ctx, 26, '500');
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 6;
      drawCenteredText(ctx, data.location, safe.cx, y + 26, maxW, 'rgba(255,255,255,0.92)');
      ctx.shadowBlur = 0;
      y += 36;
    }
    return y;
  }

  if (layoutId === 'drinkStats') {
    if (fields.drinkName && data.drinkName) {
      setShareFont(ctx, 38, '700');
      drawCenteredText(ctx, data.drinkName, safe.cx, y + 38, maxW, '#ffffff');
      y += 50;
    }
    if (fields.brand && data.brand) {
      setShareFont(ctx, 28, '600');
      drawCenteredText(ctx, data.brand, safe.cx, y + 28, maxW, 'rgba(255,255,255,0.9)');
      y += 40;
    }
    if (fields.drinkBars) {
      getNonZeroScales(DRINK_PROFILE_SCALES, data.profile, 3).forEach(({ key, label }) => {
        y = drawMiniBarCentered(ctx, safe.cx, y + 4, safe.w * 0.78, label, data.profile[key]);
      });
    }
    return y;
  }

  // classic + default
  if (fields.drinkName && data.drinkName) {
    setShareFont(ctx, 40, '700');
    drawCenteredText(ctx, data.drinkName, safe.cx, y + 40, maxW, '#ffffff');
    y += 52;
  }
  if (fields.brand && data.brand) {
    setShareFont(ctx, 30, '600');
    drawCenteredText(ctx, data.brand, safe.cx, y + 30, maxW, 'rgba(255,255,255,0.92)');
    y += 42;
  }
  return y;
}

function drawShareLayout(ctx, w, h, layoutId, data, fields, blockOffsets) {
  const safe = shareSafeZone(w);
  const anchors = SHARE_LAYOUT_ANCHORS[layoutId] || SHARE_LAYOUT_ANCHORS.classic;
  const offsets = blockOffsets || { brand: 0, details: 0 };
  const brandY = blockTopY(h, anchors.brand, offsets.brand || 0);
  const detailsY = blockTopY(h, anchors.details, offsets.details || 0);

  const needsScrim = layoutId === 'classic' || layoutId === 'drinkStats';
  if (needsScrim) {
    drawBottomScrim(ctx, w, h, Math.min(brandY, detailsY));
  }

  if (layoutId === 'minimal') {
    drawBrandBlock(ctx, w, h, safe, data, fields, brandY, {
      watermarkSize: 30,
      handleSize: 24,
      watermarkAlpha: 0.55,
      handleColor: 'rgba(255,255,255,0.7)',
      stack: 'handle-first',
      shadow: true,
    });
    return;
  }

  if (layoutId === 'locationDrop') {
    drawBrandBlock(ctx, w, h, safe, data, fields, brandY, {
      handleSize: 24,
      badge: true,
      stack: 'handle-first',
    });
    if (fields.watermark) {
      drawChakaikiWordmarkCentered(ctx, safe.cx, h * 0.5, 38, 0.35);
    }
    drawDetailsBlock(ctx, w, h, safe, data, fields, detailsY, layoutId);
    return;
  }

  drawDetailsBlock(ctx, w, h, safe, data, fields, detailsY, layoutId);
  drawBrandBlock(ctx, w, h, safe, data, fields, brandY, {
    watermarkSize: layoutId === 'fullReview' ? 32 : 34,
    handleSize: layoutId === 'fullReview' ? 22 : 24,
  });
}

const SHARE_LAYOUTS = [
  { id: 'classic', label: 'Classic' },
  { id: 'drinkStats', label: 'Drink stats' },
  { id: 'fullReview', label: 'Full review' },
  { id: 'locationDrop', label: 'Location' },
  { id: 'minimal', label: 'Minimal' },
];

function fieldsForLayout(layoutId) {
  return SHARE_LAYOUT_FIELDS[layoutId] || SHARE_LAYOUT_FIELDS.classic;
}

async function renderShareCardCanvas({ post, photoUrl, layoutId, drinkIndex = 0, blockOffsets, previewW, previewH }) {
  const w = previewW || SHARE_EXPORT_W;
  const h = previewH || SHARE_EXPORT_H;
  const fields = fieldsForLayout(layoutId);
  const data = getShareData(post, drinkIndex);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  const scaleX = w / SHARE_EXPORT_W;
  const scaleY = h / SHARE_EXPORT_H;
  if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);

  try {
    const img = await loadShareImage(photoUrl);
    drawCoverImage(ctx, img, SHARE_EXPORT_W, SHARE_EXPORT_H);
  } catch {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, SHARE_EXPORT_W, SHARE_EXPORT_H);
    setShareFont(ctx, 48, '600');
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('Photo unavailable', SHARE_EXPORT_W / 2, SHARE_EXPORT_H / 2);
    ctx.textAlign = 'left';
  }

  drawShareLayout(ctx, SHARE_EXPORT_W, SHARE_EXPORT_H, layoutId, data, fields, blockOffsets);
  return canvas;
}

async function buildShareCardBlob(opts) {
  const canvas = await renderShareCardCanvas({ ...opts, previewW: SHARE_EXPORT_W, previewH: SHARE_EXPORT_H });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Export failed — photo may block canvas (CORS)'));
    }, 'image/png');
  });
}

function downloadShareBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareShareBlob(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Chakaiki' });
    return true;
  }
  downloadShareBlob(blob, filename);
  return false;
}

function clampShareOffset(v) {
  return Math.max(SHARE_OFFSET_MIN, Math.min(SHARE_OFFSET_MAX, Math.round(v)));
}

function estimateBlockBounds(layoutId, block, offsets) {
  const h = SHARE_EXPORT_H;
  const anchors = SHARE_LAYOUT_ANCHORS[layoutId] || SHARE_LAYOUT_ANCHORS.classic;
  const top = blockTopY(h, anchors[block], offsets?.[block] || 0);
  let height = 96;
  if (block === 'brand') {
    if (layoutId === 'locationDrop') height = 56;
    else if (layoutId === 'minimal') height = 72;
    else height = 88;
  } else if (layoutId === 'fullReview') height = 300;
  else if (layoutId === 'drinkStats') height = 240;
  else if (layoutId === 'locationDrop') height = 96;
  else if (layoutId === 'classic') height = 110;
  return { top, bottom: Math.min(h, top + height) };
}

function hitTestShareBlock(clientY, wrapEl, layoutId, blockOffsets, showDetailsBlock) {
  if (!wrapEl) return null;
  const rect = wrapEl.getBoundingClientRect();
  if (!rect.height) return null;
  const exportY = ((clientY - rect.top) / rect.height) * SHARE_EXPORT_H;
  const candidates = [];
  if (showDetailsBlock) {
    const d = estimateBlockBounds(layoutId, 'details', blockOffsets);
    candidates.push({ id: 'details', ...d });
  }
  const b = estimateBlockBounds(layoutId, 'brand', blockOffsets);
  candidates.push({ id: 'brand', ...b });
  const hit = candidates.find((c) => exportY >= c.top && exportY <= c.bottom);
  if (hit) return hit.id;
  let best = candidates[0]?.id || null;
  let bestDist = Infinity;
  candidates.forEach((c) => {
    const mid = (c.top + c.bottom) / 2;
    const dist = Math.abs(exportY - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = c.id;
    }
  });
  return best;
}

function ShareDraggablePreview({ previewUrl, layoutId, blockOffsets, onOffsetsChange, theme, showDetailsBlock }) {
  const wrapRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);

  const onPointerDown = React.useCallback((e) => {
    if (!previewUrl || !wrapRef.current) return;
    const block = hitTestShareBlock(e.clientY, wrapRef.current, layoutId, blockOffsets, showDetailsBlock);
    if (!block) return;
    e.preventDefault();
    dragRef.current = {
      block,
      startClientY: e.clientY,
      startOffset: blockOffsets[block] || 0,
    };
    setDragging(true);
    wrapRef.current.setPointerCapture(e.pointerId);
  }, [previewUrl, layoutId, blockOffsets, showDetailsBlock]);

  const onPointerMove = React.useCallback((e) => {
    if (!dragRef.current || !wrapRef.current) return;
    const { block, startClientY, startOffset } = dragRef.current;
    const h = wrapRef.current.clientHeight || 1;
    const scale = SHARE_EXPORT_H / h;
    const next = clampShareOffset(startOffset + (e.clientY - startClientY) * scale);
    onOffsetsChange((prev) => ({ ...prev, [block]: next }));
  }, [onOffsetsChange]);

  const onPointerEnd = React.useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  return (
    <div style={{ width: '100%', maxWidth: 440 }}>
      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4/5',
          borderRadius: 14,
          overflow: 'hidden',
          border: `1px solid ${theme.border}`,
          background: theme.surface2,
          boxShadow: theme.shadowLg,
          touchAction: 'none',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Share preview" draggable={false} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.sans, fontSize: 13, color: theme.muted, pointerEvents: 'none' }}>
            Loading preview…
          </div>
        )}
      </div>
    </div>
  );
}

function ShareLayoutThumb({ layoutId, label, post, photoUrl, drinkIndex, selected, onSelect, theme }) {
  const [thumb, setThumb] = React.useState('');
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const canvas = await renderShareCardCanvas({
          post,
          photoUrl,
          layoutId,
          drinkIndex,
          previewW: 200,
          previewH: 250,
        });
        if (active) setThumb(canvas.toDataURL('image/png'));
      } catch {
        if (active) setThumb('');
      }
    })();
    return () => { active = false; };
  }, [layoutId, post, photoUrl, drinkIndex]);

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        flexShrink: 0,
        width: 88,
        padding: 0,
        border: selected ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
        borderRadius: 10,
        background: selected ? theme.accentLight : theme.card,
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: '100%', aspectRatio: '4/5', background: theme.surface2, overflow: 'hidden' }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: theme.border }} />
        )}
      </div>
      <div style={{ padding: '6px 4px', fontFamily: theme.sans, fontSize: 10, fontWeight: 600, color: theme.text, textAlign: 'center' }}>
        {label}
      </div>
    </button>
  );
}

function ShareCardModal({ theme, post, photoIndex = 0, onPhotoIndexChange, onClose }) {
  const [layoutId, setLayoutId] = React.useState('classic');
  const [drinkIndex, setDrinkIndex] = React.useState(0);
  const [blockOffsets, setBlockOffsets] = React.useState({ brand: 0, details: 0 });
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState('');

  const photos = (Array.isArray(post?.photos) ? post.photos : []).filter(Boolean);
  const photoUrl = photos[photoIndex] || photos[0] || '';
  const drinks = Array.isArray(post?.drinks) ? post.drinks : [];
  const showDetailsBlock = layoutId !== 'minimal';

  React.useEffect(() => {
    setBlockOffsets({ brand: 0, details: 0 });
  }, [layoutId]);

  const setBlockOffsetsClamped = React.useCallback((next) => {
    setBlockOffsets((prev) => {
      const merged = typeof next === 'function' ? next(prev) : next;
      return {
        brand: clampShareOffset(merged.brand ?? prev.brand ?? 0),
        details: clampShareOffset(merged.details ?? prev.details ?? 0),
      };
    });
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const canvas = await renderShareCardCanvas({
          post,
          photoUrl,
          layoutId,
          drinkIndex,
          blockOffsets,
          previewW: 540,
          previewH: 675,
        });
        if (!active) return;
        setPreviewUrl(canvas.toDataURL('image/png'));
      } catch {
        if (active) setPreviewUrl('');
      }
    })();
    return () => { active = false; };
  }, [post, photoUrl, layoutId, drinkIndex, blockOffsets]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exportFilename = React.useMemo(() => {
    const handle = shareSlug(post?.authorHandle || 'user');
    const brand = shareSlug(post?.brand || 'matcha');
    return `chakaiki-${handle}-${brand}.png`;
  }, [post]);

  const onDownload = async () => {
    setBusy(true);
    try {
      const blob = await buildShareCardBlob({ post, photoUrl, layoutId, drinkIndex, blockOffsets });
      downloadShareBlob(blob, exportFilename);
    } catch (e) {
      setToast(String(e?.message || 'Download failed'));
      setTimeout(() => setToast(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  const onShare = async () => {
    setBusy(true);
    try {
      const blob = await buildShareCardBlob({ post, photoUrl, layoutId, drinkIndex, blockOffsets });
      const shared = await shareShareBlob(blob, exportFilename);
      if (!shared) {
        setToast('Saved — share from your photos app');
        setTimeout(() => setToast(''), 3500);
      }
    } catch (e) {
      setToast(String(e?.message || 'Share failed'));
      setTimeout(() => setToast(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share post"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 300,
        background: theme.surface,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: window.APP_HEADER_SAFE_TOP,
        paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
          <IconClose size={20} stroke={theme.text} sw={2} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>
          Share card
        </div>
        <div style={{ width: 32 }} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          flex: 1,
          minHeight: 280,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 20px 8px',
        }}>
          <ShareDraggablePreview
            previewUrl={previewUrl}
            layoutId={layoutId}
            blockOffsets={blockOffsets}
            onOffsetsChange={setBlockOffsetsClamped}
            theme={theme}
            showDetailsBlock={showDetailsBlock}
          />
        </div>

        <div style={{ flexShrink: 0, padding: '0 16px', maxHeight: '36vh', overflowY: 'auto' }}>
          {photos.length > 1 ? (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12, overflowX: 'auto' }}>
              {photos.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPhotoIndexChange?.(i)}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 8,
                    overflow: 'hidden',
                    flexShrink: 0,
                    padding: 0,
                    border: i === photoIndex ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                    cursor: 'pointer',
                    background: theme.surface2,
                  }}
                >
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          ) : null}

          {drinks.length > 1 ? (
            <div style={{ marginBottom: 12 }}>
              <select
                value={drinkIndex}
                onChange={(e) => setDrinkIndex(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: `1px solid ${theme.border}`,
                  background: theme.card,
                  fontFamily: theme.sans,
                  fontSize: 13,
                  color: theme.text,
                }}
              >
                {drinks.map((d, i) => (
                  <option key={d.id || i} value={i}>{d.name || `Drink ${i + 1}`}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            Layout
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
            {SHARE_LAYOUTS.map((layout) => (
              <ShareLayoutThumb
                key={layout.id}
                layoutId={layout.id}
                label={layout.label}
                post={post}
                photoUrl={photoUrl}
                drinkIndex={drinkIndex}
                selected={layoutId === layout.id}
                onSelect={() => setLayoutId(layout.id)}
                theme={theme}
              />
            ))}
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '12px 16px 20px', borderTop: `1px solid ${theme.border}`, background: theme.surface }}>
          <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            disabled={busy}
            onClick={onDownload}
            style={{
              flex: 1,
              padding: '14px 16px',
              borderRadius: 999,
              border: `1px solid ${theme.border}`,
              background: theme.card,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: theme.sans,
              fontSize: 15,
              fontWeight: 600,
              color: theme.text,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <IconDownload size={18} stroke={theme.text} sw={2} />
            Download
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onShare}
            style={{
              flex: 1,
              padding: '14px 16px',
              borderRadius: 999,
              border: 'none',
              background: theme.accent,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: theme.sans,
              fontSize: 15,
              fontWeight: 600,
              color: theme.onAccent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <IconShare size={18} stroke={theme.onAccent} sw={2} />
            Share
          </button>
        </div>

        {toast ? (
          <div style={{ marginTop: 10, textAlign: 'center', fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>
            {toast}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

window.ShareCardModal = ShareCardModal;
window.buildShareCardBlob = buildShareCardBlob;
window.SHARE_LAYOUTS = SHARE_LAYOUTS;
