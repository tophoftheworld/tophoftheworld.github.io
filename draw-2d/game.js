(() => {
  const { Engine, World, Bodies, Body, Composite, Query, Vertices } = Matter;

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const engine = Engine.create();
  engine.gravity.y = 1.05;
  engine.enableSleeping = false;
  const world = engine.world;

  const ground = Bodies.rectangle(W / 2, H - 20, W + 200, 40, {
    isStatic: true,
    friction: 0.9
  });

  const leftWall = Bodies.rectangle(-20, H / 2, 40, H * 2, { isStatic: true });
  const rightWall = Bodies.rectangle(W + 20, H / 2, 40, H * 2, { isStatic: true });

  const playerWidth = 24;
  const playerHeight = 56;
  const player = Bodies.rectangle(150, 220, playerWidth, playerHeight, {
    friction: 0,
    frictionStatic: 0,
    frictionAir: 0.01,
    restitution: 0,
    density: 0.0012,
    inertia: Infinity
  });

  World.add(world, [ground, leftWall, rightWall, player]);

  const keys = {
    a: false,
    d: false,
    w: false,
    space: false
  };

  let strokePoints = [];
  let isDrawing = false;
  const drawnBodies = [];

  const moveSpeed = 3.6;
  const groundControl = 0.35;
  const airControl = 0.18;
  const idleDamping = 0.75;
  const jumpVelocity = 12.5;
  const strokeThickness = 14;
  const drawnMaterial = {
    friction: 0.6,
    frictionStatic: 0.9,
    restitution: 0,
    density: 0.0012,
    frictionAir: 0.01
  };

  function toCanvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY
    };
  }

  function simplifyPath(points, minDist) {
    if (points.length <= 2) {
      return points.slice();
    }
    const out = [points[0]];
    let last = points[0];
    for (let i = 1; i < points.length - 1; i += 1) {
      const p = points[i];
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if ((dx * dx) + (dy * dy) >= (minDist * minDist)) {
        out.push(p);
        last = p;
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function createStrokeBody(rawPoints) {
    const points = simplifyPath(rawPoints, 8);
    if (points.length < 2) {
      return null;
    }

    const ribbon = buildStrokeRibbon(points, strokeThickness);
    if (!ribbon || ribbon.length < 3) {
      return null;
    }

    const area = Math.abs(Vertices.area(ribbon));
    if (area < 80) {
      return null;
    }

    const centroid = Vertices.centre(ribbon);
    const localVertices = ribbon.map((v) => ({
      x: v.x - centroid.x,
      y: v.y - centroid.y
    }));

    const body = Bodies.fromVertices(centroid.x, centroid.y, [localVertices], {
      friction: drawnMaterial.friction,
      frictionStatic: drawnMaterial.frictionStatic,
      restitution: drawnMaterial.restitution,
      density: drawnMaterial.density,
      frictionAir: drawnMaterial.frictionAir
    }, true);
    if (!body) {
      return null;
    }

    body.renderMeta = { color: "#88b9ff" };
    return body;
  }

  function buildStrokeRibbon(points, thickness) {
    const half = thickness * 0.5;
    const left = [];
    const right = [];

    for (let i = 0; i < points.length; i += 1) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.0001) {
        dx = 1;
        dy = 0;
      } else {
        dx /= len;
        dy /= len;
      }

      const nx = -dy;
      const ny = dx;
      left.push({ x: points[i].x + (nx * half), y: points[i].y + (ny * half) });
      right.push({ x: points[i].x - (nx * half), y: points[i].y - (ny * half) });
    }

    return left.concat(right.reverse());
  }

  canvas.addEventListener("mousedown", (evt) => {
    isDrawing = true;
    strokePoints = [];
    strokePoints.push(toCanvasPoint(evt));
  });

  canvas.addEventListener("mousemove", (evt) => {
    if (!isDrawing) {
      return;
    }
    strokePoints.push(toCanvasPoint(evt));
  });

  window.addEventListener("mouseup", () => {
    if (!isDrawing) {
      return;
    }
    isDrawing = false;
    const strokeBody = createStrokeBody(strokePoints);
    if (strokeBody) {
      drawnBodies.push(strokeBody);
      World.add(world, strokeBody);
    }
    strokePoints = [];
  });

  window.addEventListener("keydown", (evt) => {
    const k = evt.key.toLowerCase();
    if (k === "a" || k === "d" || k === "w") {
      keys[k] = true;
      evt.preventDefault();
    }
    if (evt.code === "Space") {
      keys.space = true;
      evt.preventDefault();
    }
  });

  window.addEventListener("keyup", (evt) => {
    const k = evt.key.toLowerCase();
    if (k === "a" || k === "d" || k === "w") {
      keys[k] = false;
      evt.preventDefault();
    }
    if (evt.code === "Space") {
      keys.space = false;
      evt.preventDefault();
    }
  });

  function isGrounded() {
    const probe = {
      min: { x: player.bounds.min.x + 2, y: player.bounds.max.y + 1 },
      max: { x: player.bounds.max.x - 2, y: player.bounds.max.y + 4 }
    };
    const hits = Query.region(Composite.allBodies(world), probe);
    for (let i = 0; i < hits.length; i += 1) {
      const body = hits[i];
      if (body !== player) {
        return true;
      }
    }
    return false;
  }

  function updatePlayer() {
    const movingLeft = keys.a;
    const movingRight = keys.d;
    const wantsJump = keys.w || keys.space;
    const grounded = isGrounded();

    if (movingLeft && !movingRight) {
      const control = grounded ? groundControl : airControl;
      const targetVx = -moveSpeed;
      const nextVx = player.velocity.x + ((targetVx - player.velocity.x) * control);
      Body.setVelocity(player, { x: nextVx, y: player.velocity.y });
    } else if (movingRight && !movingLeft) {
      const control = grounded ? groundControl : airControl;
      const targetVx = moveSpeed;
      const nextVx = player.velocity.x + ((targetVx - player.velocity.x) * control);
      Body.setVelocity(player, { x: nextVx, y: player.velocity.y });
    } else {
      Body.setVelocity(player, { x: player.velocity.x * idleDamping, y: player.velocity.y });
    }

    if (wantsJump && grounded) {
      Body.setVelocity(player, { x: player.velocity.x, y: -jumpVelocity });
    }
  }

  function drawBody(body, fillStyle = "#6e89d8", strokeStyle = "#c4d5ff") {
    const verts = body.vertices;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i += 1) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawPlayerStickFigure() {
    const x = player.position.x;
    const y = player.position.y;
    const angle = player.angle;
    const torso = playerHeight * 0.42;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.arc(0, -torso - 10, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -torso + 2);
    ctx.lineTo(0, 8);
    ctx.moveTo(0, -torso + 12);
    ctx.lineTo(-10, -torso + 20);
    ctx.moveTo(0, -torso + 12);
    ctx.lineTo(10, -torso + 20);
    ctx.moveTo(0, 8);
    ctx.lineTo(-9, 24);
    ctx.moveTo(0, 8);
    ctx.lineTo(9, 24);
    ctx.stroke();

    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    drawBody(ground, "#35523b", "#9cd1a5");

    for (let i = 0; i < drawnBodies.length; i += 1) {
      const b = drawnBodies[i];
      if (b.parts && b.parts.length > 1) {
        for (let p = 1; p < b.parts.length; p += 1) {
          drawBody(b.parts[p], b.renderMeta?.color || "#88b9ff", "#d7e7ff");
        }
      } else {
        drawBody(b, b.renderMeta?.color || "#88b9ff", "#d7e7ff");
      }
    }

    if (isDrawing && strokePoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(strokePoints[0].x, strokePoints[0].y);
      for (let i = 1; i < strokePoints.length; i += 1) {
        ctx.lineTo(strokePoints[i].x, strokePoints[i].y);
      }
      ctx.strokeStyle = "#ffea7f";
      ctx.lineWidth = strokeThickness;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }

    drawPlayerStickFigure();
  }

  function gameLoop() {
    updatePlayer();
    Engine.update(engine, 1000 / 60);
    render();
    requestAnimationFrame(gameLoop);
  }

  gameLoop();
})();
