/* text.js —— 逐字粒子聚散展示
 * 用离屏 canvas 把每个字符画成白色，再按像素采样成粒子坐标；
 * 粒子从球形 chaos 态 morph 到字形，每个字有独立的 uProgress 控制逐字出现。
 */
import * as THREE from 'three';

export const MAX_TEXT_LEN = 8;

// 在离屏 canvas 上画出单个字符，返回粒子采样点（单位：场景坐标）
// 注意：step 必须是整数，否则像素索引会变成小数导致采样失败
function rasterizeChar(char, fontPx, scale, step = 2) {
  const pad = Math.ceil(fontPx * 0.18);
  const w = Math.ceil(fontPx * 1.2) + pad * 2;
  const h = Math.ceil(fontPx * 1.45) + pad * 2;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  const stacks = [
    `600 ${fontPx}px "Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif`,
    `600 ${fontPx}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif`,
  ];

  let pixels = null;

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
        if (data[(y * w + x) * 4] > 120) {
          pts.push([(x - w / 2) * scale, -(y - h / 2) * scale]);
        }
      }
    }
    // 采样点太少说明字体里没有该字形（例如生僻字），换下一种字体再试
    if (pts.length > 40) {
      pixels = pts;
      break;
    }
    if (!pixels || pts.length > pixels.length) pixels = pts;
  }

  // 极端兜底：字体缺字时画一个粒子环，保证仍有可见反馈
  if (!pixels || pixels.length < 40) {
    pixels = [];
    const r = fontPx * 0.34 * scale;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      pixels.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return pixels;
}

/**
 * 生成整段文字的粒子
 * @param {string} text 最多 MAX_TEXT_LEN 个字符
 * @param {object} opts { fontPx, scale, letterGap, centerY, centerZ }
 * @returns {{ group: THREE.Group, items: Array<{material: THREE.ShaderMaterial, progress: number}> }}
 */
export function buildTextParticles(text, opts = {}) {
  const {
    fontPx = 40,
    scale = 0.112,
    letterGap = 0.22,
    centerY = 0.6,
    centerZ = 17,
    maxLen = MAX_TEXT_LEN,
  } = opts;

  const chars = [...String(text || '')].filter((ch) => ch.trim() !== '').slice(0, maxLen);
  const group = new THREE.Group();
  const items = [];

  if (chars.length === 0) return { group, items, veil: null };

  // 先用 canvas 量每个字的实际宽度，用于水平居中
  const measure = document.createElement('canvas').getContext('2d');
  const widths = chars.map((ch) => {
    measure.font = `600 ${fontPx}px "Songti SC","STSong","Noto Serif CJK SC","SimSun",serif`;
    const w = measure.measureText(ch).width;
    return Math.max(w, fontPx * 0.55) * scale;
  });
  const gap = fontPx * letterGap * scale;
  const totalW = widths.reduce((s, v) => s + v, 0) + gap * (chars.length - 1);
  let cursor = -totalW / 2;

  const palette = ['#ffeec2', '#f2dfb2', '#ffd28a', '#fff6df'];
  const c = new THREE.Color();

  for (let li = 0; li < chars.length; li++) {
    const px = rasterizeChar(chars[li], fontPx, scale);
    const n = px.length;
    const cx = cursor + widths[li] / 2;
    cursor += widths[li] + gap;

    const target = new Float32Array(n * 3);
    const chaos = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      target[i * 3] = cx + px[i][0];
      target[i * 3 + 1] = centerY + px[i][1];
      target[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 0.4;

      // chaos：环绕树的球壳散布
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

      size[i] = 1.4 + Math.random() * 1.3;
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
          pos.x += sin(uTime * 0.6 + aSeed * 19.0) * 0.14 * (1.0 - t * 0.8);
          pos.y += cos(uTime * 0.5 + aSeed * 13.0) * 0.12 * (1.0 - t * 0.8);

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          gl_PointSize = aSize * uDpr * (120.0 / -mvPosition.z);

          float twinkle = 0.74 + 0.26 * sin(uTime * (1.2 + aSeed * 2.2) + aSeed * 30.0);
          vColor = aColor * twinkle * 1.18;
          vAlpha = clamp(uProgress, 0.0, 1.0) * 0.98;
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
    points.renderOrder = 2;
    group.add(points);
    items.push({ material, progress: 0 });
  }

  // 柔和暗色衬底：压住背后的树灯，保证文字在密集粒子前依然清晰
  const veilCanvas = document.createElement('canvas');
  veilCanvas.width = 256;
  veilCanvas.height = 128;
  const vctx = veilCanvas.getContext('2d');
  const grad = vctx.createRadialGradient(128, 64, 10, 128, 64, 100);
  grad.addColorStop(0, 'rgba(2, 8, 7, 0.92)');
  grad.addColorStop(0.55, 'rgba(2, 8, 7, 0.72)');
  grad.addColorStop(1, 'rgba(2, 8, 7, 0)');
  vctx.fillStyle = grad;
  vctx.fillRect(0, 0, 256, 128);

  const veilTex = new THREE.CanvasTexture(veilCanvas);
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(totalW * 1.3, fontPx * scale * 2.1),
    new THREE.MeshBasicMaterial({
      map: veilTex,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    })
  );
  veil.position.set(0, centerY, centerZ - 2.4);
  veil.renderOrder = 1;
  group.add(veil);

  return { group, items, veil };
}

export const SEQUENCE = {
  assembleDelayMs: 1600, // 聚合完成后延迟开始
  perLetterInMs: 620,    // 逐字间隔
  letterInSpeed: 1.9,    // 单字 morph 速度（每秒 progress）
  holdMs: 6200,          // 全部展示后停留
  letterOutSpeed: 2.6,   // 散开速度
};
