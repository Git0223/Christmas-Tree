/* text.js —— 逐字粒子聚散展示
 * 用离屏 canvas 把每个字画成白色，然后把像素坐标采样成粒子位置，
 * 让粒子从周围的球形 chaos 态 morph 到最终的字形。
 * 每个字一个独立的 uLetterProgress uniform，控制逐字出现。
 */
import * as THREE from 'three';

export const MAX_TEXT_LEN = 8;        // 最多 8 个字（安全上限）
export const MAX_PARTICLES_PER_LETTER = 480;

// 在离屏 canvas 上画出一个字，返回 [x, y] 像素坐标数组
function rasterizeLetter(char, fontSizePx, step) {
  const w = Math.ceil(fontSizePx * 1.15);
  const h = Math.ceil(fontSizePx * 1.4);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = `${fontSizePx}px "Songti SC","STSong","Noto Serif CJK SC","SimSun",serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, w / 2, h / 2 + fontSizePx * 0.04);

  const data = ctx.getImageData(0, 0, w, h).data;
  const out = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i] > 128) out.push([x - w / 2, -(y - h / 2)]);
    }
  }
  return out.slice(0, MAX_PARTICLES_PER_LETTER);
}

export function buildTextParticles(text, opts = {}) {
  const { fontSize = 34, letterGap = 1.1, centerY = -TREE_HALF(), centerZ = 3 } = opts;
  const TREE_H = 32;
  const TREE_HALF_VAL = TREE_H / 2;
  // 用模块导入的 THREE 下的 TREE.height/2——但本模块独立，传参进来
  // 这里 opts 里已给 centerY = -TREE_HALF() 默认值

  const chars = [...text].slice(0, MAX_TEXT_LEN);
  if (chars.length === 0) {
    // 返回一个空 group，不影响主程序
    return { group: new THREE.Group(), progresses: new Float32Array(MAX_TEXT_LEN) };
  }

  // ---- 先算每个字的像素宽，用来排布居中 ----
  const widths = chars.map(() => fontSize * letterGap);
  const totalW = widths.reduce((s, v) => s + v, 0);
  const startX = -totalW / 2 + widths[0] / 2;

  // 每个字独立一个 Points 对象
  const group = new THREE.Group();
  const progresses = new Float32Array(MAX_TEXT_LEN);
  const anims = [];

  for (let li = 0; li < chars.length; li++) {
    const samples = rasterizeLetter(chars[li], fontSize, 4);
    if (samples.length < 20) continue;

    const n = samples.length;
    const target = new Float32Array(n * 3);
    const chaos = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);

    const c = new THREE.Color();
    const palette = ['#ffeec2', '#f2dfb2', '#ffd28a', '#fff6df'];
    const cxOfLetter = startX + widths.slice(0, li).reduce((s, v) => s + v, 0);

    for (let i = 0; i < n; i++) {
      const [px, py] = samples[i];
      // 像素单位 → 场景单位（约 34px = 树高 32 的 1/12 → 0.37 单位）
      const S = 0.011;
      target[i * 3] = cxOfLetter + px * S;
      target[i * 3 + 1] = centerY + py * S;
      target[i * 3 + 2] = centerZ + (Math.random() - 0.5) * 0.35;

      // chaos：环绕树的球形散布
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const rr = 32 + Math.pow(Math.random(), 0.55) * 22;
      const s = Math.sqrt(1 - u * u);
      chaos[i * 3] = Math.cos(phi) * s * rr;
      chaos[i * 3 + 1] = u * rr * 0.7;
      chaos[i * 3 + 2] = Math.sin(phi) * s * rr + centerZ * 0.3;

      c.set(palette[Math.floor(Math.random() * palette.length)]);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;

      size[i] = 1.1 + Math.random() * 1.1;
      seed[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(target, 3));
    geo.setAttribute('aChaos', new THREE.BufferAttribute(chaos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const mat = new THREE.ShaderMaterial({
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
          float t = clamp(uProgress, 0.0, 1.0);
          float d = 1.0 - abs(t - 0.5) * 2.0;  // peak at t=1
          t = smoothstep(0.0, 1.0, t);

          vec3 pos = mix(aChaos, position, t);
          pos.x += sin(uTime * 0.6 + aSeed * 19.0) * 0.12 * (1.0 - t * 0.8);
          pos.y += cos(uTime * 0.5 + aSeed * 13.0) * 0.10 * (1.0 - t * 0.8);

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          gl_PointSize = aSize * uDpr * (88.0 / -mvPosition.z);

          float twinkle = 0.7 + 0.3 * sin(uTime * (1.2 + aSeed * 2.2) + aSeed * 30.0);
          vColor = aColor * twinkle;
          vAlpha = d * 0.95;
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

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);
  }

  return { group, progresses };
}

// 文本逐字序列控制（外部每帧调用 progresses[]）
// 调用者负责把 progresses[i] 赋给对应 shader 的 uProgress
export const SEQUENCE = {
  assembleDelayMs: 1800,  // 树聚合后等多久开始文字
  perLetterInMs: 700,
  holdMs: 6000,
  perLetterOutMs: 420,
};
