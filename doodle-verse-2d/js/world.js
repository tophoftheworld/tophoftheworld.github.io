/** @param {import('matter-js')} Matter */
export function createLevel(Matter, engine) {
  const { Bodies, Composite } = Matter;
  const thick = 60;
  const worldW = 4200;
  const worldH = 900;
  const groundY = worldH - thick * 0.5;

  const ground = Bodies.rectangle(worldW * 0.5, groundY, worldW + 400, thick, {
    isStatic: true,
    friction: 0.85,
    label: 'ground',
    plugin: { footSolid: true },
  });

  const platforms = [
    Bodies.rectangle(520, groundY - 140, 220, 18, {
      isStatic: true,
      friction: 0.9,
      label: 'platform',
      plugin: { footSolid: true },
    }),
    Bodies.rectangle(980, groundY - 260, 180, 18, {
      isStatic: true,
      friction: 0.9,
      label: 'platform',
      plugin: { footSolid: true },
    }),
    Bodies.rectangle(1500, groundY - 200, 260, 18, {
      isStatic: true,
      friction: 0.9,
      label: 'platform',
      plugin: { footSolid: true },
    }),
    Bodies.rectangle(2100, groundY - 320, 200, 18, {
      isStatic: true,
      friction: 0.9,
      label: 'platform',
      plugin: { footSolid: true },
    }),
  ];

  // T-pose ragdoll: torso sy with feet near ground top (groundY is rect center; thick/2 = surface).
  const groundTop = groundY - thick * 0.5;
  const spawn = { x: 220, y: groundTop - 89 };

  Composite.add(engine.world, [ground, ...platforms]);

  return {
    worldW,
    worldH,
    groundY,
    spawn,
    bounds: { minX: 0, minY: 0, maxX: worldW, maxY: worldH },
    bodies: { ground, platforms },
  };
}

export function drawBackground(ctx, level, camera) {
  const { view } = camera;
  const g = ctx.createLinearGradient(0, 0, 0, view.height);
  g.addColorStop(0, '#dcebff');
  g.addColorStop(0.42, '#b9d9f2');
  g.addColorStop(1, '#9ec9e8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.save();
  ctx.translate(-camera.x * 0.08, -camera.y * 0.04);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  for (let i = 0; i < 18; i++) {
    const x = (i * 210) % (level.worldW + 400) - 200;
    const y = 40 + (i % 4) * 70;
    ctx.beginPath();
    ctx.ellipse(x, y, 80, 24, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(-camera.x * 0.02, 0);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(0, level.groundY - 40, level.worldW, level.worldH);
  ctx.restore();
}
