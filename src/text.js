/* text.js —— 鎏金粒子祝福语
 * 英文 Cormorant Garamond 斜体 / 中文宋体衬线；
 * 每个字符独立粒子组：局部星屑 → 快速“砸”入字形（带过冲）→ 停留 → 向外爆散。
 */
import * as THREE from 'three';

export const MAX_TEXT_LEN = 24;
export const MAX_PARTICLES_PER_CHAR = 1600;

function isEnglishChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x0020 && c <= 0x007e) || (c >= 0x00a0 && c <= 0x024f);
}

/* 鎏金：顶部白金高光 → 亮金 → 金 → 暗金 */
const GOLD = [
  [1.0, 0.98, 0.88],
  [1.0, 0.9, 0.62],
  [0.95, 0.74, 0.34],
  [0.72, 0.49, 0.16],
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
  const pad = Math.ceil(fontPx * 0.24);
  const w = Math.ceil(fontPx * 1.5) + pad * 2;
  const h = Math.ceil(fontPx * 1.75) + pad * 2;

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
 * 构建祝福语粒子。
 * @returns {{group, items, veil: null, raw: string[]}}
 */
export function buildTextParticles(text, opts = {}) {
  const {
    enFontPx = 88,
    zhFontPx = 100,
    scale = 0.028,
    letterGap = 0.2,
    lineGap = 3.2,
    centerX = 0,
    centerY = 1.0,
    centerZ = 17,
  } = opts;

  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const group = new THREE.Group();
  const items = [];
  const rawChars = [];

  const measure = document.createElement('canvas').getContext('2d');
  const layouts = lines.map((line) => {
    const chars = [...line];
    const cells = [];
    let x = 0;
    for (const ch of chars) {
      if (ch.trim() === '') {
        x += 0.6;
        continue;
      }
      const en = isEnglishChar(ch);
      const px = en ? enFontPx : zhFontPx;
      measure.font = en
        ? `italic 400 ${px}px "Cormorant Garamond",Georgia,serif`
        : `400 ${px}px "Noto Serif SC","Songti SC",serif`;
      const w = Math.max(measure.measureText(ch).width, px * 0.3) * scale;
      cells.push({ ch, en, px, width: w, x });
      x += w + letterGap * px * scale;
    }
    return { chars, cells, width: x };
  });

  const maxWidth = Math.max(...layouts.map((l) => l.width), 0.001);
  let yCursor = centerY + ((layouts.length - 1) * lineGap) / 2;

  for (const layout of layouts) {
    const startX = centerX - layout.width / 2;
    for (const cell of layout.cells) {
      const pts = rasterizeChar(cell.ch, cell.px, scale);
      if (pts.length < 20) continue;

      const n = pts.length;
      const target = new Float32Array(n * 3);
      const chaos = new Float32Array(n * 3);
      const scatter = new Float32Array(n * 3);
      const color = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const seed = new Float32Array(n);

      const cx = startX + cell.x + cell.width / 2;

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        target[i * 3] = cx + p.x;
        target[i * 3 + 1] = yCursor + p.y;
        target[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 0.25;

        // 起手星屑：贴着字形的局部薄雾（不是远处球壳），让“砸”进来更连贯
        const ang = Math.random() * Math.PI * 2;
        const rad = 1.2 + Math.pow(Math.random(), 0.7) * 5.5;
        chaos[i * 3] = target[i * 3] + Math.cos(ang) * rad;
        chaos[i * 3 + 1] = target[i * 3 + 1] + Math.sin(ang) * rad * 0.8;
        chaos[i * 3 + 2] = target[i * 3 + 2] + (Math.random() - 0.5) * 4;

        // 爆散方向：随机球面
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const sp = 0.6 + Math.random() * 0.9;
        scatter[i * 3] = Math.cos(phi) * s * sp;
        scatter[i * 3 + 1] = u * sp * 0.75 + 0.15;
        scatter[i * 3 + 2] = Math.sin(phi) * s * sp;

        const g = goldAt(p.normY + (Math.random() - 0.5) * 0.1);
        const bright = 0.9 + Math.random() * 0.35;
        color[i * 3] = g[0] * bright;
        color[i * 3 + 1] = g[1] * bright;
        color[i * 3 + 2] = g[2] * bright;

        size[i] = 0.42 + Math.random() * 0.3;
        seed[i] = Math.random();
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(target, 3));
      geo.setAttribute('aChaos', new THREE.BufferAttribute(chaos, 3));
      geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uScatter: { value: 0 },
          uDpr: { value: 1.5 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uProgress;
          uniform float uScatter;
          uniform float uDpr;
          attribute vec3 aChaos;
          attribute vec3 aScatter;
          attribute float aSize;
          attribute float aSeed;
          attribute vec3 aColor;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            float t = clamp(uProgress, 0.0, 1.0);
            // easeOutCubic —— 起步快、落位稳，形成“砸”进去的手感
            float e = 1.0 - pow(1.0 - t, 3.0);
            vec3 pos = mix(aChaos, position, e);

            // 爆散：沿随机方向冲出去，叠一点涡旋
            float sc = clamp(uScatter, 0.0, 1.0);
            pos += aScatter * sc * 34.0;
            pos.x += sin(aSeed * 40.0 + sc * 6.0) * sc * 3.2;
            pos.y += cos(aSeed * 33.0 + sc * 5.0) * sc * 2.6;

            // 成字后的呼吸浮动
            pos.y += sin(uTime * 0.9 + aSeed * 12.0) * 0.05 * (1.0 - sc);

            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // 过冲：progress 越过 1 的瞬间点变大变亮，就是“啪”的一下
            float over = max(0.0, uProgress - 1.0);
            gl_PointSize = aSize * uDpr * (125.0 / -mvPosition.z) * (1.0 + over * 4.0);

            float twinkle = 0.8 + 0.2 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 30.0);
            vColor = aColor * twinkle * (0.9 + over * 1.0);
            vAlpha = smoothstep(0.0, 0.75, t) * (1.0 - sc) * 0.62;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.05, d);
            gl_FragColor = vec4(vColor, a * a * vAlpha);
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
      items.push({ material, progress: 0, scatter: 0, raw: 0, started: false });
      rawChars.push(cell.ch);
    }
    yCursor -= lineGap;
  }

  if (!items.length) return { group, items, veil: null, raw: rawChars };

  return { group, items, veil: null, raw: rawChars };
}

/** 固定祝福语 */
export const DEFAULT_TEXT = 'Merry Christmas\n圣诞快乐';

export const SEQUENCE = {
  enStep: 0.09,   // 英文字母间隔
  zhStep: 0.42,   // 中文字间隔（略慢，能看清每个字“砸”进来）
  slamMs: 240,    // 单个字成形的时长
  holdMs: 8000,
  scatterSpeed: 1.35,
};
