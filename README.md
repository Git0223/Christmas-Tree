# Git0223 · 粒子圣诞树

一棵由两万余粒光组成的粒子圣诞树。举起手，用 AI 手势让星光聚合、散开与流转；树拉近后会逐字聚出 `Merry Christmas · 圣诞快乐`。纯前端、无照片功能、所有手势在本地识别。

> 参考项目：[Vita0519/ChristmasTree](https://github.com/Vita0519/ChristmasTree)、[moleculemmeng020425/christmas-tree](https://github.com/moleculemmeng020425/christmas-tree)

## 交互手势（状态机）

| 状态 | 触发 | 效果 |
| --- | --- | --- |
| **散开场** | 打开页面自动进入 | 粒子绕中心自由漂浮 |
| 散开场 → 旋转 | 食指中指并指左右滑 | 粒子整体左右旋转 |
| 散开场 → 树 | 握拳 | 粒子聚合成多层圆锥圣诞树，拳头可微微带转；无手时慢慢自转而减速 |
| 树态 → 拉近 | 拳头突然缩小 | 树拉近到屏幕左侧，右侧开始逐字聚出 `Merry Christmas · 圣诞快乐` |
| 全展示态 | 文字全部成形 | 并指左右滑 → 树旋转 + 呼吸闪烁，文字带点漂移；**必须**识别到握拳→张开明显过程才会散开 |
| 全展示态 → 散开 | 握拳→张开 | 文字先崩成粒子汇入中心旋转散开；树拉远 + 崩散成极速旋转再减速 → 回到散开场 |

打开网页即自动加载 MediaPipe 模型并请求摄像头，无需点击按钮。

非手势替代方案：鼠标拖拽旋转、滚轮缩放；移动端单指旋转 / 双指 pinch；键盘 `Space` 聚散、`G` 开关手势、`Esc` 退出沉浸。

## 技术栈

- **Three.js r160** 自研 ShaderMaterial 粒子系统（foliage / lights / star / snow / sky / text），GPU 顶点着色器 morph
- **MediaPipe `@mediapipe/tasks-vision@0.10.3`** GestureRecognizer，wasm 与模型文件随站本地托管
- **Vite 5** 构建，`base: './'` 便于静态部署
- CPU delegate 优先以缩短冷启动；预热资源缓存；帧率下降时自动降低识别频率并提示

## 本地运行

```bash
npm install
npm run dev     # http://localhost:16000
npm run build   # 产出到 dist/
npm run preview
```

## 在线版本

- **URL** https://37luyny89x49olwl1q9.traesite.cn
- **Site ID** `37luyny89x49olwl1q9`
- **可见性** public

## 隐私

摄像头画面仅在浏览器本地交给 MediaPipe XNNPACK 推理，**不会上传到任何服务器**；预览小窗可在"骨架 ↔ 真实镜头"间切换，默认只显示识别点位。

## 目录结构

```
Christmas-Tree/
├── index.html
├── src/
│   ├── main.js           Three.js 场景 + 手势状态机 + 渲染循环
│   ├── text.js           文字粒子构建与逐字序列
│   └── style.css         视觉系统
├── public/mediapipe/     wasm + gesture_recognizer.task
├── vite.config.js
└── package.json
```

## License

MIT
