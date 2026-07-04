/**
 * Shared MediaPipe Hands + webcam bootstrap for finger experiments.
 */
(function (global) {
  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
  ];

  const FINGER_TIPS = [4, 8, 12, 16, 20];

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z || 0) - (b.z || 0);
    return Math.hypot(dx, dy, dz);
  }

  function mirrorX(x, mirror) {
    return mirror ? 1 - x : x;
  }

  function palmScale(hand) {
    return Math.hypot(hand[0].x - hand[9].x, hand[0].y - hand[9].y) || 0.1;
  }

  function normToCanvas(lm, width, height, mirror) {
    return {
      x: mirrorX(lm.x, mirror) * width,
      y: lm.y * height,
      z: lm.z || 0,
    };
  }

  function normToWorld(lm, mirror, opts = {}) {
    const xSpan = opts.xSpan ?? 8;
    const ySpan = opts.ySpan ?? 5;
    const zScale = opts.zScale ?? 18;
    const x = mirrorX(lm.x, mirror);
    return {
      x: x * xSpan - xSpan / 2,
      y: -(lm.y * ySpan - ySpan / 2),
      z: -(lm.z || 0) * zScale,
    };
  }

  function getPinchCenter(hand, mirror, worldOpts) {
    const mid = {
      x: (hand[4].x + hand[8].x) / 2,
      y: (hand[4].y + hand[8].y) / 2,
      z: ((hand[4].z || 0) + (hand[8].z || 0)) / 2,
    };
    return worldOpts ? normToWorld(mid, mirror, worldOpts) : mid;
  }

  function isScreenRightSide(hand, mirror) {
    return mirrorX(hand[0].x, mirror) > 0.5;
  }

  function createDepthCalibrator() {
    let min = null;
    let max = null;
    return {
      observe(handOrPalm) {
        const p = typeof handOrPalm === "number" ? handOrPalm : palmScale(handOrPalm);
        if (min === null) {
          min = p;
          max = p;
          return;
        }
        min = Math.min(min, p);
        max = Math.max(max, p);
        if (max - min < 0.045) max = min + 0.045;
      },
      normalize(handOrPalm) {
        const p = typeof handOrPalm === "number" ? handOrPalm : palmScale(handOrPalm);
        if (min === null) return 0.5;
        return Math.max(0, Math.min(1, (p - min) / (max - min)));
      },
      reset() {
        min = null;
        max = null;
      },
    };
  }

  function pinchToAligned(hand, width, height, mirror, depthOpts = {}) {
    const mid = getPinchCenter(hand, mirror, null);
    const screen = normToCanvas(mid, width, height, mirror);
    const palm = palmScale(hand);
    const cal = depthOpts.calibrator;
    if (cal) cal.observe(hand);

    const depth01 = cal ? cal.normalize(hand) : 0.5;
    const zFar = depthOpts.zFar ?? -340;
    const zNear = depthOpts.zNear ?? 220;
    const z = zFar + depth01 * (zNear - zFar);

    return {
      screen,
      x: screen.x - width / 2,
      y: height / 2 - screen.y,
      z,
      depth01,
      palm,
    };
  }

  function pinchStrength(hand) {
    const d = dist(hand[4], hand[8]);
    const limit = palmScale(hand) * 0.35;
    return 1 - Math.min(1, d / limit);
  }

  function isPinching(hand) {
    const d = dist(hand[4], hand[8]);
    return d < palmScale(hand) * 0.35;
  }

  function countExtendedFingers(hand) {
    const wrist = hand[0];
    let count = 0;
    const tips = [8, 12, 16, 20];
    const pips = [6, 10, 14, 18];
    for (let i = 0; i < tips.length; i++) {
      if (hand[tips[i]].y < hand[pips[i]].y - 0.02) count++;
    }
    const thumbOut = hand[4].x < hand[3].x ? hand[4].x < wrist.x - 0.04 : hand[4].x > wrist.x + 0.04;
    if (thumbOut) count++;
    return count;
  }

  function isFist(hand) {
    return countExtendedFingers(hand) === 0;
  }

  function isPeace(hand) {
    const indexUp = hand[8].y < hand[6].y - 0.02;
    const middleUp = hand[12].y < hand[10].y - 0.02;
    const ringDown = hand[16].y > hand[14].y;
    const pinkyDown = hand[20].y > hand[18].y;
    return indexUp && middleUp && ringDown && pinkyDown;
  }

  function isOpenPalm(hand) {
    return countExtendedFingers(hand) >= 4;
  }

  function drawHandSkeleton(ctx, hand, width, height, mirror, color = "#6ee7b7") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = normToCanvas(hand[a], width, height, mirror);
      const p2 = normToCanvas(hand[b], width, height, mirror);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    for (const i of FINGER_TIPS) {
      const p = normToCanvas(hand[i], width, height, mirror);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFingerCursor(ctx, hand, fingerIndex, width, height, mirror, color = "#fbbf24", radius = 14) {
    const tipIdx = fingerIndex === 0 ? 4 : [8, 12, 16, 20][fingerIndex - 1];
    const p = normToCanvas(hand[tipIdx], width, height, mirror);
    ctx.strokeStyle = color;
    ctx.fillStyle = color + "44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return p;
  }

  async function startHands(opts) {
    const { video, overlay, onResults, maxHands = 2 } = opts;
    const loadingEl = document.getElementById("loading");

    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: maxHands,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results) => {
      if (loadingEl) loadingEl.classList.add("hidden");
      if (overlay) {
        const ctx = overlay.getContext("2d");
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
      onResults(results);
    });

    const camera = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: 1280,
      height: 720,
    });

    await camera.start();
    return { hands, camera };
  }

  function resizeCanvasToStage(canvas, stage) {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  global.HandsRuntime = {
    HAND_CONNECTIONS,
    FINGER_TIPS,
    dist,
    palmScale,
    mirrorX,
    normToCanvas,
    normToWorld,
    getPinchCenter,
    isScreenRightSide,
    createDepthCalibrator,
    pinchToAligned,
    pinchStrength,
    isPinching,
    countExtendedFingers,
    isFist,
    isPeace,
    isOpenPalm,
    drawHandSkeleton,
    drawFingerCursor,
    startHands,
    resizeCanvasToStage,
  };
})(window);
