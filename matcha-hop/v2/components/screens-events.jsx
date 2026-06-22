// Events tab — list, add, detail (uses window.EVENTS / window.BRANDS)

function eventTypeLabel(type) {
  return { popup: 'Pop-up', workshop: 'Workshop', fest: 'Matcha Fest', meetup: 'Meetup', crawl: 'Meetup' }[type] || type;
}

function eventTypeColor(type, theme) {
  return theme.accent;
}

function hasRealTimeLabel(timeLabel) {
  const t = String(timeLabel || '').trim();
  return Boolean(t && t !== '—');
}

function looksLikeFullAddress(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\bPhilippines\b/i.test(t)) return true;
  if (/^\s*(blk|block|lot|unit|#)\s*\d/i.test(t)) return true;
  const commas = (t.match(/,/g) || []).length;
  if (commas >= 3) return true;
  if (commas >= 2 && /\b\d{4}\b/.test(t)) return true;
  return false;
}

function venueNeedsResolve(event) {
  const loc = String(event?.location || '').trim();
  const addr = String(event?.address || '').trim();
  if (!event?.placeId || !loc || loc === '—') return false;
  if (addr && loc !== addr) return false;
  if (!addr && looksLikeFullAddress(loc)) return true;
  if (addr && loc === addr) return true;
  return false;
}

function eventVenueFromData(event, resolved) {
  const loc = String(event?.location || '').trim();
  const addr = String(event?.address || '').trim();
  if (resolved?.name) {
    const name = String(resolved.name).trim();
    const resolvedAddr = String(resolved.address || '').trim();
    const secondary = resolvedAddr && resolvedAddr !== name
      ? resolvedAddr
      : (loc && loc !== name ? loc : (addr && addr !== name ? addr : ''));
    return { name: name || loc || '—', address: secondary };
  }
  if (loc && addr && loc !== addr) return { name: loc, address: addr };
  if (loc && !addr && !looksLikeFullAddress(loc)) return { name: loc, address: '' };
  return { name: loc || addr || '—', address: '' };
}

function useEventVenue(event) {
  const [resolved, setResolved] = React.useState(null);
  const needs = venueNeedsResolve(event);
  React.useEffect(() => {
    if (!needs || !event?.placeId) {
      setResolved(null);
      return undefined;
    }
    let cancelled = false;
    window.V2Live?.resolvePlaceLabel?.(event.placeId)
      .then((row) => { if (!cancelled && row?.name) setResolved(row); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [event?.id, event?.placeId, needs]);
  return eventVenueFromData(event, resolved);
}

function eventVenuePrimary(event) {
  return eventVenueFromData(event, null).name;
}

function eventVenueSecondary(event) {
  return eventVenueFromData(event, null).address;
}

function eventDisplayTitle(event, merchants) {
  if (!event) return '';
  const isPopup = event.type === 'popup';
  if (isPopup && event.title && merchants.length === 1) {
    const brandName = merchants[0]?.name || '';
    if (event.title !== brandName) return event.title;
    return `${brandName} @ ${event.subtitle || eventVenuePrimary(event)}`;
  }
  if (isPopup && merchants.length === 1) {
    return `${merchants[0].name} @ ${event.subtitle || eventVenuePrimary(event)}`;
  }
  return event.title;
}

function brandTilePhoto(brand) {
  const fn = window.brandGalleryTilePhoto;
  if (typeof fn === 'function') return fn(brand);
  return brand?.logoUrl || brand?.branches?.[0]?.photoUrl || null;
}

function toEventDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function stripDay(dt) {
  const d = toEventDate(dt);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function currentCalendarYear() {
  return new Date().getFullYear();
}

function eventDateShowYear(startD, endD = startD) {
  const cy = currentCalendarYear();
  return startD.getFullYear() !== cy || endD.getFullYear() !== cy;
}

function eventDateYearLabel(startD, endD) {
  const sy = startD.getFullYear();
  const ey = endD.getFullYear();
  if (sy === ey) return String(sy);
  return `${sy}–${ey}`;
}

function formatEventDate(date) {
  if (!date) return '';
  const d = toEventDate(date);
  const base = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  if (eventDateShowYear(d, d)) return `${base}, ${d.getFullYear()}`;
  return base;
}

function formatEventDateRange(start, end) {
  const startD = toEventDate(start);
  const endD = toEventDate(end);
  if (stripDay(startD) === stripDay(endD)) return formatEventDate(startD);
  const startBase = startD.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  const endBase = endD.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  if (!eventDateShowYear(startD, endD)) return `${startBase} – ${endBase}`;
  if (startD.getFullYear() === endD.getFullYear()) return `${startBase} – ${endBase}, ${startD.getFullYear()}`;
  return `${startBase}, ${startD.getFullYear()} – ${endBase}, ${endD.getFullYear()}`;
}

function dateToYmd(d) {
  const x = toEventDate(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdToDate(ymd) {
  const part = String(ymd || '').slice(0, 10);
  const [y, m, d] = part.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date();
  return new Date(y, m - 1, d);
}

function eventDateKeys(event) {
  if (Array.isArray(event.eventDates) && event.eventDates.length) {
    return event.eventDates.map((x) => String(x).slice(0, 10)).filter(Boolean);
  }
  const start = dateToYmd(toEventDate(event.date));
  const end = dateToYmd(toEventDate(event.endDate || event.date));
  const keys = [];
  const cursor = ymdToDate(start);
  const last = ymdToDate(end);
  while (cursor.getTime() <= last.getTime()) {
    keys.push(dateToYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function expandYmdRange(a, b) {
  const start = ymdToDate(a);
  const end = ymdToDate(b);
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  const out = [];
  const cursor = new Date(lo);
  while (cursor <= hi) {
    out.push(dateToYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > 366) break;
  }
  return out;
}

function datesArrayToEventPayload(dates) {
  const sorted = (Array.isArray(dates) ? dates : []).map((x) => String(x).slice(0, 10)).filter(Boolean).sort();
  if (!sorted.length) return { startDate: null, endDate: null };
  const startDate = sorted[0];
  const endDate = sorted[sorted.length - 1];
  const span = expandYmdRange(startDate, endDate);
  const isFullContiguous = span.length === sorted.length && span.every((d, i) => d === sorted[i]);
  if (!isFullContiguous && sorted.length > 1) {
    return { startDate, endDate, eventDates: sorted };
  }
  return { startDate, endDate };
}

function formatEventDatesLabel(event) {
  const keys = eventDateKeys(event);
  if (typeof window.formatPopUpDates === 'function') return window.formatPopUpDates(keys);
  if (!keys.length) return '';
  const start = ymdToDate(keys[0]);
  const end = ymdToDate(keys[keys.length - 1]);
  if (keys.length === 1 || dateToYmd(start) === dateToYmd(end)) return formatEventDate(start);
  return formatEventDateRange(start, end);
}

function effectiveEventStatus(ev) {
  const today = stripDay(new Date());
  const keys = eventDateKeys(ev);
  if (keys.length) {
    const stamps = keys.map((k) => stripDay(ymdToDate(k)));
    if (stamps.includes(today)) return 'ongoing';
    if (stamps.every((t) => t > today)) return 'upcoming';
    if (stamps.every((t) => t < today)) return 'past';
    return stamps.some((t) => t >= today) ? 'upcoming' : 'past';
  }
  const start = toEventDate(ev.date);
  const end = toEventDate(ev.endDate || ev.date);
  const t0 = today;
  const s0 = stripDay(start);
  const e0 = stripDay(end);
  if (t0 < s0) return 'upcoming';
  if (t0 > e0) return 'past';
  return 'ongoing';
}

function eventsWithEffectiveStatus() {
  const raw = Array.isArray(window.EVENTS) ? window.EVENTS : [];
  return raw.map((e) => ({ ...e, status: effectiveEventStatus(e) }));
}

function eventsForBrand(brandId) {
  if (!brandId) return [];
  const id = String(brandId);
  return eventsWithEffectiveStatus().filter((e) =>
    (e.merchantIds || []).some((m) => String(m) === id)
  );
}

function partitionEvents(events) {
  const ongoing = [];
  const upcoming = [];
  const past = [];
  (events || []).forEach((e) => {
    const status = e.status || effectiveEventStatus(e);
    const ev = { ...e, status };
    if (status === 'ongoing') ongoing.push(ev);
    else if (status === 'upcoming') upcoming.push(ev);
    else past.push(ev);
  });
  const byStart = (a, b) => stripDay(a.date) - stripDay(b.date);
  const byEndDesc = (a, b) => stripDay(b.endDate || b.date) - stripDay(a.endDate || a.date);
  ongoing.sort(byStart);
  upcoming.sort(byStart);
  past.sort(byEndDesc);
  return { ongoing, upcoming, past, activeUpcoming: [...ongoing, ...upcoming] };
}

function EventBrandGrid({ brands, theme, onOpenBrand }) {
  if (!brands?.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
      {brands.map((b) => {
        const tilePhoto = brandTilePhoto(b);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onOpenBrand(b.id)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              textAlign: 'left', display: 'grid', gridTemplateRows: 'auto auto', gap: 6,
            }}
          >
            <div style={{ aspectRatio: '1/1', width: '100%', borderRadius: 14, overflow: 'hidden' }}>
              {tilePhoto
                ? <img src={tilePhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.text, lineHeight: 1.2, textWrap: 'pretty' }}>{b.name}</div>
          </button>
        );
      })}
    </div>
  );
}

function FormSectionLabel({ theme, label, optional = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
      <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      {optional ? (
        <span style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 400, color: theme.muted, flexShrink: 0 }}>Optional</span>
      ) : null}
    </div>
  );
}

function FormSection({ children, style }) {
  return (
    <div style={{ marginBottom: 20, ...style }}>
      {children}
    </div>
  );
}

function findConsolidationCandidates({ eventName, organizer, placeId, dates, excludeId }) {
  const EVENTS = Array.isArray(window.EVENTS) ? window.EVENTS : [];
  const q1 = String(eventName || '').trim().toLowerCase();
  const q2 = String(organizer || '').trim().toLowerCase();
  if (!q1 && !q2) return [];
  return EVENTS.filter((e) => {
    if (excludeId && String(e.id) === String(excludeId)) return false;
    if (e.type === 'popup') return false;
    const titleMatch = q1 && String(e.title || '').toLowerCase().includes(q1);
    const orgMatch = q2 && String(e.organizer || '').toLowerCase().includes(q2);
    if (!titleMatch && !orgMatch) return false;
    const placeMatch = placeId && e.placeId && String(e.placeId) === String(placeId);
    const dateOverlap = (dates || []).length && eventDateKeys(e).some((k) => dates.includes(k));
    return placeMatch || dateOverlap || (!placeId && !dates?.length);
  }).slice(0, 3);
}

function FormSpinner({ color = '#fff', size = 16 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%', flexShrink: 0,
      border: `2px solid ${color}33`, borderTopColor: color,
      animation: 'spin 0.65s linear infinite',
    }} />
  );
}

function EventBrandsSheet({ theme, merchantIds, onSave, onClose }) {
  const [query, setQuery] = React.useState('');
  const [localIds, setLocalIds] = React.useState(() => (Array.isArray(merchantIds) ? [...merchantIds] : []));
  const pendingRef = React.useRef(Promise.resolve());
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];

  React.useEffect(() => {
    setLocalIds(Array.isArray(merchantIds) ? [...merchantIds] : []);
  }, [merchantIds]);

  const selected = localIds.map((id) => BRANDS.find((b) => b.id === id)).filter(Boolean);
  const results = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return BRANDS
      .filter((b) => b?.id && !localIds.includes(b.id))
      .filter((b) => String(b.name || '').toLowerCase().includes(needle))
      .slice(0, 15);
  }, [query, BRANDS, localIds]);
  const fInput = { width: '100%', padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, boxSizing: 'border-box' };

  const persistIds = (nextIds, prevIds) => {
    pendingRef.current = pendingRef.current
      .then(() => onSave(nextIds))
      .catch((e) => {
        setLocalIds(prevIds);
        window.alert(e?.message || 'Could not update brands');
      });
  };

  const addBrand = (brandId) => {
    if (!brandId || localIds.includes(brandId)) return;
    const prev = [...localIds];
    const next = [...localIds, brandId];
    setLocalIds(next);
    setQuery('');
    persistIds(next, prev);
  };

  const removeBrand = (brandId) => {
    const prev = [...localIds];
    const next = localIds.filter((id) => id !== brandId);
    setLocalIds(next);
    persistIds(next, prev);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ width: '100%', borderRadius: '20px 20px 0 0', background: theme.card, border: `1px solid ${theme.border}`, padding: '20px 20px 36px', maxHeight: '82vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexShrink: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 700, color: theme.text }}>Manage brands</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><IconClose size={20} stroke={theme.muted} /></button>
        </div>

        <div style={{ marginBottom: 14, flexShrink: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            Added{selected.length ? ` (${selected.length})` : ''}
          </div>
          <div style={{ maxHeight: 'min(32vh, 220px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingRight: 2 }}>
          {selected.length === 0 ? (
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, padding: '8px 2px 4px' }}>No brands yet. Search below to add.</div>
          ) : (
            selected.map((b) => {
              const photo = brandTilePhoto(b);
              return (
                <div key={b.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  border: `1px solid ${theme.border}`, borderRadius: 12, padding: '9px 10px',
                  background: theme.surface2, marginBottom: 8,
                }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, overflow: 'hidden', background: theme.card, flexShrink: 0 }}>
                    {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{b.name}</div>
                    <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, textTransform: 'capitalize' }}>{b.kind} · {b.area}</div>
                  </div>
                  <button type="button" onClick={() => removeBrand(b.id)} aria-label={`Remove ${b.name}`} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', flexShrink: 0 }}>
                    <IconClose size={16} stroke={theme.muted} />
                  </button>
                </div>
              );
            })
          )}
          </div>
        </div>

        <div style={{ marginBottom: 10, flexShrink: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Add more</div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brands…" style={fInput} autoFocus={selected.length === 0} />
        </div>

        <div style={{ flex: 1, minHeight: 96, overflowY: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 8 }}>
          {query.trim().length < 2 && (
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, padding: '4px 2px 12px' }}>Type at least 2 characters to search.</div>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, padding: '4px 2px 12px' }}>No matching brands.</div>
          )}
          {results.map((b) => {
            const photo = brandTilePhoto(b);
            return (
              <button key={b.id} type="button" onClick={() => addBrand(b.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                border: `1px solid ${theme.border}`, borderRadius: 12, padding: '10px 12px',
                background: theme.card, marginBottom: 8, cursor: 'pointer',
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', background: theme.surface2, flexShrink: 0 }}>
                  {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{b.name}</div>
                  <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, textTransform: 'capitalize' }}>{b.kind} · {b.area}</div>
                </div>
                <IconPlus size={16} stroke={theme.accent} sw={2.5} />
              </button>
            );
          })}
        </div>

        <button type="button" onClick={onClose} style={{ width: '100%', padding: '13px', borderRadius: 999, border: 'none', background: theme.accent, color: '#fff', fontFamily: theme.sans, fontSize: 15, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
          Done
        </button>
      </div>
    </div>
  );
}

function MerchantThumbs({ merchantIds, theme, compact = false }) {
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const merchants = (merchantIds || []).map((id) => BRANDS.find((b) => b.id === id)).filter(Boolean);
  if (!merchants.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: compact ? 1 : 4 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {merchants.slice(0, 5).map((b, i) => {
          const photo = brandTilePhoto(b);
          return (
            <div key={b.id} style={{
              width: 31, height: 31, borderRadius: '50%',
              overflow: 'hidden', flexShrink: 0,
              border: `2px solid ${theme.card}`,
              marginLeft: i === 0 ? 0 : -9,
              background: theme.surface2,
              zIndex: merchants.length - i,
              position: 'relative',
            }}>
              {photo
                ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
            </div>
          );
        })}
        {merchants.length > 5 && (
          <div style={{ width: 31, height: 31, borderRadius: '50%', background: theme.surface2, border: `2px solid ${theme.card}`, marginLeft: -9, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 0 }}>
            <span style={{ fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: theme.muted }}>+{merchants.length - 5}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EventInfoRow({ theme, icon, label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ width: 16, flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.3, lineHeight: 1.2 }}>{label}</div>
        <div style={{ marginTop: 3 }}>{children}</div>
      </div>
    </div>
  );
}

function EventDateYearFoot({ startD, endD, theme }) {
  if (!eventDateShowYear(startD, endD)) return null;
  return (
    <div style={{
      fontFamily: theme.sans,
      fontSize: 9,
      fontWeight: 600,
      color: theme.muted,
      lineHeight: 1,
      marginTop: 3,
      textAlign: 'center',
    }}>
      {eventDateYearLabel(startD, endD)}
    </div>
  );
}

function EventDateColumn({ startD, endD, theme }) {
  const multiDay = stripDay(endD) !== stripDay(startD);
  const showYear = eventDateShowYear(startD, endD);
  const colStyle = {
    width: multiDay ? (showYear ? 66 : 62) : (showYear ? 58 : 54),
    flexShrink: 0,
    alignSelf: 'stretch',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 6px',
    background: theme.accentLight,
    borderRight: `1px solid ${theme.border}`,
  };
  const monthStyle = {
    fontFamily: theme.sans,
    fontSize: 11,
    fontWeight: 600,
    color: theme.accent,
    lineHeight: 1.1,
    textAlign: 'center',
  };
  const dayStyle = {
    fontFamily: theme.sans,
    fontSize: 22,
    fontWeight: 700,
    color: theme.text,
    lineHeight: 1,
  };
  const dashStyle = {
    fontFamily: theme.sans,
    fontSize: 12,
    fontWeight: 500,
    color: theme.muted,
    lineHeight: 1,
  };

  if (!multiDay) {
    return (
      <div style={colStyle}>
        <div style={monthStyle}>{startD.toLocaleDateString('en-PH', { month: 'short' })}</div>
        <div style={{ ...dayStyle, fontSize: 26, marginTop: 2 }}>{startD.getDate()}</div>
        <EventDateYearFoot startD={startD} endD={endD} theme={theme} />
      </div>
    );
  }

  const sameMonth = startD.getMonth() === endD.getMonth() && startD.getFullYear() === endD.getFullYear();

  if (sameMonth) {
    return (
      <div style={{ ...colStyle, width: showYear ? 58 : 54 }}>
        <div style={monthStyle}>{startD.toLocaleDateString('en-PH', { month: 'short' })}</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 3, gap: 1 }}>
          <span style={{ ...dayStyle, fontSize: 20 }}>{startD.getDate()}</span>
          <span style={dashStyle}>–</span>
          <span style={{ ...dayStyle, fontSize: 20 }}>{endD.getDate()}</span>
        </div>
        <EventDateYearFoot startD={startD} endD={endD} theme={theme} />
      </div>
    );
  }

  return (
    <div style={{ ...colStyle, width: showYear ? 60 : 56 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <div style={{ ...monthStyle, fontSize: 10 }}>{startD.toLocaleDateString('en-PH', { month: 'short' })}</div>
        <span style={{ ...dayStyle, fontSize: 18 }}>{startD.getDate()}</span>
        <span style={{ ...dashStyle, margin: '1px 0' }}>–</span>
        <div style={{ ...monthStyle, fontSize: 10 }}>{endD.toLocaleDateString('en-PH', { month: 'short' })}</div>
        <span style={{ ...dayStyle, fontSize: 18 }}>{endD.getDate()}</span>
        <EventDateYearFoot startD={startD} endD={endD} theme={theme} />
      </div>
    </div>
  );
}

function EventCard({ event, theme, onOpen }) {
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const color = eventTypeColor(event.type, theme);
  const isPopup = event.type === 'popup';
  const isOngoing = event.status === 'ongoing';
  const popupMerchants = isPopup && event.merchantIds?.length === 1
    ? [BRANDS.find((b) => b.id === event.merchantIds[0])].filter(Boolean)
    : [];
  const displayTitle = eventDisplayTitle(event, popupMerchants);
  const { name: venueName, address: venueAddr } = useEventVenue(event);
  const startD = toEventDate(event.date);
  const endD = toEventDate(event.endDate || event.date);
  const hasMerchants = (
    (event.type === 'fest' || event.type === 'meetup' || event.type === 'crawl' || event.type === 'workshop')
    && event.merchantIds?.length > 0
  );
  const thumbSize = hasMerchants ? 92 : 84;

  return (
    <button type="button" onClick={onOpen} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: 10 }}>
      <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden', background: theme.card, display: 'flex', alignItems: 'stretch' }}>
        <EventDateColumn startD={startD} endD={endD} theme={theme} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: '8px 12px 8px 10px' }}>
          <div style={{
            width: thumbSize,
            height: thumbSize,
            minWidth: thumbSize,
            maxWidth: thumbSize,
            minHeight: thumbSize,
            maxHeight: thumbSize,
            flexShrink: 0,
            borderRadius: 10,
            overflow: 'hidden',
            background: theme.surface2,
          }}>
            {event.coverPhoto
              ? <img src={event.coverPhoto} alt="" style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'cover', display: 'block' }} />
              : <Placeholder label="" hue={event.coverHue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 14, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ padding: '2px 7px', borderRadius: 999, background: color, fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: 0.4, lineHeight: 1.2 }}>
              {eventTypeLabel(event.type).toUpperCase()}
            </span>
            {isOngoing && (
              <span style={{ padding: '2px 7px', borderRadius: 999, background: theme.accentLight, border: `1px solid ${theme.accent}`, fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: theme.accent, letterSpacing: 0.4, lineHeight: 1.2 }}>
                NOW
              </span>
            )}
          </div>
          <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 700, color: theme.text, lineHeight: 1.15, textWrap: 'pretty' }}>
            {displayTitle}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              <IconPin size={12} stroke={theme.muted} sw={1.7} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{venueName}</div>
              {venueAddr ? (
                <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, lineHeight: 1.15, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }}>{venueAddr}</div>
              ) : null}
            </div>
          </div>
          {hasMerchants && (
            <MerchantThumbs merchantIds={event.merchantIds} theme={theme} compact />
          )}
          </div>
        </div>
      </div>
    </button>
  );
}

function initialFormFromEvent(event, presetBrandId) {
  if (!event) {
    return {
      title: '',
      popupEventName: '',
      organizer: '',
      type: presetBrandId ? 'popup' : 'popup',
      location: '',
      address: '',
      merchantIds: presetBrandId ? [String(presetBrandId)] : [],
      dates: [],
      coverPreview: null,
      placeId: null,
      lat: null,
      lng: null,
      locationPicked: false,
    };
  }
  const type = event.type === 'crawl' ? 'meetup' : (event.type || 'fest');
  const merchantIds = Array.isArray(event.merchantIds) ? event.merchantIds.map(String) : [];
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const popupBrand = type === 'popup' && merchantIds.length === 1
    ? BRANDS.find((b) => String(b.id) === merchantIds[0])
    : null;
  const popupEventName = type === 'popup' && popupBrand && event.title && event.title !== popupBrand.name
    ? (event.title || '')
    : '';
  let organizer = event.organizer || '';
  let resolvedMerchantIds = merchantIds;
  if (type === 'workshop' && merchantIds.length === 1) {
    const workshopBrand = BRANDS.find((b) => String(b.id) === merchantIds[0]);
    if (workshopBrand) {
      if (!organizer.trim() || organizer.trim() === workshopBrand.name) {
        organizer = workshopBrand.name;
      } else {
        resolvedMerchantIds = [];
      }
    }
  }
  return {
    title: type === 'popup' ? popupEventName : (event.title || ''),
    popupEventName,
    organizer,
    merchantIds: resolvedMerchantIds,
    type,
    location: event.location || '',
    address: event.address || '',
    dates: eventDateKeys(event),
    coverPreview: event.coverPhoto || null,
    placeId: event.placeId || null,
    lat: event.lat ?? null,
    lng: event.lng ?? null,
    locationPicked: Boolean(event.placeId || event.address),
  };
}

function BrandTagPicker({
  theme, fInput, locked, lockedBrandId, presetBrand, selectedBrand,
  brandQuery, setBrandQuery, brandSearchResults, brandPickerOpen, setBrandPickerOpen,
  setMerchantIds, label = 'Brand',
}) {
  return (
    <FormSection>
      <FormSectionLabel theme={theme} label={label} />
      {lockedBrandId && presetBrand ? (
        <div style={{ ...fInput, display: 'flex', alignItems: 'center', gap: 8, background: theme.accentLight, borderColor: theme.accent }}>
          <span style={{ fontWeight: 600, color: theme.text }}>{presetBrand.name}</span>
        </div>
      ) : selectedBrand && !brandPickerOpen ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2 }}>
          <div style={{ flex: 1, fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{selectedBrand.name}</div>
          <button type="button" disabled={locked} onClick={() => { setMerchantIds([]); setBrandPickerOpen(true); setBrandQuery(''); }} style={{ background: 'none', border: 'none', cursor: locked ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.accent, padding: 0 }}>Change</button>
        </div>
      ) : (
        <>
          <input value={brandQuery} disabled={locked} onChange={(e) => setBrandQuery(e.target.value)} placeholder="Search gallery brands…" style={fInput} autoFocus={brandPickerOpen} />
          {brandSearchResults.length > 0 && (
            <div style={{ marginTop: 4, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
              {brandSearchResults.map((b) => (
                <button key={b.id} type="button" disabled={locked} onClick={() => { setMerchantIds([String(b.id)]); setBrandQuery(''); setBrandPickerOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${theme.border}`, cursor: locked ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 13, color: theme.text }}>
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </FormSection>
  );
}

function OrganizerWithBrandField({
  theme, fInput, locked, organizer, setOrganizer, merchantIds, setMerchantIds, brands,
}) {
  const taggedBrand = merchantIds.length === 1
    ? brands.find((b) => String(b.id) === merchantIds[0])
    : null;
  const taggedActive = Boolean(taggedBrand && organizer.trim() === taggedBrand.name);
  const suggestions = React.useMemo(() => {
    const q = organizer.trim().toLowerCase();
    if (q.length < 2 || taggedActive) return [];
    return brands
      .filter((b) => String(b.name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [organizer, brands, taggedActive]);

  const onOrganizerChange = (value) => {
    setOrganizer(value);
    if (taggedBrand && value.trim() !== taggedBrand.name) {
      setMerchantIds([]);
    }
  };

  const pickBrand = (brand) => {
    setOrganizer(brand.name);
    setMerchantIds([String(brand.id)]);
  };

  const clearTag = () => {
    setMerchantIds([]);
    setOrganizer('');
  };

  const photo = taggedBrand ? brandTilePhoto(taggedBrand) : null;

  return (
    <FormSection style={{ position: 'relative' }}>
      <FormSectionLabel theme={theme} label="Organizer" optional />
      {taggedActive ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          borderRadius: 10, border: `1px solid ${theme.accent}`, background: theme.accentLight,
        }}>
          {photo ? (
            <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
              <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0, fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>
            {taggedBrand.name}
          </div>
          <button type="button" disabled={locked} onClick={clearTag} style={{ background: 'none', border: 'none', cursor: locked ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.muted, padding: 0 }}>
            Clear
          </button>
        </div>
      ) : (
        <>
          <input
            value={organizer}
            disabled={locked}
            onChange={(e) => onOrganizerChange(e.target.value)}
            placeholder="Name or search matcha brands…"
            style={fInput}
          />
          {suggestions.length > 0 && !locked ? (
            <div style={{
              position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 6,
              background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10,
              overflow: 'hidden', boxShadow: theme.shadowSm,
            }}>
              {suggestions.map((b) => {
                const thumb = brandTilePhoto(b);
                return (
                  <button
                    key={b.id}
                    type="button"
                    disabled={locked}
                    onClick={() => pickBrand(b)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '10px 12px', background: 'none', border: 'none',
                      borderBottom: `1px solid ${theme.border}`, cursor: locked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {thumb ? (
                      <div style={{ width: 28, height: 28, borderRadius: 7, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
                        <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    ) : null}
                    <span style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: theme.text }}>{b.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 6 }}>
            Type a custom name or pick a gallery brand from suggestions
          </div>
        </>
      )}
    </FormSection>
  );
}

function EventFormModal({ theme, onClose, event = null, onDeleted = null, presetBrandId = null, defaultType = null, onSaved = null }) {
  const isEdit = Boolean(event?.id);
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const lockedBrandId = presetBrandId ? String(presetBrandId) : null;
  const initial = initialFormFromEvent(event, lockedBrandId);
  const [title, setTitle] = React.useState(initial.title);
  const [popupEventName, setPopupEventName] = React.useState(initial.popupEventName || '');
  const [organizer, setOrganizer] = React.useState(initial.organizer || '');
  const [type, setType] = React.useState(defaultType || initial.type);
  const [location, setLocation] = React.useState(initial.location);
  const [address, setAddress] = React.useState(initial.address || '');
  const [searchTerm, setSearchTerm] = React.useState(initial.locationPicked ? '' : initial.location);
  const [locationPicked, setLocationPicked] = React.useState(initial.locationPicked);
  const [suggestions, setSuggestions] = React.useState([]);
  const [placeId, setPlaceId] = React.useState(initial.placeId);
  const [coords, setCoords] = React.useState({ lat: initial.lat, lng: initial.lng });
  const [dates, setDates] = React.useState(initial.dates);
  const [datesOpen, setDatesOpen] = React.useState(false);
  const [merchantIds, setMerchantIds] = React.useState(initial.merchantIds);
  const [brandQuery, setBrandQuery] = React.useState('');
  const [brandPickerOpen, setBrandPickerOpen] = React.useState(false);
  const [coverPreview, setCoverPreview] = React.useState(initial.coverPreview);
  const [coverFile, setCoverFile] = React.useState(null);
  const [busyAction, setBusyAction] = React.useState(null);
  const [joiningEventId, setJoiningEventId] = React.useState(null);
  const coverInputRef = React.useRef(null);
  const searchTimer = React.useRef(null);
  const latestQuery = React.useRef('');
  const locked = busyAction !== null;
  const presetBrand = lockedBrandId ? BRANDS.find((b) => String(b.id) === lockedBrandId) : null;
  const selectedBrand = merchantIds.length === 1 ? BRANDS.find((b) => String(b.id) === merchantIds[0]) : null;
  const brandSearchResults = React.useMemo(() => {
    const q = brandQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return BRANDS
      .filter((b) => b?.id && !merchantIds.includes(String(b.id)))
      .filter((b) => String(b.name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [brandQuery, BRANDS, merchantIds]);

  React.useEffect(() => {
    if (!isEdit || !event?.placeId || !window.V2Live?.resolvePlaceLabel) return undefined;
    const loc = String(event.location || '').trim();
    const addr = String(event.address || '').trim();
    if (addr && loc && loc !== addr) return undefined;
    if (!loc || (!looksLikeFullAddress(loc) && addr)) return undefined;
    let cancelled = false;
    window.V2Live.resolvePlaceLabel(event.placeId)
      .then((row) => {
        if (cancelled || !row?.name) return;
        setLocation(row.name);
        setAddress(row.address && row.address !== row.name ? row.address : loc);
        setLocationPicked(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isEdit, event?.id, event?.placeId]);

  const consolidationMatches = React.useMemo(() => {
    if (isEdit || type !== 'popup' || !merchantIds.length) return [];
    return findConsolidationCandidates({
      eventName: popupEventName,
      organizer,
      placeId,
      dates,
      excludeId: event?.id,
    });
  }, [isEdit, type, popupEventName, organizer, placeId, dates, merchantIds, event?.id]);

  const fInput = { width: '100%', padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, boxSizing: 'border-box' };

  const onLocationSearch = (v) => {
    setSearchTerm(v);
    if (locationPicked) {
      setLocation('');
      setAddress('');
      setLocationPicked(false);
    } else {
      setLocation(v);
    }
    setPlaceId(null);
    setCoords({ lat: null, lng: null });
    latestQuery.current = v;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = String(v || '').trim();
    const searchFn = window.V2Live?.searchPlacesForEvents || window.V2Live?.searchPlacesForPopUps;
    if (q.length < 2 || !searchFn) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const rows = await searchFn(q).catch(() => []);
      if (latestQuery.current !== v) return;
      setSuggestions(rows || []);
    }, 320);
  };

  const pickSuggestion = async (row) => {
    let name = String(row.name || '').trim();
    let addr = String(row.address || '').trim();
    const pid = row.placeId || null;
    if (pid && window.V2Live?.resolvePlaceLabel) {
      const resolved = await window.V2Live.resolvePlaceLabel(pid).catch(() => null);
      if (resolved?.name) name = String(resolved.name).trim();
      if (resolved?.address) addr = String(resolved.address).trim();
    }
    setLocation(name || addr);
    setAddress(addr && addr !== name ? addr : '');
    setSearchTerm('');
    setLocationPicked(true);
    setPlaceId(pid);
    setCoords({ lat: typeof row.lat === 'number' ? row.lat : null, lng: typeof row.lng === 'number' ? row.lng : null });
    setSuggestions([]);
  };

  const clearPickedLocation = () => {
    setLocation('');
    setAddress('');
    setSearchTerm('');
    setLocationPicked(false);
    setPlaceId(null);
    setCoords({ lat: null, lng: null });
  };

  const onCoverPick = (e) => {
    if (locked) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = () => setCoverPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const buildPayload = () => {
    const dateFields = datesArrayToEventPayload(dates);
    const tagBrand = type === 'popup' || type === 'workshop';
    const ids = tagBrand ? merchantIds.slice(0, 1).map(String) : [];
    const primaryBrand = ids.length === 1 ? BRANDS.find((b) => String(b.id) === ids[0]) : null;
    const venueSubtitle = (location.split(',')[0] || location).trim();
    const payload = {
      type,
      title: type === 'popup'
        ? (popupEventName.trim() || undefined)
        : title.trim(),
      brandName: type === 'popup' ? (primaryBrand?.name || '').trim() : undefined,
      subtitle: type === 'popup' ? venueSubtitle : undefined,
      organizer: organizer.trim() || undefined,
      location: location.trim(),
      address: address.trim() || undefined,
      startDate: dateFields.startDate,
      endDate: dateFields.endDate || dateFields.startDate,
      placeId: placeId || null,
      lat: coords.lat,
      lng: coords.lng,
    };
    if (tagBrand) payload.merchantIds = ids;
    if (dateFields.eventDates) payload.eventDates = dateFields.eventDates;
    if (coverFile) payload.coverPhotoFile = coverFile;
    else if (isEdit && event?.coverPhoto) payload.keepCoverPhoto = event.coverPhoto;
    return payload;
  };

  const joinExistingEvent = async (existingId) => {
    const brandId = merchantIds[0];
    if (!brandId || !existingId || locked) return;
    setJoiningEventId(existingId);
    try {
      const ev = (window.EVENTS || []).find((e) => String(e.id) === String(existingId));
      const next = [...new Set([...(ev?.merchantIds || []).map(String), String(brandId)])];
      await window.V2Live.updateEventMerchants(existingId, next);
      if (onSaved) onSaved(existingId);
      onClose();
    } catch (e) {
      window.alert(e?.message || 'Could not add brand to event');
    } finally {
      setJoiningEventId(null);
    }
  };

  const saveEvent = async () => {
    const popupOk = type === 'popup' ? merchantIds.length > 0 : true;
    const titleOk = type === 'popup' ? popupOk : title.trim();
    if (locked || !titleOk || !location.trim() || !dates.length) return;
    setBusyAction('save');
    try {
      const payload = buildPayload();
      let savedId = event?.id || null;
      if (isEdit) await window.V2Live.updateEvent(event.id, payload);
      else savedId = await window.V2Live.submitEvent(payload);
      if (onSaved) onSaved(savedId);
      onClose();
    } catch (e) {
      window.alert(e?.message || (isEdit ? 'Could not update event' : 'Could not add event'));
    } finally {
      setBusyAction(null);
    }
  };

  const removeEvent = async () => {
    if (!isEdit || locked) return;
    if (!window.confirm('Delete this event? This cannot be undone.')) return;
    setBusyAction('delete');
    try {
      await window.V2Live.deleteEvent(event.id);
      onClose();
      if (onDeleted) onDeleted();
    } catch (e) {
      window.alert(e?.message || 'Could not delete event');
    } finally {
      setBusyAction(null);
    }
  };

  const canSave = (type === 'popup' ? merchantIds.length > 0 : title.trim()) && location.trim() && dates.length > 0 && !locked;
  const saveLabel = isEdit ? 'Save changes' : 'Save';
  const busyMessage = busyAction === 'delete'
    ? 'Deleting event…'
    : (isEdit ? 'Saving changes…' : 'Saving…');
  const Calendar = window.PopUpCalendar;
  const formatDates = window.formatPopUpDates;

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={() => { if (!locked) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 540, margin: '0 auto', borderRadius: '18px 18px 0 0', background: theme.card, border: `1px solid ${theme.border}`, borderBottom: 'none', padding: '18px 18px 24px', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 700, color: theme.text }}>{isEdit ? 'Edit event' : 'Add an event'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {isEdit ? (
              <button
                type="button"
                disabled={locked}
                onClick={removeEvent}
                aria-label="Delete event"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: locked ? 'not-allowed' : 'pointer',
                  padding: 4,
                  opacity: locked ? 0.25 : 0.35,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconTrash size={15} stroke={theme.muted} sw={1.6} />
              </button>
            ) : null}
            <button type="button" disabled={locked} onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: locked ? 'not-allowed' : 'pointer', padding: '0 2px', fontSize: 22, lineHeight: 1, color: theme.muted, opacity: locked ? 0.35 : 1 }}>&times;</button>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          {locked && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10, borderRadius: 12,
              background: `${theme.card}e8`, backdropFilter: 'blur(2px)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>
              <FormSpinner color={theme.accent} size={22} />
              <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{busyMessage}</div>
            </div>
          )}

          <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, minWidth: 0, opacity: locked ? 0.55 : 1 }}>
        {!lockedBrandId && (
        <FormSection>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Type</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              ['popup', 'Pop-up', 'Brand appearing at a market or venue'],
              ['workshop', 'Workshop', 'Educational or guided tasting session'],
              ['fest', 'Matcha Fest', 'Multi-brand festival or bazaar'],
              ['meetup', 'Meetup', 'Community meetup across multiple spots'],
            ].map(([id, lbl, desc]) => (
              <button key={id} type="button" onClick={() => setType(id)} style={{
                padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                border: `1.5px solid ${type === id ? theme.accent : theme.border}`,
                background: type === id ? theme.accentLight : theme.surface2,
                cursor: 'pointer',
              }}>
                <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: type === id ? theme.accent : theme.text, marginBottom: 2 }}>{lbl}</div>
                <div style={{ fontFamily: theme.sans, fontSize: 10, color: theme.muted, lineHeight: 1.3 }}>{desc}</div>
              </button>
            ))}
          </div>
        </FormSection>
        )}

        {type === 'popup' && (
          <>
            <BrandTagPicker
              theme={theme}
              fInput={fInput}
              locked={locked}
              lockedBrandId={lockedBrandId}
              presetBrand={presetBrand}
              selectedBrand={selectedBrand}
              brandQuery={brandQuery}
              setBrandQuery={setBrandQuery}
              brandSearchResults={brandSearchResults}
              brandPickerOpen={brandPickerOpen}
              setBrandPickerOpen={setBrandPickerOpen}
              setMerchantIds={setMerchantIds}
            />
            <FormSection>
              <FormSectionLabel theme={theme} label="Event name" optional />
              <input value={popupEventName} onChange={(e) => setPopupEventName(e.target.value)} placeholder="e.g. Manila Matcha Fest" style={fInput} />
              {!popupEventName.trim() && (
                <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 6 }}>Without an event name, appears as &quot;[Brand] @ [Venue]&quot;</div>
              )}
            </FormSection>
            <FormSection style={{ marginBottom: consolidationMatches.length > 0 ? 12 : 20 }}>
              <FormSectionLabel theme={theme} label="Organizer" optional />
              <input value={organizer} onChange={(e) => setOrganizer(e.target.value)} placeholder="Who is running this?" style={fInput} />
            </FormSection>
            {consolidationMatches.length > 0 && (
              <FormSection>
                {consolidationMatches.map((ev) => (
                  <button key={ev.id} type="button" disabled={Boolean(joiningEventId)} onClick={() => joinExistingEvent(ev.id)} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 6,
                    borderRadius: 10, border: `1px solid ${theme.accent}`, background: theme.accentLight, cursor: joiningEventId ? 'not-allowed' : 'pointer',
                  }}>
                    <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.accent }}>
                      {joiningEventId === ev.id ? 'Adding…' : `Add to existing: ${ev.title}`}
                    </div>
                    <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 2 }}>Same event — avoid a duplicate page</div>
                  </button>
                ))}
              </FormSection>
            )}
          </>
        )}

        {type !== 'popup' && (
          <FormSection>
            <FormSectionLabel theme={theme} label="Event name" />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Metro Matcha Fest 2026" style={fInput} />
            {type === 'fest' && (
              <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 6 }}>Add participating brands from the event page after saving.</div>
            )}
          </FormSection>
        )}

        {type !== 'popup' && type !== 'workshop' && (
          <FormSection>
            <FormSectionLabel theme={theme} label="Organizer" optional={type === 'fest'} />
            <input value={organizer} onChange={(e) => setOrganizer(e.target.value)} placeholder="Who is organizing this?" style={fInput} />
          </FormSection>
        )}

        {type === 'workshop' && (
          <OrganizerWithBrandField
            theme={theme}
            fInput={fInput}
            locked={locked}
            organizer={organizer}
            setOrganizer={setOrganizer}
            merchantIds={merchantIds}
            setMerchantIds={setMerchantIds}
            brands={BRANDS}
          />
        )}

        <FormSection style={{ position: 'relative' }}>
          <FormSectionLabel theme={theme} label="Location" />
          {locationPicked ? (
            <div style={{ padding: '11px 13px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{location}</div>
                  {address ? <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 3, lineHeight: 1.35 }}>{address}</div> : null}
                </div>
                <button type="button" onClick={clearPickedLocation} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                  <IconClose size={16} stroke={theme.muted} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <input value={searchTerm} onChange={(e) => onLocationSearch(e.target.value)} placeholder="Search address or place" style={fInput} />
              {suggestions.length > 0 && !locked && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, marginTop: 4, overflow: 'hidden', boxShadow: theme.shadowSm }}>
                  {suggestions.map((row) => (
                    <button key={row.placeId} type="button" onClick={() => pickSuggestion(row)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${theme.border}`, cursor: 'pointer', fontFamily: theme.sans, fontSize: 13, color: theme.text }}>
                      <div style={{ fontWeight: 600 }}>{row.name}</div>
                      {row.address ? <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{row.address}</div> : null}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </FormSection>

        <FormSection>
          <FormSectionLabel theme={theme} label="Date" />
          <button type="button" onClick={() => setDatesOpen((o) => !o)} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '11px 13px', borderRadius: 10, border: `1px solid ${theme.border}`,
            background: theme.surface2, cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: dates.length ? 600 : 400, color: dates.length ? theme.text : theme.muted }}>
              {dates.length > 0 && formatDates ? formatDates(dates) : 'Tap to pick dates'}
            </div>
            <IconChevron size={14} stroke={theme.muted} sw={2} />
          </button>
          {datesOpen && Calendar ? (
            <div style={{ marginTop: 8, padding: '12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2 }}>
              <Calendar theme={theme} value={dates} onChange={setDates} disabled={locked} />
              <button type="button" onClick={() => setDatesOpen(false)} style={{ width: '100%', marginTop: 8, padding: '9px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.card, fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text, cursor: 'pointer' }}>Done</button>
            </div>
          ) : null}
        </FormSection>

        <FormSection style={{ marginBottom: 4 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Thumbnail</div>
          <input ref={coverInputRef} type="file" accept="image/*" onChange={onCoverPick} style={{ display: 'none' }} />
          <button type="button" onClick={() => coverInputRef.current?.click()} style={{
            width: '100%', padding: 12, borderRadius: 12, border: `1.5px dashed ${theme.border}`,
            background: theme.surface2, cursor: locked ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', background: theme.card, flexShrink: 0 }}>
              {coverPreview
                ? <img src={coverPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Placeholder label="" hue={120} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: theme.text }}>{coverPreview ? 'Change photo' : 'Add cover photo'}</div>
              <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 2 }}>Square works best</div>
            </div>
          </button>
        </FormSection>
          </fieldset>
        </div>

        <div style={{
          display: 'flex',
          gap: 10,
          marginTop: 20,
          paddingTop: 16,
          borderTop: `1px solid ${theme.border}`,
        }}>
          <button type="button" disabled={locked} onClick={onClose} style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: 10,
            border: `1px solid ${theme.border}`,
            background: theme.surface2,
            fontFamily: theme.sans,
            fontSize: 14,
            fontWeight: 600,
            cursor: locked ? 'not-allowed' : 'pointer',
            color: theme.text,
            opacity: locked ? 0.5 : 1,
          }}>
            Cancel
          </button>
          <button type="button" disabled={!canSave || busyAction === 'save'} onClick={saveEvent} style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: 10,
            border: 'none',
            background: theme.accent,
            color: theme.onAccent || '#fff',
            fontFamily: theme.sans,
            fontSize: 14,
            fontWeight: 600,
            cursor: (canSave && busyAction !== 'save') ? 'pointer' : 'not-allowed',
            opacity: busyAction === 'save' ? 0.65 : (canSave ? 1 : 0.45),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}>
            {busyAction === 'save' ? (
              <>
                <FormSpinner color={theme.onAccent || '#fff'} size={14} />
                {busyMessage}
              </>
            ) : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventsScreen({ theme, onOpenEvent, onOpenProfile }) {
  const [showAdd, setShowAdd] = React.useState(false);
  const [pastOpen, setPastOpen] = React.useState(false);
  const EVENTS = eventsWithEffectiveStatus();
  const { ongoing: ongoingEvents, upcoming: upcomingEvents, past: pastEvents } = partitionEvents(EVENTS);
  const Header = window.AppBrandHeader;
  const profileBtn = onOpenProfile && window.V2Live?.getProfile ? (() => {
    const prof = window.V2Live.getProfile();
    return (
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label="Open profile"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
      >
        <ProfileAvatar profile={prof} size={32} theme={theme} />
      </button>
    );
  })() : null;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      {Header ? <Header theme={theme} rightAction={profileBtn} /> : null}
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: theme.sans, fontSize: 24, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>Events</div>
          <button type="button" onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}>
            <IconPlus size={12} stroke={theme.accent} sw={2.5} />
            Add
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 90px' }}>
        {EVENTS.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>
            No events yet.
          </div>
        )}

        {ongoingEvents.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Happening now</div>
            {ongoingEvents.map((e) => <EventCard key={e.id} event={e} theme={theme} onOpen={() => onOpenEvent(e.id)} />)}
          </div>
        )}

        {upcomingEvents.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Upcoming</div>
            {upcomingEvents.map((e) => <EventCard key={e.id} event={e} theme={theme} onOpen={() => onOpenEvent(e.id)} />)}
          </div>
        )}

        {pastEvents.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setPastOpen((o) => !o)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                background: 'none', border: 'none', padding: '4px 0 10px', cursor: 'pointer',
              }}
            >
              <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Past events ({pastEvents.length})
              </div>
              <IconChevron size={14} stroke={theme.muted} sw={2} />
            </button>
            {pastOpen && pastEvents.map((e) => (
              <EventCard key={e.id} event={e} theme={theme} onOpen={() => onOpenEvent(e.id)} />
            ))}
          </div>
        )}
      </div>

      {showAdd && <EventFormModal theme={theme} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function EventDetailScreen({ theme, eventId, onBack, onOpenBrand, bottomInset = 30 }) {
  const [, refreshTick] = React.useState(0);
  const [showBrandSheet, setShowBrandSheet] = React.useState(false);
  const [showEdit, setShowEdit] = React.useState(false);
  React.useEffect(() => {
    const h = () => refreshTick((x) => x + 1);
    window.addEventListener('v2:data-updated', h);
    return () => window.removeEventListener('v2:data-updated', h);
  }, []);
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const EVENTS = eventsWithEffectiveStatus();
  const event = EVENTS.find((e) => e.id === eventId);
  const merchants = (event?.merchantIds || []).map((id) => BRANDS.find((b) => b.id === id)).filter(Boolean);
  const canManageBrands = ['fest', 'meetup', 'crawl'].includes(event?.type);
  if (!event) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 15, color: theme.muted, marginBottom: 16 }}>Event not found.</div>
        <button type="button" onClick={onBack} style={{ padding: '10px 20px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, cursor: 'pointer', fontFamily: theme.sans }}>Back</button>
      </div>
    );
  }
  const color = eventTypeColor(event.type, theme);
  const displayTitle = eventDisplayTitle(event, merchants);
  const dateLabel = formatEventDatesLabel(event);
  const { name: venueName, address: venueAddr } = useEventVenue(event);
  const showTime = hasRealTimeLabel(event.timeLabel);
  const showOrganizer = Boolean(String(event.organizer || '').trim());
  const workshopTaggedBrand = event.type === 'workshop' && merchants.length === 1 ? merchants[0] : null;
  const showBrandSection = merchants.length > 0 && !workshopTaggedBrand;

  const saveBrands = (ids) => window.V2Live.updateEventMerchants(event.id, ids);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
          <IconBack size={20} stroke={theme.text} sw={2} />
        </button>
        <div style={{ flex: 1, fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>Event</div>
        <button type="button" onClick={() => setShowEdit(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text }}>
          <IconEdit size={13} stroke={theme.text} sw={1.8} />
          Edit
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: bottomInset }}>
        <div style={{ height: 200, position: 'relative' }}>
          {event.coverPhoto
            ? <img src={event.coverPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Placeholder label="" hue={event.coverHue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)' }} />
          <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16 }}>
            <span style={{ padding: '4px 10px', borderRadius: 999, background: color, fontFamily: theme.sans, fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: 0.4, display: 'inline-block', marginBottom: 6 }}>
              {eventTypeLabel(event.type).toUpperCase()}
            </span>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2, textWrap: 'pretty' }}>{displayTitle}</div>
          </div>
        </div>

        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: '14px 16px', background: theme.card, marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <EventInfoRow
                theme={theme}
                label="Date"
                icon={<IconCalendar size={15} stroke={theme.accent} sw={1.8} />}
              >
                <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{dateLabel}</div>
                {showTime ? (
                  <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>{event.timeLabel}</div>
                ) : null}
              </EventInfoRow>
              <EventInfoRow
                theme={theme}
                label="Venue"
                icon={<IconPin size={15} stroke={theme.accent} sw={1.8} />}
              >
                <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{venueName}</div>
                {venueAddr ? (
                  <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, lineHeight: 1.35, marginTop: 2 }}>{venueAddr}</div>
                ) : null}
              </EventInfoRow>
              {showOrganizer ? (
                <EventInfoRow
                  theme={theme}
                  label="Organizer"
                  icon={<span style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 700, color: theme.accent, lineHeight: 1 }}>@</span>}
                >
                  {workshopTaggedBrand ? (
                    <button type="button" onClick={() => onOpenBrand(workshopTaggedBrand.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
                      padding: 0, cursor: 'pointer', textAlign: 'left',
                    }}>
                      {brandTilePhoto(workshopTaggedBrand) ? (
                        <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
                          <img src={brandTilePhoto(workshopTaggedBrand)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      ) : null}
                      <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.accent }}>{event.organizer}</div>
                    </button>
                  ) : (
                    <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{event.organizer}</div>
                  )}
                </EventInfoRow>
              ) : null}
            </div>
          </div>

          {event.description ? (
            <p style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.65, color: theme.text, margin: '0 0 20px', textWrap: 'pretty' }}>{event.description}</p>
          ) : null}

          {showBrandSection && merchants.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {merchants.length > 1 ? `${merchants.length} Brands` : 'Brands'}
                </div>
                {canManageBrands ? (
                  <button type="button" onClick={() => setShowBrandSheet(true)} style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999,
                    border: `1px solid ${theme.border}`, background: theme.accentLight, cursor: 'pointer',
                    fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.accent,
                  }}>
                    <IconPlus size={11} stroke={theme.accent} sw={2.5} />
                    Manage brands
                  </button>
                ) : null}
              </div>
              <EventBrandGrid brands={merchants} theme={theme} onOpenBrand={onOpenBrand} />
            </div>
          )}

          {canManageBrands && merchants.length === 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Brands</div>
                <button type="button" onClick={() => setShowBrandSheet(true)} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999,
                  border: `1px solid ${theme.border}`, background: theme.accentLight, cursor: 'pointer',
                  fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.accent,
                }}>
                  <IconPlus size={11} stroke={theme.accent} sw={2.5} />
                  Manage brands
                </button>
              </div>
              <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>No brands yet. Tap Manage brands to add.</div>
            </div>
          )}
        </div>
      </div>

      {showBrandSheet && (
        <EventBrandsSheet
          theme={theme}
          merchantIds={event.merchantIds || []}
          onSave={saveBrands}
          onClose={() => setShowBrandSheet(false)}
        />
      )}

      {showEdit && (
        <EventFormModal
          theme={theme}
          event={event}
          onClose={() => setShowEdit(false)}
          onDeleted={onBack}
        />
      )}
    </div>
  );
}

function BrandEventsListScreen({ theme, brandId, onBack, onOpenEvent }) {
  const brand = (window.BRANDS || []).find((b) => String(b.id) === String(brandId));
  const { ongoing, upcoming, past, activeUpcoming } = partitionEvents(eventsForBrand(brandId));
  const [showAdd, setShowAdd] = React.useState(false);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: window.APP_HEADER_SAFE_TOP, paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM, borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>Events</div>
            {brand?.name ? (
              <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>{brand.name}</div>
            ) : null}
          </div>
          {brand ? (
            <button type="button" onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', background: theme.accent, color: theme.onAccent || '#fff', border: 'none', borderRadius: 999, fontFamily: theme.sans, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <IconPlus size={12} stroke={theme.onAccent || '#fff'} sw={2.5} />
              Add
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 80px' }}>
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Active &amp; Upcoming
          </div>
          {activeUpcoming.length === 0 ? (
            <div style={{ padding: '28px 12px', textAlign: 'center', fontFamily: theme.sans, fontSize: 13, color: theme.muted, border: `1px dashed ${theme.border}`, borderRadius: 12 }}>
              No active or upcoming events{brand ? '. Tap Add to create one.' : '.'}
            </div>
          ) : (
            activeUpcoming.map((e) => <EventCard key={e.id} event={e} theme={theme} onOpen={() => onOpenEvent?.(e.id)} />)
          )}
        </section>

        {past.length > 0 && (
          <section>
            <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Past events
            </div>
            {past.map((e) => <EventCard key={e.id} event={e} theme={theme} onOpen={() => onOpenEvent?.(e.id)} />)}
          </section>
        )}
      </div>

      {showAdd && (
        <EventFormModal
          theme={theme}
          presetBrandId={brandId}
          defaultType="popup"
          onClose={() => setShowAdd(false)}
          onSaved={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

Object.assign(window, {
  EventsScreen,
  EventDetailScreen,
  EventFormModal,
  EventCard,
  BrandEventsListScreen,
  eventsForBrand,
  partitionEvents,
  effectiveEventStatus,
  eventDateKeys,
  formatEventDatesLabel,
  eventTypeLabel,
  eventTypeColor,
});
