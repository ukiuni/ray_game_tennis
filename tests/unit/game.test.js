import { describe, it, expect } from 'vitest';
import { createMatch, updateMatch, difficulty, SWING } from '../../src/game.js';
import { predictPath, COURT, inCourtHalf } from '../../src/physics.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Simple bot that drives the human player with the same inputs a person would. */
function makeBot(opts = {}) {
  const st = { plan: null, holdUntil: 0, stick: { x: 0, y: 0 }, aim: opts.aim ?? { x: 0, y: 1 }, power: opts.power ?? 0 };
  return (m) => {
    const p = m.player;
    const input = { stick: { x: 0, y: 0 }, charging: false, release: null };
    if (m.phase === 'serve' && m.server === 'player') {
      if (m.phaseT > 0.5) input.release = { power: st.power };
      return input;
    }
    if (m.phase !== 'rally') { st.plan = null; return input; }
    if (m.rally.lastHitter === 'cpu' && !st.plan) {
      const path = predictPath(m.ball, 3, 1 / 60);
      const c = path.find((s) => s.bounces === 1 && s.z > 0.8 && s.y > 0.4 && s.y < 1.5 && s.t > 0.35);
      if (c) st.plan = { x: c.x - 0.4, z: c.z + 0.3, at: m.time + c.t - 0.1 };
    }
    if (m.rally.lastHitter === 'player') st.plan = null;
    if (st.plan) {
      const dx = st.plan.x - p.pos.x, dz = st.plan.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) input.stick = { x: dx / Math.max(d, 0.6), y: -dz / Math.max(d, 0.6) };
      if (m.time >= st.plan.at && !p.swing) {
        input.release = { power: st.power };
        input.stick = st.aim;
      }
    }
    return input;
  };
}

function run(m, bot, maxT = 400, onEvent) {
  const dt = 1 / 60;
  for (let t = 0; t < maxT && m.phase !== 'done'; t += dt) {
    updateMatch(m, dt, bot(m));
    if (onEvent) for (const e of m.events) onEvent(e, m);
    m.events.length = 0;
  }
}

describe('match simulation', () => {
  it('a full game finishes with a winner and rallies happen', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const m = createMatch({ stage: 1, rand: rng(seed) });
      let hits = { player: 0, cpu: 0 };
      let points = 0;
      run(m, makeBot(), 600, (e) => {
        if (e.type === 'hit') hits[e.who]++;
        if (e.type === 'point') points++;
      });
      expect(m.phase).toBe('done');
      expect(['player', 'cpu']).toContain(m.score.winner);
      expect(points).toBeGreaterThanOrEqual(4);
      expect(hits.player).toBeGreaterThan(2);
      expect(hits.cpu).toBeGreaterThan(2);
    }
  });

  it('human serve on release travels to the CPU side', () => {
    const m = createMatch({ stage: 1, rand: rng(3) });
    expect(m.server).toBe('player');
    updateMatch(m, 1 / 60, { stick: { x: 0, y: 0 }, release: { power: 1 } });
    for (let i = 0; i < 20; i++) updateMatch(m, 1 / 60, { stick: { x: 0, y: 0 } });
    expect(m.phase).toBe('rally');
    expect(m.ball.vel.z).toBeLessThan(0);
  });

  it('CPU serves on even stages', () => {
    const m = createMatch({ stage: 2, rand: rng(9) });
    expect(m.server).toBe('cpu');
    for (let i = 0; i < 120; i++) updateMatch(m, 1 / 60, { stick: { x: 0, y: 0 } });
    expect(m.phase).toBe('rally');
    expect(m.ball.vel.z).toBeGreaterThan(0);
  });

  it('player hit direction follows the joystick, power controls speed', () => {
    const results = {};
    for (const [name, aim, power] of [['left', { x: -1, y: 0.5 }, 1], ['right', { x: 1, y: 0.5 }, 1], ['weak', { x: 0, y: 1 }, 0], ['strong', { x: 0, y: 1 }, 1]]) {
      const m = createMatch({ stage: 2, rand: rng(4) });
      const bot = makeBot({ aim, power });
      let shot = null;
      run(m, bot, 30, (e, mm) => {
        if (!shot && e.type === 'hit' && e.who === 'player') shot = { vel: { ...mm.ball.vel } };
      });
      expect(shot, name).not.toBeNull();
      results[name] = shot.vel;
    }
    expect(results.left.x).toBeLessThan(-1);
    expect(results.right.x).toBeGreaterThan(1);
    const sp = (v) => Math.hypot(v.x, v.z);
    expect(sp(results.strong)).toBeGreaterThan(sp(results.weak) * 1.5);
  });

  it('missing the ball loses the point', () => {
    const m = createMatch({ stage: 2, rand: rng(5) });
    let pt = null;
    run(m, () => ({ stick: { x: 0, y: 0 } }), 10, (e) => { if (e.type === 'point' && !pt) pt = e; });
    expect(pt.winner).toBe('cpu');
  });

  it('swing window constants are sane', () => {
    expect(SWING.activeEnd).toBeLessThan(SWING.duration);
  });

  it('difficulty increases with stage', () => {
    const a = difficulty(1), b = difficulty(6);
    expect(b.speed).toBeGreaterThan(a.speed);
    expect(b.reaction).toBeLessThan(a.reaction);
    expect(b.aimNoise).toBeLessThan(a.aimNoise);
  });
});
