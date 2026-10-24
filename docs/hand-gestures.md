# 手势识别模块（摄像头 → 指令）

摄像头 → MediaPipe Hand Landmarker → 手势分类 → 稳定去重 → 统一事件。

**不碰游戏状态、不碰渲染、不改任何现有文件。** 只往 `window` 上派发 `gesture` 事件，
谁需要谁监听。主入口加三行就能用，删掉三行就完全消失。

## 文件

```
src/input/hand/
  index.js       对外入口 createHandInput()，组装 + 事件派发
  poses.js       手指计数 + 手势分类（纯函数）
  stabilizer.js  稳定 / 去重状态机（纯逻辑）
  tracker.js     摄像头 + MediaPipe 封装
  overlay.js     画中画 + 关键点 + 识别结果（自注入 DOM）
hand-test.html   自检页
tests/hand.test.mjs  35 项单测（不需要摄像头）
vendor/hand/     MediaPipe 运行时 + 模型（25.8MB，离线）
```

## 接入主项目（给整合的同学）

主入口 `src/main.js` 里加三行：

```js
import { createHandInput } from './input/hand/index.js';

const hand = createHandInput();   // overlay 默认开，摄像头画面会贴在左下角
hand.start();                     // 失败不抛错，只显示友好提示，鼠标照常能玩
```

然后在你负责的地方监听：

```js
window.addEventListener('gesture', (e) => {
  const { type, value } = e.detail;
  if (type === 'SELECT_MONSTER') selectMonster(value);   // 1 / 2 / 3
  else if (type === 'ATTACK') attack();
  else if (type === 'CONFIRM') confirm();
});
```

就这些。没有别的约定，也不要求游戏改结构。

## 事件格式

```js
{
  type: 'SELECT_MONSTER',   // 'SELECT_MONSTER' | 'ATTACK' | 'CONFIRM'
  value: 1,                 // 只有 SELECT_MONSTER 有
  gesture: 'one',           // 原始手势名：open_palm | fist | one | two | three
  hand: 'Right',            // MediaPipe 判的左右手，仅作参考
  t: 12345.6                // performance.now()
}
```

| 手势 | 事件 |
|---|---|
| 🖐 张开手掌 | `{ type: 'CONFIRM' }` |
| ✊ 握拳 | `{ type: 'ATTACK' }` |
| ☝ 1 根手指 | `{ type: 'SELECT_MONSTER', value: 1 }` |
| ✌ 2 根手指 | `{ type: 'SELECT_MONSTER', value: 2 }` |
| 🤟 3 根手指 | `{ type: 'SELECT_MONSTER', value: 3 }` |

想改键位就传一份 mapping，不用动逻辑：

```js
createHandInput({
  mapping: {
    open_palm: { type: 'CONFIRM' },
    fist: { type: 'ATTACK' },
    one: { type: 'SELECT_MONSTER', value: 2 },   // 食指改成选 2 号
    two: { type: 'SELECT_MONSTER', value: 3 },
    three: { type: 'SKILL', value: 1 },
  },
});
```

## 稳定性是怎么做的

1. **保持 260ms 才算数**（`stableMs`）。分类器偶尔会在两帧之间跳一下，
   一帧的毛刺熬不到 260ms，直接丢掉。
2. **触发一次就锁住**（`releaseMs` 默认 180ms）。手一直举着不会连发，
   必须先换成别的手势，才能再次触发同一个指令。
3. 切标签页回来时间会跳，超过 500ms 的间隔会重置计时，避免"回来瞬间误触"。

参数都可调：

```js
createHandInput({ stableMs: 200, releaseMs: 120 });   // 更灵敏
createHandInput({ stableMs: 420, releaseMs: 260 });   // 更稳，适合投影现场
```

## 怎么测试

### 1. 纯逻辑（不用摄像头）

```bash
node tests/hand.test.mjs
```

35 项，覆盖手指计数、五种手势分类、误判（只竖小指、食指+无名指）、
稳定去重、映射、以及用假 tracker 跑的端到端事件流。

### 2. 真摄像头

```bash
start.bat          # Windows，起在 http://localhost:8000
```

打开 <http://localhost:8000/hand-test.html>：

- 左下角出现摄像头画面，手上有绿色骨架；
- 中间「当前手势」实时显示判定结果，下面有保持进度条；
- 右侧「指令流」里出现 `SELECT_MONSTER 1` 之类的记录；
- 举着不动 → 只出现一条；换手势再举 → 出现下一条。

必须用 `localhost` 打开。摄像头只在 localhost / https 下可用，
用局域网 IP 打不开（这是浏览器策略，不是 bug）。

### 3. 在游戏里

```js
// 浏览器控制台，接入后可直接看
window.addEventListener('gesture', (e) => console.log(e.detail));
```

## 摄像头拿不到时

模块**不会抛错、不会白屏**，只会在左下角面板里显示原因和一个「重试」按钮，
游戏照常用鼠标玩。

| 现象 | 原因 | 处理 |
|---|---|---|
| 「摄像头权限被拒绝」 | 用户点了拒绝 | 地址栏图标 → 允许 → 重试 |
| 「摄像头被占用了」 | 会议软件 / OBS 占着 | 关掉那个软件 → 重试 |
| 「没找到摄像头」 | 设备不存在 | 换机器，或用鼠标 |
| 「无法使用摄像头」 | 不是 localhost/https | 用 `start.bat` 打开 |
| 「手势模型加载失败」 | `vendor/hand/` 缺失 | 检查目录完整性 |

## 现场调优

| 情况 | 调法 |
|---|---|
| 手够不到、画面里手太小 | 靠近摄像头；或把 `minHandDetectionConfidence` 从 0.5 调到 0.4 |
| 逆光 / 暗场识别不稳 | 补一盏灯照玩家（最有效），别让灯在背后 |
| 误触太多 | `stableMs` 调到 400 左右 |
| 反应太慢 | `stableMs` 降到 200，`releaseMs` 降到 120 |
| 帧率低 | `detectFps` 调到 20（默认 30） |

## 已知限制

- **单手**。`numHands` 可以设 2，但只取第一只；双人场景需要各一台机器。
- **手背对镜头**时手指判定会退化，握拳和"侧面手"可能混淆。让玩家手心朝镜头。
- 手指交叉、戴深色手套、强逆光都会掉精度。这是单目视觉的边界，不是实现问题。
- **没有做四点标定**：这个模块输出的是手势指令，不输出屏幕坐标，所以不需要标定。
