import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// All artwork is drawn on integer pixel grids. No fonts, assets or dependencies.
const OUT = new URL('../public/', import.meta.url);
const palette = {
  ink: '#182735', skin: '#e8ad79', skinLight: '#ffd2a1', skinShade: '#bb7758',
  blue: '#287cdc', blueLight: '#59a9f1', blueShade: '#1753a0',
  red: '#df4250', redLight: '#ff7880', redShade: '#9c293e',
  white: '#f4f5e8', gray: '#acbec8', hair: '#75462d', hairLight: '#a4693e',
  black: '#222936', blackLight: '#455064', net: '#bce5da', rim: '#e8f6eb',
};
const rgba = hex => [...hex.slice(1).match(/../g).map(n => parseInt(n, 16)), 255];
function canvas(w, h) {
  const data = Buffer.alloc(w * h * 4);
  const put = (x, y, color) => {
    if (x >= 0 && y >= 0 && x < w && y < h) data.set(rgba(palette[color] || color), (y * w + x) * 4);
  };
  const rect = (x, y, width, height, color) => {
    for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) put(i, j, color);
  };
  const line = (x0, y0, x1, y1, color, radius = 0) => {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      rect(x0 - radius, y0 - radius, radius * 2 + 1, radius * 2 + 1, color);
      if (x0 === x1 && y0 === y1) break;
      const e = err * 2;
      if (e >= dy) { err += dy; x0 += sx; }
      if (e <= dx) { err += dx; y0 += sy; }
    }
  };
  const grid = (x, y, rows, colors) => rows.forEach((row, j) => [...row].forEach((v, i) => {
    if (colors[v]) put(x + i, y + j, colors[v]);
  }));
  return { w, h, data, put, rect, line, grid };
}

function racket(c, x, y, handX, handY) {
  // A nine-by-thirteen oval with a one-pixel outer outline and open strings.
  c.line(x, y + 5, handX, handY, 'ink', 1);
  c.line(x, y + 5, handX, handY, 'gray');
  c.grid(x - 4, y - 6, [
    '...###...', '.##rrr##.', '.#rnnnr#.', '#rn.n.nr#', '#r.n.n.r#',
    '#rnnnnnr#', '#r.n.n.r#', '#rn.n.nr#', '.#rnnnr#.', '.#rnnnr#.',
    '..#rrr#..', '...#r#...', '....#....',
  ], { '#': 'ink', r: 'rim', n: 'net' });
  c.line(handX, handY - 1, handX, handY + 1, 'skinLight');
}

function character(frame, front) {
  const c = canvas(32, 48);
  const shirt = front ? 'red' : 'blue';
  const light = front ? 'redLight' : 'blueLight';
  const shade = front ? 'redShade' : 'blueShade';
  const shorts = front ? 'black' : 'white';
  const shortsShade = front ? 'blackLight' : 'gray';
  const hair = front ? 'black' : 'hair';
  const bob = frame === 1 ? -1 : 0;
  const limb = (a, b, color = 'skin') => {
    c.line(...a, ...b, 'ink', 2);
    c.line(...a, ...b, color, 1);
  };
  const shoe = (x, y) => c.grid(x, y, ['.####.', '#wwww#', '#wwgw#', '######'],
    { '#': 'ink', w: 'white', g: 'gray' });
  // Feet are balanced about x=15.5; at least one sole meets row 47.
  const legs = [
    [[11, 35], [9, 44], [20, 35], [22, 44]],
    [[11, 34], [10, 44], [20, 34], [21, 40]],
    [[11, 35], [10, 40], [20, 35], [21, 44]],
    [[11, 35], [9, 44], [20, 35], [22, 44]],
    [[11, 35], [9, 44], [20, 35], [22, 44]],
    [[12, 35], [11, 44], [19, 35], [20, 44]],
  ][frame];
  limb(legs[0], legs[1]); limb(legs[2], legs[3]);
  shoe(legs[1][0] - 2, legs[1][1]); shoe(legs[3][0] - 3, legs[3][1]);
  const poses = [
    { elbow: [24, 27], hand: [26, 29], racket: [27, 20], left: [7, 28] },
    { elbow: [24, 24], hand: [26, 24], racket: [27, 15], left: [7, 30] },
    { elbow: [24, 29], hand: [26, 32], racket: [27, 23], left: [7, 24] },
    { elbow: [26, 23], hand: [27, 19], racket: [26, 10], left: [7, 26] },
    { elbow: [17, 24], hand: [7, 24], racket: [4, 15], left: [8, 30] },
    { elbow: [23, 16], hand: [23, 11], racket: [24, 6], left: [7, 12] },
  ];
  const p = poses[frame];
  if (frame !== 4) racket(c, ...p.racket, ...p.hand);
  limb([10, 22 + bob], p.left);
  if (frame !== 4) {
    limb([21, 22 + bob], p.elbow); limb(p.elbow, p.hand);
  }
  c.grid(8, 29 + bob, [
    '################', '#ssssssssssssss#', '#ssssssssssssss#', '#ssssssggssssss#',
    '#ssssss##ssssss#', '#sssss#..#sssss#', '#######..#######',
  ], { '#': 'ink', s: shorts, g: shortsShade });
  c.grid(7, 18 + bob, [
    '....##########....', '..##ssssssssss##..', '.#llssssssssssss#.',
    '#lllssssssssssddd#', '#lllssssssssssddd#', '####ssssssssss####',
    '...#sssssssssd#...', '...#sssssssssd#...', '...#sssssssssd#...',
    '...#sssssssssd#...', '...#sssssssssd#...', '...#dddddddddd#...',
    '....##########....',
  ], { '#': 'ink', s: shirt, l: light, d: shade });
  c.rect(13, 16 + bob, 6, 4, 'ink'); c.rect(14, 16 + bob, 4, 3, 'skin');
  c.grid(10, 7 + bob, [
    '...######...', '..#hhhhhh#..', '.#hhhhhhhh#.', '#hhhhhhhhhh#',
    '#hhhhhhhhhh#', '#hhhhhhhhhh#', '#hhhhhhhhhh#', '.#hhhhhhhh#.',
    '.#hhhhhhhh#.', '..#hhhhhh#..', '...######...',
  ], { '#': 'ink', h: hair });
  if (front) {
    c.rect(12, 12 + bob, 8, 4, 'skin');
    c.rect(13, 16 + bob, 6, 1, 'skinShade');
    c.rect(11, 10 + bob, 10, 2, 'white');
    c.put(13, 13 + bob, 'ink'); c.put(18, 13 + bob, 'ink');
    c.put(16, 15 + bob, 'skinLight');
    c.rect(20, 10 + bob, 2, 1, 'gray');
  } else {
    c.rect(12, 10 + bob, 2, 4, 'hairLight');
    c.rect(14, 9 + bob, 4, 1, 'hairLight');
    c.rect(12, 15 + bob, 8, 1, 'hair');
    c.rect(12, 22 + bob, 1, 5, light);
    c.rect(14, 21 + bob, 4, 1, light);
  }
  if (frame === 4) {
    limb([21, 22], p.elbow); limb(p.elbow, p.hand);
    racket(c, ...p.racket, ...p.hand);
  }
  if (!front) return c;
  // Mirroring the front-view drawing puts the right hand on image left.
  const mirrored = canvas(32, 48);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++)
    c.data.copy(mirrored.data, (y * 32 + 31 - x) * 4, (y * 32 + x) * 4, (y * 32 + x + 1) * 4);
  return mirrored;
}

function sheet(front) {
  const out = canvas(192, 48);
  for (let frame = 0; frame < 6; frame++) {
    const sprite = character(frame, front);
    for (let y = 0; y < 48; y++) sprite.data.copy(out.data, (y * 192 + frame * 32) * 4, y * 128, (y + 1) * 128);
  }
  return out;
}

function icon() {
  const c = canvas(32, 32);
  c.rect(0, 0, 32, 32, '#165a58');
  c.rect(3, 3, 26, 26, '#238b78');
  c.rect(6, 4, 20, 24, '#297ba2');
  c.rect(7, 5, 18, 22, '#378fb0');
  c.rect(6, 4, 1, 24, '#7cc6bd'); c.rect(25, 4, 1, 24, '#7cc6bd');
  c.rect(6, 8, 20, 1, '#7cc6bd'); c.rect(6, 23, 20, 1, '#7cc6bd');
  c.rect(16, 4, 1, 24, '#7cc6bd');
  c.line(13, 20, 22, 27, 'ink', 1); c.line(13, 20, 22, 27, '#e9b06e');
  c.line(19, 24, 22, 27, 'ink', 1); c.line(19, 24, 22, 27, '#ed7056');
  c.grid(5, 6, [
    '....######....', '..##wwwwww##..', '.#wwnnnnnnww#.', '.#wn.n.n.n.w#.',
    '#wnnnnnnnnnnw#', '#wn.n.n.n.n.w#', '#wnnnnnnnnnnw#', '#wn.n.n.n.n.w#',
    '#wnnnnnnnnnnw#', '.#wn.n.n.n.w#.', '.#wwnnnnnnww#.', '..##wwwwww##..',
    '....######....',
  ], { '#': 'ink', w: 'white', n: 'net' });
  c.grid(17, 13, [
    '...#####...', '.##yyyyy##.', '.#yywwyyy#.', '#yyyyywwyy#', '#yyyyyywyy#',
    '#yyyyyywyy#', '#yyyyywwyy#', '#yyyywwyyd#', '.#ywwyydd#.', '.##ddddd##.',
    '...#####...',
  ], { '#': 'ink', y: '#d9ed48', d: '#9dbb35', w: '#ffffc7' });
  return c;
}

function scale(src, size) {
  const out = canvas(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (Math.floor(y * src.h / size) * src.w + Math.floor(x * src.w / size)) * 4;
    src.data.copy(out.data, (y * size + x) * 4, i, i + 4);
  }
  return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0); ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA, non-interlaced.
  const scanlines = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) c.data.copy(scanlines, y * (c.w * 4 + 1) + 1, y * c.w * 4, (y + 1) * c.w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(new URL('sprites/', OUT), { recursive: true });
mkdirSync(new URL('icons/', OUT), { recursive: true });
const courtIcon = icon();
// Extra margin keeps the ball and racket inside the 80%-diameter safe circle.
const maskable = canvas(40, 40);
maskable.rect(0, 0, 40, 40, '#165a58');
for (let y = 0; y < 32; y++) courtIcon.data.copy(maskable.data, ((y + 4) * 40 + 4) * 4, y * 128, (y + 1) * 128);
for (const [file, art] of [
  ['sprites/player.png', sheet(false)], ['sprites/cpu.png', sheet(true)],
  ['icons/icon-192.png', scale(courtIcon, 192)], ['icons/icon-512.png', scale(courtIcon, 512)],
  ['icons/icon-maskable-512.png', scale(maskable, 512)], ['icons/apple-touch-icon.png', scale(courtIcon, 180)],
]) {
  writeFileSync(new URL(file, OUT), png(art));
  console.log(`public/${file}: ${art.w}x${art.h}`);
}
