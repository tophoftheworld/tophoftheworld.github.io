// Placeholder tile — subtle diagonal stripes + mono caption
function Placeholder({ label = 'photo', hue = 120, radius = 0, style = {} }) {
  const id = `ph-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      borderRadius: radius, overflow: 'hidden',
      background: `oklch(0.92 0.025 ${hue})`,
      ...style,
    }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="10" stroke={`oklch(0.86 0.03 ${hue})`} strokeWidth="1.2"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase',
        color: `oklch(0.45 0.04 ${hue})`, opacity: 0.75,
      }}>{label}</div>
    </div>
  );
}

window.Placeholder = Placeholder;
