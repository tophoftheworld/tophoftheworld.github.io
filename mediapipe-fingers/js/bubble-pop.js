(function () {
  const stage = document.getElementById("stage");
  const game = document.getElementById("game");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const timerEl = document.getElementById("timer");

  let score = 0;
  let combo = 1;
  let timeLeft = 60;
  let bubbles = [];
  let pops = [];
  let lastSpawn = 0;
  let gameOver = false;

  function syncGameCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    game.width = Math.floor(rect.width * dpr);
    game.height = Math.floor(rect.height * dpr);
    const ctx = game.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  let size = syncGameCanvas();
  window.addEventListener("resize", () => {
    size = syncGameCanvas();
  });

  function spawnBubble() {
    const r = 18 + Math.random() * 28;
    bubbles.push({
      x: r + Math.random() * (size.width - r * 2),
      y: size.height + r,
      r,
      vy: -(0.6 + Math.random() * 1.2),
      hue: 150 + Math.random() * 80,
    });
  }

  function getFingerTips(hand, mirror) {
    return HandsRuntime.FINGER_TIPS.map((i) =>
      HandsRuntime.normToCanvas(hand[i], size.width, size.height, mirror)
    );
  }

  function drawGame() {
    const ctx = game.getContext("2d");
    ctx.clearRect(0, 0, size.width, size.height);

    for (const b of bubbles) {
      const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 0, b.x, b.y, b.r);
      g.addColorStop(0, `hsla(${b.hue}, 80%, 75%, 0.9)`);
      g.addColorStop(0.7, `hsla(${b.hue}, 70%, 55%, 0.35)`);
      g.addColorStop(1, `hsla(${b.hue}, 70%, 50%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${b.hue}, 90%, 90%, 0.5)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    for (const p of pops) {
      p.life -= 0.04;
      if (p.life <= 0) continue;
      ctx.fillStyle = `rgba(255,255,255,${p.life})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.4 - p.life), 0, Math.PI * 2);
      ctx.fill();
    }
    pops = pops.filter((p) => p.life > 0);

    if (gameOver) {
      ctx.fillStyle = "rgba(12,14,20,0.75)";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "600 28px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Time! Score: ${score}`, size.width / 2, size.height / 2);
      ctx.font = "14px Segoe UI, system-ui, sans-serif";
      ctx.fillStyle = "#8b95ab";
      ctx.fillText("Refresh to play again", size.width / 2, size.height / 2 + 32);
    }
  }

  setInterval(() => {
    if (gameOver) return;
    timeLeft -= 1;
    timerEl.textContent = String(Math.max(0, timeLeft));
    if (timeLeft <= 0) gameOver = true;
  }, 1000);

  let animId;
  function tick() {
    const now = performance.now();
    if (!gameOver) {
      if (now - lastSpawn > 520 - Math.min(280, score * 3)) {
        spawnBubble();
        lastSpawn = now;
      }
      for (const b of bubbles) b.y += b.vy;
      bubbles = bubbles.filter((b) => b.y + b.r > -20);
    }
    drawGame();
    animId = requestAnimationFrame(tick);
  }
  tick();

  initExperiment({
    maxHands: 2,
    onResults: ({ ctx, hands, size: s, mirror }) => {
      size = s;
      const tips = [];
      for (const hand of hands) {
        HandsRuntime.drawHandSkeleton(ctx, hand, size.width, size.height, mirror, "#818cf888");
        tips.push(...getFingerTips(hand, mirror));
        for (const t of getFingerTips(hand, mirror)) {
          ctx.fillStyle = "#fbbf24";
          ctx.beginPath();
          ctx.arc(t.x, t.y, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (gameOver) return;

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        let hit = false;
        for (const t of tips) {
          if (Math.hypot(t.x - b.x, t.y - b.y) < b.r + 12) {
            hit = true;
            break;
          }
        }
        if (hit) {
          score += 10 * combo;
          combo = Math.min(8, combo + 1);
          scoreEl.textContent = String(score);
          comboEl.textContent = `×${combo}`;
          pops.push({ x: b.x, y: b.y, r: b.r, life: 1 });
          bubbles.splice(i, 1);
        } else if (b.y + b.r < 0) {
          combo = 1;
          comboEl.textContent = "×1";
          bubbles.splice(i, 1);
        }
      }
    },
  });
})();
