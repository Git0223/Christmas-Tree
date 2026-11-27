/* text.js —— 鎏金粒子祝福语
 * 英文走 Cormorant Garamond 斜体艺术字，中文走宋体；
 * 每个字符独立成粒子组，uProgress 控制「球形星屑 → 字形」的 morph。
 */
import * as THREE from 'three';

export const MAX_TEXT_LEN = 24;
export const MAX_PARTICLES_PER_CHAR = 2600;

function isEnglishChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x0020 && c <= 0x007e) || (c >= 0x00a0 && c <= 0x024f);
}

/* 鎏金配色：顶部高光白金 → 中部亮金 → 底部暗金 */
const GOLD = [
  [1.0, 0.97, 0.82], // 白金高光
  [1.0, 0.86, 0.52], // 亮金
  [0.91, 0.68, 0.28], // 金
  [0.62, 0.42, 0.13], // 暗金
];

function goldAt(t) {
  // t: 0(字顶) → 1(字底)
  const x = Math.min(0.999, Math.max(0, t)) * (GOLD.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = GOLD[i];
  const b = GOLD[Math.min(GOLD.length - 1, i + 1)];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

/* 离屏栅格化单个字符，返回 [{x,y,normY}]（场景坐标） */
function rasterizeChar(char, fontPx, scale, step = 1) {
  const pad = Math.ceil(fontPx * 0.22);
  const w = Math.ceil(fontPx * 1.5) + pad * 2;
  const h = Math.ceil(fontPx * 1.7) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const stacks = isEnglishChar(char)
    ? [
        `italic 500 ${fontPx}px "Cormorant Garamond","CormorantGaramond","Palatino Linotype",Georgia,serif`,
        `italic 500 ${fontPx}px Georgia,serif`,
      ]
    : [
        `500 ${fontPx}px "Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif`,
        `500 ${fontPx}px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",serif`,
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
          pts.push({
            x: (x - w / 2) * scale,
            y: -(y - h / 2) * scale,
            normY: y / h,
          });
        }
      }
    }
    if (!best || pts.length > best.length) best = pts;
  }

  if (!best || best.length < 30) {
    best = [];
    const r = fontPx * 0.4 * scale;
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      best.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, normY: 0.5 + Math.sin(a) * 0.5 });
    }
  }
  if (best.length > MAX_PARTICLES_PER_CHAR) {
    // 均匀抽稀，避免单字粒子过多
    const keep = [];
    const strideN = best.length / MAX_PARTICLES_PER_CHAR;
    for (let i = 0; i < MAX_PARTICLES_PER_CHAR; i++) {
      keep.push(best[Math.floor(i * strideN)]);
    }
    return keep;
  }
  return best;
}

/**
 * 构建祝福语粒子。
 * @param {string} text  用 \n 分行，例如 "Merry Christmas\n圣诞快乐"
 * @param {object} opts  { enFontPx, zhFontPx, scale, letterGap, lineGap, centerX, centerY, centerZ }
 * @returns {{group, items, veil, raw: string[]}}
 */
export function buildTextParticles(text, opts = {}) {
  const {
    enFontPx = 62,
    zhFontPx = 70,
    scale = 0.045,
    letterGap = 0.16,   // em 倍数
    lineGap = 2.9,      // 场景单位
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

  // ---- 量宽 + 分行 ----
  const measure = document.createElement('canvas').getContext('2d');
  const layouts = lines.map((line) => {
    const chars = [...line];
    const cells = [];
    let x = 0;
    for (const ch of chars) {
      if (ch.trim() === '') {
        x += 0.5; // 空格占位
        continue;
      }
      const en = isEnglishChar(ch);
      const px = en ? enFontPx : zhFontPx;
      measure.font = en
        ? `italic 500 ${px}px "Cormorant Garamond",Georgia,serif`
        : `500 ${px}px "Songti SC",serif`;
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
      const color = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const seed = new Float32Array(n);

      const cx = startX + cell.x + cell.width / 2;

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        target[i * 3] = cx + p.x;
        target[i * 3 + 1] = yCursor + p.y;
        target[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 0.3;

        // 星屑：围绕文字区域的球壳
        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const rr = 20 + Math.pow(Math.random(), 0.6) * 26;
        const s = Math.sqrt(1 - u * u);
        chaos[i * 3] = cx + Math.cos(phi) * s * rr * 0.6;
        chaos[i * 3 + 1] = yCursor + u * rr * 0.5;
        chaos[i * 3 + 2] = centerZ + Math.sin(phi) * s * rr * 0.5;

        // 鎏金渐变色
        const g = goldAt(p.normY + (Math.random() - 0.5) * 0.12);
        const bright = 0.85 + Math.random() * 0.35;
        color[i * 3] = g[0] * bright;
        color[i * 3 + 1] = g[1] * bright;
        color[i * 3 + 2] = g[2] * bright;

        size[i] = 0.62 + Math.random() * 0.5;
        seed[i] = Math.random();
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(target, 3));
      geo.setAttribute('aChaos', new THREE.BufferAttribute(chaos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uDpr: { value: 1.5 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uProgress;
          uniform float uDpr;
          attribute vec3 aChaos;
          attribute float aSize;
          attribute float aSeed;
          attribute vec3 aColor;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            float t = smoothstep(0.0, 1.0, clamp(uProgress, 0.0, 1.0));
            vec3 pos = mix(aChaos, position, t);
            // 成字后仍有极轻的呼吸浮动
            pos.y += sin(uTime * 0.9 + aSeed * 12.0) * 0.06;
            pos.x += cos(uTime * 0.7 + aSeed * 9.0) * 0.05;

            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            gl_PointSize = aSize * uDpr * (118.0 / -mvPosition.z);

            float twinkle = 0.78 + 0.22 * sin(uTime * (0.9 + aSeed * 1.8) + aSeed * 30.0);
            vColor = aColor * twinkle * 1.15;
            vAlpha = clamp(uProgress, 0.0, 1.0) * 0.95;
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
      items.push({ material, progress: 0 });
      rawChars.push(cell.ch);
    }
    yCursor -= lineGap;
  }

  // 暗色绒雾衬底，压住背后树灯
  const veilW = Math.max(maxWidth * 1.5, 14);
  const veilH = Math.max(layouts.length * lineGap * 1.3, 6);
  const veilCanvas = document.createElement('canvas');
  veilCanvas.width = 256;
  veilCanvas.height = 128;
  const vctx = veilCanvas.getContext('2d');
  const grad = vctx.createRadialGradient(128, 64, 10, 128, 64, 104);
  grad.addColorStop(0, 'rgba(2, 8, 10, 0.82)');
  grad.addColorStop(0.6, 'rgba(2, 8, 10, 0.55)');
  grad.addColorStop(1, 'rgba(2, 8, 10, 0)');
  vctx.fillStyle = grad;
  vctx.fillRect(0, 0, 256, 128);

  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(veilW, veilH),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(veilCanvas),
      transparent: true,
      depthWrite: false,
      opacity: 0,
    })
  );
  veil.position.set(centerX, centerY, centerZ - 2.2);
  veil.renderOrder = 1;
  group.add(veil);

  return { group, items, veil, raw: rawChars };
}

/** 固定祝福语：英文一行、中文一行 */
export const DEFAULT_TEXT = 'Merry Christmas\n圣诞快乐';

export const SEQUENCE = {
  enStep: 0.075,   // 英文字母 75ms 一个字，稍快
  zhStep: 0.5,     // 中文 500ms 一个字，略慢
  morphSpeed: 2.0,
  holdMs: 8000,
  outSpeed: 2.6,
};
