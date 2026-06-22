// Stylized monochrome green-tinted map — hand-drawn SVG, no external deps.
// Exports MapCanvas(theme) as <window.MapCanvas />

function MapCanvas({ theme }) {
  const bg = theme.mapBg;
  const water = theme.mapWater;
  const park = theme.mapPark;
  const road = theme.mapRoad;
  const road2 = theme.mapRoad2;
  const label = theme.mapLabel;

  return (
    <svg viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice"
         width="100%" height="100%" style={{ display: 'block' }}>
      <rect width="400" height="700" fill={bg} />
      {/* Park blobs */}
      <path d="M-20 120 Q60 90 130 140 T260 160 Q300 170 310 210 Q300 250 240 240 T100 260 Q20 250 -20 200 Z" fill={park} opacity="0.55"/>
      <path d="M280 480 Q340 470 380 510 Q420 560 380 620 Q320 640 280 600 Q250 540 280 480 Z" fill={park} opacity="0.55"/>
      <path d="M40 560 Q80 540 140 570 Q160 600 130 640 Q90 660 50 630 Q20 600 40 560 Z" fill={park} opacity="0.55"/>

      {/* River */}
      <path d="M-10 340 Q80 320 150 370 Q240 430 330 400 Q390 380 420 420"
            fill="none" stroke={water} strokeWidth="14" opacity="0.5" strokeLinecap="round"/>
      <path d="M-10 340 Q80 320 150 370 Q240 430 330 400 Q390 380 420 420"
            fill="none" stroke={water} strokeWidth="7" opacity="0.7" strokeLinecap="round"/>

      {/* Major roads — gentle curves */}
      <g stroke={road} strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.85">
        <path d="M-10 80 Q120 60 220 110 T420 140"/>
        <path d="M-10 220 Q90 210 180 240 T420 230"/>
        <path d="M-10 450 Q120 440 230 470 T420 480"/>
        <path d="M-10 620 Q120 610 230 640 T420 650"/>
        <path d="M80 -10 Q100 120 70 240 T100 500 Q110 620 90 720"/>
        <path d="M220 -10 Q240 120 210 260 T240 520 Q250 630 230 720"/>
        <path d="M330 -10 Q350 140 320 280 T350 560 Q360 660 340 720"/>
      </g>

      {/* Minor roads — thin hatching */}
      <g stroke={road2} strokeWidth="2" fill="none" opacity="0.6">
        <path d="M30 40 L130 90"/><path d="M150 30 L170 120"/>
        <path d="M260 50 L320 90"/><path d="M40 170 L130 200"/>
        <path d="M200 150 L300 190"/><path d="M340 170 L390 200"/>
        <path d="M30 280 L140 300"/><path d="M170 290 L260 310"/>
        <path d="M300 300 L380 330"/><path d="M40 380 L140 390"/>
        <path d="M180 400 L300 420"/><path d="M30 500 L140 520"/>
        <path d="M170 510 L280 530"/><path d="M310 520 L380 540"/>
        <path d="M30 580 L140 600"/><path d="M180 590 L280 610"/>
        <path d="M300 600 L380 620"/>
        <path d="M130 130 L130 180"/><path d="M170 140 L170 200"/>
        <path d="M260 200 L260 270"/><path d="M180 260 L180 340"/>
        <path d="M300 340 L300 420"/><path d="M130 420 L130 500"/>
        <path d="M270 480 L270 570"/><path d="M180 560 L180 640"/>
      </g>

      {/* Street labels — very subtle */}
      <g fill={label} fontFamily="'Plus Jakarta Sans', system-ui, sans-serif" fontSize="8" opacity="0.55" letterSpacing="0.4">
        <text x="150" y="85" transform="rotate(-8 150 85)">E. RODRIGUEZ</text>
        <text x="30" y="215" transform="rotate(-3 30 215)">SHAW BLVD</text>
        <text x="170" y="365" transform="rotate(18 170 365)">PASIG RIVER</text>
        <text x="240" y="445" transform="rotate(-2 240 445)">ORTIGAS AVE</text>
        <text x="100" y="615" transform="rotate(-3 100 615)">EDSA</text>
        <text x="85" y="150" transform="rotate(90 85 150)">E. ABELLO</text>
        <text x="225" y="320" transform="rotate(90 225 320)">J.P. RIZAL</text>
        <text x="335" y="380" transform="rotate(90 335 380)">MERALCO AVE</text>
      </g>
    </svg>
  );
}

window.MapCanvas = MapCanvas;
