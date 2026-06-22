(function () {
  const TARGETS = [
    { id: "fist", label: "Fist", emoji: "✊", test: (h) => HandsRuntime.isFist(h) },
    { id: "peace", label: "Peace", emoji: "✌️", test: (h) => HandsRuntime.isPeace(h) },
    { id: "palm", label: "Open palm", emoji: "🖐️", test: (h) => HandsRuntime.isOpenPalm(h) },
    { id: "one", label: "1 finger", emoji: "☝️", test: (h) => HandsRuntime.countExtendedFingers(h) === 1 },
    { id: "two", label: "2 fingers", emoji: "✌️", test: (h) => HandsRuntime.countExtendedFingers(h) === 2 && !HandsRuntime.isPeace(h) },
    { id: "three", label: "3 fingers", emoji: "🤟", test: (h) => HandsRuntime.countExtendedFingers(h) === 3 },
    { id: "four", label: "4 fingers", emoji: "🖖", test: (h) => HandsRuntime.countExtendedFingers(h) === 4 },
  ];

  const scoreEl = document.getElementById("score");
  const streakEl = document.getElementById("streak");
  const timerEl = document.getElementById("timer");

  let score = 0;
  let streak = 0;
  let targetIdx = Math.floor(Math.random() * TARGETS.length);
  let timeLeft = 4;
  let lastTick = performance.now();
  let flash = 0;

  function pickTarget() {
    let next = Math.floor(Math.random() * TARGETS.length);
    while (next === targetIdx) next = Math.floor(Math.random() * TARGETS.length);
    targetIdx = next;
    timeLeft = Math.max(2.2, 4.2 - streak * 0.15);
  }

  function drawPrompt(ctx, w, h) {
    const t = TARGETS[targetIdx];
    ctx.fillStyle = "rgba(12,14,20,0.55)";
    ctx.fillRect(0, 0, w, h * 0.38);
    ctx.textAlign = "center";
    ctx.fillStyle = flash > 0 ? "#6ee7b7" : "#e8ecf4";
    ctx.font = "48px Segoe UI Emoji, Apple Color Emoji, sans-serif";
    ctx.fillText(t.emoji, w / 2, h * 0.14);
    ctx.font = "600 22px Segoe UI, system-ui, sans-serif";
    ctx.fillText(`Show: ${t.label}`, w / 2, h * 0.28);
    if (flash > 0) {
      flash -= 0.02;
      ctx.font = "600 16px Segoe UI, system-ui, sans-serif";
      ctx.fillStyle = "#6ee7b7";
      ctx.fillText("+1 Nice!", w / 2, h * 0.34);
    }
  }

  initExperiment({
    maxHands: 1,
    onResults: ({ ctx, hands, size, mirror }) => {
      const now = performance.now();
      const dt = (now - lastTick) / 1000;
      lastTick = now;
      timeLeft -= dt;
      timerEl.textContent = Math.max(0, timeLeft).toFixed(1);

      drawPrompt(ctx, size.width, size.height);

      if (hands.length) {
        const hand = hands[0];
        HandsRuntime.drawHandSkeleton(ctx, hand, size.width, size.height, mirror);
        const target = TARGETS[targetIdx];
        if (target.test(hand)) {
          score++;
          streak++;
          scoreEl.textContent = String(score);
          streakEl.textContent = String(streak);
          flash = 1;
          pickTarget();
        }
      }

      if (timeLeft <= 0) {
        streak = 0;
        streakEl.textContent = "0";
        pickTarget();
      }
    },
  });
})();
