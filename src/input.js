// Touch controls: left half = floating joystick, right half = swing button.
// Short press -> weak swing, long press (>= STRONG_PRESS_MS) -> strong swing.
import { STRONG_PRESS_MS, pressToPower } from './physics.js';

const JOY_RADIUS = 60;

export class Input {
  constructor(root) {
    this.root = root;
    this.stick = { x: 0, y: 0 };
    this.joyId = null;
    this.joyOrigin = null;
    this.swingId = null;
    this.pressStart = 0;
    this.release = null;
    this.keys = new Set();
    this.enabled = false;

    this.joyBase = root.querySelector('#joy-base');
    this.joyKnob = root.querySelector('#joy-knob');
    this.swingBtn = root.querySelector('#swing-btn');
    this.charge = root.querySelector('#swing-charge');
    this.leftZone = root.querySelector('#zone-left');
    this.rightZone = root.querySelector('#zone-right');

    this.leftZone.addEventListener('pointerdown', (e) => this.joyDown(e));
    this.rightZone.addEventListener('pointerdown', (e) => this.swingDown(e));
    window.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    window.addEventListener('blur', () => this.reset());
    this.resetJoyVisual();
  }

  reset() {
    this.stick = { x: 0, y: 0 };
    this.joyId = null;
    this.swingId = null;
    this.pressStart = 0;
    this.release = null;
    this.keys.clear();
    this.resetJoyVisual();
    this.swingBtn.classList.remove('pressed');
    this.charge.style.setProperty('--p', 0);
    this.swingBtn.classList.remove('strong');
  }

  resetJoyVisual() {
    this.joyBase.classList.remove('active');
    this.joyKnob.style.transform = 'translate(-50%, -50%)';
    this.joyBase.style.left = '';
    this.joyBase.style.top = '';
  }

  joyDown(e) {
    e.preventDefault();
    if (this.joyId !== null) return;
    this.joyId = e.pointerId;
    this.joyOrigin = { x: e.clientX, y: e.clientY };
    this.joyBase.classList.add('active');
    this.joyBase.style.left = `${e.clientX}px`;
    this.joyBase.style.top = `${e.clientY}px`;
    this.updateJoy(e);
  }

  swingDown(e) {
    e.preventDefault();
    if (this.swingId !== null) return;
    this.swingId = e.pointerId;
    this.pressStart = performance.now();
    this.swingBtn.classList.add('pressed');
  }

  move(e) {
    if (e.pointerId === this.joyId) {
      e.preventDefault();
      this.updateJoy(e);
    }
  }

  updateJoy(e) {
    let dx = e.clientX - this.joyOrigin.x;
    let dy = e.clientY - this.joyOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      dx = (dx / d) * JOY_RADIUS;
      dy = (dy / d) * JOY_RADIUS;
    }
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / JOY_RADIUS;
    const ny = -dy / JOY_RADIUS;
    const mag = Math.hypot(nx, ny);
    this.stick = mag < 0.12 ? { x: 0, y: 0 } : { x: nx, y: ny };
  }

  up(e, cancelled = false) {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.stick = { x: 0, y: 0 };
      this.resetJoyVisual();
    }
    if (e.pointerId === this.swingId) {
      this.swingId = null;
      this.finishSwing(cancelled);
    }
  }

  finishSwing(cancelled) {
    const ms = performance.now() - this.pressStart;
    this.pressStart = 0;
    this.swingBtn.classList.remove('pressed', 'strong');
    this.charge.style.setProperty('--p', 0);
    if (!cancelled && this.enabled) this.release = { power: pressToPower(ms), ms };
  }

  keyDown(e) {
    const k = e.key.toLowerCase();
    if ([' ', 'j', 'enter'].includes(k)) {
      e.preventDefault();
      if (!this.keys.has('swing')) {
        this.keys.add('swing');
        this.pressStart = performance.now();
        this.swingBtn.classList.add('pressed');
      }
      return;
    }
    this.keys.add(k);
  }

  keyUp(e) {
    const k = e.key.toLowerCase();
    if ([' ', 'j', 'enter'].includes(k)) {
      if (this.keys.has('swing')) {
        this.keys.delete('swing');
        this.finishSwing(false);
      }
      return;
    }
    this.keys.delete(k);
  }

  keyStick() {
    const k = this.keys;
    const x = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0);
    const y = (k.has('arrowup') || k.has('w') ? 1 : 0) - (k.has('arrowdown') || k.has('s') ? 1 : 0);
    if (!x && !y) return null;
    const m = Math.hypot(x, y);
    return { x: x / m, y: y / m };
  }

  /** Called once per frame. */
  poll() {
    const charging = this.pressStart > 0;
    if (charging) {
      const p = Math.min(1, (performance.now() - this.pressStart) / STRONG_PRESS_MS);
      this.charge.style.setProperty('--p', p);
      this.swingBtn.classList.toggle('strong', p >= 1);
    }
    const out = {
      stick: this.keyStick() || this.stick,
      charging,
      release: this.release,
    };
    this.release = null;
    return out;
  }
}
