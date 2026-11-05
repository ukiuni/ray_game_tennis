// Match simulation: players, CPU AI, ball, rules. Rendering independent.
import {
  COURT,
  clamp,
  computeServe,
  computeShot,
  createBall,
  inBox,
  inCourtHalf,
  predictBounce,
  predictPath,
  serverPosition,
  serviceBox,
  stepBall,
  stickToDirection,
} from './physics.js';
import { addPoint, createScore, isDeuceSide } from './score.js';

export const SWING = {
  activeStart: 0.0,
  activeEnd: 0.3,
  duration: 0.42,
};
export const PLAYER_SPEED = 6.2;
export const PLAYER_REACH = 1.6;
export const CPU_REACH = 1.4;
export const POINT_PAUSE = 1.7;
const SUBSTEPS = 4;

export function difficulty(stage) {
  const s = Math.max(1, stage) - 1;
  return {
    speed: Math.min(4.0 + 0.4 * s, 7.4),
    reaction: Math.max(0.36 - 0.035 * s, 0.07),
    aimNoise: Math.max(1.0 - 0.1 * s, 0.25),
    strongProb: Math.min(0.15 + 0.08 * s, 0.75),
    angleProb: Math.min(0.2 + 0.08 * s, 0.85),
    serveNoise: Math.max(0.5 - 0.05 * s, 0.1),
    misjudge: Math.max(0.16 - 0.025 * s, 0.0), // chance to misread the ball
  };
}

function createCharacter(id, side, speed, reach) {
  return {
    id,
    side, // +1 human (+z half), -1 cpu
    pos: { x: 0, z: side * (COURT.halfLength + 0.5) },
    vel: { x: 0, z: 0 },
    speed,
    reach,
    swing: null, // {t, power, hit, kind}
    charging: false,
    chargeT: 0,
    lastDirX: 0,
  };
}

export function createMatch({ stage = 1, rand = Math.random } = {}) {
  const m = {
    stage,
    rand,
    diff: difficulty(stage),
    time: 0,
    score: createScore(),
    server: stage % 2 === 1 ? 'player' : 'cpu',
    faults: 0,
    phase: 'serve',
    phaseT: 0,
    player: createCharacter('player', 1, PLAYER_SPEED, PLAYER_REACH),
    cpu: createCharacter('cpu', -1, 0, CPU_REACH),
    ball: createBall(),
    rally: null, // {lastHitter, bounces, isServe, box}
    events: [],
    bounceMarker: null,
    ai: { plan: null, decideAt: Infinity, target: { x: 0, z: -12.3 } },
    pointWinner: null,
    hits: 0,
  };
  m.cpu.speed = m.diff.speed;
  setupServe(m);
  return m;
}

function other(who) {
  return who === 'player' ? 'cpu' : 'player';
}

function setupServe(m) {
  m.phase = 'serve';
  m.phaseT = 0;
  m.rally = null;
  m.bounceMarker = null;
  m.ai.plan = null;
  m.ai.decideAt = Infinity;
  const deuce = isDeuceSide(m.score);
  const humanServes = m.server === 'player';
  const sp = serverPosition(humanServes, deuce);
  const box = serviceBox(humanServes, deuce);
  const server = m[m.server];
  const receiver = m[other(m.server)];
  server.pos.x = sp.x;
  server.pos.z = sp.z;
  const bx = (box.minX + box.maxX) / 2;
  receiver.pos.x = bx * 0.9;
  receiver.pos.z = receiver.side * (COURT.halfLength + 0.6);
  for (const c of [m.player, m.cpu]) {
    c.vel.x = c.vel.z = 0;
    c.swing = null;
  }
  m.ai.target = { x: m.cpu.pos.x, z: m.cpu.pos.z };
  m.ball.netted = false;
  m.ball.vel = { x: 0, y: 0, z: 0 };
  holdBall(m);
}

function holdBall(m) {
  const s = m[m.server];
  const bob = Math.sin(m.phaseT * 3) * 0.12;
  // ball tossed on the server's racket side
  m.ball.pos = { x: s.pos.x + (s.side > 0 ? 0.35 : -0.35), y: 1.3 + bob, z: s.pos.z - s.side * 0.2 };
}

function emit(m, e) {
  m.events.push(e);
}

/**
 * input: { stick:{x,y}, charging:boolean, release: null | {power:0..1} }
 */
export function updateMatch(m, dt, input) {
  m.time += dt;
  m.phaseT += dt;
  if (m.phase === 'done') return;

  updatePlayer(m, dt, input);
  updateCpu(m, dt);

  if (m.phase === 'serve') {
    holdBall(m);
    if (m.server === 'cpu' && m.phaseT > 1.1 && !m.cpu.swing) {
      startSwing(m.cpu, m.rand() < m.diff.strongProb ? 1 : 0, 'serve');
    }
    for (const c of [m.player, m.cpu]) {
      if (c.swing && c.swing.kind === 'serve' && !c.swing.hit && c.swing.t >= 0.12) {
        doServe(m, c, input);
      }
    }
  } else if (m.phase === 'rally') {
    const h = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS && m.phase === 'rally'; i++) {
      const ev = stepBall(m.ball, h);
      for (const e of ev) handleBallEvent(m, e);
      if (m.phase !== 'rally') break;
      checkHits(m, input);
      checkOut(m);
    }
  } else if (m.phase === 'point') {
    stepBall(m.ball, dt);
    if (m.phaseT >= POINT_PAUSE) {
      if (m.score.winner) {
        m.phase = 'done';
        emit(m, { type: 'match', winner: m.score.winner });
      } else {
        setupServe(m);
      }
    }
  }
}

function startSwing(c, power, kind = 'rally') {
  c.swing = { t: 0, power, hit: false, kind };
}

function updateSwing(c, dt) {
  if (!c.swing) return;
  c.swing.t += dt;
  if (c.swing.t >= SWING.duration) c.swing = null;
}

function updatePlayer(m, dt, input) {
  const p = m.player;
  updateSwing(p, dt);
  p.charging = !!input.charging;
  const stick = input.stick || { x: 0, y: 0 };
  if (Math.abs(stick.x) > 0.2) p.lastDirX = Math.sign(stick.x);
  let sx = stick.x;
  let sy = stick.y;
  const mag = Math.hypot(sx, sy);
  if (mag > 1) {
    sx /= mag;
    sy /= mag;
  }
  let speed = p.speed * (p.charging ? 0.85 : 1);
  if (m.phase === 'serve' && m.server === 'player') {
    // the server may only shuffle along the baseline on the correct side
    p.vel.x = sx * speed * 0.6;
    p.vel.z = 0;
  } else if (m.phase === 'point' || m.phase === 'done') {
    p.vel.x *= 0.8;
    p.vel.z *= 0.8;
  } else {
    p.vel.x = sx * speed;
    p.vel.z = -sy * speed;
  }
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  if (m.phase === 'serve' && m.server === 'player') {
    const sp = serverPosition(true, isDeuceSide(m.score));
    const s = Math.sign(sp.x);
    p.pos.x = s > 0 ? clamp(p.pos.x, 0.3, 3.8) : clamp(p.pos.x, -3.8, -0.3);
  }
  p.pos.x = clamp(p.pos.x, -7.5, 7.5);
  p.pos.z = clamp(p.pos.z, 0.7, COURT.halfLength + 5);

  if (input.release && !p.swing) {
    const kind = m.phase === 'serve' && m.server === 'player' ? 'serve' : 'rally';
    startSwing(p, input.release.power, kind);
    emit(m, { type: 'swing', who: 'player', power: input.release.power });
  }
}

function doServe(m, c, input) {
  const deuce = isDeuceSide(m.score);
  const human = c.id === 'player';
  const from = { x: c.pos.x + (human ? 0.25 : -0.25), y: 2.75, z: c.pos.z - c.side * 0.3 };
  let stickX;
  let noise = 0;
  if (human) {
    stickX = input.stick ? input.stick.x : 0;
  } else {
    stickX = m.rand() * 2 - 1;
    noise = m.diff.serveNoise;
  }
  const shot = computeServe(from, stickX, c.swing.power, human, deuce, m.rand, noise);
  m.ball.pos = from;
  m.ball.vel = { ...shot.vel };
  m.ball.netted = false;
  c.swing.hit = true;
  m.rally = { lastHitter: c.id, bounces: 0, isServe: true, box: shot.box };
  m.phase = 'rally';
  m.phaseT = 0;
  m.hits = 0;
  emit(m, { type: 'hit', who: c.id, power: c.swing.power, serve: true });
  onBallStruck(m);
}

function onBallStruck(m) {
  const r = m.rally;
  if (r.lastHitter === 'player') {
    m.bounceMarker = null;
    // CPU reads the ball after its reaction time
    m.ai.plan = null;
    m.ai.decideAt = m.time + m.diff.reaction;
  } else {
    const b = predictBounce(m.ball);
    m.bounceMarker = b ? { x: b.x, z: b.z } : null;
    m.ai.plan = null;
    m.ai.decideAt = Infinity;
    // recover to the middle of the baseline
    m.ai.target = { x: m.ball.vel.x * 0.05, z: -(COURT.halfLength + 0.6) };
  }
}

function checkHits(m, input) {
  const r = m.rally;
  const b = m.ball;
  if (b.netted) return;
  for (const c of [m.player, m.cpu]) {
    if (r.lastHitter === c.id) continue;
    const sw = c.swing;
    if (!sw || sw.hit || sw.kind !== 'rally') continue;
    if (sw.t < SWING.activeStart || sw.t > SWING.activeEnd) continue;
    if (r.bounces > 1) continue;
    if (r.isServe && r.bounces === 0) continue; // serve must bounce first
    if (b.pos.z * c.side < -0.3) continue; // ball must be on own side
    if (b.pos.y > 2.6 || b.pos.y < 0.03) continue;
    const d = Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z);
    if (d > c.reach) continue;
    // Contact!
    let dir;
    let noise;
    if (c.id === 'player') {
      dir = stickToDirection(input.stick || { x: 0, y: 0 }, -1);
      noise = 0.25;
    } else {
      dir = m.ai.shotDir || null;
      noise = m.diff.aimNoise;
    }
    const shot = computeShot(b.pos, dir, sw.power, -c.side, m.rand, noise);
    b.vel = { ...shot.vel };
    b.pos.y = Math.max(b.pos.y, 0.25);
    sw.hit = true;
    r.lastHitter = c.id;
    r.bounces = 0;
    r.isServe = false;
    m.hits++;
    emit(m, { type: 'hit', who: c.id, power: sw.power });
    onBallStruck(m);
    return;
  }
}

function handleBallEvent(m, e) {
  const r = m.rally;
  if (e.type === 'net') {
    emit(m, { type: 'net' });
    return;
  }
  if (e.type !== 'bounce') return;
  emit(m, { type: 'bounce', x: e.x, z: e.z });
  const hitter = r.lastHitter;
  const receiverSide = hitter === 'player' ? -1 : 1;
  if (r.bounces === 0) {
    const good = r.isServe ? inBox(r.box, e.x, e.z) : inCourtHalf(receiverSide, e.x, e.z);
    if (!good) {
      if (r.isServe) {
        m.faults++;
        if (m.faults >= 2) {
          m.faults = 0;
          return endPoint(m, other(hitter), 'ダブルフォルト');
        }
        emit(m, { type: 'fault' });
        m.phase = 'point';
        m.phaseT = POINT_PAUSE - 1.0;
        m.pendingFault = true;
        return;
      }
      return endPoint(m, other(hitter), m.ball.netted ? 'ネット' : 'アウト');
    }
    r.bounces = 1;
    m.bounceMarker = null;
  } else {
    // second bounce: the receiver failed to return it
    return endPoint(m, hitter, r.isServe ? 'サービスエース' : m.hits === 0 ? 'エース' : 'ポイント');
  }
}

function checkOut(m) {
  const r = m.rally;
  const p = m.ball.pos;
  if (Math.abs(p.z) > COURT.halfLength + 9 || Math.abs(p.x) > 12) {
    if (r.bounces >= 1) endPoint(m, r.lastHitter, r.isServe ? 'サービスエース' : 'ポイント');
    else endPoint(m, other(r.lastHitter), 'アウト');
  }
}

function endPoint(m, winner, reason) {
  m.faults = 0;
  m.pendingFault = false;
  addPoint(m.score, winner);
  m.pointWinner = winner;
  m.phase = 'point';
  m.phaseT = 0;
  m.bounceMarker = null;
  emit(m, { type: 'point', winner, reason });
}

// ---------------------------------------------------------------- CPU AI
function updateCpu(m, dt) {
  const c = m.cpu;
  updateSwing(c, dt);
  const ai = m.ai;

  if (m.phase === 'rally' && m.rally.lastHitter === 'player' && !ai.plan && m.time >= ai.decideAt) {
    planReturn(m);
  }

  if (ai.plan && m.phase === 'rally') {
    const plan = ai.plan;
    if (!c.swing && m.time >= plan.swingAt && m.rally.lastHitter === 'player') {
      ai.shotDir = chooseCpuDir(m);
      startSwing(c, plan.power, 'rally');
      emit(m, { type: 'swing', who: 'cpu', power: plan.power });
    }
    if (m.rally.lastHitter === 'cpu') ai.plan = null;
  }

  // move towards target
  let tx = ai.target.x;
  let tz = ai.target.z;
  if (m.phase === 'serve' && m.server === 'cpu') {
    tx = c.pos.x;
    tz = c.pos.z;
  } else if (m.phase === 'serve') {
    tx = ai.target.x;
    tz = ai.target.z;
  }
  const dx = tx - c.pos.x;
  const dz = tz - c.pos.z;
  const dist = Math.hypot(dx, dz);
  const maxStep = c.speed * dt;
  if (dist > 0.02 && m.phase !== 'point' && m.phase !== 'done') {
    const step = Math.min(dist, maxStep);
    c.vel.x = (dx / dist) * (step / dt);
    c.vel.z = (dz / dist) * (step / dt);
    c.pos.x += (dx / dist) * step;
    c.pos.z += (dz / dist) * step;
  } else {
    c.vel.x = c.vel.z = 0;
  }
  c.pos.x = clamp(c.pos.x, -7.5, 7.5);
  c.pos.z = clamp(c.pos.z, -(COURT.halfLength + 5), -0.7);
}

function planReturn(m) {
  const c = m.cpu;
  const ai = m.ai;
  const r = m.rally;
  const path = predictPath(m.ball, 3.2, 1 / 60);
  const first = path.find((s) => s.bounces >= 1);
  if (!first) return;
  const bounceIn = r.isServe
    ? inBox(r.box, first.x, first.z)
    : inCourtHalf(-1, first.x, first.z);
  if (!bounceIn || m.ball.netted) {
    // let it go; drift to the middle
    ai.target = { x: 0, z: -(COURT.halfLength + 0.5) };
    ai.plan = { swingAt: Infinity, power: 0, contact: first };
    return;
  }
  // candidate contacts after the first bounce, comfortable height, reachable
  let best = null;
  let bestScore = Infinity;
  for (const s of path) {
    if (s.bounces !== 1) continue;
    if (s.z > -0.8 || s.z < -(COURT.halfLength + 4)) continue;
    if (s.y < 0.3 || s.y > 1.7) continue;
    const reachT = s.t - 0.05;
    const travel = Math.max(0, Math.hypot(s.x - c.pos.x, s.z - c.pos.z) - c.reach * 0.6);
    const need = travel / c.speed;
    const late = Math.max(0, need - reachT);
    const score = late * 10 + Math.abs(s.y - 1.0) * 0.6 + s.t * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (!best) best = first;
  let contact = best;
  if (m.rand() < m.diff.misjudge) {
    // misread: aim for a slightly wrong spot
    contact = { ...best, x: best.x + (m.rand() < 0.5 ? -1 : 1) * 1.6 };
  }
  const now = m.time;
  ai.target = { x: contact.x + 0.45, z: contact.z - 0.35 };
  const power = m.rand() < m.diff.strongProb ? 1 : 0;
  ai.plan = {
    contact,
    swingAt: now + best.t - 0.12,
    power,
  };
}

function chooseCpuDir(m) {
  const p = m.player;
  let tx;
  if (m.rand() < m.diff.angleProb) {
    // aim away from the human
    const away = p.pos.x > 0 ? -1 : 1;
    tx = away * (2.2 + m.rand() * 1.5);
  } else {
    tx = (m.rand() * 2 - 1) * 2.5;
  }
  const fromX = m.ball.pos.x;
  const fromZ = m.ball.pos.z;
  const tz = 8.5;
  const dz = Math.abs(tz - fromZ);
  const dx = tx - fromX;
  const len = Math.hypot(dx, dz);
  return { x: dx / len, z: dz / len };
}

