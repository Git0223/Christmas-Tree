# Git0223 · 粒子圣诞树

一棵由两万余粒光组成的粒子圣诞树。举起手，用 AI 手势让星光聚合、散开与流转；写下任意祝福，它会逐字化作光，在树前聚散成字。纯前端、无照片功能、所有手势在本地识别。

> 参考项目：[Vita0519/ChristmasTree](https://github.com/Vita0519/ChristmasTree)、[moleculemmeng020425/christmas-tree](https://github.com/moleculemmeng020425/christmas-tree)

## 交互手势

| 手势 | 效果 |
| --- | --- |
| ✊ 握拳 | 粒子聚合成树 |
| 🖐 张开手掌 | 粒子散开成星云 |
| 👋 横向挥手 | 旋转视角 |
| 🤲 前后移动手掌 | 远离镜头→放大，靠近镜头→缩小（任意手势均生效，握拳时同样有效；幅度小于 6% 自动忽略） |

非手势替代方案：鼠标拖拽旋转、滚轮缩放；移动端单指旋转 / 双指 pinch；键盘 `Space` 聚散、`G` 开关手势、`Esc` 退出沉浸。

## 文字粒子展示

主界面底部有一个输入框（上限 8 个字）。输入任意祝福后点击「粒子展示」，树会聚合成形，随后这段文字逐字从星屑中聚出：

1. 每个字符先在离屏 canvas 上栅格化，再按像素采样成粒子坐标；
2. 粒子从环绕树的球形混沌态平滑 morph 到字形；
3. 全部字成形后停留约 6 秒，再逐字散回星云；
4. 文字展示期间树身轻微压暗、辉光收敛，确保文字始终清晰可读。

聚合完成时若没有输入新文字，会自动展示默认的「圣诞快乐」。

## 技术栈

- **Three.js r160** 自研 ShaderMaterial 粒子系统（foliage / lights / star / snow / sky / text），GPU 顶点着色器 morph
- **MediaPipe `@mediapipe/tasks-vision@0.10.3`** GestureRecognizer，wasm 与模型文件随站本地托管
- **Vite 5** 构建，`base: './'` 便于静态部署
- CPU delegate 优先以缩短冷启动；预热资源缓存；帧率下降时自动降低识别频率并提示

## 本地运行

```bash
npm install
npm run dev     # 开发服务器（默认 http://localhost:16000）
npm run build   # 产出到 dist/
npm run preview # 本地预览 dist/
```

## 在线版本

当前部署站点：

- **URL** https://37luyny89x49olwl1q9.traesite.cn
- **Site ID** `37luyny89x49olwl1q9`
- **可见性** public

## 隐私说明

摄像头画面仅在浏览器本地交给 MediaPipe XNNPACK 推理，**不会上传到任何服务器**，且预览窗口只显示识别出的手部粒子骨架，不显示真实摄像头画面。关闭手势功能后画面立即停止采集。

## 目录结构

```
christmas-tree/
├── index.html             # UI 骨架（HUD / intro / legend / 文本输入 / preview）
├── src/
│   ├── main.js            # Three.js 场景 + 手势 + 渲染循环
│   ├── text.js            # 逐字文字粒子构建与序列控制
│   └── style.css          # 深色翡翠/金色视觉系统
├── public/mediapipe/
│   ├── gesture_recognizer.task
│   └── wasm/*.js / *.wasm
├── vite.config.js
└── package.json
```

## License

MIT
