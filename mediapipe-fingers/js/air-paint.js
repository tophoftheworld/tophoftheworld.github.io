(function () {
  const COLORS = [
    { name: "Mint", hex: 0x6ee7b7 },
    { name: "Lilac", hex: 0xa5b4fc },
    { name: "Coral", hex: 0xfb7185 },
    { name: "Gold", hex: 0xfbbf24 },
    { name: "Sky", hex: 0x38bdf8 },
    { name: "White", hex: 0xf8fafc },
  ];

  const BASE_RADIUS = 14;
  const MIN_SEGMENT = 4;
  const depthCal = HandsRuntime.createDepthCalibrator();
  const depthOpts = { calibrator: depthCal, zFar: -360, zNear: 240 };

  const stage = document.getElementById("stage");
  const webglCanvas = document.getElementById("webgl");
  const depthLabel = document.getElementById("depthLabel");
  const colorPicksEl = document.getElementById("colorPicks");

  let colorIdx = 0;
  let scene, camera, renderer;
  let rotGroup, strokeGroup;
  let viewW = 1;
  let viewH = 1;

  let activeStroke = null;
  let lastRotatePinch = null;

  const _va = new THREE.Vector3();
  const _vb = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _pinchView = new THREE.Vector3();
  const _pinchLocal = new THREE.Vector3();

  COLORS.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = c.name;
    btn.style.background = "#" + c.hex.toString(16).padStart(6, "0");
    btn.setAttribute("aria-label", c.name);
    btn.addEventListener("click", () => setColor(i));
    colorPicksEl.appendChild(btn);
  });

  function setColor(i) {
    colorIdx = i;
    [...colorPicksEl.children].forEach((btn, j) => btn.classList.toggle("active", j === i));
  }
  setColor(0);

  /** Thickness follows depth slightly (far = thinner), but Z position is the main depth cue. */
  function strokeRadius(aligned) {
    const t = aligned.depth01;
    return BASE_RADIUS * (0.5 + 0.65 * t);
  }

  function formatDepthLabel(aligned) {
    const pct = Math.round(aligned.depth01 * 100);
    if (aligned.depth01 < 0.28) return `far · ${pct}%`;
    if (aligned.depth01 > 0.72) return `near · ${pct}%`;
    return `mid · ${pct}%`;
  }

  function makeMaterial() {
    const hex = COLORS[colorIdx].hex;
    return new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.38,
      metalness: 0.12,
      emissive: hex,
      emissiveIntensity: 0.08,
    });
  }

  function disposeMesh(mesh) {
    strokeGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  function addSphere(point, radius) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 14, 14),
      makeMaterial()
    );
    mesh.position.copy(point);
    strokeGroup.add(mesh);
    return mesh;
  }

  function addTube(a, b, rA, rB) {
    _vb.subVectors(b, a);
    const len = _vb.length();
    if (len < 0.4) return null;

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rB, rA, len, 14, 1),
      makeMaterial()
    );
    _va.copy(a).addScaledVector(_vb, 0.5);
    mesh.position.copy(_va);
    mesh.quaternion.setFromUnitVectors(_up, _vb.normalize());
    strokeGroup.add(mesh);
    return mesh;
  }

  /** View-fixed pinch → local coords inside rotGroup so draw stays under your finger while sculpture spins. */
  function alignedToStrokeLocal(aligned) {
    _pinchView.set(aligned.x, aligned.y, aligned.z);
    rotGroup.updateMatrixWorld(true);
    _pinchLocal.copy(_pinchView);
    rotGroup.worldToLocal(_pinchLocal);
    return _pinchLocal;
  }

  function appendStrokePoint(aligned) {
    const p = alignedToStrokeLocal(aligned).clone();
    const r = strokeRadius(aligned);

    if (!activeStroke) {
      activeStroke = { last: null, lastR: r };
      addSphere(p, r);
      activeStroke.last = p;
      activeStroke.lastR = r;
      return;
    }

    if (activeStroke.last.distanceTo(p) < MIN_SEGMENT) return;

    addTube(activeStroke.last, p, activeStroke.lastR, r);
    addSphere(p, r);
    activeStroke.last = p;
    activeStroke.lastR = r;
  }

  function endStroke() {
    activeStroke = null;
  }

  function clearAll() {
    endStroke();
    while (strokeGroup.children.length) {
      const m = strokeGroup.children[0];
      disposeMesh(m);
    }
    rotGroup.rotation.set(0, 0, 0);
    lastRotatePinch = null;
    depthCal.reset();
  }

  function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
    camera.position.z = 1000;

    renderer = new THREE.WebGLRenderer({
      canvas: webglCanvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    rotGroup = new THREE.Group();
    strokeGroup = new THREE.Group();
    rotGroup.add(strokeGroup);
    scene.add(rotGroup);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(0.3, 0.6, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa5b4fc, 0.35);
    fill.position.set(-0.5, -0.3, 0.5);
    scene.add(fill);

    resizeThree();
    window.addEventListener("resize", resizeThree);
    renderer.setAnimationLoop(() => renderer.render(scene, camera));
  }

  function resizeThree() {
    const rect = stage.getBoundingClientRect();
    viewW = rect.width;
    viewH = rect.height;
    renderer.setSize(viewW, viewH, false);
    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
  }

  function drawPinchMarker(ctx, screen, color, label) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color + "44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (label) {
      ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(label, screen.x + 18, screen.y + 4);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "c" || e.key === "C") setColor((colorIdx + 1) % COLORS.length);
    if (e.key === "r" || e.key === "R") clearAll();
  });

  initThree();

  initExperiment({
    maxHands: 2,
    onResults: ({ ctx, hands, size, mirror }) => {
      const tracked = hands.map((hand) => {
        depthCal.observe(hand);
        return {
          hand,
          onRight: HandsRuntime.isScreenRightSide(hand, mirror),
          pinching: HandsRuntime.isPinching(hand),
          aligned: HandsRuntime.pinchToAligned(hand, size.width, size.height, mirror, depthOpts),
        };
      });

      let rightPinching = false;
      let leftRotating = false;

      for (const { hand, onRight, pinching, aligned } of tracked) {
        HandsRuntime.drawHandSkeleton(
          ctx,
          hand,
          size.width,
          size.height,
          mirror,
          pinching ? (onRight ? "#6ee7b7" : "#a5b4fc") : "#6ee7b744"
        );
      }

      // Apply rotation before converting draw points into rotated local space
      for (const { onRight, pinching, aligned } of tracked) {
        if (!pinching || onRight) continue;
        leftRotating = true;
        drawPinchMarker(ctx, aligned.screen, "#a5b4fc", "rotate");
        if (lastRotatePinch) {
          const dx = aligned.x - lastRotatePinch.x;
          const dy = aligned.y - lastRotatePinch.y;
          rotGroup.rotation.y += dx * 0.012;
          rotGroup.rotation.x += dy * 0.012;
          rotGroup.rotation.x = Math.max(-1.1, Math.min(1.1, rotGroup.rotation.x));
        }
        lastRotatePinch = { x: aligned.x, y: aligned.y };
      }

      for (const { onRight, pinching, aligned } of tracked) {
        if (!pinching || !onRight) continue;
        rightPinching = true;
        const hex = "#" + COLORS[colorIdx].hex.toString(16).padStart(6, "0");
        drawPinchMarker(ctx, aligned.screen, hex, "");
        depthLabel.textContent = formatDepthLabel(aligned);
        appendStrokePoint(aligned);
      }

      if (!rightPinching) endStroke();
      if (!leftRotating) lastRotatePinch = null;
      if (!rightPinching) depthLabel.textContent = "—";
    },
  });
})();
