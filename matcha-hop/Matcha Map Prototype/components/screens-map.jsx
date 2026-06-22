// Map screen — pannable, centers on selected café, no filters, minimal chrome.

function MapScreen({ theme, onOpenDetail }) {
  const [selected, setSelected] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef(null);
  const containerRef = React.useRef(null);

  // Map is 2x viewport so panning has room
  const MAP_W = 750; // 2x 375
  const MAP_H = 1400; // 2x visible
  const VIEW_W = 375;
  const VIEW_H = 812;

  const clamp = (x, y) => ({
    x: Math.max(VIEW_W - MAP_W, Math.min(0, x)),
    y: Math.max(VIEW_H - MAP_H, Math.min(0, y)),
  });

  const selectedPin = PINS.find(p => p.id === selected);

  // Center a pin on screen (with room for bottom sheet)
  const centerOn = (pin) => {
    const targetX = VIEW_W / 2 - pin.x * MAP_W;
    const targetY = VIEW_H / 2 - 80 - pin.y * MAP_H; // shift up a bit for sheet
    setOffset(clamp(targetX, targetY));
  };

  const onPointerDown = (e) => {
    // Ignore drags initiated on interactive elements (pins, buttons)
    if (e.target.closest('button')) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y, moved: false };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.sx;
    const dy = e.clientY - drag.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
    setOffset(clamp(drag.current.ox + dx, drag.current.oy + dy));
  };
  const onPointerUp = (e) => {
    drag.current = null;
  };

  const handlePinClick = (pin, e) => {
    e.stopPropagation();
    setSelected(pin.id);
    centerOn(pin);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* Pannable map layer */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'absolute', inset: 0, touchAction: 'none',
          cursor: drag.current ? 'grabbing' : 'grab',
        }}
      >
        <div style={{
          position: 'absolute',
          width: MAP_W, height: MAP_H,
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          transition: drag.current ? 'none' : 'transform 420ms cubic-bezier(.2,.8,.2,1)',
        }}>
          <div style={{ position: 'absolute', inset: 0 }}><MapCanvas theme={theme} /></div>

          {/* Pins — positioned within the full map */}
          {PINS.map(pin => {
            const isSel = selected === pin.id;
            return (
              <button key={pin.id} onClick={(e) => handlePinClick(pin, e)}
                style={{
                  position: 'absolute',
                  left: pin.x * MAP_W, top: pin.y * MAP_H,
                  transform: 'translate(-50%, -100%)',
                  zIndex: isSel ? 20 : 5,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                }}>
                <MapPin pin={pin} selected={isSel} theme={theme} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Top search — no filters */}
      <div style={{
        position: 'absolute', top: 56, left: 16, right: 16, zIndex: 10,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', background: theme.card,
          border: `1px solid ${theme.border}`, borderRadius: 16,
          boxShadow: theme.shadow,
        }}>
          <IconSearch size={18} stroke={theme.muted} />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Find matcha nearby"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'none',
              fontFamily: theme.sans, fontSize: 15, fontWeight: 500,
              color: theme.text, letterSpacing: -0.1,
            }} />
          <div style={{
            padding: '3px 8px', background: theme.surface2, borderRadius: 6,
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: 11, color: theme.muted, fontWeight: 600,
          }}>{PINS.length}</div>
        </div>
      </div>

      {/* Minimal recenter icon */}
      <button
        onClick={() => setOffset({ x: 0, y: 0 })}
        style={{
          position: 'absolute', bottom: 130, right: 18, zIndex: 11,
          background: 'none', border: 'none', padding: 8, cursor: 'pointer',
          color: theme.text, filter: `drop-shadow(0 2px 6px ${theme.surface})`,
        }}>
        <IconLocate size={24} stroke={theme.text} sw={1.8} />
      </button>

      {/* Bottom sheet */}
      {selectedPin && (
        <div style={{
          position: 'absolute', bottom: 114, left: 16, right: 16, zIndex: 30,
          background: theme.card, borderRadius: 20,
          border: `1px solid ${theme.border}`,
          boxShadow: theme.shadowLg, overflow: 'hidden',
          animation: 'slideUp 280ms cubic-bezier(.2,.8,.2,1)',
        }}>
          <div style={{ display: 'flex', gap: 12, padding: 14 }}>
            <div style={{ width: 68, height: 68, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
              <Placeholder label="photo" hue={120} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{
                  fontFamily: theme.sans, fontSize: 18, fontWeight: 600,
                  color: theme.text, letterSpacing: -0.3, lineHeight: 1.2,
                }}>{selectedPin.name}</div>
                <button onClick={(e) => { e.stopPropagation(); setSelected(null); }}
                  style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}>
                  <IconClose size={16} stroke={theme.muted} />
                </button>
              </div>
              {selectedPin.sub && (
                <div style={{
                  fontFamily: theme.sans, fontSize: 13, color: theme.muted,
                  marginTop: 2, fontWeight: 500,
                }}>{selectedPin.sub}</div>
              )}
              <div style={{
                marginTop: 8, display: 'flex', gap: 10, alignItems: 'center',
                fontFamily: theme.sans, fontSize: 13, color: theme.muted, fontWeight: 500,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <IconStar size={14} filled stroke={theme.accent} />
                  <b style={{ color: theme.text, fontWeight: 600 }}>4.8</b>
                </span>
                <span>·</span>
                <span>2 visits</span>
                <span>·</span>
                <span style={{ color: theme.accent, fontWeight: 600 }}>Open</span>
              </div>
            </div>
          </div>
          <button onClick={() => onOpenDetail(selectedPin)}
            style={{
              width: '100%', padding: '14px', border: 'none',
              borderTop: `1px solid ${theme.border}`,
              background: theme.surface2, color: theme.text, cursor: 'pointer',
              fontFamily: theme.sans, fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
            }}>View location →</button>
        </div>
      )}
    </div>
  );
}

function MapPin({ pin, selected, theme }) {
  const { name, sub, fav, visited } = pin;
  let iconNode;
  const sz = 11;
  if (fav && visited) {
    iconNode = <IconHeart size={sz} stroke={selected ? theme.onAccent : theme.accent}
                          fill={selected ? theme.onAccent : theme.accent} sw={0} />;
  } else if (visited) {
    iconNode = <IconCheck size={sz} stroke={selected ? theme.onAccent : theme.accent} sw={2.5} />;
  } else if (fav) {
    iconNode = <IconStar size={sz} filled stroke={selected ? theme.onAccent : theme.accent} />;
  } else {
    iconNode = <div style={{ width: 5, height: 5, borderRadius: '50%', background: selected ? theme.onAccent : theme.muted }} />;
  }

  return (
    <div style={{
      transform: `scale(${selected ? 1 : 0.88})`,
      transition: 'transform 200ms',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        padding: '6px 11px 6px 9px',
        background: selected ? theme.accent : theme.card,
        color: selected ? theme.onAccent : theme.text,
        border: `1px solid ${selected ? theme.accent : theme.border}`,
        borderRadius: 999,
        fontFamily: theme.sans, fontSize: 13, fontWeight: 600,
        letterSpacing: -0.1, whiteSpace: 'nowrap',
        boxShadow: selected ? theme.shadowLg : theme.shadow,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 13 }}>
          {iconNode}
        </span>
        <span>{name}</span>
        {sub && <span style={{
          fontFamily: theme.sans, fontSize: 11, fontWeight: 500,
          opacity: 0.65, paddingLeft: 6,
          borderLeft: `1px solid ${selected ? 'rgba(255,255,255,0.3)' : theme.border}`,
          marginLeft: 2,
        }}>{sub}</span>}
      </div>
      <div style={{
        width: 0, height: 0, marginTop: -1,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderTop: `6px solid ${selected ? theme.accent : theme.card}`,
      }} />
    </div>
  );
}

function CircleBtn({ children, theme, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 40, height: 40, borderRadius: '50%',
      background: theme.card, border: `1px solid ${theme.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', boxShadow: theme.shadow,
    }}>{children}</button>
  );
}

window.MapScreen = MapScreen;
window.CircleBtn = CircleBtn;
