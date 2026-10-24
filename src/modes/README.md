# 模式层（`src/modes/`）

玩法是**可插拔**的。这个目录负责把「塔防制」和「1v1 决斗」两套完全不同的玩法
包装成同一个接口，让 `main.js` / `hud.js` 不用为每套玩法写 if-else。

归属：**E 整合**。

---

## 一、为什么需要这一层

两套玩法的内部数据结构完全不同：

| | 塔防制 | 1v1 决斗 |
|---|---|---|
| 战斗引擎 | `battle/battle.js` | `battle/battle-system.js` |
| 关键数据 | `playerTower` / `enemyTower` / `creatures[]` / `mana` | `player` / `enemy` / 技能冷却 |
| 手势含义 | 召唤生物 | 出招（普攻 / 技能） |
| 胜负条件 | 拆掉对方塔 | 打空对方血量 |
| 界面要显示 | 两座塔的血 + 法力 | 两个人的血 + 技能条 |

如果让 `hud.js` 直接读这些字段，加第三种玩法就要再写一遍。
所以中间加一层适配器，统一翻译成 **view 模型**。

---

## 二、模式接口

每个模式是一个类，必须实现下面 6 个东西：

```js
class XxxMode {
  id        // string，和注册表里的 key 一致
  name      // string，显示给玩家看的中文名
  tagline   // string，一句话说明

  restart()                  // → { ok, message }，开新一局
  update(dt)                 // 推进一帧，dt 单位秒
  handleGesture(result)      // → { ok, message }，result 是识别器输出或 null
  getLegend()                // → [{ glyph, label, cost?, color? }]，控制条图例
  getView()                  // → 见下方 view 模型
}
```

`handleGesture` 返回的 `message` 会被 `main.js` 直接丢进提示气泡，
所以**必须是人话**（「法力不足（雷鸟 需要 38）」而不是 `reason: 'mana'`）。

### 摄像头 / 键盘（可选实现）

摄像头和键盘共用**同一套动作词表**，都走 `handleAction()`：

```js
cameraMap                 // { pose: action }，pose 是 open_palm|fist|one|two|three
keyMap                    // { KeyboardEvent.code: action }
handleAction(a)           // → { ok, message, started? }，started=true 表示"开始了一局"
getCameraHint()           // → [{ glyph, label }]，摄像头开着时显示的对照表
getKeyHint()              // → [{ keys, label }]，控制条上常驻的键盘提示
```

动作词表：`creature:N` / `monster:N` / `attack` / `skill` / `toward` / `away`。

**关键约束：键盘不要直接调战斗引擎。** 按键应该合成一个动作交给 `handleAction()`，
让它复用冷却、射程、法力判断。否则会出现「键盘能无限召唤 / 绕过冷却」这种两套逻辑各写一遍的 bug。
`tests/keyboard.test.mjs` 专门验了这条。

`cameraMap` / `keyMap` 里没列的键会被静默忽略。映射放在模式里而不是输入层，是因为
模块只认 5 种姿态、键盘键位也和玩法强相关，放进输入层会让输入层认识所有玩法。

---

---

## 三、view 模型

`getView()` 的返回值是 `hud.js` 唯一认识的结构：

```js
{
  mode: 'tower' | 'duel',      // 决定用哪个渲染器
  phase: 'playing' | 'win' | 'lose' | 'select',
  result: null | 'win' | 'lose',
  time: number,

  hud: {
    left:  { label, hp, maxHp, ratio, color },   // 左上角血条
    right: { label, hp, maxHp, ratio, color },   // 右上角血条
    resource: {
      label,                                     // 资源名：法力 / 技能
      value,                                     // 数字，或 '就绪' / '蓄力中'
      max,                                       // 上限；空字符串表示没有上限
      ratio,                                     // 0~1，进度条宽度
      ready?,                                    // true 时进度条变金色
    },
  },

  legend: [...],               // 同 getLegend()
  world: <渲染器要的数据>,       // 各模式自己定，见下
  stats: { time, detail },     // detail 是结算面板那一行文字
}
```

`world` 是各模式私有的：

- **塔防**：直接给 `Battle` 实例，`renderer.js` 的既有实现照常吃。
- **决斗**：给一个扁平对象（`player` / `enemy` / `lunge` / `hit` / `effects` …），
  由 `duel-scene.js` 消费。

---

## 四、决斗的走位机制

引擎（`battle-system.js`）里有一个 `distance`：`0` = 贴身，`1` = 最远。
四个射程旋钮决定「打到 / 打不到」，默认全为 `1`（永远够得着），
所以**不传距离时行为和以前完全一致**，原有单测不受影响。

```
0 ──────── enemyHeavyReach ──────── playerReach ──────── 1
   危险区        甜区（能打人 + 躲重击）         安全区
```

| 旋钮 | 作用 | 决斗取值 |
|---|---|---|
| `playerReach` | 普攻最大命中距离 | 0.80 |
| `playerSkillReach` | 技能最大命中距离 | 1.00（远程手段） |
| `enemyReach` | 敌人普攻命中距离 | 1.00（**故意设满**，否则玩家可以一直龟缩） |
| `enemyHeavyReach` | 敌人重击命中距离 | 0.35（必须小于 `playerReach`，否则没有安全输出位） |
| `moveStep` | 画一次横线走多远 | 0.22（必须小于甜区宽度，否则会来回抖） |

**两条硬约束，改之前务必想清楚：**

1. `enemyHeavyReach < playerReach` —— 否则「能打人」和「会吃重击」是同一块区域，
   走位只能靠牺牲输出来躲，越躲越输。第一版就踩了这个坑，模拟器实测走位胜场从 14 掉到 10。
2. `moveStep < playerReach - enemyHeavyReach` —— 否则一步跨过甜区，玩家在两端来回震荡永远落不进去。
   实测 `moveStep = 0.4` 时 16 场全输。

**横线方向从哪来：** 识别器的 `normalize()` 里有旋转对齐，正着画和反着画都会匹配到 `line_h`，
方向信息在那之后就没了。所以 `recognize()` 在**原始点**上补一个 `dir: 'ltr' | 'rtl'` 字段，
只有 `line_h` 会带。

**验证：** `node src/modes/duel-balance.mjs` 会跑两种玩家（会走位 / 站桩）对比胜场，
`node tests/duel-range.test.mjs` 覆盖射程判定和横线方向。

---

## 五、文件清单

| 文件 | 作用 |
|---|---|
| `index.js` | 模式注册表 + 按 URL / localStorage 决定开局模式 |
| `tower-mode.js` | 塔防适配器，包装 `battle.js` |
| `duel-mode.js` | 决斗适配器，包装 `battle-system.js`，含动画状态 |
| `duel-scene.js` | 决斗画面的纯绘制函数（无状态） |
| `duel-balance.mjs` | 决斗平衡自测，`node src/modes/duel-balance.mjs` |

---

## 六、加第三种玩法

1. 新建 `src/modes/xxx-mode.js`，实现上面 6 个成员
2. 在 `index.js` 的 `MODES` 里登记一行（`id` / `name` / `tagline` / `desc` / `accent` / `create`）
3. 画面如果和现有两套都不一样，再写 `xxx-scene.js`，并在 `main.js` 的 `frame()` 里加一个分支
4. `hud.js` **不用改**

---

## 七、决斗模式的数值为什么单独一套

塔防里「攻击」是持续输出，「血量」是挡在前面的时间，两者可以极端分化 ——
石灵 7 攻击 / 110 血当肉盾，雷鸟 26 攻击 / 68 血当炮台，都合理。

但 1v1 里玩家出手被「画一次手势 ≈ 1 秒」卡住，**攻击力直接等于 DPS**，
血量只决定能挨几下。原样搬过来实测：雷鸟、巨魔 100% 胜率，石灵、焰狐 50%。

所以 `config.js` 里有一份 `DUEL_STATS` 修正表，把攻击压到 13~20 的窄区间，
靠血量和速度拉开差异。改之前先跑：

```bash
node src/modes/duel-balance.mjs
```

判断标准：**每只生物作为玩家都要能赢**，且没有对局超过 30 秒。

> 踩过的坑：`battle-system.js` 在没有 `getMonster` 时会优先用上游的
> `getCreatureById`，那样查到的还是原始数值，`DUEL_STATS` 会被静默忽略。
> `duel-mode.js` 里 `monsters` 和 `getMonster` 是成对传的，别只传一个。
