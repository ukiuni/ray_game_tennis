// Three.js (WebGL) rendering of the match.
import * as THREE from 'three';
import { COURT, BALL_RADIUS } from './physics.js';
import { SWING } from './game.js';

const FRAMES = 6;
const SPRITE_H = 1.95;
const SPRITE_W = SPRITE_H * (32 / 48);

function courtTexture(maxAniso) {
  const PPM = 40; // pixels per metre
  const W = 22;
  const L = 38;
  const c = document.createElement('canvas');
  c.width = W * PPM;
  c.height = L * PPM;
  const g = c.getContext('2d');
  const X = (x) => (x + W / 2) * PPM;
  const Z = (z) => (z + L / 2) * PPM;
  // run-off area
  g.fillStyle = '#2f7d4f';
  g.fillRect(0, 0, c.width, c.height);
  // subtle pixel dither for a retro look
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.035)';
    g.fillRect(Math.floor(Math.random() * c.width / 4) * 4, Math.floor(Math.random() * c.height / 4) * 4, 4, 4);
  }
  // court (doubles area)
  g.fillStyle = '#2d6fb3';
  g.fillRect(X(-COURT.doublesHalfWidth), Z(-COURT.halfLength), COURT.doublesHalfWidth * 2 * PPM, COURT.halfLength * 2 * PPM);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 0.07 * PPM;
  const line = (x1, z1, x2, z2) => {
    g.beginPath();
    g.moveTo(X(x1), Z(z1));
    g.lineTo(X(x2), Z(z2));
    g.stroke();
  };
  const hl = COURT.halfLength;
  const dw = COURT.doublesHalfWidth;
  const sw = COURT.halfWidth;
  const sl = COURT.serviceLine;
  // outer lines
  line(-dw, -hl, dw, -hl);
  line(-dw, hl, dw, hl);
  line(-dw, -hl, -dw, hl);
  line(dw, -hl, dw, hl);
  line(-sw, -hl, -sw, hl);
  line(sw, -hl, sw, hl);
  line(-sw, -sl, sw, -sl);
  line(-sw, sl, sw, sl);
  line(0, -sl, 0, sl);
  line(0, -hl, 0, -hl + 0.25);
  line(0, hl, 0, hl - 0.25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return { tex, W, L };
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 32);
  g.strokeStyle = 'rgba(20,20,20,0.85)';
  g.lineWidth = 1;
  for (let x = 0; x <= 256; x += 4) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, 32);
    g.stroke();
  }
  for (let y = 0; y <= 32; y += 4) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(256, y + 0.5);
    g.stroke();
  }
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 256, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Fallback pixel sprite if the PNG sheet cannot be loaded. */
function fallbackSheet(color) {
  const c = document.createElement('canvas');
  c.width = 32 * FRAMES;
  c.height = 48;
  const g = c.getContext('2d');
  for (let f = 0; f < FRAMES; f++) {
    const ox = f * 32;
    g.fillStyle = '#6b4226';
    g.fillRect(ox + 11, 2, 10, 9);
    g.fillStyle = color;
    g.fillRect(ox + 9, 12, 14, 14);
    g.fillStyle = '#eeeeee';
    g.fillRect(ox + 10, 26, 12, 7);
    g.fillStyle = '#e0a070';
    g.fillRect(ox + 11, 33, 4, 12);
    g.fillRect(ox + 17, 33, 4, 12);
  }
  return c;
}

function loadSheet(url, color) {
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.repeat.set(1 / FRAMES, 1);
  const img = new Image();
  img.onload = () => {
    tex.image = img;
    tex.needsUpdate = true;
  };
  img.onerror = () => {
    tex.image = fallbackSheet(color);
    tex.needsUpdate = true;
  };
  img.src = url;
  return tex;
}

function blobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#8fd3ff');
    scene.fog = new THREE.Fog('#8fd3ff', 40, 90);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camPos = new THREE.Vector3(0, 6, 20);
    this.camLook = new THREE.Vector3(0, 0, -2);

    scene.add(new THREE.HemisphereLight('#ffffff', '#4a7a4a', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-6, 14, 6);
    scene.add(sun);

    const base = import.meta.env?.BASE_URL ?? './';
    this.buildCourt();
    this.buildStadium();

    this.shadowMat = blobShadow();
    this.player = this.makeCharacter(loadSheet(`${base}sprites/player.png`, '#2a62d6'));
    this.cpu = this.makeCharacter(loadSheet(`${base}sprites/cpu.png`, '#d63a2a'));

    // ball
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 12),
      new THREE.MeshStandardMaterial({ color: '#e8ff3a', emissive: '#6b7a00', roughness: 0.6 }),
    );
    scene.add(ball);
    this.ball = ball;
    const bs = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), this.shadowMat);
    bs.rotation.x = -Math.PI / 2;
    bs.position.y = 0.012;
    scene.add(bs);
    this.ballShadow = bs;

    // predicted bounce marker
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.32, 24),
      new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.015;
    marker.visible = false;
    scene.add(marker);
    this.marker = marker;

    this.resize();
  }

  buildCourt() {
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const { tex, W, L } = courtTexture(aniso);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshLambertMaterial({ color: '#2a6b43' }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    this.scene.add(outer);

    const netW = (COURT.doublesHalfWidth + 0.9) * 2;
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(netW, COURT.netHeight),
      new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    net.position.set(0, COURT.netHeight / 2, 0);
    this.scene.add(net);
    const postMat = new THREE.MeshStandardMaterial({ color: '#1d3b2a', metalness: 0.3, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, COURT.netHeight + 0.12, 8), postMat);
      post.position.set(s * netW / 2, (COURT.netHeight + 0.12) / 2, 0);
      this.scene.add(post);
    }
  }

  buildStadium() {
    const wallMat = new THREE.MeshLambertMaterial({ color: '#1f4f36' });
    const standMat = new THREE.MeshLambertMaterial({ color: '#6c7a89' });
    const add = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.scene.add(m);
      return m;
    };
    // back walls & side walls
    add(30, 2.2, 0.3, 0, 1.1, -21, wallMat);
    add(30, 2.2, 0.3, 0, 1.1, 24, wallMat);
    add(0.3, 2.2, 45, -13, 1.1, 1.5, wallMat);
    add(0.3, 2.2, 45, 13, 1.1, 1.5, wallMat);
    // stands with pixel "crowd"
    const crowd = document.createElement('canvas');
    crowd.width = 128;
    crowd.height = 32;
    const g = crowd.getContext('2d');
    const colors = ['#e84a5f', '#f9d56e', '#3fbac2', '#ffffff', '#8b5cf6', '#f97316', '#22c55e'];
    g.fillStyle = '#4b5563';
    g.fillRect(0, 0, 128, 32);
    for (let y = 0; y < 32; y += 4) {
      for (let x = (y / 4) % 2 ? 2 : 0; x < 128; x += 4) {
        if (Math.random() < 0.8) {
          g.fillStyle = colors[(Math.random() * colors.length) | 0];
          g.fillRect(x, y + 1, 3, 3);
        }
      }
    }
    const ct = new THREE.CanvasTexture(crowd);
    ct.magFilter = THREE.NearestFilter;
    ct.colorSpace = THREE.SRGBColorSpace;
    ct.wrapS = THREE.RepeatWrapping;
    const crowdMat = new THREE.MeshLambertMaterial({ map: ct });
    const stand = (w, x, z, rotY) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 7), crowdMat.clone());
      m.material.map = ct.clone();
      m.material.map.repeat.set(w / 8, 1);
      m.material.map.needsUpdate = true;
      m.position.set(x, 4.5, z);
      m.rotation.y = rotY;
      m.rotation.x = rotY === 0 ? -0.5 : 0;
      this.scene.add(m);
    };
    stand(34, 0, -24, 0);
    const side = (x, s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(46, 7), new THREE.MeshLambertMaterial({ map: ct.clone() }));
      m.material.map.repeat.set(46 / 8, 1);
      m.material.map.needsUpdate = true;
      m.position.set(x, 4.5, 1);
      m.rotation.y = s * Math.PI / 2;
      this.scene.add(m);
    };
    side(-16, 1);
    side(16, -1);
    add(40, 0.6, 2, 0, 0.3, -22.5, standMat);
  }

  makeCharacter(tex) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.5 });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0);
    sprite.scale.set(SPRITE_W, SPRITE_H, 1);
    this.scene.add(sprite);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.011;
    this.scene.add(shadow);
    return { sprite, tex, shadow };
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // keep the court width visible in portrait orientation
    const hfov = 62 * (Math.PI / 180);
    const vfovForWidth = 2 * Math.atan(Math.tan(hfov / 2) / aspect) * (180 / Math.PI);
    this.camera.fov = Math.min(Math.max(46, vfovForWidth), 95);
    this.portrait = aspect < 1;
    this.camera.updateProjectionMatrix();
  }

  frameFor(c, m, now) {
    if (c.swing) {
      if (c.swing.kind === 'serve') return 5;
      return c.swing.t < SWING.activeEnd * 0.4 ? 3 : 4;
    }
    if (c.charging) return 3;
    if (m.phase === 'serve' && m.server === c.id) return 0;
    const sp = Math.hypot(c.vel.x, c.vel.z);
    if (sp > 0.6) return 1 + (Math.floor(now * 8) % 2);
    return 0;
  }

  draw(m, now) {
    if (m) {
      for (const [c, view] of [[m.player, this.player], [m.cpu, this.cpu]]) {
        view.sprite.position.set(c.pos.x, 0, c.pos.z);
        view.shadow.position.set(c.pos.x, 0.011, c.pos.z);
        const f = this.frameFor(c, m, now);
        view.tex.offset.set(f / FRAMES, 0);
      }
      const b = m.ball.pos;
      this.ball.position.set(b.x, Math.max(b.y, BALL_RADIUS), b.z);
      this.ballShadow.position.set(b.x, 0.012, b.z);
      const s = 1 / (1 + b.y * 0.25);
      this.ballShadow.scale.set(s, s, s);
      this.ball.visible = this.ballShadow.visible = true;

      if (m.bounceMarker) {
        this.marker.visible = true;
        this.marker.position.x = m.bounceMarker.x;
        this.marker.position.z = m.bounceMarker.z;
        const k = 1 + Math.sin(now * 10) * 0.12;
        this.marker.scale.set(k, k, k);
      } else {
        this.marker.visible = false;
      }

      // camera follows the player from behind
      const p = m.player.pos;
      // portrait: higher, steeper camera so the court fills the tall screen
      const back = this.portrait ? 17 : 20.5;
      const height = this.portrait ? 15 : 6.2;
      const lookZ = this.portrait ? 1.5 : -3.5;
      const target = new THREE.Vector3(p.x * 0.45, height, Math.max(p.z, 9) + back - 11);
      this.camPos.lerp(target, 0.08);
      this.camLook.lerp(new THREE.Vector3(p.x * 0.25, 0, lookZ), 0.08);
    } else {
      // title screen: slow orbit
      const a = now * 0.15;
      this.camPos.set(Math.sin(a) * 22, 9, Math.cos(a) * 22);
      this.camLook.set(0, 0, 0);
      this.ball.visible = this.ballShadow.visible = false;
      this.marker.visible = false;
      this.player.sprite.position.set(1, 0, 11.5);
      this.player.shadow.position.set(1, 0.011, 11.5);
      this.cpu.sprite.position.set(-1, 0, -11.5);
      this.cpu.shadow.position.set(-1, 0.011, -11.5);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }
}
