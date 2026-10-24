# Gesture Arena · 手势竞技场

用鼠标或手指在画板上画一个符号，召唤对应生物，攻破敌方核心。

> **新加入的成员**：先看 [ONBOARDING.md](ONBOARDING.md)，按 6 步走完就能开工。
> 已经配好环境的老手，直接看下面的快速开始。

纯前端项目：**HTML + CSS + 原生 JavaScript**，没有构建步骤、没有依赖、不需要 npm install。
克隆下来跑一条命令就能玩。

---

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/WangHan934/gesture-arena.git
cd gesture-arena
```

### 2. 启动

| 系统 | 操作 |
|---|---|
| Windows | 双击 `start.bat` |
| macOS / Linux | 终端执行 `bash start.sh` |

浏览器会自动打开 <http://localhost:8000>。

> **为什么不直接双击 index.html？**
> 项目用了 ES Module（`import` / `export`）。浏览器的安全策略禁止在 `file://` 协议下加载模块，
> 直接双击会白屏。必须通过本地服务器访问。这是初学者最常踩的坑。

### 3. 玩

在右下角画板画手势 → 生物出场 → 自动推进、交战、拆塔。先拆掉敌方核心的一方获胜。

---

## 玩法

### 手势对照表

| 手势 | 生物 | 法力 | 生命 | 每秒伤害 | 速度 | 定位 |
|---|---|---|---|---|---|---|
| ○ 画一个圆 | 石灵 🗿 | 22 | 110 | 7 | 55 | 肉盾，扛线慢推 |
| — 画一条横线 | 焰狐 🦊 | 20 | 42 | 14 | 110 | 廉价快速，性价比高 |
| Z 画一个 Z 字 | 雷鸟 🦅 | 38 | 68 | 26 | 95 | 高爆发，脆 |
| V 画一个 V 字 | 巨魔 👹 | 48 | 180 | 16 | 62 | 超级肉盾，出场慢 |

**规则**

- 法力初始 30，每秒回复 10，上限 100。
- 敌方每 2.75 秒出一波，每 15 秒增强一档（兵种变强 + 数量变多）。
- 双方核心各 240 血，谁先掉光谁输。
- 一局通常 30–60 秒。

**画不准怎么办？** 画板会拒绝认不出的形状（画竖线、斜线、乱涂都不会误召唤），重新画一次即可。
画得越接近标准形状，识别越稳。

---

## 目录结构

```
gesture-arena/
├── index.html              游戏入口（页面骨架 + HUD 元素）
├── start.bat               Windows 一键启动
├── start.sh                macOS / Linux 一键启动
├── ONBOARDING.md           新成员接入指南（新人先看这个）
├── README.md               项目介绍与运行说明
├── CONTRIBUTING.md         协作流程与代码规范
├── src/
│   ├── main.js             主入口：接线 + 主循环（唯一需要改这里的人）
│   ├── config.js           全局配置：所有可调数值
│   ├── input/
│   │   ├── gesture-canvas.js      手势画板：接收鼠标/触摸，记录轨迹
│   │   └── gesture-recognizer.js  手势识别：$1 算法 + 模板
│   ├── summon/
│   │   ├── creature-data.js       生物数据表（数值都在这里）
│   │   └── summoner.js            召唤逻辑：手势 → 生物 → 校验法力
│   ├── battle/
│   │   ├── entity.js              实体：生物、塔
│   │   └── battle.js              战斗规则：走位、伤害、波次、胜负
│   └── ui/
│       ├── renderer.js            Canvas 渲染：画战场
│       ├── hud.js                 DOM 界面：血条、提示、结算
│       └── style.css              样式
└── assets/
    ├── images/             图片资源
    └── audio/              音效资源
```

**分层原则**：`battle/` 是纯逻辑，不碰 DOM 和 canvas；`ui/` 只读数据、不改数据。
所以换美术风格不会影响玩法，调玩法也不会影响画面。

---

## 常见改动

### 改数值（不需要懂代码）

打开 `src/config.js`，改数字即可：

```js
manaRegen: 10,        // 法力每秒回复，调大游戏更快
enemyInterval: 2.75,  // 敌人出怪间隔，调小更难
towerHp: 240,         // 塔的血量，调大节奏更慢
```

生物数值在 `src/summon/creature-data.js`，改 `hp` / `dps` / `speed` / `cost` 就行。

### 加一个新生物

1. 在 `src/summon/creature-data.js` 的 `CREATURES` 数组里加一条，`gesture` 填一个**新的** id。
2. 在 `src/input/gesture-recognizer.js` 里加对应模板：

```js
// 1) 写一个生成轨迹的函数，返回点数组
function myShape() {
  return [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
}

// 2) 加进 TEMPLATES
makeTemplate('my_shape', myShape()),
```

3. 在 `index.html` 的 `.legend` 里加一行图例。

### 加音效

在 `src/ui/` 下新建 `audio.js`，用 `new Audio('assets/audio/xxx.mp3')` 播放，
在 `main.js` 里调用。音效文件放 `assets/audio/`。

---

## 5 人协作规范

**核心原则：按目录分工，不要多人同时改同一个文件。**

### 建议分工

| 角色 | 负责目录 | 能改的文件 |
|---|---|---|
| A 手势 | `src/input/` | `gesture-canvas.js`、`gesture-recognizer.js` |
| B 生物 | `src/summon/` | `creature-data.js`、`summoner.js` |
| C 战斗 | `src/battle/` | `battle.js`、`entity.js` |
| D 界面 | `src/ui/` | `renderer.js`、`hud.js`、`style.css` |
| E 整合 | 根目录 | `main.js`、`config.js`、`index.html`、文档 |

`main.js` 和 `index.html` 只有 E 能改，其他人需要新接口就找 E 加。
这样 5 个人同时开工也不会互相覆盖。

### 当前待认领的任务

每个角色一个 Issue，里面有具体的验收标准。**认领方式：在 Issue 下回一句"我接了"，然后开分支干活。**

| 角色 | 任务 | Issue |
|---|---|---|
| A 手势 | 摄像头手势接入主游戏 | [#3](../../issues/3) |
| B 生物 | 生物表配置化 + 补 2 个新生物 | [#4](../../issues/4) |
| C 战斗 | 战斗数值集中配置 + 技能机制 | [#5](../../issues/5) |
| D 界面 | 视觉打磨：朝向、受击反馈、跳字 | [#6](../../issues/6) |
| E 整合 | 新手引导 + 再来一局 + 移动端 | [#7](../../issues/7) |

全部任务列表见 [Issues](../../issues)。

### 分支与合并

```
main          ← 永远可运行，只接受 PR 合并
 └ feature/xxx ← 每人一个分支，做完发 PR
```

**每次开工的标准流程**

```bash
git checkout main
git pull                        # 先同步最新代码
git checkout -b feature/你的任务  # 建自己的分支
# ……改代码……
git add .
git commit -m "feat: 加了雷鸟的闪电特效"
git push -u origin feature/你的任务
```

然后在 GitHub 网页上点 **Compare & pull request** 发起 PR，至少 1 人 review 后合并。

**分支命名**

| 前缀 | 用途 | 例子 |
|---|---|---|
| `feature/` | 新功能 | `feature/gesture-trail` |
| `fix/` | 修 bug | `fix/mana-overflow` |
| `art/` | 美术资源 | `art/creature-sprites` |
| `docs/` | 文档 | `docs/readme-setup` |

**提交信息**用 `类型: 说明` 的格式，例如 `feat: 新增巨魔`、`fix: 修复生物卡住不动`、`docs: 补充启动说明`。

### 冲突预防

- 开工前一定先 `git pull`。
- 只改自己负责的目录。
- 数值调整集中在 `config.js` 和 `creature-data.js`，避免散落。
- 合并前先在自己机器上跑一遍：能启动、能画手势、能分出胜负。

详细流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 技术说明

| 项 | 说明 |
|---|---|
| 渲染 | Canvas 2D，逻辑坐标 1000×420，实际像素 2000×840（2 倍清晰度） |
| 手势识别 | $1 Unistroke Recognizer 简化版：重采样 64 点 → 等比缩放 → 居中 → 逐点比对 |
| 识别准确率 | 模拟真人手绘 800 次，四类手势识别率 100%；乱画误判率约 11% |
| 循环 | `requestAnimationFrame`，单帧步长上限 0.05 秒（切标签页回来不会瞬移） |
| 兼容性 | 支持 Pointer Events 的现代浏览器（Chrome / Edge / Safari / Firefox 均可） |

**识别器两个关键设计**

1. 圆形是闭合图形，起点可能在任意位置，所以比对时会做**循环移位对齐**。
2. 竖线、斜线做成**负样本模板**，匹配到就判为无效，避免玩家画歪了误召唤。

---

## 当前进度

已完成（可运行、可展示）：

- [x] 手势绘制 + 四类手势识别
- [x] 召唤系统 + 法力经济
- [x] 实时战斗：走位、交战、拆塔、胜负
- [x] 敌方波次随时间增强
- [x] HUD、结算面板、重开
- [x] 粒子与光效
- [x] 摄像头手势识别模块（`src/input/hand/`，未接入主流程，见 Issue #3）

后续可做：

- [ ] 音效与背景音乐（`assets/audio/` 已就位）
- [ ] 生物用图片替代 emoji（`assets/images/` 已就位）
- [ ] 更多手势与生物
- [ ] 技能系统（画复杂手势放大招）
- [ ] 移动端触屏适配优化
- [ ] 排行榜 / 最高连击

### 待决策

仓库里存了队友 C 交付的**1v1 决斗制**战斗系统（`src/battle/battle-system.js`，已存档在 `feature/battle-system` 分支，60 项测试全过），和当前上线的**塔防制**是两套不同玩法：

| | 塔防制（现在跑这套） | 1v1 决斗制（未接入） |
|---|---|---|
| 手势作用 | 召唤生物 | 出招 / 放技能 |
| 对手 | 敌方塔 + 源源不断的波次 | 单个敌方怪物 |
| 资源 | 法力条 | 技能冷却 |
| 胜负 | 拆掉对方塔 | 打空对方血量 |

接入决斗制需要重写 `renderer.js`、`hud.js`、`main.js`，并加一个选怪界面。**最终用哪套由队长决定**，确定后再开对应 Issue。

---

## 许可

本项目为团队参赛作品，暂未选择开源协议。如需公开复用，请先与团队确认。
