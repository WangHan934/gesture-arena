# 模块 B · 手势识别 —— 交接说明

> 本文档由队友 B 随模块一起交付，**已原样保留**作为交接记录。
> 仓库内的接入状态见文末「九、本仓库的接入方式」。

**一句话**：摄像头识别手势 → 派发成 `SELECT_MONSTER` / `ATTACK` / `CONFIRM` 三种指令。
不碰游戏状态、不碰渲染、不改任何现有文件，只往 `window` 上发事件。

---

## 一、这些文件放到哪

把下面这些**覆盖到项目根目录**即可（结构与仓库一致，不会覆盖别人的文件）：

| 包里的路径 | 放到项目 | 说明 |
|---|---|---|
| `src/input/hand/` | `src/input/hand/` | 模块本体，5 个 js |
| `vendor/hand/` | `vendor/hand/` | MediaPipe 运行时 + 模型，25.8MB，**离线可用** |
| `hand-test.html` | 项目根目录 | 自检页，不影响游戏 |
| `tests/hand.test.mjs` | `tests/` | 单测，可选 |
| `docs/hand-gestures.md` | `docs/` | 详细文档（本文件是精简版） |
| `单文件版/hand-gesture.html` | 不用放 | 给非开发同学预览用，代码以 `src/` 为准 |

> `vendor/hand/` 必须带上。没有它就只能走 CDN，现场断网会挂。

---

## 二、接口

模块只发一种事件：`window` 上的 `CustomEvent('gesture')`。

```js
{
  type: 'SELECT_MONSTER',   // 'SELECT_MONSTER' | 'ATTACK' | 'CONFIRM'
  value: 1,                 // 只有 SELECT_MONSTER 有，取值 1 / 2 / 3
  gesture: 'one',           // 原始手势：open_palm | fist | one | two | three
  hand: 'Right',            // 判定的左右手，仅供参考
  t: 12345.6                // performance.now()
}
```

| 手势 | 事件 |
|---|---|
| 🖐 张开手掌 | `{ type: 'CONFIRM' }` |
| ✊ 握拳 | `{ type: 'ATTACK' }` |
| ☝ 竖起 1 根手指 | `{ type: 'SELECT_MONSTER', value: 1 }` |
| ✌ 竖起 2 根手指 | `{ type: 'SELECT_MONSTER', value: 2 }` |
| 🤟 竖起 3 根手指 | `{ type: 'SELECT_MONSTER', value: 3 }` |

另外还有一个 `hand-status` 事件（`{state, message}`），只在加载 / 出错时发，用来做提示条。

**稳定性**：同一手势要连续保持 260ms 才触发；触发后必须换成别的手势才能再触发。
所以举着不会连发，一帧的识别毛刺也不会误触。

---

## 三、接进主入口（三行）

`src/main.js` 里加：

```js
import { createHandInput } from './input/hand/index.js';

const hand = createHandInput();   // 左下角会自动出现摄像头画中画
hand.start();                     // 失败不抛错，只显示友好提示

window.addEventListener('gesture', (e) => {
  const { type, value } = e.detail;
  if (type === 'SELECT_MONSTER') selectMonster(value);
  else if (type === 'ATTACK') attack();
  else if (type === 'CONFIRM') confirm();
});
```

删掉这几行就完全恢复原状，没有任何副作用。

---

## 四、怎么验证

### 1. 逻辑（不用摄像头）

```bash
node tests/hand.test.mjs
```

应该看到 **35 项全过**。覆盖：手指计数、五种手势分类、误判（只竖小指 / 食指+无名指）、
稳定去重、事件映射、以及用假 tracker 跑的端到端事件流。

### 2. 真摄像头

```bash
start.bat        # 项目自带脚本，起在 http://localhost:8000
```

打开 **http://localhost:8000/hand-test.html**：

- 左下角出现摄像头画面，手上有绿色骨架；
- 中间「当前手势」实时显示判定，下面有保持进度条（进度满才触发）；
- 右侧「指令流」出现 `SELECT_MONSTER 1` 等记录；
- 举着不动 → 只有一条；换手势 → 出现下一条。

**必须用 localhost 打开**，摄像头只在 localhost / https 下可用。

### 3. 在游戏里

接入后打开控制台：

```js
window.addEventListener('gesture', (e) => console.log(e.detail));
```

---

## 五、可调参数

```js
createHandInput({
  stableMs: 260,      // 保持多久才触发。现场误触多就调到 400
  releaseMs: 180,     // 触发后多久才能再次触发
  modelBase: 'auto',  // 默认：先本地 vendor/hand，失败再走 CDN；null = 只用 CDN
  mirror: true,       // 镜像显示
  overlay: true,      // 左下角摄像头画中画
  mapping: { ... },   // 改键位，不用改逻辑
});
```

---

## 六、现场注意

| 情况 | 处理 |
|---|---|
| 摄像头被会议软件占用 | 关掉腾讯会议 / 钉钉 / OBS，再点面板里的「重试」 |
| 暗场投影识别不稳 | 补一盏灯照玩家，别让灯在背后 |
| 手离镜头太远 | 靠近一点；面板会提示「把手放进画面」 |
| 误触太多 | `stableMs` 调到 400 |
| 想临时关掉手势 | 删掉 main.js 里那三行 |

**兜底**：摄像头不可用时游戏照常能用鼠标玩，模块只显示一个带「重试」的提示，不会白屏、不会抛错。

---

## 七、已知限制

- **单手**。只取画面里的第一只手。
- **手心要朝镜头**。手背对镜头时手指判定会退化，握拳和侧面手可能混淆。
- 手指交叉、戴深色手套、强逆光都会掉精度——单目视觉的边界。
- **没有做屏幕坐标**。只输出手势指令，不做四点标定。

---

## 八、版本

- 模块版本：v1（2026-10）
- 依赖：无（MediaPipe 运行时与模型已内置在 `vendor/hand/`）
- 单测：35 项全过

---

## 九、本仓库的接入方式

模块本体**一行没改**。接入逻辑在 `src/input/camera-input.js`（E 写的胶水层），
映射规则放在各个模式里（`src/modes/*-mode.js` 的 `cameraMap`），原因：

模块只认 5 种姿态，但两种玩法要的动作不一样 ——
塔防是「召唤 4 只生物」，决斗是「选怪 / 普攻 / 技能」。
把映射放到模式里，加第三种玩法时不用碰输入层。

| 手势 | 塔防制 | 1v1 决斗 |
|---|---|---|
| ☝ 1 指 | 召唤石灵 | 选第 1 只生物 |
| ✌ 2 指 | 召唤焰狐 | 选第 2 只生物 |
| 🤟 3 指 | 召唤雷鸟 | 选第 3 只生物 |
| ✊ 握拳 | 召唤巨魔 | 普攻 |
| 🖐 张掌 | —（塔防只有召唤） | 技能 |

**摄像头默认关闭**，点顶栏的「摄像头」按钮才请求权限，不会一进游戏就弹授权框。

> 注意：模块只输出 1 / 2 / 3 根手指三种选择，所以第 4 只生物（巨魔）在塔防里用「握拳」，
> 在决斗选怪界面用鼠标点。想补「4 根手指」需要改 `poses.js`，属于 A 的活（见 Issue #3）。
