// Court geometry & ball physics (pure, no rendering).
// Coordinates: x = lateral, y = up, z = along the court.
// The human player defends the +z half, the CPU the -z half.

export const COURT = {
  halfLength: 11.885, // baseline z
  halfWidth: 4.115, // singles sideline x
  serviceLine: 6.4,
  netHeight: 0.95,
  doublesHalfWidth: 5.485,
};

export const GRAVITY = 9.8;
export const BALL_RADIUS = 0.07;
export const RESTITUTION = 0.72; // vertical energy kept on bounce
export const BOUNCE_FRICTION = 0.78; // horizontal speed kept on bounce
export const DRAG = 0.06; // simple linear air drag (1/s)

export const SHOT = {
  weak: { depth: 5.2, speed: 13, minTime: 1.25 },
  strong: { depth: 10.4, speed: 27, minTime: 0.62 },
  serveWeak: { depth: 4.2, speed: 15, minTime: 1.0 },
  serveStrong: { depth: 5.7, speed: 30, minTime: 0.62 },
  maxAimX: 3.85,
  netClearance: 0.22,
};

export function createBall() {
  return {
    pos: { x: 0, y: 1, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Integrate ball for dt seconds. Returns an array of events
 * ({type:'bounce', x, z} | {type:'net'}) that happened during the step.
 */
export function stepBall(ball, dt, events = []) {
  const p = ball.pos;
  const v = ball.vel;
  const prevZ = p.z;
  const drag = Math.max(0, 1 - DRAG * dt);
  v.x *= drag;
  v.z *= drag;
  v.y -= GRAVITY * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  // Net collision (net plane z = 0 between posts).
  if (!ball.netted && Math.sign(prevZ) !== Math.sign(p.z) && prevZ !== 0) {
    if (p.y < COURT.netHeight + BALL_RADIUS && Math.abs(p.x) < COURT.doublesHalfWidth + 0.9) {
      ball.netted = true;
      p.z = Math.sign(prevZ) * BALL_RADIUS;
      v.z = -v.z * 0.15;
      v.x *= 0.3;
      events.push({ type: 'net' });
    }
  }

  if (p.y <= BALL_RADIUS && v.y < 0) {
    p.y = BALL_RADIUS;
    v.y = -v.y * RESTITUTION;
    v.x *= BOUNCE_FRICTION;
    v.z *= BOUNCE_FRICTION;
    if (v.y < 0.4) v.y = 0; // rolling
    events.push({ type: 'bounce', x: p.x, z: p.z });
  }
  return events;
}

/** Height of a ballistic (drag-free) path at time t. */
function heightAt(y0, vy, t) {
  return y0 + vy * t - 0.5 * GRAVITY * t * t;
}

/**
 * Compute launch velocity so that the ball travels from `from` to the ground
 * point `to` in roughly `time` seconds, while clearing the net.
 * Compensates for linear drag on the horizontal axis.
 */
export function solveLaunch(from, to, time) {
  let T = time;
  for (let i = 0; i < 40; i++) {
    const v = launchFor(from, to, T);
    // check net clearance if the path crosses z=0
    if (Math.sign(from.z) !== Math.sign(to.z) && v.z !== 0) {
      const tn = timeToTravel(-from.z, v.z);
      if (tn !== null) {
        const h = heightAt(from.y, v.y, tn);
        if (h < COURT.netHeight + SHOT.netClearance) {
          T *= 1.07;
          continue;
        }
      }
    }
    return { vel: v, time: T };
  }
  return { vel: launchFor(from, to, T), time: T };
}

// With linear drag k: x(t) = v0/k (1 - e^{-kt}) -> v0 = dx*k/(1-e^{-kT})
function launchFor(from, to, T) {
  const k = DRAG;
  const f = k > 0 ? k / (1 - Math.exp(-k * T)) : 1 / T;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = BALL_RADIUS - from.y;
  return {
    x: dx * f,
    z: dz * f,
    y: (dy + 0.5 * GRAVITY * T * T) / T,
  };
}

function timeToTravel(dist, v0) {
  const k = DRAG;
  if (k === 0) return dist / v0;
  const r = 1 - (dist * k) / v0;
  if (r <= 0) return null;
  return -Math.log(r) / k;
}

/**
 * Convert a joystick vector into a world-space aim direction for a hitter.
 * stick: {x, y} in [-1,1], y positive = "up" on the screen.
 * forward: -1 if the hitter is hitting towards -z (human), +1 for CPU.
 * Returns {x, z} unit vector (always pointing at least partly forward).
 */
export function stickToDirection(stick, forward) {
  const mag = Math.hypot(stick.x, stick.y);
  if (mag < 0.25) return null; // neutral -> let caller choose a default
  let dx = stick.x / mag;
  let df = stick.y / mag; // forward component (towards opponent)
  const minForward = 0.45;
  if (df < minForward) {
    // pointing sideways / backwards: keep lateral sense, force forward travel
    const s = Math.sign(dx) || 1;
    df = minForward;
    dx = s * Math.sqrt(1 - minForward * minForward);
  }
  return { x: dx, z: df * forward };
}

/** Map press duration to swing power in [0,1]. */
export const STRONG_PRESS_MS = 320;
export function pressToPower(ms) {
  return ms >= STRONG_PRESS_MS ? 1 : 0;
}

/**
 * Compute a rally shot.
 * from: ball position at contact; dir: {x,z} unit (or null = neutral);
 * power 0 (weak) .. 1 (strong); forward: -1 / +1; noise: aim error in m.
 */
export function computeShot(from, dir, power, forward, rand = Math.random, noise = 0) {
  const depth = lerp(SHOT.weak.depth, SHOT.strong.depth, power);
  const speed = lerp(SHOT.weak.speed, SHOT.strong.speed, power);
  const minTime = lerp(SHOT.weak.minTime, SHOT.strong.minTime, power);
  const targetZ = forward * depth;
  let targetX;
  if (!dir) {
    targetX = from.x * 0.25; // neutral: roughly down the middle
  } else {
    const dzAbs = Math.abs(targetZ - from.z);
    targetX = from.x + (dir.x / Math.abs(dir.z)) * dzAbs;
  }
  targetX = clamp(targetX, -SHOT.maxAimX, SHOT.maxAimX);
  const to = {
    x: targetX + (rand() * 2 - 1) * noise,
    z: targetZ + (rand() * 2 - 1) * noise * 0.8,
  };
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const T = Math.max(minTime, dist / speed);
  const { vel, time } = solveLaunch({ x: from.x, y: Math.max(from.y, 0.25), z: from.z }, to, T);
  return { vel, target: to, time };
}

/** Service box for a server; deuce = true on even points. */
export function serviceBox(serverIsHuman, deuce) {
  // Human serves towards -z; their right hand side is +x.
  // Receiver's deuce box is the receiver's right side.
  const f = serverIsHuman ? -1 : 1;
  const sideSign = (serverIsHuman ? -1 : 1) * (deuce ? 1 : -1);
  const xs = [0, sideSign * COURT.halfWidth].sort((a, b) => a - b);
  const zs = [0, f * COURT.serviceLine].sort((a, b) => a - b);
  return { minX: xs[0], maxX: xs[1], minZ: zs[0], maxZ: zs[1] };
}

export function serverPosition(serverIsHuman, deuce) {
  const sideSign = (serverIsHuman ? 1 : -1) * (deuce ? 1 : -1);
  return { x: sideSign * 1.1, z: (serverIsHuman ? 1 : -1) * (COURT.halfLength + 0.4) };
}

export function inBox(box, x, z, tol = BALL_RADIUS) {
  return x >= box.minX - tol && x <= box.maxX + tol && z >= box.minZ - tol && z <= box.maxZ + tol;
}

/** Is (x,z) inside the singles court half that belongs to side (+1 human, -1 cpu)? */
export function inCourtHalf(side, x, z, tol = BALL_RADIUS) {
  if (Math.abs(x) > COURT.halfWidth + tol) return false;
  if (side > 0) return z >= -tol && z <= COURT.halfLength + tol;
  return z <= tol && z >= -COURT.halfLength - tol;
}

/**
 * Serve shot: stick.x chooses the lateral spot inside the box,
 * power chooses speed/depth.
 */
export function computeServe(from, stickX, power, serverIsHuman, deuce, rand = Math.random, noise = 0) {
  const box = serviceBox(serverIsHuman, deuce);
  const f = serverIsHuman ? -1 : 1;
  const margin = 0.35;
  // stick.x is screen-relative for the human (right = +x); for CPU it's world x
  const t = (clamp(stickX, -1, 1) + 1) / 2;
  let x = lerp(box.minX + margin, box.maxX - margin, t);
  x += (rand() * 2 - 1) * noise;
  x = clamp(x, box.minX + 0.15, box.maxX - 0.15);
  const depth = lerp(SHOT.serveWeak.depth, SHOT.serveStrong.depth, power);
  const to = { x, z: f * depth };
  const speed = lerp(SHOT.serveWeak.speed, SHOT.serveStrong.speed, power);
  const minTime = lerp(SHOT.serveWeak.minTime, SHOT.serveStrong.minTime, power);
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const T = Math.max(minTime, dist / speed);
  const { vel, time } = solveLaunch(from, to, T);
  return { vel, target: to, time, box };
}

/**
 * Predict the ball path. Returns samples [{t, x, y, z, bounces}] every `dt`.
 */
export function predictPath(ball, maxTime = 3, dt = 1 / 60) {
  const b = {
    pos: { ...ball.pos },
    vel: { ...ball.vel },
    netted: ball.netted,
  };
  const out = [];
  let bounces = 0;
  const sub = 2;
  for (let t = 0; t < maxTime; t += dt) {
    for (let s = 0; s < sub; s++) {
      const ev = stepBall(b, dt / sub);
      for (const e of ev) if (e.type === 'bounce') bounces++;
    }
    out.push({ t: t + dt, x: b.pos.x, y: b.pos.y, z: b.pos.z, bounces });
    if (bounces >= 2) break;
  }
  return out;
}

/** First bounce point of the current trajectory or null. */
export function predictBounce(ball, maxTime = 4) {
  const b = { pos: { ...ball.pos }, vel: { ...ball.vel }, netted: ball.netted };
  const dt = 1 / 240;
  for (let t = 0; t < maxTime; t += dt) {
    const ev = stepBall(b, dt);
    const bounce = ev.find((e) => e.type === 'bounce');
    if (bounce) return { x: bounce.x, z: bounce.z, t };
  }
  return null;
}
