(function () {
  const stage = document.getElementById("stage");
  const video = document.getElementById("webcam");
  const revealCanvas = document.getElementById("reveal");
  const powderCanvas = document.getElementById("powder");
  const clearBtn = document.getElementById("clearBtn");

  let showSkeleton = false;
  const activeStrokes = new Map();

  const powder = new PowderRenderer(stage, revealCanvas, powderCanvas, {
    realistic: true,
    video,
  });
  powder.syncSize();

  function frostLoop(now) {
    if (powder.needsFrostUpdate()) powder.refreshFrost(video, now);
    requestAnimationFrame(frostLoop);
  }
  requestAnimationFrame(frostLoop);

  function clearAll() {
    activeStrokes.clear();
    powder.reset();
  }

  function pinchScreen(hand, size, mirror) {
    const mid = HandsRuntime.getPinchCenter(hand, mirror);
    return HandsRuntime.normToCanvas(mid, size.width, size.height, mirror);
  }

  function drawPinchCursor(ctx, screen, radius) {
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  clearBtn.addEventListener("click", clearAll);

  document.addEventListener("keydown", (e) => {
    if (e.key === "c" || e.key === "C") clearAll();
    if (e.key === "h" || e.key === "H") showSkeleton = !showSkeleton;
  });

  initExperiment({
    maxHands: 2,
    onResize: () => powder.syncSize(),
    onResults: ({ ctx, hands, size, mirror }) => {
      const seen = new Set();

      for (let i = 0; i < hands.length; i++) {
        const hand = hands[i];
        const pinching = HandsRuntime.isPinching(hand);
        const screen = pinchScreen(hand, size, mirror);
        const radius = powder.brushRadius(hand, size.width);
        const key = i;

        if (showSkeleton) {
          HandsRuntime.drawHandSkeleton(
            ctx,
            hand,
            size.width,
            size.height,
            mirror,
            pinching ? "#f8f6f0" : "rgba(248,246,240,0.35)"
          );
        }

        if (pinching) {
          seen.add(key);
          drawPinchCursor(ctx, screen, radius);

          const prev = activeStrokes.get(key);
          if (prev) {
            powder.carveSegment(prev.x, prev.y, screen.x, screen.y, radius);
          } else {
            powder.carvePoint(screen.x, screen.y, radius);
          }
          activeStrokes.set(key, { x: screen.x, y: screen.y, radius });
        }
      }

      for (const key of activeStrokes.keys()) {
        if (!seen.has(key)) activeStrokes.delete(key);
      }
    },
  });
})();
