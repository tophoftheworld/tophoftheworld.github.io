(function () {
  const NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
  const FREQ = {
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
    G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25,
  };

  const stage = document.getElementById("stage");
  const keysCanvas = document.getElementById("keys");
  const noteLabel = document.getElementById("noteLabel");
  let audioCtx = null;
  let activeNote = null;
  let activeOsc = null;

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  document.body.addEventListener("click", ensureAudio, { once: true });

  function syncKeysCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    keysCanvas.width = Math.floor(rect.width * dpr);
    keysCanvas.height = Math.floor(rect.height * dpr);
    const ctx = keysCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  let size = syncKeysCanvas();
  window.addEventListener("resize", () => {
    size = syncKeysCanvas();
  });

  function keyRects() {
    const pad = 24;
    const top = size.height * 0.55;
    const h = size.height - top - pad;
    const w = (size.width - pad * 2) / NOTES.length;
    return NOTES.map((note, i) => ({
      note,
      x: pad + i * w,
      y: top,
      w: w - 4,
      h,
    }));
  }

  function drawKeys(highlight) {
    const ctx = keysCanvas.getContext("2d");
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "rgba(12,14,20,0.55)";
    ctx.fillRect(0, size.height * 0.52, size.width, size.height * 0.48);

    for (const k of keyRects()) {
      const lit = highlight === k.note;
      ctx.fillStyle = lit ? "#6ee7b7" : "#e8ecf4";
      ctx.strokeStyle = lit ? "#6ee7b7" : "#2a3348";
      ctx.lineWidth = 2;
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(k.x + r, k.y);
      ctx.lineTo(k.x + k.w - r, k.y);
      ctx.quadraticCurveTo(k.x + k.w, k.y, k.x + k.w, k.y + r);
      ctx.lineTo(k.x + k.w, k.y + k.h);
      ctx.lineTo(k.x, k.y + k.h);
      ctx.lineTo(k.x, k.y + r);
      ctx.quadraticCurveTo(k.x, k.y, k.x + r, k.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = lit ? "#0c0e14" : "#8b95ab";
      ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(k.note, k.x + k.w / 2, k.y + k.h - 14);
    }
  }

  function playNote(note) {
    ensureAudio();
    if (activeNote === note) return;
    stopNote();
    activeNote = note;
    noteLabel.textContent = note;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = FREQ[note];
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + 0.02);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    activeOsc = { osc, gain };
  }

  function stopNote() {
    if (!activeOsc) return;
    const { osc, gain } = activeOsc;
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
    osc.stop(audioCtx.currentTime + 0.08);
    activeOsc = null;
    activeNote = null;
  }

  function hitTest(tip) {
    for (const k of keyRects()) {
      if (tip.x >= k.x && tip.x <= k.x + k.w && tip.y >= k.y && tip.y <= k.y + k.h) return k.note;
    }
    return null;
  }

  drawKeys(null);

  initExperiment({
    maxHands: 1,
    onResults: ({ ctx, hands, size: s, mirror }) => {
      size = s;
      let note = null;
      if (hands.length) {
        const hand = hands[0];
        HandsRuntime.drawHandSkeleton(ctx, hand, size.width, size.height, mirror);
        const tip = HandsRuntime.drawFingerCursor(ctx, hand, 1, size.width, size.height, mirror);
        note = hitTest(tip);
      } else {
        stopNote();
      }

      if (note) playNote(note);
      else stopNote();
      drawKeys(note);
    },
  });
})();
