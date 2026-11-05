import './style.css';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { createMatch, updateMatch } from './game.js';
import { scoreLabels, scoreText } from './score.js';
import { initUpdater } from './updater.js';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const BEST_KEY = 'dot-tennis-best';
const SOUND_KEY = 'dot-tennis-sound';
const STEP = 1 / 60;
const NEXT_GAME_DELAY = 3;

const app = {
  state: 'title', // 'title' | 'playing' | 'between' | 'gameover'
  match: null,
  stage: 1,
  streak: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  countdownEnd: 0,
  msgTimer: 0,
  toastTimer: 0,
};

const renderer = new Renderer($('game'));
const input = new Input(document.getElementById('ui'));

// ------------------------------------------------------------ updates (PWA)
const updater = import.meta.env.PROD
  ? initUpdater({
      isSafe: () => app.state === 'title',
      notify: (what) => {
        if (what === 'ready' && app.state !== 'title') toast('新しいバージョンがあります。ゲーム終了後に更新します', 3);
        if (what === 'applying') toast('アップデート中…', 10);
      },
    })
  : { pending: false, tryApply: () => false, checkNow: () => {} };

// ------------------------------------------------------------ UI helpers
function show(id, on = true) {
  $(id).classList.toggle('hidden', !on);
}

function setState(s) {
  app.state = s;
  show('title', s === 'title');
  show('win', s === 'between');
  show('over', s === 'gameover');
  const inGame = s === 'playing';
  show('hud', s !== 'title');
  show('controls', inGame);
  show('call', inGame);
  input.enabled = inGame;
  if (!inGame) input.reset();
  document.body.dataset.state = s;
  if (s === 'title') {
    $('best').textContent = app.best;
    updater.checkNow?.();
    updater.tryApply();
  }
}

function message(text, bad = false, time = 1.4) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.classList.remove('hidden');
  // restart pop animation
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  app.msgTimer = time;
}

function toast(text, time = 3) {
  $('toast').textContent = text;
  show('toast', true);
  app.toastTimer = time;
}

function updateHud() {
  const m = app.match;
  if (!m) return;
  const l = scoreLabels(m.score);
  setText('sc-player', l.player);
  setText('sc-cpu', l.cpu);
  $('srv-player').classList.toggle('on', m.server === 'player');
  $('srv-cpu').classList.toggle('on', m.server === 'cpu');
  setText('hud-stage', `STAGE ${app.stage}`);
  setText('hud-streak', `連勝 ${app.streak}`);
  setText('call', scoreText(m.score));
  show('serve-hint', app.state === 'playing' && m.phase === 'serve' && m.server === 'player');
}

function setText(id, t) {
  const el = $(id);
  if (el.textContent !== String(t)) el.textContent = t;
}

// ------------------------------------------------------------ flow
function startRun() {
  app.stage = 1;
  app.streak = 0;
  startStage();
}

function startStage() {
  app.match = createMatch({ stage: app.stage });
  setState('playing');
  message(`STAGE ${app.stage}`, false, 1.2);
}

function onMatchEnd(winner) {
  if (winner === 'player') {
    app.streak++;
    sfx.win();
    $('win-streak').textContent = app.streak;
    $('next-stage').textContent = app.stage + 1;
    // wall-clock deadline so slow frame rates don't stretch the countdown
    app.countdownEnd = performance.now() + NEXT_GAME_DELAY * 1000;
    $('countdown').textContent = NEXT_GAME_DELAY;
    setState('between');
  } else {
    sfx.lose();
    const record = app.streak > app.best;
    if (record) {
      app.best = app.streak;
      localStorage.setItem(BEST_KEY, String(app.best));
    }
    $('over-streak').textContent = app.streak;
    $('over-best').textContent = app.best;
    show('new-record', record);
    setState('gameover');
  }
}

function handleEvents(m) {
  for (const e of m.events) {
    switch (e.type) {
      case 'hit':
        sfx.hit(e.power > 0.5);
        if (e.who === 'player') vibrate(e.power > 0.5 ? 25 : 12);
        break;
      case 'swing':
        sfx.swing();
        break;
      case 'bounce':
        sfx.bounce();
        break;
      case 'net':
        sfx.net();
        break;
      case 'fault':
        message('フォルト', m.server === 'player');
        break;
      case 'point': {
        const good = e.winner === 'player';
        sfx.point(good);
        let text = e.reason;
        if (e.reason === 'ポイント') text = good ? 'ナイスショット!' : 'ポイントを取られた';
        message(text, !good);
        break;
      }
      case 'match':
        onMatchEnd(e.winner);
        break;
      default:
    }
  }
  m.events.length = 0;
}

function vibrate(ms) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* ignore */
    }
  }
}

function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  if (window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}

// ------------------------------------------------------------ buttons
$('btn-start').addEventListener('click', () => {
  unlockAudio();
  enterFullscreen();
  startRun();
});
$('btn-retry').addEventListener('click', () => {
  unlockAudio();
  if (updater.pending) {
    // apply the waiting update first, then start right away after reload
    sessionStorage.setItem('dot-tennis-autostart', '1');
    if (updater.tryApply(true)) return;
  }
  startRun();
});
$('btn-title').addEventListener('click', () => setState('title'));
$('btn-quit').addEventListener('click', () => {
  if (app.streak > app.best) {
    app.best = app.streak;
    localStorage.setItem(BEST_KEY, String(app.best));
  }
  setState('title');
});
$('btn-sound').addEventListener('click', () => {
  setMuted(!isMuted());
  localStorage.setItem(SOUND_KEY, isMuted() ? 'off' : 'on');
  $('btn-sound').textContent = `サウンド: ${isMuted() ? 'OFF' : 'ON'}`;
  unlockAudio();
});
if (localStorage.getItem(SOUND_KEY) === 'off') {
  setMuted(true);
  $('btn-sound').textContent = 'サウンド: OFF';
}
document.addEventListener('pointerdown', unlockAudio, { once: true });
// block iOS pinch / double-tap zoom & context menu
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 200));

$('ver').textContent = __BUILD_TIME__.slice(0, 16).replace('T', ' ');

// ------------------------------------------------------------ main loop
let last = performance.now();
let acc = 0;
let pendingRelease = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (app.msgTimer > 0) {
    app.msgTimer -= dt;
    if (app.msgTimer <= 0) show('message', false);
  }
  if (app.toastTimer > 0) {
    app.toastTimer -= dt;
    if (app.toastTimer <= 0) show('toast', false);
  }

  const m = app.match;
  if (app.state === 'playing' && m) {
    const inp = input.poll();
    // keep a swing release until a simulation step consumes it
    // (on 120Hz displays some frames run zero fixed steps)
    if (inp.release) pendingRelease = inp.release;
    acc += dt;
    while (acc >= STEP) {
      updateMatch(m, STEP, { ...inp, release: pendingRelease });
      pendingRelease = null;
      acc -= STEP;
      handleEvents(m);
      if (app.state !== 'playing') break;
    }
  } else {
    acc = 0;
    pendingRelease = null;
  }

  if (app.state === 'between') {
    const remaining = (app.countdownEnd - now) / 1000;
    setText('countdown', Math.max(0, Math.ceil(remaining)));
    if (remaining <= 0) {
      app.stage++;
      startStage();
    }
  }

  updateHud();
  renderer.draw(app.state === 'title' ? null : app.match, now / 1000);
}

setState('title');
if (sessionStorage.getItem('dot-tennis-autostart')) {
  sessionStorage.removeItem('dot-tennis-autostart');
  startRun();
}
requestAnimationFrame(frame);

// Test / debug hooks (used by the automated browser tests).
window.__tennis = {
  app,
  updater,
  get state() {
    return app.state;
  },
  forceMatchEnd(winner) {
    if (app.state !== 'playing') return;
    const m = app.match;
    m.score[winner] = 4;
    m.score[winner === 'player' ? 'cpu' : 'player'] = 0;
    m.score.winner = winner;
    m.phase = 'done';
    onMatchEnd(winner);
  },
};
