import { describe, it, expect } from 'vitest';
import {
  COURT, computeShot, computeServe, stickToDirection, pressToPower, STRONG_PRESS_MS,
  predictBounce, predictPath, createBall, serviceBox, inBox, inCourtHalf, serverPosition,
} from '../../src/physics.js';

const noRand = () => 0.5; // (0.5*2-1)=0 -> no noise

function launch(from, shot) {
  const b = createBall();
  b.pos = { ...from };
  b.vel = { ...shot.vel };
  return b;
}
function netHeightCrossing(ball) {
  const path = predictPath(ball, 4, 1 / 240);
  for (let i = 1; i < path.length; i++) {
    if (Math.sign(path[i - 1].z) !== Math.sign(path[i].z)) return path[i].y;
  }
  return null;
}

describe('stickToDirection', () => {
  it('neutral returns null', () => {
    expect(stickToDirection({ x: 0, y: 0 }, -1)).toBeNull();
  });
  it('up means straight at the opponent', () => {
    const d = stickToDirection({ x: 0, y: 1 }, -1);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(-1);
  });
  it('right/left keep their lateral sign and still go forward', () => {
    const r = stickToDirection({ x: 1, y: 0 }, -1);
    const l = stickToDirection({ x: -1, y: -1 }, -1);
    expect(r.x).toBeGreaterThan(0);
    expect(r.z).toBeLessThan(0);
    expect(l.x).toBeLessThan(0);
    expect(l.z).toBeLessThan(0);
  });
});

describe('pressToPower', () => {
  it('short press is weak, long press is strong', () => {
    expect(pressToPower(80)).toBe(0);
    expect(pressToPower(STRONG_PRESS_MS - 1)).toBe(0);
    expect(pressToPower(STRONG_PRESS_MS)).toBe(1);
    expect(pressToPower(1500)).toBe(1);
  });
});

describe('computeShot', () => {
  const from = { x: 0, y: 1, z: 11 };
  it('weak shot is slower and shorter than strong shot', () => {
    const weak = computeShot(from, null, 0, -1, noRand, 0);
    const strong = computeShot(from, null, 1, -1, noRand, 0);
    const vw = Math.hypot(weak.vel.x, weak.vel.z);
    const vs = Math.hypot(strong.vel.x, strong.vel.z);
    expect(vs).toBeGreaterThan(vw * 1.5);
    expect(Math.abs(strong.target.z)).toBeGreaterThan(Math.abs(weak.target.z) + 3);
    expect(strong.time).toBeLessThan(weak.time);
  });
  it.each([[0, 0.4], [1, 0.4], [0, 2.5], [1, 0.25]])('lands where aimed & clears the net (power %s, height %s)', (power, y) => {
    const f = { x: 1, y, z: 10 };
    const shot = computeShot(f, stickToDirection({ x: 0.5, y: 0.8 }, -1), power, -1, noRand, 0);
    const ball = launch(f, shot);
    const b = predictBounce(ball);
    expect(b).not.toBeNull();
    expect(b.x).toBeCloseTo(shot.target.x, 0);
    expect(b.z).toBeCloseTo(shot.target.z, 0);
    expect(inCourtHalf(-1, b.x, b.z)).toBe(true);
    expect(netHeightCrossing(ball)).toBeGreaterThan(COURT.netHeight + 0.1);
  });
  it('ball flies in the joystick direction', () => {
    const f = { x: 0, y: 1, z: 10 };
    const left = computeShot(f, stickToDirection({ x: -1, y: 0.6 }, -1), 1, -1, noRand, 0);
    const right = computeShot(f, stickToDirection({ x: 1, y: 0.6 }, -1), 1, -1, noRand, 0);
    const straight = computeShot(f, stickToDirection({ x: 0, y: 1 }, -1), 1, -1, noRand, 0);
    expect(left.vel.x).toBeLessThan(-1);
    expect(right.vel.x).toBeGreaterThan(1);
    expect(Math.abs(straight.vel.x)).toBeLessThan(0.01);
    expect(left.target.x).toBeLessThan(-2);
    expect(right.target.x).toBeGreaterThan(2);
  });
  it('CPU shots go towards +z', () => {
    const f = { x: 0, y: 1, z: -11 };
    const s = computeShot(f, { x: 0, z: 1 }, 1, 1, noRand, 0);
    const b = predictBounce(launch(f, s));
    expect(inCourtHalf(1, b.x, b.z)).toBe(true);
  });
});

describe('serve', () => {
  for (const human of [true, false]) {
    for (const deuce of [true, false]) {
      for (const power of [0, 1]) {
        for (const sx of [-1, 0, 1]) {
          it(`lands in the service box (human=${human} deuce=${deuce} power=${power} stick=${sx})`, () => {
            const sp = serverPosition(human, deuce);
            const from = { x: sp.x, y: 2.75, z: sp.z };
            const s = computeServe(from, sx, power, human, deuce, noRand, 0);
            const ball = launch(from, s);
            const b = predictBounce(ball);
            expect(inBox(serviceBox(human, deuce), b.x, b.z)).toBe(true);
            expect(netHeightCrossing(ball)).toBeGreaterThan(COURT.netHeight);
          });
        }
      }
    }
  }
  it('serves cross court', () => {
    const sp = serverPosition(true, true);
    const box = serviceBox(true, true);
    expect(Math.sign(sp.x)).toBe(-Math.sign(box.minX + box.maxX));
  });
});
