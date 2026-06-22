const MOVE_ACCEL = 0.0062;
const MAX_RUN = 22;
const AIR_CONTROL = 0.0035;
const FRICTION_GROUND = 0.01;
const FRICTION_AIR = 0.0025;
const JUMP_VY = -13.6;

/** T-pose: horizontal arms (length × thickness in world units). */
const TORSO_W = 42; // 50% wider than original 28
const TORSO_H = 62;
const HEAD_W = 36; // 50% wider than original 24
const HEAD_H = 33; // 50% taller than original 22
/** Max head tilt from vertical (world radians) for walk / jump bob. */
const HEAD_BOB_MAX_RAD = (30 * Math.PI) / 180;
const ARM_LEN = 54;
const ARM_TH = 9;
const LEG_W = 10;
const LEG_H = 58;

const FOOT_PROBE = 20;

const LAND_RECOVER_SEC = 0.45;

/** Hold Shift to run: multiply move accel and max horizontal speed. */
const RUN_SPEED_MULT = 3;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Nudge body toward upright (angle 0). `damp` shrinks spin; `gain` pulls angle closed.
 * @param {typeof import('matter-js').Body} BodyCtor
 * @param {import('matter-js').IBody} body
 */
function uprightStabilize(BodyCtor, body, damp, gain) {
  BodyCtor.setAngularVelocity(body, body.angularVelocity * damp + (0 - body.angle) * gain);
}

/**
 * Keep head rotation within ±`maxRad` (stops ragdoll neck from folding past bob range).
 * @param {typeof import('matter-js').Body} BodyCtor
 * @param {import('matter-js').IBody} headBody
 */
function clampHeadBob(BodyCtor, headBody, maxRad) {
  const a = headBody.angle;
  if (a > maxRad) {
    BodyCtor.setAngle(headBody, maxRad);
    BodyCtor.setAngularVelocity(headBody, Math.min(0, headBody.angularVelocity));
  } else if (a < -maxRad) {
    BodyCtor.setAngle(headBody, -maxRad);
    BodyCtor.setAngularVelocity(headBody, Math.max(0, headBody.angularVelocity));
  }
}

/**
 * @param {import('matter-js').IBody[]} bodies
 */
function unionBounds(bodies) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bodies) {
    const { min, max } = b.bounds;
    minX = Math.min(minX, min.x);
    minY = Math.min(minY, min.y);
    maxX = Math.max(maxX, max.x);
    maxY = Math.max(maxY, max.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return { minX, minY, maxX, maxY, w, h, cx: (minX + maxX) * 0.5, cy: (minY + maxY) * 0.5 };
}

/**
 * @param {import('matter-js')} Matter
 * @param {import('matter-js').IEngine} engine
 * @param {{ x: number, y: number }} spawn
 * @param {Partial<Record<string, HTMLCanvasElement>> | null} [layers]
 */
export function createPlayer(Matter, engine, spawn, layers) {
  const { Bodies, Body, Composite, Constraint } = Matter;
  const sx = spawn.x;
  const sy = spawn.y;

  const group = Body.nextGroup(true);

  const partOpts = (label, extra = {}) => ({
    friction: 0.02,
    frictionAir: 0.03,
    density: 0.003,
    restitution: 0.02,
    collisionFilter: { group },
    label,
    ...extra,
  });

  const torso = Bodies.rectangle(sx, sy, TORSO_W, TORSO_H, {
    ...partOpts('playerTorso', { density: 0.005 }),
    chamfer: { radius: Math.min(10, TORSO_W * 0.22, TORSO_H * 0.22) },
  });
  Body.setMass(torso, 5.2);
  Body.setInertia(torso, torso.inertia * 1.35);

  const head = Bodies.rectangle(sx, sy - 48, HEAD_W, HEAD_H, {
    ...partOpts('playerHead'),
    chamfer: { radius: Math.min(12, HEAD_W * 0.28, HEAD_H * 0.28) },
  });

  const armL = Bodies.rectangle(sx - 46, sy - 12, ARM_LEN, ARM_TH, partOpts('playerArmL'));
  const armR = Bodies.rectangle(sx + 46, sy - 12, ARM_LEN, ARM_TH, partOpts('playerArmR'));
  const legL = Bodies.rectangle(sx - 12, sy + 60, LEG_W, LEG_H, partOpts('playerLegL'));
  const legR = Bodies.rectangle(sx + 12, sy + 60, LEG_W, LEG_H, partOpts('playerLegR'));

  const rag = Composite.create({
    label: 'playerRag',
    bodies: [torso, head, armL, armR, legL, legR],
  });

  const baseHinge = { length: 0, render: { visible: false } };

  const cNeck = Constraint.create({
    bodyA: torso,
    bodyB: head,
    pointA: { x: 0, y: -TORSO_H * 0.5 },
    pointB: { x: 0, y: HEAD_H * 0.5 },
    stiffness: 0.5,
    damping: 0.1,
    ...baseHinge,
  });
  const cArmL = Constraint.create({
    bodyA: torso,
    bodyB: armL,
    pointA: { x: -TORSO_W * 0.5 - 1, y: -TORSO_H * 0.5 + 10 },
    pointB: { x: ARM_LEN * 0.5 - 2, y: 0 },
    stiffness: 0.22,
    damping: 0.1,
    ...baseHinge,
  });
  const cArmR = Constraint.create({
    bodyA: torso,
    bodyB: armR,
    pointA: { x: TORSO_W * 0.5 + 1, y: -TORSO_H * 0.5 + 10 },
    pointB: { x: -ARM_LEN * 0.5 + 2, y: 0 },
    stiffness: 0.22,
    damping: 0.1,
    ...baseHinge,
  });
  const cLegL = Constraint.create({
    bodyA: torso,
    bodyB: legL,
    pointA: { x: -TORSO_W * 0.5 + 14, y: TORSO_H * 0.5 },
    pointB: { x: 0, y: -LEG_H * 0.5 + 3 },
    stiffness: 0.55,
    damping: 0.12,
    ...baseHinge,
  });
  const cLegR = Constraint.create({
    bodyA: torso,
    bodyB: legR,
    pointA: { x: TORSO_W * 0.5 - 14, y: TORSO_H * 0.5 },
    pointB: { x: 0, y: -LEG_H * 0.5 + 3 },
    stiffness: 0.55,
    damping: 0.12,
    ...baseHinge,
  });

  Composite.add(rag, [cNeck, cArmL, cArmR, cLegL, cLegR]);
  Composite.add(engine.world, rag);

  /** @type {Record<string, HTMLCanvasElement | undefined>} */
  const tex = layers || {};
  const partMeta = [
    { key: 'legL', body: legL, tw: LEG_W, th: LEG_H },
    { key: 'legR', body: legR, tw: LEG_W, th: LEG_H },
    { key: 'armL', body: armL, tw: ARM_LEN, th: ARM_TH },
    { key: 'armR', body: armR, tw: ARM_LEN, th: ARM_TH },
    { key: 'torso', body: torso, tw: TORSO_W, th: TORSO_H },
    { key: 'head', body: head, tw: HEAD_W, th: HEAD_H },
  ];

  for (const p of partMeta) {
    p.body.plugin = p.body.plugin || {};
    p.body.plugin.partKey = p.key;
    p.body.plugin.texture = tex[p.key];
  }

  const ragBodies = [torso, head, armL, armR, legL, legR];
  const keys = new Set();
  let grounded = false;
  let prevGrounded = true;
  let landRecover = 0;
  let walkPhase = 0;
  /** Cosmetic: mirror sprites when moving left. */
  let facingLeft = false;

  function onKeyDown(e) {
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') e.preventDefault();
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    Composite.remove(engine.world, rag);
  }

  function updateGrounded() {
    const u = unionBounds(ragBodies);
    const start = { x: u.cx, y: u.maxY };
    const end = { x: u.cx, y: u.maxY + FOOT_PROBE };
    const solids = Matter.Composite.allBodies(engine.world).filter(
      (b) => !ragBodies.includes(b) && !b.isSensor && b.plugin && b.plugin.footSolid,
    );
    const hits = Matter.Query.ray(solids, start, end, 4);
    grounded = hits.length > 0;
  }

  /**
   * Air = loose ragdoll; walk = stiff legs + stable head + light arms; idle ground = medium.
   * After landing, lerp from air → walk over LAND_RECOVER_SEC.
   */
  function applyHingeTuning(inAir, walking, landT) {
    let neckS;
    let neckD;
    let armS;
    let armD;
    let legS;
    let legD;

    const airNeck = [0.12, 0.05];
    const airArm = [0.07, 0.04];
    const airLeg = [0.08, 0.045];

    const walkNeck = [0.88, 0.16];
    const walkArm = [0.24, 0.11];
    const walkLeg = [0.96, 0.2];

    const idleNeck = [0.62, 0.11];
    const idleArm = [0.18, 0.09];
    const idleLeg = [0.78, 0.15];

    const target = inAir
      ? { neck: airNeck, arm: airArm, leg: airLeg }
      : walking
        ? { neck: walkNeck, arm: walkArm, leg: walkLeg }
        : { neck: idleNeck, arm: idleArm, leg: idleLeg };

    if (landT > 0 && !inAir) {
      const u = 1 - landT / LAND_RECOVER_SEC;
      neckS = lerp(airNeck[0], target.neck[0], u);
      neckD = lerp(airNeck[1], target.neck[1], u);
      armS = lerp(airArm[0], target.arm[0], u);
      armD = lerp(airArm[1], target.arm[1], u);
      legS = lerp(airLeg[0], target.leg[0], u);
      legD = lerp(airLeg[1], target.leg[1], u);
    } else {
      neckS = target.neck[0];
      neckD = target.neck[1];
      armS = target.arm[0];
      armD = target.arm[1];
      legS = target.leg[0];
      legD = target.leg[1];
    }

    cNeck.stiffness = neckS;
    cNeck.damping = neckD;
    cArmL.stiffness = armS;
    cArmL.damping = armD;
    cArmR.stiffness = armS;
    cArmR.damping = armD;
    cLegL.stiffness = legS;
    cLegL.damping = legD;
    cLegR.stiffness = legS;
    cLegR.damping = legD;
  }

  function update() {
    updateGrounded();
    const left = keys.has('KeyA');
    const right = keys.has('KeyD');
    const jump = keys.has('KeyW') || keys.has('Space');
    const runBoost =
      grounded && (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? RUN_SPEED_MULT : 1;

    const dt = (engine.timing.lastDelta || 1000 / 60) / 1000;
    const walking = grounded && (left || right);
    const inAir = !grounded;

    if (!prevGrounded && grounded) {
      landRecover = LAND_RECOVER_SEC;
    }
    if (landRecover > 0) {
      landRecover = Math.max(0, landRecover - dt);
    }

    applyHingeTuning(inAir, walking, landRecover);

    if (walking) {
      walkPhase += dt * 14 * (runBoost > 1 ? 1.2 : 1);
    }

    const control = (grounded ? MOVE_ACCEL : AIR_CONTROL) * runBoost;
    let ax = 0;
    if (left) ax -= control;
    if (right) ax += control;

    if (ax !== 0) {
      Body.applyForce(torso, torso.position, { x: ax, y: 0 });
    }

    const vx = torso.velocity.x;
    const cap = MAX_RUN * runBoost;
    if (vx > cap) Body.setVelocity(torso, { x: cap, y: torso.velocity.y });
    if (vx < -cap) Body.setVelocity(torso, { x: -cap, y: torso.velocity.y });

    const fric = grounded ? FRICTION_GROUND : FRICTION_AIR;
    Body.setVelocity(torso, { x: torso.velocity.x * (1 - fric), y: torso.velocity.y });

    const vxf = torso.velocity.x;
    if (right && !left) facingLeft = false;
    else if (left && !right) facingLeft = true;
    else if (vxf > 0.45) facingLeft = false;
    else if (vxf < -0.45) facingLeft = true;

    if (jump && grounded) {
      Body.setVelocity(torso, { x: torso.velocity.x, y: JUMP_VY });
      grounded = false;
    }

    if (grounded && walking) {
      uprightStabilize(Body, torso, 0.62, 0.12);
      const stride = Math.sin(walkPhase) * 0.055;
      const legDamp = 0.72;
      const legUpright = 0.06;
      Body.setAngularVelocity(
        legL,
        legL.angularVelocity * legDamp + stride + (0 - legL.angle) * legUpright,
      );
      Body.setAngularVelocity(
        legR,
        legR.angularVelocity * legDamp - stride + (0 - legR.angle) * legUpright,
      );

      Body.setAngularVelocity(
        head,
        head.angularVelocity * 0.72 +
          Math.sin(walkPhase * 1.4) * 0.0045 +
          (0 - head.angle) * 0.06,
      );
      Body.setAngularVelocity(armL, armL.angularVelocity * 0.82 + Math.sin(walkPhase) * 0.018);
      Body.setAngularVelocity(armR, armR.angularVelocity * 0.82 - Math.sin(walkPhase) * 0.018);
    } else if (grounded && !walking) {
      uprightStabilize(Body, torso, 0.74, 0.09);
      Body.setAngularVelocity(legL, legL.angularVelocity * 0.86 + (0 - legL.angle) * 0.05);
      Body.setAngularVelocity(legR, legR.angularVelocity * 0.86 + (0 - legR.angle) * 0.05);
      Body.setAngularVelocity(
        head,
        head.angularVelocity * 0.78 + (0 - head.angle) * 0.05,
      );
      Body.setAngularVelocity(armL, armL.angularVelocity * 0.88);
      Body.setAngularVelocity(armR, armR.angularVelocity * 0.88);
    } else {
      uprightStabilize(Body, torso, 0.96, 0.022);
      Body.setAngularVelocity(
        head,
        head.angularVelocity * 0.94 +
          Math.sin(engine.timing.timestamp * 0.003) * 0.003 +
          (0 - head.angle) * 0.02,
      );
    }

    clampHeadBob(Body, head, HEAD_BOB_MAX_RAD);

    prevGrounded = grounded;
  }

  function draw(ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const px = torso.position.x;
    const py = torso.position.y;

    if (facingLeft) {
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(-1, 1);
      ctx.translate(-px, -py);
    }
    for (const p of partMeta) {
      const { body: b, tw, th } = p;
      const img = b.plugin?.texture;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      if (img && img.width > 0) {
        ctx.drawImage(img, -tw * 0.5, -th * 0.5, tw, th);
      } else {
        ctx.fillStyle = 'rgba(20, 33, 61, 0.45)';
        ctx.fillRect(-tw * 0.5, -th * 0.5, tw, th);
      }
      ctx.restore();
    }
    if (facingLeft) {
      ctx.restore();
    }
  }

  return {
    body: torso,
    composite: rag,
    ragBodies,
    draw,
    dispose,
    update,
    isGrounded() {
      return grounded;
    },
    get position() {
      return torso.position;
    },
    get w() {
      return unionBounds(ragBodies).w;
    },
    get h() {
      return unionBounds(ragBodies).h;
    },
  };
}
