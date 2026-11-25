import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import './style.css';
import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const IS_MOBILE =
  window.matchMedia('(pointer: coarse)').matches ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  window.innerWidth < 760;

const DPR = Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.75 : 2);
const TREE = { height: 32, radius: 11.6 };
const COUNTS = IS_MOBILE
  ? { foliage: 9000, lights: 220, star: 480, snow: 600, sky: 380 }
  : { foliage: 24000, lights: 520, star: 900, snow: 1200, sky: 700 };

const BASE_DIST = IS_MOBILE ? 74 : 58;
const START_DIST = IS_MOBILE ? 88 : 72;
const BASE_URL = (import.meta.env.BASE_URL || './').replace(/\/?$/, '/');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = Math.random;

/* ------------------------------------------------------------------ */
/*  DOM                                                                */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById('scene');
const intro = document.getElementById('intro');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const previewEl = document.getElementById('preview');
const videoEl = document.getElementById('video');
const skeletonEl = document.getElementById('skeleton');
const toastEl = document.getElementById('toast');
const fallbackEl = document.getElementById('fallback');
const gestureBtn = document.getElementById('gestureBtn');
const morphBtn = document.getElementById('morphBtn');
const immersiveBtn = document.getElementById('immersiveBtn');
const enterGestureBtn = document.getElementById('enterGesture');
const enterQuietBtn = document.getElementById('enterQuiet');

function setStatus(text, tone = 'idle') {
  statusText.textContent = text;
  statusEl.dataset.tone = tone;
}

let toastTimer = 0;
function toast(text, duration = 3600) {
  toastEl.textContent = text;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), duration);
}

/* ------------------------------------------------------------------ */
/*  Interaction state (shared with the render engine)                  */
/* ------------------------------------------------------------------ */

let targetProgress = 0; // start scattered for the reveal
let assembled = false;

let yawTarget = 0.35;
let pitchTarget = 0.02;

let distTarget = START_DIST;

let entered = false;
let engine = null;

let setAssembled = () => {};

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/* ------------------------------------------------------------------ */
/*  Pointer / touch                                                    */
/* ------------------------------------------------------------------ */

const pointers = new Map();
let dragMoved = 0;
let pinchBase = 0;
let pinchBaseDist = 0;

function pinchDistance() {
  const pts = [...pointers.values()];
  if (pts.length < 2) return 0;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) dragMoved = 0;
  if (pointers.size === 2) {
    pinchBase = pinchDistance();
    pinchBaseDist = distTarget;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);

  if (pointers.size === 1) {
    yawTarget -= dx * 0.0052;
    pitchTarget = clamp(pitchTarget + dy * 0.0026, -0.3, 0.4);
  } else if (pointers.size === 2) {
    const d = pinchDistance();
    if (pinchBase > 0 && d > 0) {
      distTarget = clamp((pinchBaseDist * pinchBase) / d, 34, 105);
    }
  }
});

function endPointer(e) {
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchBase = 0;
  if (wasSingle && dragMoved < 8 && document.body.classList.contains('is-immersive')) {
    setImmersive(false);
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    distTarget = clamp(distTarget + e.deltaY * 0.06, 34, 105);
  },
  { passive: false }
);

/* ------------------------------------------------------------------ */
/*  UI actions                                                         */
/* ------------------------------------------------------------------ */

setAssembled = function (next, announce = true) {
  assembled = next;
  targetProgress = next ? 1 : 0;
  morphBtn.textContent = next ? '散作星尘' : '聚合成树';
  morphBtn.setAttribute('aria-pressed', String(next));
  if (announce && !gesture.active) {
    setStatus(next ? '聚合完成 · 静赏此刻' : '星屑散开 · 轻触聚合', next ? 'ok' : 'idle');
  }
};

function setImmersive(on) {
  document.body.classList.toggle('is-immersive', on);
  immersiveBtn.setAttribute('aria-label', on ? '退出沉浸模式' : '进入沉浸模式');
  if (on) toast('点击画面或按 Esc 唤出界面', 2800);
}

function enter(withGesture) {
  if (entered) return;
  entered = true;
  document.body.classList.add('is-live');
  intro.classList.add('is-gone');
  setTimeout(() => {
    intro.hidden = true;
  }, 1400);

  distTarget = BASE_DIST;

  if (!engine) {
    setStatus('此浏览器未启用 WebGL', 'warn');
    return;
  }

  setTimeout(() => setAssembled(true, false), 320);

  if (withGesture) startGestures();
  else setStatus('触控观赏 · 拖动旋转', 'idle');
}

morphBtn.addEventListener('click', () => setAssembled(!assembled));

immersiveBtn.addEventListener('click', () =>
  setImmersive(!document.body.classList.contains('is-immersive'))
);

gestureBtn.addEventListener('click', () => {
  if (gesture.loading) return;
  if (gesture.active) stopGestures();
  else startGestures();
});

enterGestureBtn.addEventListener('click', () => enter(true));
enterQuietBtn.addEventListener('click', () => enter(false));

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') setImmersive(false);
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!entered) enter(false);
    else setAssembled(!assembled);
  }
  if (e.key.toLowerCase() === 'h') setImmersive(!document.body.classList.contains('is-immersive'));
  if (e.key.toLowerCase() === 'g' && entered && engine) {
    if (gesture.active) stopGestures();
    else startGestures();
  }
});

/* ------------------------------------------------------------------ */
/*  Gesture recognition                                                */
/* ------------------------------------------------------------------ */

const gesture = {
  active: false,
  loading: false,
  recognizer: null,
  stream: null,
  drawing: null,
  raf: 0,
  lastVideoTime: -1,
  lastDetect: 0,
  lostFrames: 0,
  present: false,
  candidate: '',
  candidateCount: 0,
  stable: '',
  palm: { x: 0.5, y: 0.5, ready: false },
  pinchActive: false,
};

let visionLib = null;

async function loadVision() {
  if (!visionLib) visionLib = await import('@mediapipe/tasks-vision');
  return visionLib;
}

function resetHand() {
  gesture.present = false;
  gesture.candidate = '';
  gesture.candidateCount = 0;
  gesture.stable = '';
  gesture.palm.ready = false;
  if (gesture.pinchActive) {
    gesture.pinchActive = false;
    distTarget = BASE_DIST;
  }
}

function updateHandPresence(present) {
  if (present === gesture.present) return;
  gesture.present = present;
  if (present) {
    setStatus('已握到你的手 · 试试握拳或张开', 'ok');
  } else {
    setStatus('把手举到镜头前', 'ok');
  }
}

function applyGesture(name) {
  if (name === 'Closed_Fist') {
    setAssembled(true, false);
    setStatus('手势 · 握拳 — 聚合成树', 'live');
  } else if (name === 'Open_Palm') {
    setAssembled(false, false);
    setStatus('手势 · 张开 — 星屑散开', 'live');
  }
}

const GESTURE_LABEL = {
  Thumb_Up: '点赞',
  Thumb_Down: '倒赞',
  Victory: '胜利',
  Pointing_Up: '指向',
  ILoveYou: '爱意',
  None: '未知',
};

function processResult(result) {
  const hands = result.landmarks;
  if (!hands || hands.length === 0) {
    gesture.lostFrames++;
    if (gesture.lostFrames > 8) {
      if (gesture.present) updateHandPresence(false);
      resetHand();
    }
    return;
  }

  gesture.lostFrames = 0;
  updateHandPresence(true);

  const lm = hands[0];

  // Palm position → orbit
  const nx = 1 - lm[9].x;
  const ny = lm[9].y;
  if (!gesture.palm.ready) {
    gesture.palm.x = nx;
    gesture.palm.y = ny;
    gesture.palm.ready = true;
  } else {
    const sx = gesture.palm.x + (nx - gesture.palm.x) * 0.3;
    const sy = gesture.palm.y + (ny - gesture.palm.y) * 0.3;
    const dx = clamp(sx - gesture.palm.x, -0.05, 0.05);
    const dy = clamp(sy - gesture.palm.y, -0.05, 0.05);
    gesture.palm.x = sx;
    gesture.palm.y = sy;

    yawTarget += dx * 3.4;
    pitchTarget = clamp(pitchTarget + dy * 1.3, -0.3, 0.4);
  }

  // Pinch → zoom
  const fingerGap = Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y);
  const palmSize = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 0.001;
  const ratio = fingerGap / palmSize;
  if (ratio < 0.62) {
    gesture.pinchActive = true;
    distTarget = clamp(
      THREE.MathUtils.mapLinear(clamp(ratio, 0.12, 0.62), 0.12, 0.62, 36, BASE_DIST),
      34,
      BASE_DIST
    );
    setStatus('手势 · 捏合 — 拉近凝望', 'live');
  } else if (gesture.pinchActive) {
    gesture.pinchActive = false;
    distTarget = BASE_DIST;
  }

  // Category gesture
  const g = result.gestures?.[0]?.[0];
  if (!g || g.score < 0.45) return;

  const name = g.categoryName;
  if (name === gesture.candidate) {
    gesture.candidateCount++;
  } else {
    gesture.candidate = name;
    gesture.candidateCount = 1;
  }

  if (gesture.candidateCount >= 3 && gesture.stable !== name) {
    gesture.stable = name;
    if (name === 'Closed_Fist' || name === 'Open_Palm') applyGesture(name);
  }

  if (
    gesture.stable &&
    gesture.stable !== 'None' &&
    gesture.stable !== 'Closed_Fist' &&
    gesture.stable !== 'Open_Palm' &&
    !gesture.pinchActive
  ) {
    setStatus(`手势 · ${GESTURE_LABEL[gesture.stable] || gesture.stable}`, 'live');
  }
}

function drawSkeleton(result) {
  const ctx = skeletonEl.getContext('2d');
  if (!ctx) return;

  if (skeletonEl.width !== videoEl.videoWidth) {
    skeletonEl.width = videoEl.videoWidth;
    skeletonEl.height = videoEl.videoHeight;
  }
  ctx.clearRect(0, 0, skeletonEl.width, skeletonEl.height);

  const lm = result.landmarks?.[0];
  if (!lm) return;

  if (!gesture.drawing) gesture.drawing = new visionLib.DrawingUtils(ctx);
  gesture.drawing.drawConnectors(lm, HAND_CONNECTIONS, {
    color: 'rgba(226, 190, 128, 0.9)',
    lineWidth: 2,
  });
  gesture.drawing.drawLandmarks(lm, {
    color: 'rgba(255, 248, 232, 0.95)',
    fillColor: 'rgba(194, 84, 91, 0.9)',
    radius: 2,
  });
}

function detectLoop() {
  if (!gesture.active) return;
  gesture.raf = requestAnimationFrame(detectLoop);

  const now = performance.now();
  if (
    !videoEl.videoWidth ||
    now - gesture.lastDetect < 32 ||
    videoEl.currentTime === gesture.lastVideoTime
  ) {
    return;
  }
  gesture.lastVideoTime = videoEl.currentTime;
  gesture.lastDetect = now;

  let result;
  try {
    result = gesture.recognizer.recognizeForVideo(videoEl, now);
  } catch (err) {
    console.warn('Gesture frame failed', err);
    return;
  }
  drawSkeleton(result);
  processResult(result);
}

async function createRecognizer() {
  const { FilesetResolver, GestureRecognizer } = await loadVision();
  const vision = await FilesetResolver.forVisionTasks(`${BASE_URL}mediapipe/wasm`);
  const modelPath = `${BASE_URL}mediapipe/gesture_recognizer.task`;

  const build = (delegate) =>
    GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  try {
    return await build('GPU');
  } catch (err) {
    console.warn('GPU delegate unavailable, falling back to CPU', err);
    return build('CPU');
  }
}

function requestCamera(constraints, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('camera-timeout'));
    }, timeoutMs);

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        clearTimeout(timer);
        if (settled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        settled = true;
        resolve(stream);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(err);
      });
  });
}

async function startGestures() {
  if (gesture.active || gesture.loading) return;
  if (!engine) {
    toast('当前浏览器未启用 WebGL，手势模式不可用');
    return;
  }

  gesture.loading = true;
  gestureBtn.textContent = '唤醒中…';
  gestureBtn.disabled = true;
  setStatus('正在唤醒手势 AI', 'idle');

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('media-devices-unavailable');
    }

    if (!gesture.recognizer) {
      setStatus('载入手势模型 · 首次稍慢', 'idle');
      gesture.recognizer = await createRecognizer();
    }

    setStatus('正在请求摄像头权限', 'idle');
    const stream = await requestCamera({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    gesture.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});

    gesture.active = true;
    previewEl.hidden = false;
    gestureBtn.textContent = '关闭手势';
    gestureBtn.classList.add('is-on');
    gestureBtn.setAttribute('aria-pressed', 'true');
    setStatus('把手举到镜头前', 'ok');
    detectLoop();
  } catch (err) {
    console.warn('Gesture setup failed', err);
    gesture.active = false;
    previewEl.hidden = true;
    gestureBtn.textContent = '开启手势';
    gestureBtn.classList.remove('is-on');

    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      setStatus('摄像头权限被拒绝', 'warn');
      toast('需要摄像头权限才能使用手势，可在浏览器设置中开启后重试');
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      setStatus('未检测到可用摄像头', 'warn');
      toast('此设备没有可用摄像头，仍可用拖拽与按钮观赏');
    } else if (name === 'NotReadableError') {
      setStatus('摄像头被其他应用占用', 'warn');
      toast('摄像头正被其他应用使用，关闭后可重试');
    } else if (err?.message === 'camera-timeout') {
      setStatus('摄像头启动超时', 'warn');
      toast('摄像头启动超时，请重试或直接用拖拽观赏');
    } else {
      setStatus('手势 AI 载入失败', 'warn');
      toast('手势不可用，请检查网络后重试 · 触控观赏不受影响');
    }
    if (gesture.stream) {
      gesture.stream.getTracks().forEach((t) => t.stop());
      gesture.stream = null;
    }
  } finally {
    gesture.loading = false;
    gestureBtn.disabled = false;
  }
}

function stopGestures() {
  gesture.active = false;
  cancelAnimationFrame(gesture.raf);
  if (gesture.stream) {
    gesture.stream.getTracks().forEach((t) => t.stop());
    gesture.stream = null;
  }
  videoEl.srcObject = null;
  previewEl.hidden = true;
  const ctx = skeletonEl.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, skeletonEl.width, skeletonEl.height);
  gestureBtn.textContent = '开启手势';
  gestureBtn.classList.remove('is-on');
  gestureBtn.setAttribute('aria-pressed', 'false');
  resetHand();
  setStatus('手势已关闭 · 可触控观赏', 'idle');
}

/* ------------------------------------------------------------------ */
/*  Render engine                                                      */
/* ------------------------------------------------------------------ */

function createEngine() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04080a);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 3.6, START_DIST);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(DPR);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,
    0.5,
    0.85
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const treeGroup = new THREE.Group();
  scene.add(treeGroup);

  /* ---- soft radial texture ------------------------------------- */

  function radialTexture(inner, mid, outer) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, mid);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ---- atmosphere ---------------------------------------------- */

  const glowTex = radialTexture(
    'rgba(255,246,226,0.95)',
    'rgba(226,190,128,0.28)',
    'rgba(0,0,0,0)'
  );

  const groundGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0xd9b877,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  groundGlow.rotation.x = -Math.PI / 2;
  groundGlow.position.y = -TREE.height / 2 - 1.4;
  scene.add(groundGlow);

  const groundAura = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0x1f7d61,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  groundAura.rotation.x = -Math.PI / 2;
  groundAura.position.y = -TREE.height / 2 - 2.2;
  scene.add(groundAura);

  const backdropHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 96),
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0x176a54,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  backdropHalo.position.set(0, 3, -34);
  scene.add(backdropHalo);

  /* ---- materials ----------------------------------------------- */

  const foliageMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uDpr: { value: DPR },
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
        float t = clamp((uProgress - aSeed * 0.18) / 0.82, 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);

        vec3 pos = mix(aChaos, position, t);

        float drift = mix(1.0, 0.22, t);
        pos.x += sin(uTime * 0.45 + aSeed * 17.0) * 0.9 * drift;
        pos.y += cos(uTime * 0.38 + aSeed * 13.0) * 0.8 * drift;
        pos.z += sin(uTime * 0.41 + aSeed * 11.0) * 0.9 * drift;

        pos.x += sin(uTime * 0.85 + position.y * 0.32 + aSeed) * 0.1 * t;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float twinkle = 0.72 + 0.28 * sin(uTime * (0.8 + aSeed * 2.2) + aSeed * 40.0);
        gl_PointSize = aSize * uDpr * (1.18 - 0.18 * t) * (135.0 / -mvPosition.z);

        vColor = aColor * twinkle * 0.84;
        vAlpha = mix(0.46, 0.68, t);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.04, d);
        a = pow(a, 1.7);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const lightsMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uDpr: { value: DPR },
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
        float t = clamp((uProgress - aSeed * 0.12) / 0.88, 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);

        vec3 pos = mix(aChaos, position, t);
        pos.x += sin(uTime * 0.5 + aSeed * 21.0) * 0.7 * mix(1.0, 0.2, t);
        pos.y += cos(uTime * 0.42 + aSeed * 15.0) * 0.6 * mix(1.0, 0.2, t);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float pulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * (1.1 + aSeed * 2.6) + aSeed * 33.0), 2.0);
        gl_PointSize = aSize * uDpr * (0.85 + 0.15 * t) * pulse * (135.0 / -mvPosition.z);

        vColor = aColor * (0.55 + 0.6 * pulse);
        vAlpha = mix(0.55, 0.78, t) * (0.5 + 0.5 * pulse);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.02, d);
        float halo = smoothstep(0.5, 0.16, d) * 0.35;
        gl_FragColor = vec4(vColor, (core * core + halo) * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDpr: { value: DPR },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uDpr;
      attribute float aSize;
      attribute float aSeed;
      attribute vec3 aColor;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 pos = position;
        pos.z += sin(uTime * 1.4 + aSeed * 12.0) * 0.12;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float twinkle = 0.6 + 0.4 * sin(uTime * (1.6 + aSeed * 3.0) + aSeed * 50.0);
        gl_PointSize = aSize * uDpr * (135.0 / -mvPosition.z);

        vColor = aColor * (0.7 + 0.45 * twinkle);
        vAlpha = 0.7 * twinkle;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, a * a * vAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const snowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDpr: { value: DPR },
      uColor: { value: new THREE.Color('#d7ece4') },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uDpr;
      attribute float aSize;
      attribute float aSeed;
      varying float vAlpha;

      void main() {
        vec3 pos = position;
        pos.y = mod(pos.y - uTime * (1.6 + aSeed * 2.6), 92.0) - 46.0;
        pos.x += sin(uTime * 0.32 + aSeed * 22.0) * 2.2;
        pos.z += cos(uTime * 0.26 + aSeed * 17.0) * 1.4;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        gl_PointSize = aSize * uDpr * (95.0 / -mvPosition.z);
        vAlpha = (0.16 + 0.5 * aSeed) * smoothstep(0.0, 8.0, -mvPosition.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(uColor, a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  /* ---- geometry builders --------------------------------------- */

  function buildFoliage() {
    const count = COUNTS.foliage;
    const tree = new Float32Array(count * 3);
    const chaos = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);

    const c = new THREE.Color();
    const H = TREE.height;
    const R = TREE.radius;

    for (let i = 0; i < count; i++) {
      const t = Math.pow(rand(), 0.82);
      const y = -H / 2 + t * H;

      const profile = Math.pow(1 - t, 0.96);
      const tier = 0.83 + 0.17 * Math.cos(((t * 9) % 1) * Math.PI * 2);
      const shell = 0.56 + 0.44 * Math.pow(rand(), 0.38);
      const radius = R * profile * tier * shell;

      const theta = rand() * Math.PI * 2 + t * 7.5;
      tree[i * 3] = Math.cos(theta) * radius;
      tree[i * 3 + 1] = y + (rand() - 0.5) * 0.5;
      tree[i * 3 + 2] = Math.sin(theta) * radius;

      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const rr = 28 + Math.pow(rand(), 0.65) * 27;
      const s = Math.sqrt(1 - u * u);
      chaos[i * 3] = Math.cos(phi) * s * rr;
      chaos[i * 3 + 1] = u * rr * 0.72 + 1.5;
      chaos[i * 3 + 2] = Math.sin(phi) * s * rr;

      const r = rand();
      let hex;
      let sz;
      if (r < 0.66) {
        hex = '#0d5038';
        sz = 1.05 + rand() * 1.35;
      } else if (r < 0.865) {
        hex = '#1b7d5b';
        sz = 1.1 + rand() * 1.4;
      } else if (r < 0.92) {
        hex = '#8bd8b6';
        sz = 1.2 + rand() * 1.4;
      } else if (r < 0.975) {
        hex = '#e6c184';
        sz = 1.55 + rand() * 1.7;
      } else {
        hex = '#c94f57';
        sz = 1.4 + rand() * 1.5;
      }

      c.set(hex);
      if (rand() < 0.35) c.multiplyScalar(0.62 + rand() * 0.3);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;

      // compensate the higher particle density near the apex
      size[i] = sz * (0.52 + 0.48 * profile);
      seed[i] = rand();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(tree, 3));
    geo.setAttribute('aChaos', new THREE.BufferAttribute(chaos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const points = new THREE.Points(geo, foliageMat);
    points.frustumCulled = false;
    return points;
  }

  function buildLights() {
    const count = COUNTS.lights;
    const tree = new Float32Array(count * 3);
    const chaos = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);

    const palette = ['#ff5a4d', '#ff5a4d', '#ffc96a', '#ffc96a', '#ff8f5f', '#ffe3a8', '#7fd0ff'];
    const c = new THREE.Color();
    const H = TREE.height;
    const R = TREE.radius;

    for (let i = 0; i < count; i++) {
      const t = Math.pow(rand(), 0.9);
      const y = -H / 2 + t * H;
      const radius = R * Math.pow(1 - t, 0.95) * (0.94 + rand() * 0.12);
      const theta = rand() * Math.PI * 2 + t * 7.5;

      tree[i * 3] = Math.cos(theta) * radius;
      tree[i * 3 + 1] = y + (rand() - 0.5) * 0.8;
      tree[i * 3 + 2] = Math.sin(theta) * radius;

      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const rr = 30 + Math.pow(rand(), 0.6) * 28;
      const s = Math.sqrt(1 - u * u);
      chaos[i * 3] = Math.cos(phi) * s * rr;
      chaos[i * 3 + 1] = u * rr * 0.75 + 2;
      chaos[i * 3 + 2] = Math.sin(phi) * s * rr;

      c.set(palette[Math.floor(rand() * palette.length)]);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;

      size[i] = 2.7 + rand() * 2.6;
      seed[i] = rand();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(tree, 3));
    geo.setAttribute('aChaos', new THREE.BufferAttribute(chaos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const points = new THREE.Points(geo, lightsMat);
    points.frustumCulled = false;
    return points;
  }

  function buildStar() {
    const count = COUNTS.star;
    const pos = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);

    const c = new THREE.Color();
    const palette = ['#ffeec2', '#f7d99a', '#e9c07a', '#fff6df'];
    const OUTER = 3.1;
    const INNER = 0.46;
    const SEG = (Math.PI * 2) / 5;

    for (let i = 0; i < count; i++) {
      const ang = rand() * Math.PI * 2;
      const a = (ang % SEG) / SEG;
      const env = INNER + (1 - INNER) * Math.abs(1 - 2 * a);
      const rr =
        i < count * 0.06
          ? OUTER * 0.18 * Math.sqrt(rand())
          : OUTER * env * Math.pow(rand(), 0.4);

      pos[i * 3] = Math.cos(ang - Math.PI / 2) * rr + (rand() - 0.5) * 0.08;
      pos[i * 3 + 1] = Math.sin(ang - Math.PI / 2) * rr + (rand() - 0.5) * 0.08;
      pos[i * 3 + 2] = (rand() - 0.5) * 0.4;

      c.set(palette[Math.floor(rand() * palette.length)]);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;

      size[i] = 1.1 + rand() * 1.3;
      seed[i] = rand();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const group = new THREE.Group();
    group.position.set(0, TREE.height / 2 + 4.4, 0);
    const points = new THREE.Points(geo, starMat);
    points.frustumCulled = false;
    group.add(points);
    return group;
  }

  function buildSnow() {
    const count = COUNTS.snow;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 120;
      pos[i * 3 + 1] = rand() * 92; // consumed by mod() in shader
      pos[i * 3 + 2] = (rand() - 0.5) * 90 - 10;
      size[i] = 0.9 + rand() * 2.1;
      seed[i] = rand();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    const points = new THREE.Points(geo, snowMat);
    points.frustumCulled = false;
    return points;
  }

  function buildSky() {
    const count = COUNTS.sky;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const rr = 150 + rand() * 90;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(phi) * s * rr;
      pos[i * 3 + 1] = u * rr * 0.65;
      pos[i * 3 + 2] = Math.sin(phi) * s * rr;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fb9b2,
      size: 1.15,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }

  treeGroup.add(buildFoliage());
  treeGroup.add(buildLights());
  const starGroup = buildStar();
  treeGroup.add(starGroup);

  const snow = buildSnow();
  scene.add(snow);
  const sky = buildSky();
  scene.add(sky);

  /* ---- loop ----------------------------------------------------- */

  const clock = new THREE.Clock();
  let progress = 0;
  let yaw = yawTarget;
  let pitch = pitchTarget;
  let dist = START_DIST;
  let stopped = false;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }

  function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    progress += (targetProgress - progress) * (1 - Math.exp(-1.9 * dt));
    foliageMat.uniforms.uProgress.value = progress;
    foliageMat.uniforms.uTime.value = t;
    lightsMat.uniforms.uProgress.value = progress;
    lightsMat.uniforms.uTime.value = t;
    snowMat.uniforms.uTime.value = t;
    starMat.uniforms.uTime.value = t;
    starMat.uniforms.uOpacity.value = clamp(progress * 1.25, 0, 0.92);

    starGroup.scale.setScalar(0.4 + progress * 0.6);
    starGroup.rotation.z = Math.sin(t * 0.22) * 0.09;

    if (!gesture.present) {
      yawTarget += dt * (0.045 + 0.02 * (1 - progress));
    }

    yaw += (yawTarget - yaw) * (1 - Math.exp(-4.2 * dt));
    pitch += (pitchTarget - pitch) * (1 - Math.exp(-4.2 * dt));
    treeGroup.rotation.y = yaw;
    treeGroup.rotation.x = pitch;

    dist += (distTarget - dist) * (1 - Math.exp(-2.2 * dt));
    camera.position.set(0, 3.6 + Math.sin(t * 0.24) * 0.35, dist);
    camera.lookAt(0, 1.2 + progress * 1.4, 0);

    sky.rotation.y = t * 0.008;
    snow.rotation.y = Math.sin(t * 0.05) * 0.06;

    groundGlow.material.opacity = 0.16 + progress * 0.14;
    backdropHalo.material.opacity = 0.09 + progress * 0.09;

    composer.render();
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (stopped) return;
    stopped = true;
    renderer.setAnimationLoop(null);
    document.body.classList.add('no-webgl');
    fallbackEl.hidden = false;
    setStatus('图形上下文丢失 · 请刷新页面', 'warn');
  });

  renderer.setAnimationLoop(animate);

  return { resize };
}

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

setAssembled(false, false);

try {
  engine = createEngine();
} catch (err) {
  console.warn('WebGL unavailable', err);
  document.body.classList.add('no-webgl');
  fallbackEl.hidden = false;
  setStatus('当前浏览器未启用 WebGL', 'warn');
  gestureBtn.hidden = true;
  morphBtn.hidden = true;
  enterGestureBtn.hidden = true;
  enterQuietBtn.textContent = '进入';
}

window.addEventListener('resize', () => engine?.resize());

window.addEventListener('pagehide', () => {
  if (gesture.active) stopGestures();
});

// Keep the mobile browser chrome from fighting the canvas.
document.addEventListener('gesturestart', (e) => e.preventDefault());
