/* text.js —— 逐字粒子聚散展示
 * 英文走 Cormorant Garamond 斜体艺术字；中文走宋体。
 * 每个字独立一个 Points 对象，uProgress 控制 Morph：球形 chaos → 字形。
 */
import * as THREE from 'three';

export const MAX_TEXT_LEN = 24;
export const MAX_PARTICLES_PER_CHAR = 560;

function isEnglishChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x0020 && c <= 0x007e) || (c >= 0x00a0 && c <= 0x024f);
}

function rasterizeChar(char, fontPx, scale, step = 2) {
  const pad = Math.ceil(fontPx * 0.2);
  const w = Math.ceil(fontPx * 1.4) + pad * 2;
  const h = Math.ceil(fontPx * 1.6) + pad * 2;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  // 英文字母走艺术斜体（Cormorant Garamond italic 600 / 宋体 600）
  const enStacks = [
    `italic 600 ${fontPx}px "Cormorant Garamond","CormorantGaramond","Palatino Linotype",Georgia,serif`,
    `italic 600 ${fontPx}px "Times New Roman",serif`,
  ];
  const zhStacks = [
    `600 ${fontPx}px "Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif`,
    `600 ${fontPx}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",serif`,
  ];

  const stacks = isEnglishChar(char) ? enStacks : zhStacks;

  let best = null;
  for (const font of stacks) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 英文用 0.92 缩一点，避免太粗
    if (isEnglishChar(char)) {
      ctx.fillText(char, w / 2, h / 2 + fontPx * 0.02);
    } else {
      ctx.fillText(char, w / 2, h / 2 + fontPx * 0.04);
    }

    const data = ctx.getImageData(0, 0, w, h).data;
    const pts = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4] > 120) {
          pts.push([(x - w / 2) * scale, -(y - h / 2) * scale]);
        }
      }
    }
    if (!best || pts.length > best.length) best = pts;
  }

  if (!best || best.length < 40) {
    // 极端兜底：圆环
    best = [];
    const r = fontPx * 0.4 * scale;
    for (let i = 0; i < 140; i++) {
      const a = (i / 140) * Math.PI * 2;
      best.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return best.slice(0, MAX_PARTICLES_PER_CHAR);
}

/**
 * 构建整段文字的粒子。每个字符独立一个 Points，共享同一个渐变衬底。
 * @returns {{group, items, veil, raw: string[]}}  raw: 每个字符（包括空格）的数组，与 items 等长
 */
export function buildTextParticles(text, opts = {}) {
  const {
    enFontPx = 32,
    zhFontPx = 42,
    scale = 0.11,
    letterGap = 0.28,
    wordGap = 0.55,
    lineGap = 1.0,
    centerY = 2.2,
    centerZ = 18,
  } = opts;

  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const group = new THREE.Group();
  const items = [];

  // 先算每个字的宽度 + 分行布局
  const layout = [];
  let totalWidth = 0;
  for (const line of lines) {
    const lineChars = [...line];
    const widths = [];
    let x = 0;
    for (let i = 0; i < lineChars.length; i++) {
      const ch = lineChars[i];
      const isEn = isEnglishChar(ch);
      const px = isEn ? enFontPx : zhFontPx;
      const measure = document.createElement('canvas').getContext('2d');
      measure.font = isEn
        ? `italic 600 ${px}px "Cormorant Garamond",serif`
        : `600 ${px}px "Songti SC",serif`;
      const w = Math.max(measure.measureText(ch).width, px * 0.38) * scale;
      widths.push({ ch, isEn, fontPx: px, width: w, x });
      x += w + letterGap * scale;
      if (ch === ' ') {
        // 空格额外留 wordGap
        x += wordGap * scale;
      }
    }
    totalWidth = Math.max(totalWidth, x);
    layout.push({ lineChars, widths });
  }

  // 每个字一个 Points
  const palette = ['#ffeec2', '#f7d99a', '#ffd28a', '#fff6df', '#e4f5f4', '#7ce5df'];
  const c = new THREE.Color();

  let yCursor = centerY + ((lines.length - 1) * (zhFontPx * scale + lineGap * scale)) / 2;

  for (const line of layout) {
    const lineChars = [...line.lineChars];
    const half = totalWidth / 2;
    for (let i = 0; i < lineChars.length; i++) {
      const ch = lineChars[i];
      const isEn = isEnglishChar(ch);
      const fontPx = isEn ? enFontPx : zhFontPx;
      const px = rasterizeChar(ch, fontPx, scale);
      if (px.length < 30) continue;

      const n = px.length;
      const target = new Float32Array(n * 3);
      const chaos = new Float32Array(n * 3);
      const color = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const seed = new Float32Array(n);

      const cx = -half + line.widths[i].x + line.widths[i].width / 2;

      for (let i = 0; i < n; i++) {
        target[i * 3] = cx + px[i][0];
        target[i * 3 + 1] = yCursor + px[i][1];
        target[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 0.35;

        const u = Math.random() * 2 - 1;
        const phi = Math.random() * Math.PI * 2;
        const rr = 32 + Math.pow(Math.random(), 0.55) * 22;
        const s = Math.sqrt(1 - u * u);
        chaos[i * 3] = Math.cos(phi) * s * rr;
        chaos[i * 3 + 1] = u * rr * 0.7;
        chaos[i * 3 + 2] = Math.sin(phi) * s * rr + centerZ * 0.2;

        c.set(palette[Math.floor(Math.random() * palette.length)]);
        color[i * 3] = c.r;
        color[i * 3 + 1] = c.g;
        color[i * 3 + 2] = c.b;

        size[i] = isEn ? 1.4 + Math.random() * 1.0 : 1.3 + Math.random() * 1.2;
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
            pos.x += sin(uTime * 0.6 + aSeed * 19.0) * 0.12 * (1.0 - t * 0.7);
            pos.y += cos(uTime * 0.5 + aSeed * 13.0) * 0.10 * (1.0 - t * 0.7);

            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            gl_PointSize = aSize * uDpr * (110.0 / -mvPosition.z);

            float twinkle = 0.72 + 0.28 * sin(uTime * (1.2 + aSeed * 2.2) + aSeed * 30.0);
            vColor = aColor * twinkle;
            vAlpha = t * 0.95;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.02, d);
            gl_FragColor = vec4(vColor, a * a * vAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const points = new THREE.Points(geo, material);
      points.frustumCulled = false;
      group.add(points);
      items.push({ material, progress: 0 });
    }
    yCursor -= zhFontPx * scale + lineGap * scale;
  }

  // 柔和暗色衬底（在树后方、文字前方）
  const veilW = Math.max(totalWidth * 1.6, 24);
  const veilCanvas = document.createElement('canvas');
  veilCanvas.width = 256;
  veilCanvas.height = 128;
  const vctx = veilCanvas.getContext('2d');
  const grad = vctx.createRadialGradient(128, 64, 8, 128, 64, 100);
  grad.addColorStop(0, 'rgba(2, 12, 18, 0.88)');
  grad.addColorStop(0.55, 'rgba(2, 12, 18, 0.65)');
  grad.addColorStop(1, 'rgba(2, 12, 18, 0)');
  vctx.fillStyle = grad;
  vctx.fillRect(0, 0, 256, 128);
  const veilTex = new THREE.CanvasTexture(veilCanvas);
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(veilW, zhFontPx * scale * 1.8),
    new THREE.MeshBasicMaterial({ map: veilTex, transparent: true, depthWrite: false, opacity: 0 })
  );
  veil.position.set(0, centerY - zhFontPx * scale * 0.2, centerZ - 2.4);
  group.add(veil);

  return { group, items, veil, raw: chars };
}

/** 默认固定的两行文案 */
export const DEFAULT_TEXT = 'Merry Christmas\n圣诞快乐';

export const SEQUENCE = {
  // 每个字的基础间隔（秒）——英文按字母稍快，中文稍慢
  enStep: 0.08,   // 英文字母间隔 80ms
  zhStep: 0.45,   // 中文 4 字各 450ms → 总共 1.8s
  morphSpeed: 1.8, // 每个字 morph 到 1 的速度（每秒）
  holdMs: 6500,
  outSpeed: 2.6,
};
