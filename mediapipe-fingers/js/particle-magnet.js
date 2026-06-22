(function () {
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("particles");
  const modeLabel = document.getElementById("modeLabel");
  const COUNT = 2200;
  let attract = true;
  let wasPinching = false;
  let attractors = [];

  function syncCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  let size = syncCanvas();
  const particles = Array.from({ length: COUNT }, () => ({
    x: Math.random() * size.width,
    y: Math.random() * size.height,
    vx: 0,
    vy: 0,
    hue: 140 + Math.random() * 100,
  }));

  window.addEventListener("resize", () => {
    size = syncCanvas();
  });

  function step() {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(12,14,20,0.22)";
    ctx.fillRect(0, 0, size.width, size.height);

    const sign = attract ? 1 : -1;
    for (const p of particles) {
      for (const a of attractors) {
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        const d2 = dx * dx + dy * dy + 120;
        const force = (sign * 420) / d2;
        p.vx += (dx / Math.sqrt(d2)) * force;
        p.vy += (dy / Math.sqrt(d2)) * force;
      }
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      if (p.x < 0) p.x = size.width;
      if (p.x > size.width) p.x = 0;
      if (p.y < 0) p.y = size.height;
      if (p.y > size.height) p.y = 0;
      ctx.fillStyle = `hsla(${p.hue}, 75%, 62%, 0.65)`;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    requestAnimationFrame(step);
  }
  step();

  initExperiment({
    maxHands: 2,
    onResults: ({ ctx, hands, size: s, mirror }) => {
      size = s;
      attractors = [];
      let anyPinch = false;

      for (const hand of hands) {
        HandsRuntime.drawHandSkeleton(ctx, hand, size.width, size.height, mirror, "#818cf6aa");
        if (HandsRuntime.isPinching(hand)) anyPinch = true;
        for (const i of HandsRuntime.FINGER_TIPS) {
          const p = HandsRuntime.normToCanvas(hand[i], size.width, size.height, mirror);
          attractors.push(p);
          ctx.strokeStyle = attract ? "#6ee7b7" : "#f87171";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (anyPinch && !wasPinching) {
        attract = !attract;
        modeLabel.textContent = attract ? "Attract" : "Repel";
      }
      wasPinching = anyPinch;
    },
  });
})();
