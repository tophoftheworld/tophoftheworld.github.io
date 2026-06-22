/** Shared experiment page bootstrap */
function initExperiment({ maxHands = 2, onResults, onResize }) {
  const stage = document.getElementById("stage");
  const video = document.getElementById("webcam");
  const overlay = document.getElementById("overlay");
  const mirror = true;

  let size = HandsRuntime.resizeCanvasToStage(overlay, stage);

  function handleResize() {
    size = HandsRuntime.resizeCanvasToStage(overlay, stage);
    if (onResize) onResize(size);
  }

  window.addEventListener("resize", handleResize);

  HandsRuntime.startHands({
    video,
    overlay,
    maxHands,
    onResults: (results) => {
      const ctx = overlay.getContext("2d");
      const hands = results.multiHandLandmarks || [];
      onResults({ ctx, hands, size, mirror, results });
    },
  });

  return { stage, video, overlay, getSize: () => size, mirror };
}
