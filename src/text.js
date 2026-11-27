/* text.js —— 烟雾状鎏金粒子祝福语
 *
 * 视觉逻辑：
 *  1. 显现：一整块文字被一条从左到右的“雾锋”扫过，雾锋处粒子被推散、放大、半透明（烟），
 *     越过后逐渐收紧到字形表面 —— 连贯、不突兀，也没有“啪啪”贴字的机械感。
 *  2. 峰值：全部显现后短暂提亮（uGlow），像被点着一样。
 *  3. 消散：逐字化雾上升（uDissolve 按字符顺序推进），不是整体淡出。
 */
import * as THREE from 'three';

export const MAX_TEXT_LEN = 24;
export const MAX_PARTICLES_PER_CHAR = 1500;

function isEnglishChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x0020 && c <= 0x007e) || (c >= 0x00a0 && c <= 0x024f);
}

/* 鎏金：顶部白金高光 → 亮金 → 金 → 暗金 */
const GOLD = [
  [1.0, 0.985, 0.9],
  [1.0, 0.92, 0.66],
  [0.96, 0.76, 0.36],
  [0.74, 0.5, 0.16],
];

function goldAt(t) {
  const x = Math.min(0.999, Math.max(0, t)) * (GOLD.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = GOLD[i];
  const b = GOLD[Math.min(GOLD.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/* 离屏栅格化单个字符 */
function rasterizeChar(char, fontPx, scale, step = 1) {
  const pad = Math.ceil(fontPx * 0.26);
  const w = Math.ceil(fontPx * 1.5) + pad * 2;
  const h = Math.ceil(fontPx * 1.8) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const stacks = isEnglishChar(char)
    ? [
        `italic 400 ${fontPx}px "Cormorant Garamond","CormorantGaramond","Palatino Linotype",Georgia,serif`,
        `italic 400 ${fontPx}px Georgia,serif`,
      ]
    : [
        `400 ${fontPx}px "Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif`,
        `400 ${fontPx}px "PingFang SC","Hiragino Sans GB",serif`,
      ];

  let best = null;
  for (const font of stacks) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, w / 2, h / 2);

    const data = ctx.getImageData(0, 0, w, h).data;
    const pts = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4] > 110) {
          pts.push({ x: (x - w / 2) * scale, y: -(y - h / 2) * scale, normY: y / h });
        }
      }
    }
    if (!best || pts.length > best.length) best = pts;
  }

  if (!best || best.length < 30) {
    best = [];
    const r = fontPx * 0.4 * scale;
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      best.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, normY: 0.5 + Math.sin(a) * 0.5 });
    }
  }
  if (best.length > MAX_PARTICLES_PER_CHAR) {
    const keep = [];
    const strideN = best.length / MAX_PARTICLES_PER_CHAR;
    for (let i = 0; i < MAX_PARTICLES_PER_CHAR; i++) keep.push(best[Math.floor(i * strideN)]);
    return keep;
  }
  return best;
}

/**
 * @returns {{group, items, raw: string[]}}
 * items[i] = { material, xn, line, index }
 */
export function buildTextParticles(text, opts = {}) {
  const {
    enFontPx = 88,
    zhFontPx = 100,
    scale = 0.022,
    letterGap = 0.05,
    lineGap = 2.6,
    centerX = 0,
    centerY = 1.0,
    centerZ = 17,
  } = opts;

  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const group = new THREE.Group();
  const measure = document.createElement('canvas').getContext('2d');
  const cells = [];
  const rawChars = [];

  const layouts = lines.map((line) => {
    const chars = [...line];
    const row = [];
    let x = 0;
    for (const ch of chars) {
      if (ch.trim() === '') {
        x += 0.5;
        continue;
      }
      const en = isEnglishChar(ch);
      const px = en ? enFontPx : zhFontPx;
      measure.font = en
        ? `italic 400 ${px}px "Cormorant Garamond",Georgia,serif`
        : `400 ${px}px "Noto Serif SC","Songti SC",serif`;
      const w = Math.max(measure.measureText(ch).width, px * 0.3) * scale;
      row.push({ ch, en, px, width: w, x });
      x += w + letterGap * px * scale;
    }
    return { row, width: x };
  });

  let yCursor = centerY + ((layouts.length - 1) * lineGap) / 2;
  layouts.forEach((layout, lineIdx) => {
    const startX = centerX - layout.width / 2;
    for (const cell of layout.row) {
      const pts = rasterizeChar(cell.ch, cell.px, scale);
      if (pts.length < 20) continue;
      cells.push({
        pts,
        en: cell.en,
        cx: startX + cell.x + cell.width / 2,
        cy: yCursor,
        line: lineIdx,
        ch: cell.ch,
      });
      rawChars.push(cell.ch);
    }
    yCursor -= lineGap;
  });

  if (!cells.length) return { group, items: [], raw: rawChars };

  /* 全局 x 归一化 —— 雾锋从左到右扫过整块文字 */
  let minX = Infinity;
  let maxX = -Infinity;
  for (const c of cells) {
    for (const p of c.pts) {
      const x = c.cx + p.x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  const spanX = Math.max(0.001, maxX - minX);

  const items = [];
  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci];
    const n = cell.pts.length;
    const target = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);
    const xn = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const p = cell.pts[i];
      const x = cell.cx + p.x;
      target[i * 3] = x;
      target[i * 3 + 1] = cell.cy + p.y;
      target[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 0.3;
      xn[i] = (x - minX) / spanX;

      const g = goldAt(p.normY + (Math.random() - 0.5) * 0.12);
      // 英文笔画细、粒子密，压低亮度免得叠成白色；中文保持饱满金色
      const bright = (0.88 + Math.random() * 0.3) * (cell.en ? 0.66 : 0.86);
      color[i * 3] = g[0] * bright;
      color[i * 3 + 1] = g[1] * bright;
      color[i * 3 + 2] = g[2] * bright;

      size[i] = 0.4 + Math.random() * 0.32;
      seed[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(target, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aXNorm', new THREE.BufferAttribute(xn, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uReveal: { value: 0 },   // 0→1：雾锋从左到右把这个字显现出来
        uDissolve: { value: 0 }, // 0→1：这个字化雾上升
        uGlow: { value: 0 },     // 峰值提亮
        uDpr: { value: 1.5 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uReveal;
        uniform float uDissolve;
        uniform float uGlow;
        uniform float uDpr;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aSeed;
        attribute float aXNorm;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          float rv = clamp(uReveal, 0.0, 1.0);
          float dv = clamp(uDissolve, 0.0, 1.0);

          // 还没定型的程度：1 = 完全是一团雾，0 = 已贴合字形
          float edge = 1.0 - rv;
          float e2 = edge * edge;

          // 两路低频抖动，凑出不可名状的烟雾感
          float n1 = sin(uTime * 1.15 + aSeed * 41.0 + aXNorm * 8.0);
          float n2 = cos(uTime * 0.92 + aSeed * 27.0 - aXNorm * 6.0);

          vec3 pos = position;

          // 烟雾：显现前沿的粒子被推开、翻卷、上扬
          float smoke = e2 * (0.45 + 0.6 * aSeed);
          pos.x += n1 * smoke * 1.15;
          pos.y += n2 * smoke * 0.85 + smoke * 0.9;
          pos.z += n2 * smoke * 0.7;

          // 消散：逐字化雾上升，各自朝自己的方向飘走
          pos.y += dv * (3.2 + aSeed * 9.0);
          pos.x += sin(aSeed * 61.0) * dv * 4.6;
          pos.z += cos(aSeed * 47.0) * dv * 2.8;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // 雾态粒子更大更虚，成型后收紧 → 看起来是“凝”出来的
          float puff = 1.0 + e2 * 1.5 + dv * 1.0 + uGlow * 0.22;
          gl_PointSize = aSize * uDpr * puff * (125.0 / -mvPosition.z);

          float tw = 0.85 + 0.15 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 30.0);
          vColor = aColor * tw * (0.76 + 0.24 * uGlow);
          vAlpha = smoothstep(0.0, 0.7, rv) * (1.0 - dv) * (0.42 + 0.42 * smoothstep(0.15, 0.95, rv));
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          // 柔边：雾态要更虚
          float a = smoothstep(0.5, 0.02, d);
          a = pow(a, 1.25);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = 2;
    group.add(points);

    items.push({ material, xn: 0, line: cell.line, index: ci, raw: cell.ch });
  }

  // 用全局归一化坐标给每个字一个代表值（雾锋位置比对用）
  items.forEach((it, i) => {
    const cell = cells[i];
    it.xn = ((cell.cx - minX) / spanX);
  });

  return { group, items, raw: rawChars };
}

/** 固定祝福语 */
export const DEFAULT_TEXT = 'Merry Christmas\n圣诞快乐';

export const SEQUENCE = {
  revealMs: 2600,   // 雾锋从左扫到右
  holdMs: 6000,     // 峰值停留
  dissolveMs: 2600, // 逐字化雾
  lineDelay: 0.14,  // 第二行比第一行晚一点起步
};
