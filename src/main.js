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
import { buildTextParticles, DEFAULT_TEXT, SEQUENCE, MAX_TEXT_LEN } from './text.js';

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
  if (intro) {
    intro.classList.add('is-gone');
    setTimeout(() => {
      intro.hidden = true;
    }, 900);
  }

  // 散开态起步：phase='idle'，progressTarget=0
  setPhase('idle', '欢迎进入');
  targetProgress = 0;
  assembled = false;
  distTarget = START_DIST;
  yawTarget = 0;

  if (!engine) {
    setStatus('此浏览器未启用 WebGL', 'warn');
    return;
  }

  setStatus('试试握拳 → 让星光聚合', 'ok');

  if (withGesture) startGestures();
}

morphBtn.addEventListener('click', () => {
  const next = !assembled;
  setAssembled(next);
  if (next) {
    setPhase('tree', '手动聚合');
  } else {
    setPhase('disperse', '手动散开');
  }
});

/* ---------- 摄像头小窗：骨架 / 真实镜头 切换 ---------- */
const toggleSkeleton = document.getElementById('toggleSkeleton');
const toggleRaw = document.getElementById('toggleRaw');
toggleSkeleton?.addEventListener('click', () => {
  previewEl?.classList.remove('is-raw');
  toggleSkeleton.classList.add('is-active');
  toggleSkeleton.setAttribute('aria-selected', 'true');
  toggleRaw.classList.remove('is-active');
  toggleRaw.setAttribute('aria-selected', 'false');
});
toggleRaw?.addEventListener('click', () => {
  previewEl?.classList.add('is-raw');
  toggleRaw.classList.add('is-active');
  toggleRaw.setAttribute('aria-selected', 'true');
  toggleSkeleton.classList.remove('is-active');
  toggleSkeleton.setAttribute('aria-selected', 'false');
});

/* ---- 自动进入：打开页面即加载模型并开启手势 ---- */
immersiveBtn.addEventListener('click', () =>
  setImmersive(!document.body.classList.contains('is-immersive'))
);

gestureBtn.addEventListener('click', () => {
  if (gesture.loading) return;
  if (gesture.active) stopGestures();
  else startGestures();
});

enterGestureBtn?.addEventListener('click', () => enter(true));
enterQuietBtn?.addEventListener('click', () => enter(true));

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

/* ------------------------------------------------------------------ */
/*  Gesture —— 5-phase state machine                                    */
/* ------------------------------------------------------------------ */

// phase: 'idle' (散开场) | 'tree' (握拳聚合) | 'pull' (拳头缩小拉近) | 'hold' (全展示) | 'disperse' (散开过渡)
let phase = 'idle';
let phaseTarget = 'idle';

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
  prevStable: '',       // 用于检测 Closed_Fist → Open_Palm 过渡
  transitionSince: 0,   // 过渡计时（ms）
  palm: { x: 0.5, y: 0.5, ready: false, spanSlow: 0, spanFast: 0 },
  lastFrameMs: performance.now(),
  fpsSamples: [],
  throttled: false,
  prefetchWasm: null,
  prefetchModel: null,
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
  gesture.prevStable = gesture.stable;
  gesture.stable = '';
  gesture.transitionSince = 0;
  gesture.palm.ready = false;
  gesture.palm.spanSlow = 0;
  gesture.palm.spanFast = 0;
  swipePrevX = null;
  prevFistX = null;
}

function updateHandPresence(present) {
  if (present === gesture.present) return;
  gesture.present = present;
  if (present) setStatus('已识别到手部 · 试试握拳', 'ok');
  else setStatus('把手举到镜头前', 'ok');
}

/* phase 切换 —— 会驱动 animate loop 里的过渡动画 */
function setPhase(next, reason = '') {
  if (next === phaseTarget) return;
  phaseTarget = next;
  setStatus(`相位 → ${next} · ${reason}`, 'live');
}

/*
 * 辅助：取两个食指中指指尖的 x 差作为"并指左右滑"的量
 */
function fingerSpread(lm) {
  return Math.abs(lm[8].x - lm[4].x); // 4=食指尖, 8=中指尖
}

/*
 * 辅助：计算手掌包围盒对角线 span（近似距离）
 */
function palmSpan(lm) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

const GESTURE_LABEL = {
  Thumb_Up: '点赞',
  Thumb_Down: '倒赞',
  Victory: '胜利',
  Pointing_Up: '指向',
  ILoveYou: '爱意',
  None: '未知',
};

/* 并指（食指+中指）识别与左右滑动 */
let swipePrevX = null;
let prevFistX = null;

function detectTwoFingerSwipe(lm) {
  const extIndex = lm[8].y < lm[6].y - 0.012;
  const extMiddle = lm[12].y < lm[10].y - 0.012;
  const extRing = lm[16].y < lm[14].y - 0.008;
  const gap = Math.hypot(lm[8].x - lm[12].x, lm[8].y - lm[12].y);

  const isTwo = extIndex && extMiddle && !extRing && gap < 0.085;
  if (!isTwo) {
    swipePrevX = null;
    return false;
  }

  const fx = (lm[8].x + lm[12].x) / 2;
  if (swipePrevX !== null) {
    const dx = fx - swipePrevX;
    if (Math.abs(dx) > 0.0015) {
      // 画面是镜像的：手向右移 → landmark x 变小 → dx<0 → yaw 正向
      yawTarget -= dx * 9.0;
      setStatus('并指滑动 · 旋转视角', 'live');
    }
  }
  swipePrevX = fx;
  return true;
}

function processResult(result, frameMs = performance.now()) {
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
  const g = result.gestures?.[0]?.[0];
  const name = g?.categoryName || 'None';
  const score = g?.score ?? 0;

  // ---- 稳定识别：连续 3 帧相同才切换 stable ----
  if (name === gesture.candidate) gesture.candidateCount++;
  else {
    gesture.candidate = name;
    gesture.candidateCount = 1;
  }
  if (gesture.candidateCount >= 3 && gesture.stable !== name) {
    gesture.prevStable = gesture.stable;
    gesture.stable = name;
    gesture.transitionSince = 0; // 开始过渡计时
  }

  const spread = fingerSpread(lm);
  const span = palmSpan(lm);

  // ---- 并指（食指+中指）左右滑动 → 旋转（所有 phase 生效）----
  const twoFingerSwipe = detectTwoFingerSwipe(lm);

  // ---- 手掌中心 → 旋转（所有 phase 都生效）----
  const nx = 1 - lm[9].x;
  const ny = lm[9].y;
  if (!gesture.palm.ready) {
    gesture.palm.x = nx;
    gesture.palm.y = ny;
    gesture.palm.ready = true;
    gesture.palm.spanSlow = span;
    gesture.palm.spanFast = span;
  } else {
    gesture.palm.x += (nx - gesture.palm.x) * 0.2;
    gesture.palm.y += (ny - gesture.palm.y) * 0.2;
  }

  // ---- span 跟踪（握拳缩小 = 拉近）----
  if (gesture.stable === 'Closed_Fist') {
    gesture.palm.spanSlow += (span - gesture.palm.spanSlow) * 0.03;
    gesture.palm.spanFast += (span - gesture.palm.spanFast) * 0.4;
  }

  // ---- 状态机分发 ----
  if (phaseTarget === 'idle') phaseIdle(spread, gesture.stable, gesture.prevStable, gesture.palm);
  else if (phaseTarget === 'tree') phaseTree(gesture.stable, gesture.prevStable, gesture.palm, gesture.transitionSince);
  else if (phaseTarget === 'pull') {
    // pull 由 animate 自动推进到 hold，这里只允许 Closed_Fist → Open_Palm 过渡中断
    if (gesture.prevStable === 'Closed_Fist' && gesture.stable === 'Open_Palm') {
      setPhase('disperse', 'pull途中握拳→张开');
    }
  } else if (phaseTarget === 'hold') phaseHold(spread, gesture.stable, gesture.prevStable);
  // disperse 是一次性过渡，不在 processResult 里处理（由 animate loop 自动完成）

  gesture.transitionSince += 33; // 粗略每帧 +33ms
}

/* phase handler: 散开场
 * - 并指左右滑 → yawTarget 立即跟着走
 * - 握拳 → setPhase('tree')
 */
function phaseIdle(spread, stable, prevStable, palm) {
  // 并指左右滑由全局手势处理（twoFingerSwipe），这里只负责握拳聚合
  if (stable === 'Closed_Fist') {
    setPhase('tree', '检测到握拳');
    setAssembled(true, false);
  }
}

/* phase handler: 握拳聚合态
 * - 握拳面积快速缩小 → setPhase('pull')
 * - Closed_Fist → Open_Palm 过渡（过渡 > 120ms）→ setPhase('disperse')
 * - 拳头继续移动 → yawTarget 跟随（rotate）
 */
function phaseTree(stable, prevStable, palm, transitionMs) {
  if (stable === 'Closed_Fist') {
    // 握拳带转：跟随拳头位移增量（静止时不漂移）
    if (prevFistX !== null) {
      const dx = palm.x - prevFistX;
      if (Math.abs(dx) > 0.0015) {
        yawTarget += dx * 7.5 + dx * Math.abs(dx) * 60; // 甩得越快，冲量越大
      }
    }
    prevFistX = palm.x;

    // 拳头突然缩小 → 拉近
    const ratio = palm.spanFast / palm.spanSlow;
    if (ratio < 0.9 && palm.spanSlow > 0.03) {
      setPhase('pull', `握拳缩小 ${ratio.toFixed(2)}`);
      distTarget = 48;
    }
  } else {
    prevFistX = null;
  }

  // Closed_Fist → Open_Palm 明显过程（过渡时间足够长）
  if (prevStable === 'Closed_Fist' && stable === 'Open_Palm' && transitionMs > 120) {
    setPhase('disperse', '握拳→张开 过渡');
  }
}

/* phase handler: 全展示态
 * - 并指左右滑 → 旋转 + 呼吸闪烁（hold 态特效由 animate 做）
 * - Closed_Fist → Open_Palm → disperse（同样要过渡足够长）
 */
function phaseHold(spread, stable, prevStable) {
  if (prevStable === 'Closed_Fist' && stable === 'Open_Palm' && gesture.transitionSince > 160) {
    setPhase('disperse', 'hold 态握拳→张开');
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
    color: 'rgba(242, 223, 178, 0.95)',
    lineWidth: 2.2,
  });
  gesture.drawing.drawLandmarks(lm, {
    color: 'rgba(255, 248, 232, 1)',
    fillColor: 'rgba(255, 105, 110, 1)',
    radius: 2.2,
  });
}

function detectLoop() {
  if (!gesture.active) return;
  gesture.raf = requestAnimationFrame(detectLoop);

  // opt4: FPS monitor — auto-degrade if device is under load
  const now = performance.now();
  const frameMs = now - gesture.lastFrameMs;
  gesture.lastFrameMs = now;
  gesture.fpsSamples.push(frameMs);
  if (gesture.fpsSamples.length > 120) gesture.fpsSamples.shift();

  const detectInterval = gesture.throttled ? 48 : 32;
  const minDelta = gesture.throttled ? 52 : 36;

  if (
    !videoEl.videoWidth ||
    now - gesture.lastDetect < detectInterval ||
    videoEl.currentTime === gesture.lastVideoTime
  ) {
    return;
  }
  gesture.lastVideoTime = videoEl.currentTime;
  gesture.lastDetect = now;

  // Throttle: sometimes also skip if the last frame took too long
  if (frameMs > minDelta && gesture.throttled) return;

  let result;
  try {
    result = gesture.recognizer.recognizeForVideo(videoEl, now);
  } catch (err) {
    console.warn('Gesture frame failed', err);
    return;
  }
  drawSkeleton(result);
  processResult(result, now);

  // Evaluate throttle state roughly once a second
  if (gesture.fpsSamples.length >= 45 && gesture.fpsSamples.length % 60 === 0) {
    const avg = gesture.fpsSamples.reduce((s, v) => s + v, 0) / gesture.fpsSamples.length;
    if (avg > 45 && !gesture.throttled) {
      gesture.throttled = true;
      setStatus('设备负载较高 · 识别已降级', 'warn');
    } else if (avg < 35 && gesture.throttled) {
      gesture.throttled = false;
      setStatus('手势识别恢复正常', 'ok');
    }
  }
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

  // Prefer CPU delegate — it initialises significantly faster than GPU fallback on most browsers
  try {
    return await build('CPU');
  } catch (err) {
    console.warn('CPU delegate unavailable, falling back to GPU', err);
    return build('GPU');
  }
}

// opt3: prefetch MediaPipe assets so they land in HTTP cache before user clicks
function prefetchMediaPipe() {
  if (gesture.prefetchWasm) return;
  const wasmUrl = `${BASE_URL}mediapipe/wasm/vision_wasm_internal.js`;
  const modelUrl = `${BASE_URL}mediapipe/gesture_recognizer.task`;
  // Fire-and-forget — just warm the browser connection pool / cache
  gesture.prefetchWasm = fetch(wasmUrl, { cache: 'default' }).catch(() => {});
  gesture.prefetchModel = fetch(modelUrl, { cache: 'default' }).catch(() => {});
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

  // opt3: warm MediaPipe asset cache as early as possible
  prefetchMediaPipe();

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

    // opt4: reset FPS samples on a fresh session
    gesture.lastFrameMs = performance.now();
    gesture.fpsSamples.length = 0;
    gesture.throttled = false;

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
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uDpr;
      uniform float uDim;
      attribute vec3 aChaos;
      attribute float aSize;
      attribute float aSeed;
      attribute float aSag;
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

        // pine-needle droop — acts only on assembled tree
        float wind = sin(uTime * 0.85 + position.y * 0.32 + aSeed) * 0.18;
        float droop = aSag * 0.35 * sin(uTime * 0.35 + position.y * 0.15 + aSeed * 3.0);
        pos.x += wind * t;
        pos.z += droop * t;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float twinkle = 0.72 + 0.28 * sin(uTime * (0.8 + aSeed * 2.2) + aSeed * 40.0);
        gl_PointSize = aSize * uDpr * (1.12 - 0.12 * t) * (135.0 / -mvPosition.z);

        vColor = aColor * twinkle * 0.84;
        vAlpha = mix(0.46, 0.68, t) * uDim;
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
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uProgress;
      uniform float uDpr;
      uniform float uDim;
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
        vAlpha = mix(0.55, 0.78, t) * (0.5 + 0.5 * pulse) * uDim;
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
      uRadius: { value: TREE.radius },
      uColor: { value: new THREE.Color('#d7ece4') },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uDpr;
      uniform float uRadius;
      attribute float aSize;
      attribute float aSeed;
      varying float vAlpha;

      void main() {
        vec3 pos = position;
        float d2 = length(pos.xz);
        float near = smoothstep(uRadius * 1.3, uRadius * 0.4, d2);
        float fallMul = 1.0 - near * 0.35;
        float windMul = 1.0 + near * 1.4;

        pos.y = mod(pos.y - uTime * (1.6 + aSeed * 2.6) * fallMul, 92.0) - 46.0;
        pos.x += sin(uTime * 0.32 + aSeed * 22.0 + pos.y * 0.05) * 2.2 * windMul;
        pos.z += cos(uTime * 0.26 + aSeed * 17.0 + pos.y * 0.04) * 1.4 * windMul;

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
    const sag = new Float32Array(count);

    const c = new THREE.Color();
    const H = TREE.height;
    const R = TREE.radius;

    for (let i = 0; i < count; i++) {
      // 偏向下部 t 的分布——尖顶要尖、底部要厚
      const t = Math.pow(rand(), 0.88);
      const y = -H / 2 + t * H;

      // 干净圆锥轮廓：profile 决定整体三角锥形
      const profile = Math.pow(1 - t, 1.05);
      // 柔和的 5 层起伏——幅度只有 ±8%，不会形成锯齿
      const tier = 0.92 + 0.08 * Math.cos(t * Math.PI * 5);
      // 壳分布：0.6~1.0，越外侧越稀疏
      const shell = 0.6 + 0.4 * Math.pow(rand(), 0.45);
      const radius = R * profile * tier * shell;

      // 6 匝紧密螺旋，轮廓呈柔美的锥形螺旋枝
      const theta = rand() * Math.PI * 2 + t * 12 + (rand() - 0.5) * 0.18;
      tree[i * 3] = Math.cos(theta) * radius;
      tree[i * 3 + 1] = y + (rand() - 0.5) * 0.35;
      tree[i * 3 + 2] = Math.sin(theta) * radius;

      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const rr = 28 + Math.pow(rand(), 0.62) * 28;
      const s = Math.sqrt(1 - u * u);
      chaos[i * 3] = Math.cos(phi) * s * rr;
      chaos[i * 3 + 1] = u * rr * 0.72 + 1.5;
      chaos[i * 3 + 2] = Math.sin(phi) * s * rr;

      // 蓝绿主色调——沿壳从内层深蓝向外层冰青渐变
      const shellBrightness = shell; // 0.6~1.0
      let hex, sz;
      if (shellBrightness < 0.72) {
        // 内层：深青蓝
        hex = lerpHex('#0e2b3c', '#114a63', (shellBrightness - 0.6) / 0.12);
        sz = 1.0 + rand() * 1.0;
      } else if (shellBrightness < 0.86) {
        // 中层：青绿
        hex = lerpHex('#114a63', '#1aa99e', (shellBrightness - 0.72) / 0.14);
        sz = 1.15 + rand() * 1.15;
      } else {
        // 外层：冰青、极少量银白点缀
        const r = rand();
        if (r < 0.04) {
          hex = '#eaf7f6';
        } else if (r < 0.22) {
          hex = '#7ce5df';
        } else {
          hex = '#1aa99e';
        }
        sz = 1.3 + rand() * 1.3;
      }

      c.set(hex);
      if (rand() < 0.22) c.multiplyScalar(0.55 + rand() * 0.25);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;

      size[i] = sz * (0.55 + 0.45 * profile);
      seed[i] = rand();
      sag[i] = 0.5 + 0.5 * Math.sin(t * Math.PI);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(tree, 3));
    geo.setAttribute('aChaos', new THREE.BufferAttribute(chaos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSag', new THREE.BufferAttribute(sag, 1));

    const points = new THREE.Points(geo, foliageMat);
    points.frustumCulled = false;
    return points;
  }

  // 颜色插值（两个 hex → 中间 hex）
  function lerpHex(a, b, t) {
    const A = hex2rgb(a);
    const B = hex2rgb(b);
    return `rgb(${Math.round(A.r + (B.r - A.r) * t)},${Math.round(A.g + (B.g - A.g) * t)},${Math.round(A.b + (B.b - A.b) * t)})`;
  }
  function hex2rgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }

  function buildLights() {
    const count = COUNTS.lights;
    const tree = new Float32Array(count * 3);
    const chaos = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);

    // 蓝绿+冰白银色点缀，偶发一点暖金反光
    const palette = [
      '#5ad8e5', '#5ad8e5',
      '#8fe8db', '#8fe8db',
      '#d9f6f2',
      '#3d7fb0',
      '#1a9b94',
      '#bfe7e6',
      '#ffe3a8', // 极少量暖金点缀
    ];
    const c = new THREE.Color();
    const H = TREE.height;
    const R = TREE.radius;

    for (let i = 0; i < count; i++) {
      const t = Math.pow(rand(), 0.9);
      const y = -H / 2 + t * H;
      const profile = Math.pow(1 - t, 1.05);
      // 与 foliage 同轮廓的柔和 tier
      const tier = 0.92 + 0.08 * Math.cos(t * Math.PI * 5);
      const radial = 0.96 + rand() * 0.06;
      const radius = R * profile * tier * radial;

      // 紧密螺旋，沿着树轮廓均匀缠绕
      const theta = rand() * Math.PI * 2 + t * 14 + (rand() - 0.5) * 0.35;
      tree[i * 3] = Math.cos(theta) * radius;
      tree[i * 3 + 1] = y + (rand() - 0.5) * 0.4;
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

      const bright = 0.9 + 0.35 * profile;
      size[i] = (2.4 + rand() * 2.6) * bright;
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

  /* ---- text particle overlay (opt6) ---- */
  let textData = { group: new THREE.Group(), items: [] };
  scene.add(textData.group);

  function disposeText() {
    scene.remove(textData.group);
    textData.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    textData = { group: new THREE.Group(), items: [] };
  }

  function buildText(text) {
    try {
      disposeText();
      textData = buildTextParticles(text, {
        scale: IS_MOBILE ? 0.034 : 0.038,
        letterGap: 0.16,
        lineGap: IS_MOBILE ? 2.2 : 2.9,
        centerX: IS_MOBILE ? 0 : 11.0,
        centerY: IS_MOBILE ? 0.6 : 1.2,
        centerZ: 17,
      });
      scene.add(textData.group);
    } catch (err) {
      // 文字层只是装饰，绝不能让整站降级为“未启用 WebGL”
      console.warn('[text] build failed', err);
      textData = { group: new THREE.Group(), items: [], raw: [] };
      scene.add(textData.group);
    }
  }

  buildText(DEFAULT_TEXT);

  /* ---- letter-sequence scheduler (opt6) ---- */
  let textState = 'idle'; // 'waiting' | 'in' | 'hold' | 'out'
  let textIndex = 0;
  let textClock = 0;
  let textDelay = 0;
  let textSteps = [];

  function playText(text) {
    if (typeof text === 'string' && text.trim()) buildText(text.trim());
    // 根据每个字符的语言算各自 step：英文字母快，中文字慢
    textSteps = textData.raw.map((ch) => {
      const c = ch.charCodeAt(0);
      const en = (c >= 0x0020 && c <= 0x007e) || (c >= 0x00a0 && c <= 0x024f);
      return en ? SEQUENCE.enStep : SEQUENCE.zhStep;
    });
    textIndex = 0;
    textClock = 0;
    textDelay = 0.35;
    textState = 'waiting';
  }

  function clearText() {
    textState = 'out';
  }

  function tickText(dt) {
    if (textState === 'waiting') {
      textDelay -= dt;
      if (textDelay <= 0) {
        textState = 'in';
        textClock = 0;
      }
    } else if (textState === 'in') {
      textClock += dt;
      // 按每个字的 step 间隔推进
      let want = 0;
      let acc = 0;
      for (let i = 0; i < textData.items.length; i++) {
        acc += (textSteps && textSteps[i]) || 0.25;
        if (acc <= textClock) want = i + 1;
        else break;
      }
      want = Math.min(textData.items.length, want);
      while (textIndex < want) {
        textData.items[textIndex].progress = Math.max(textData.items[textIndex].progress, 0.001);
        textIndex++;
      }
      let allIn = textIndex >= textData.items.length;
      for (let i = 0; i < textIndex; i++) {
        const it = textData.items[i];
        it.progress = Math.min(1, it.progress + dt * SEQUENCE.morphSpeed);
        if (it.progress < 0.999) allIn = false;
      }
      if (allIn) {
        textState = 'hold';
        textClock = 0;
      }
    } else if (textState === 'hold') {
      textClock += dt;
      if (textClock * 1000 >= SEQUENCE.holdMs) textState = 'out';
    } else if (textState === 'out') {
      let allOut = true;
      for (const it of textData.items) {
        it.progress = Math.max(0, it.progress - dt * SEQUENCE.letterOutSpeed);
        if (it.progress > 0) allOut = false;
      }
      if (allOut) textState = 'idle';
    }
  }

  /* ---- loop ----------------------------------------------------- */

  const clock = new THREE.Clock();
  let progress = 0;
  let progressTarget = 0;
  let yaw = yawTarget;
  let pitch = pitchTarget;
  let dist = START_DIST;
  let treeShiftX = 0;
  let treeShiftTarget = 0;
  let pullTimer = 0;
  let disperseTimer = 0;
  let idleSince = null;
  let breathMod = 0;
  let breathBand = 0.02;
  let textDriftX = 0;
  let textDriftY = 0;
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

    // ---- phase 自动推进（只依赖 phaseTarget，gesture handler 切 phaseTarget）----
    // phase 平滑过渡
    phase = phaseTarget;

    // 每 phase 的动画目标 & 自动推进
    let autoPhase = null;
    if (phase === 'tree') {
      // 没手 → 慢慢自转而减速（yawTarget 先猛拉到一个新值再自然回落）
      if (!gesture.present) {
        // 无手保持约 3.5s 后自动开始自转再慢慢减速
        idleSince = idleSince || t;
        const sinceNoHand = t - idleSince;
        if (sinceNoHand > 4.2) {
          // 猛加速再减速：模拟"拳头加速移动后圣诞树猛加速再慢慢减速到慢慢旋转"
          yawTarget += dt * (2.6 - clamp(sinceNoHand - 4.2, 0, 1.4)) * (1 - clamp(sinceNoHand - 5.6, 0, 0.4) / 0.4);
          // 减速：指数衰减
          yawTarget *= Math.exp(-dt * 0.22);
        } else if (sinceNoHand > 2.2) {
          // 保持慢慢旋转
          yawTarget += dt * 0.25;
        }
      } else {
        idleSince = null;
      }
    } else {
      idleSince = null;
    }

    // ---- phase: pull → 拉近 + 自动过 hold ----
    if (phase === 'pull') {
      distTarget = 48; // 拉近
      treeShiftTarget = -8; // 树整体左移，右侧留给祝福语
      // 自动推进：文字触发 + 计时 → hold
      if (!pullTimer) {
        pullTimer = 0;
        if (engine && engine.playText) engine.playText();
      }
      pullTimer += dt;
      if (pullTimer > 0.7) {
        setPhase('hold', '文字开始逐字聚出');
        pullTimer = 0;
      }
    }

    // ---- phase: hold → 呼吸闪烁 + 无自动推进（直到握拳→张开触发 disperse）----
    if (phase === 'hold') {
      breathMod = (Math.sin(t * 1.6) * 0.5 + 0.5); // 0..1
      breathBand = 0.08 + 0.06 * breathMod;
      // 文字轻微漂移
      textDriftX = Math.sin(t * 0.9) * 0.28;
      textDriftY = Math.cos(t * 0.7) * 0.08;
    } else {
      breathMod = 0;
      breathBand = 0.02;
      textDriftX *= 0.88;
      textDriftY *= 0.88;
    }

    // ---- phase: disperse → 极速旋转 拉远 崩散 ----
    if (phase === 'disperse') {
      // 文字先崩散（playText(DEFAULT_TEXT) 触发 + 进度清零）
      if (!disperseTimer) {
        disperseTimer = 0;
        if (engine && engine.clearText) engine.clearText(); // 立即清零文字 progress 让它汇入中心
      }
      disperseTimer += dt;
      // 旋转猛加速
      yawTarget += dt * 10;
      yawTarget *= Math.exp(-dt * 0.4);
      // 相机拉远
      distTarget = BASE_DIST;
      treeShiftTarget = 0;
      progressTarget = 0; // 树崩散
      // 约 1.4s 后回到 idle
      if (disperseTimer > 1.4) {
        setPhase('idle', '散开完成');
        disperseTimer = 0;
        yawTarget = 0;
        distTarget = START_DIST;
      }
    }

    // progress 驱动
    if (phase === 'tree' && assembled) progressTarget = 1;
    if (phase === 'pull') progressTarget = 1;
    if (phase === 'hold') progressTarget = 1;

    progress += (progressTarget - progress) * (1 - Math.exp(-1.9 * dt));
    foliageMat.uniforms.uProgress.value = progress;
    foliageMat.uniforms.uTime.value = t;
    lightsMat.uniforms.uProgress.value = progress;
    lightsMat.uniforms.uTime.value = t;
    snowMat.uniforms.uTime.value = t;
    starMat.uniforms.uTime.value = t;
    starMat.uniforms.uOpacity.value = clamp(progress * 1.25, 0, 0.92);

    starGroup.scale.setScalar(0.4 + progress * 0.6);
    starGroup.rotation.z = Math.sin(t * 0.22) * 0.09;

    if (!gesture.present && phase === 'idle') {
      yawTarget += dt * (0.045 + 0.02 * (1 - progress));
    }

    yaw += (yawTarget - yaw) * (1 - Math.exp(-4.2 * dt));
    pitch += (pitchTarget - pitch) * (1 - Math.exp(-4.2 * dt));
    treeGroup.rotation.y = yaw;
    treeGroup.rotation.x = pitch;

    dist += (distTarget - dist) * (1 - Math.exp(-2.2 * dt));
    treeShiftX += (treeShiftTarget - treeShiftX) * (1 - Math.exp(-3.2 * dt));
    treeGroup.position.x = treeShiftX;
    camera.position.set(0, 3.6 + Math.sin(t * 0.24) * 0.35, dist);
    camera.lookAt(0, 1.2 + progress * 1.4, 0);

    sky.rotation.y = t * 0.008;
    snow.rotation.y = Math.sin(t * 0.05) * 0.06;

    groundGlow.material.opacity = 0.16 + progress * 0.14;
    backdropHalo.material.opacity = 0.09 + progress * 0.09;

    // ---- bloom 呼吸（hold 态额外摆动）----
    const baseBloom = 0.6 - (phase === 'hold' ? 0 : 0) - breathMod * breathBand;
    bloom.strength = baseBloom;
    bloom.radius = 0.5;
    bloom.threshold = phase === 'hold' ? 0.72 : 0.85;

    // ---- text letter progress ----
    tickText(dt);
    let textAlive = false;
    let maxProg = 0;
    for (let i = 0; i < textData.items.length; i++) {
      const it = textData.items[i];
      it.material.uniforms.uTime.value = t;
      it.material.uniforms.uProgress.value = it.progress;
      it.material.uniforms.uDpr.value = DPR;
      if (it.progress > maxProg) maxProg = it.progress;
      if (it.progress > 0.005) textAlive = true;
    }
    if (textData.veil) textData.veil.material.opacity = phase === 'disperse' ? 0 : Math.min(1, maxProg) * 0.88;
    const dim = 1 - Math.min(1, maxProg) * 0.22;
    foliageMat.uniforms.uDim.value = dim;
    lightsMat.uniforms.uDim.value = dim;
    textData.group.visible = textAlive && phase !== 'disperse';
    if (phase === 'disperse') {
      // 文字粒子向树心汇入
      const k = 1 - Math.min(1, dt * 2.6);
      textData.group.position.x *= k;
      textData.group.position.y *= k;
      textData.group.position.z *= k;
    } else if (textData.group.position.lengthSq() > 0.0001) {
      textData.group.position.set(0, 0, 0);
    }
    if (textAlive) {
      textData.group.rotation.y = Math.sin(t * 0.35) * 0.05 + textDriftX * 0.1;
      textData.group.rotation.x = Math.sin(t * 0.27) * 0.02 + textDriftY * 0.05;
    }

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

  return { resize, playText, clearText };
}

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

setAssembled(false, false);

// 打开页面就开始预热手势模型（不等待点击）
prefetchMediaPipe();

try {
  engine = createEngine();
  // 自动进入并开启手势：边看粒子边加载模型
  setTimeout(() => enter(true), 120);
} catch (err) {
  console.warn('WebGL unavailable', err);
  document.body.classList.add('no-webgl');
  fallbackEl.hidden = false;
  setStatus('当前浏览器未启用 WebGL', 'warn');
  gestureBtn.hidden = true;
  morphBtn.hidden = true;
  if (enterGestureBtn) enterGestureBtn.hidden = true;
  if (enterQuietBtn) enterQuietBtn.hidden = true;
}

window.addEventListener('resize', () => engine?.resize());

window.addEventListener('pagehide', () => {
  if (gesture.active) stopGestures();
});

// Keep the mobile browser chrome from fighting the canvas.
document.addEventListener('gesturestart', (e) => e.preventDefault());
