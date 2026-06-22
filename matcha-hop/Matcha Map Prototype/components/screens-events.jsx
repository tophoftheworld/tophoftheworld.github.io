// Events tab — collapsed calendar, merchant thumbnails, simplified categories

function eventTypeLabel(type) {
  return { popup: 'Pop-up', workshop: 'Workshop', fest: 'Matcha Fest', crawl: 'Meetup / Crawl' }[type] || type;
}

function eventTypeColor(type, theme) {
  const map = {
    popup:    'oklch(0.58 0.18 260)',
    workshop: 'oklch(0.56 0.16 30)',
    fest:     theme.accent,
    crawl:    'oklch(0.55 0.14 200)',
  };
  return map[type] || theme.accent;
}

function formatEventDate(date) {
  if (!date) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

// ── Mini Calendar (collapsible) ────────────────────────────────────────
function MiniCalendar({ events, selectedDate, onSelectDate, theme }) {
  const today = new Date(2026, 4, 8);
  const [viewMonth, setViewMonth] = React.useState(new Date(2026, 4, 1));
  const year  = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventDays = new Set(
    events.filter(e => e.date.getMonth() === month && e.date.getFullYear() === year)
      .map(e => e.date.getDate())
  );

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ padding: '0 16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <IconBack size={15} stroke={theme.muted} sw={2} />
        </button>
        <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: theme.text }}>
          {viewMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
        </div>
        <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <IconChevron size={15} stroke={theme.muted} sw={2} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 3 }}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontFamily: theme.sans, fontSize: 10, fontWeight: 600, color: theme.muted, padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const hasEvent = eventDays.has(day);
          const isSelected = selectedDate && selectedDate.getDate() === day && selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
          return (
            <button key={day} type="button" onClick={() => onSelectDate(new Date(year, month, day))} style={{
              height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isSelected ? theme.accent : isToday ? theme.accentLight : 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              position: 'relative', gap: 2,
            }}>
              <span style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: isToday || isSelected ? 700 : 400, color: isSelected ? '#fff' : isToday ? theme.accent : theme.text }}>
                {day}
              </span>
              {hasEvent && !isSelected && (
                <div style={{ width: 3, height: 3, borderRadius: '50%', background: theme.accent }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Merchant thumbnails strip ──────────────────────────────────────────
function MerchantThumbs({ merchantIds, theme }) {
  const merchants = merchantIds.map(id => BRANDS.find(b => b.id === id)).filter(Boolean);
  if (!merchants.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {merchants.slice(0, 5).map((b, i) => {
          const photo = b.branches?.[0]?.photoUrl;
          return (
            <div key={b.id} style={{
              width: 28, height: 28, borderRadius: '50%',
              overflow: 'hidden', flexShrink: 0,
              border: `2px solid ${theme.card}`,
              marginLeft: i === 0 ? 0 : -8,
              background: theme.surface2,
              zIndex: merchants.length - i,
              position: 'relative',
            }}>
              {photo
                ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
              }
            </div>
          );
        })}
        {merchants.length > 5 && (
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: theme.surface2, border: `2px solid ${theme.card}`, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 0 }}>
            <span style={{ fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: theme.muted }}>+{merchants.length - 5}</span>
          </div>
        )}
      </div>
      <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, minWidth: 0 }}>
        {merchants.length === 1
          ? merchants[0].name
          : `${merchants.slice(0, 2).map(b => b.name).join(', ')}${merchants.length > 2 ? ` +${merchants.length - 2}` : ''}`
        }
      </div>
    </div>
  );
}

// ── Event Card ─────────────────────────────────────────────────────────
function EventCard({ event, theme, onOpen }) {
  const color = eventTypeColor(event.type, theme);
  const isPopup = event.type === 'popup';
  const isOngoing = event.status === 'ongoing';

  // Popup: show "[Brand] @ [Venue]"
  const displayTitle = isPopup && event.merchantIds?.length === 1
    ? `${BRANDS.find(b => b.id === event.merchantIds[0])?.name || event.title} @ ${event.subtitle || event.location}`
    : event.title;

  return (
    <button type="button" onClick={onOpen} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: 10 }}>
      <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', background: theme.card }}>
        <div style={{ height: 96, position: 'relative' }}>
          {event.coverPhoto
            ? <img src={event.coverPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Placeholder label="" hue={event.coverHue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
          }
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(0,0,0,0.55) 0%, transparent 65%)' }} />
          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '10px 12px' }}>
            <div style={{ display: 'flex', gap: 5 }}>
              <span style={{ padding: '2px 7px', borderRadius: 999, background: color, fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: 0.4 }}>
                {eventTypeLabel(event.type).toUpperCase()}
              </span>
              {isOngoing && (
                <span style={{ padding: '2px 7px', borderRadius: 999, background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)', fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: 0.4 }}>
                  NOW
                </span>
              )}
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.25, textWrap: 'pretty', maxWidth: '70%' }}>
              {displayTitle}
            </div>
          </div>
        </div>

        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <IconCalendar size={11} stroke={theme.muted} sw={1.6} />
                <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>
                  {formatEventDate(event.date)}{event.endDate && event.endDate.getDate() !== event.date.getDate() ? ` – ${formatEventDate(event.endDate)}` : ''} · {event.timeLabel}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <IconPin size={11} stroke={theme.muted} sw={1.6} />
                <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.location}</span>
              </div>
            </div>
          </div>
          <MerchantThumbs merchantIds={event.merchantIds} theme={theme} />
        </div>
      </div>
    </button>
  );
}

// ── Submit Event Modal ─────────────────────────────────────────────────
function SubmitEventModal({ theme, onClose }) {
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState('popup');
  const [location, setLocation] = React.useState('');
  const [dateStr, setDateStr] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const fInput = { width: '100%', padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, boxSizing: 'border-box' };

  if (submitted) {
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
        <div style={{ width: '100%', maxWidth: 340, borderRadius: 20, padding: 24, background: theme.card, border: `1px solid ${theme.border}` }} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <IconCheck size={22} stroke={theme.accent} sw={2.5} />
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 700, color: theme.text, marginBottom: 6 }}>Event submitted!</div>
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, lineHeight: 1.5 }}>Your event will appear once approved by the team.</div>
          </div>
          <button type="button" onClick={onClose} style={{ width: '100%', padding: '13px', borderRadius: 999, border: 'none', background: theme.accent, color: '#fff', fontFamily: theme.sans, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ width: '100%', borderRadius: '20px 20px 0 0', background: theme.card, border: `1px solid ${theme.border}`, padding: '20px 20px 36px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 700, color: theme.text }}>Add an event</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><IconClose size={20} stroke={theme.muted} /></button>
        </div>

        {/* Type first */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 7 }}>Type</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              ['popup',    'Pop-up',         'Brand appearing at a market or venue'],
              ['workshop', 'Workshop',       'Educational or guided tasting session'],
              ['fest',     'Matcha Fest',    'Multi-brand festival or bazaar'],
              ['crawl',    'Meetup / Crawl', 'Community crawl across multiple spots'],
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
        </div>

        {type === 'popup' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Brand / Merchant</div>
            <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Uji House" style={fInput} />
            <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 4 }}>Will appear as "[Brand] @ [Venue]"</div>
          </div>
        )}

        {type !== 'popup' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Event name</div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Metro Matcha Fest 2026" style={fInput} />
          </div>
        )}

        {[
          { label: 'Venue / Location', value: location, setter: setLocation, placeholder: 'e.g. BGC High Street' },
        ].map(({ label, value, setter, placeholder }) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>{label}</div>
            <input value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} style={fInput} />
          </div>
        ))}

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Date</div>
          <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} style={fInput} />
        </div>

        <button type="button" disabled={!(type === 'popup' ? brand.trim() : title.trim()) || !location.trim()} onClick={() => setSubmitted(true)} style={{ width: '100%', padding: '14px', borderRadius: 999, border: 'none', background: (type === 'popup' ? brand.trim() : title.trim()) && location.trim() ? theme.accent : theme.border, color: (type === 'popup' ? brand.trim() : title.trim()) && location.trim() ? '#fff' : theme.muted, fontFamily: theme.sans, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          Submit for review
        </button>
      </div>
    </div>
  );
}

// ── Events Screen ──────────────────────────────────────────────────────
function EventsScreen({ theme, onOpenEvent }) {
  const [selectedDate, setSelectedDate] = React.useState(null);
  const [filterType, setFilterType] = React.useState('all');
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const [showSubmit, setShowSubmit] = React.useState(false);

  const filtered = EVENTS.filter(e => {
    const matchesType = filterType === 'all' || e.type === filterType;
    const matchesDate = !selectedDate || (e.date.getDate() === selectedDate.getDate() && e.date.getMonth() === selectedDate.getMonth());
    return matchesType && matchesDate;
  });

  const ongoingEvents = EVENTS.filter(e => e.status === 'ongoing');

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      {/* Header */}
      <div style={{ padding: 'max(8px, env(safe-area-inset-top, 0px)) 16px 0', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 24, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>Events</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setCalendarOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, border: `1px solid ${calendarOpen ? theme.accent : theme.border}`, background: calendarOpen ? theme.accentLight : theme.surface2, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: calendarOpen ? theme.accent : theme.text }}>
              <IconCalendar size={13} stroke={calendarOpen ? theme.accent : theme.text} sw={1.8} />
              {selectedDate ? formatEventDate(selectedDate) : 'Calendar'}
              {selectedDate && <button type="button" onClick={e => { e.stopPropagation(); setSelectedDate(null); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', marginLeft: 2 }}><IconClose size={10} stroke={theme.accent} sw={2.5} /></button>}
            </button>
            <button type="button" onClick={() => setShowSubmit(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}>
              <IconPlus size={12} stroke={theme.accent} sw={2.5} />
              Add
            </button>
          </div>
        </div>

        {/* Collapsible calendar */}
        {calendarOpen && (
          <div style={{ paddingTop: 12, borderTop: `1px solid ${theme.border}`, animation: 'fadeIn 160ms ease' }}>
            <MiniCalendar events={EVENTS} selectedDate={selectedDate} onSelectDate={d => { setSelectedDate(prev => prev && prev.getTime() === d.getTime() ? null : d); }} theme={theme} />
          </div>
        )}

        {/* Category filter chips */}
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 10, paddingTop: calendarOpen ? 4 : 8 }}>
          {[['all','All'],['popup','Pop-ups'],['fest','Matcha Fests'],['workshop','Workshops'],['crawl','Meetups / Crawls']].map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setFilterType(id)} style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 999, border: `1.5px solid ${filterType === id ? theme.accent : theme.border}`, background: filterType === id ? theme.accentLight : 'none', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: filterType === id ? theme.accent : theme.muted, cursor: 'pointer' }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 90px' }}>
        {/* Ongoing now */}
        {ongoingEvents.length > 0 && !selectedDate && filterType === 'all' && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Happening now</div>
            {ongoingEvents.map(e => <EventCard key={e.id} event={e} theme={theme} onOpen={() => onOpenEvent(e.id)} />)}
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 6 }}>Upcoming</div>
          </div>
        )}

        {filtered.filter(e => e.status !== 'ongoing' || filterType !== 'all' || selectedDate).length === 0 && ongoingEvents.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>
            No events {selectedDate ? 'on this date' : 'in this category'}.
          </div>
        )}

        {filtered.filter(e => filterType !== 'all' || selectedDate || e.status !== 'ongoing').map(e => (
          <EventCard key={e.id} event={e} theme={theme} onOpen={() => onOpenEvent(e.id)} />
        ))}
      </div>

      {showSubmit && <SubmitEventModal theme={theme} onClose={() => setShowSubmit(false)} />}
    </div>
  );
}

// ── Event Detail Screen ────────────────────────────────────────────────
function EventDetailScreen({ theme, eventId, onBack, onOpenBrand }) {
  const event = EVENTS.find(e => e.id === eventId) || EVENTS[0];
  const merchants = event.merchantIds.map(id => BRANDS.find(b => b.id === id)).filter(Boolean);
  const color = eventTypeColor(event.type, theme);
  const isPopup = event.type === 'popup';

  const displayTitle = isPopup && merchants.length === 1
    ? `${merchants[0].name} @ ${event.subtitle || event.location}`
    : event.title;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
          <IconBack size={20} stroke={theme.text} sw={2} />
        </button>
        <div style={{ flex: 1, fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>Event</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 30 }}>
        {/* Hero */}
        <div style={{ height: 200, position: 'relative' }}>
          {event.coverPhoto
            ? <img src={event.coverPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Placeholder label="" hue={event.coverHue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
          }
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)' }} />
          <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16 }}>
            <span style={{ padding: '4px 10px', borderRadius: 999, background: color, fontFamily: theme.sans, fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: 0.4, display: 'inline-block', marginBottom: 6 }}>
              {eventTypeLabel(event.type).toUpperCase()}
            </span>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2, textWrap: 'pretty' }}>{displayTitle}</div>
          </div>
        </div>

        <div style={{ padding: '16px 16px 0' }}>
          {/* Info card */}
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: '14px 16px', background: theme.card, marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <IconCalendar size={14} stroke={theme.accent} sw={1.8} />
                </div>
                <div>
                  <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>
                    {formatEventDate(event.date)}{event.endDate && event.endDate.getDate() !== event.date.getDate() ? ` – ${formatEventDate(event.endDate)}` : ''}
                  </div>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{event.timeLabel}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <IconPin size={14} stroke={theme.accent} sw={1.8} />
                </div>
                <div>
                  <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{event.location}</div>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{event.address}</div>
                </div>
              </div>
            </div>
          </div>

          {event.description && (
            <p style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.65, color: theme.text, margin: '0 0 20px', textWrap: 'pretty' }}>{event.description}</p>
          )}

          {/* Merchants — checklist style */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              {merchants.length > 1 ? `${merchants.length} Merchants` : 'Merchant'}
            </div>
            {merchants.map(b => {
              const tried = userTriedBrand(b.id);
              const photo = b.branches?.[0]?.photoUrl;
              const postCount = POSTS.filter(p => p.brandId === b.id).length;
              return (
                <button key={b.id} type="button" onClick={() => onOpenBrand(b.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 13px', background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: theme.surface2, position: 'relative' }}>
                    {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.accent }}>{b.name}</div>
                    <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 1, textTransform: 'capitalize' }}>{b.kind} · {b.area}</div>
                  </div>
                  {/* Tried indicator */}
                  <div style={{ display: 'flex', flex: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {tried ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: theme.accentLight, border: `1.5px solid ${theme.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <IconCheck size={12} stroke={theme.accent} sw={2.5} />
                        </div>
                        <span style={{ fontFamily: theme.sans, fontSize: 9, color: theme.accent, fontWeight: 600 }}>Tried</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', border: `1.5px dashed ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: theme.border }} />
                        </div>
                        <span style={{ fontFamily: theme.sans, fontSize: 9, color: theme.muted, fontWeight: 500 }}>Not yet</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, paddingBottom: 10 }}>
            Submitted by <span style={{ fontWeight: 600, color: theme.text }}>@{event.submittedBy}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { EventsScreen, EventDetailScreen });
