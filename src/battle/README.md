# 战斗系统（C 战斗 / `src/battle/`）

1v1 决斗制战斗逻辑：血量、攻击、技能、伤害结算、敌人定时攻击、胜负判定。

**纯逻辑层** —— 不碰 DOM、不碰 canvas、不认识手势和摄像头，可以脱离浏览器单独跑。

---

## 1. 交付范围

| 文件 | 作用 |
| --- | --- |
| `src/battle/battle-system.js` | 战斗系统本体（唯一需要接入的文件） |
| `src/battle/battle-system.test.mjs` | 单测，58 条用例 |
| `src/battle/demo.mjs` | 命令行演示，把整场战斗逐步打印出来 |
| `src/battle/fixture.mjs` | 测试/演示用的怪物表，字段与 B 的 `creature-data.js` 一致 |
| `src/battle/README.md` | 本文件 |

**没有改动任何其他人的文件。** 现有 `battle.js`、`entity.js`、`main.js`、`index.html`、
`config.js`、`ui/`、`input/`、`summon/` 全部保持原样。

---

## 2. 先跑起来看

```bash
node src/battle/battle-system.test.mjs   # 58 条用例，不需要摄像头/浏览器
node src/battle/demo.mjs                 # 打印三场完整战斗
```

两条命令都不需要 `npm install`，仓库的「零依赖无构建」不受影响。

`demo.mjs` 会打出类似这样的时间轴，肉眼就能验收整条链路：

```
t= 0.00s  我方普攻  → 造成   7 伤害   敌方剩余 173/180
t= 1.80s  敌方普攻  → 造成  16 伤害   我方剩余 94/110
t= 4.00s  敌方重击  → 造成  24 伤害   我方剩余 54/110
...
  结果：失败 💀
```

---

## 3. 接口

### 3.1 任务书点名的四个接口

模块级直接可用，不用 `new`：

```js
import {
  startBattle, playerAttack, getBattleState, resetBattle,
} from './battle/battle-system.js';

startBattle('fox');        // → { ok, state } | { ok:false, reason:'unknown-monster' }
playerAttack();            // → { ok, damage, enemyHp, killed, state } | { ok:false, reason }
getBattleState();          // → 战斗状态快照（全新对象，见 §4）
resetBattle();             // → 回到 idle，可重新 startBattle
```

另外补了两个（任务书没列但玩法需要）：

```js
import { updateBattle, configureDefaultBattle } from './battle/battle-system.js';

updateBattle(dt);          // 推进时间：冷却回复 + 敌人定时攻击
```

> 为什么接口清单里没有 `update` 却必须有：
> 任务书要求「敌人可以定时进行简单攻击」，定时就必须有人推进时钟。
> 主循环里已经在调 `battle.update(dt)`，这里沿用同一个位置，不需要新增循环。
> 单帧步长会被夹到 `RULES.maxDelta`（0.1s），切标签页回来不会一帧跳完整场战斗。

### 3.2 推荐用法：类实例

如果要同时跑多场战斗（演示对战、回放），用 `createBattleSystem()` 各建一个：

```js
import { BattleSystem } from './battle/battle-system.js';

const battle = new BattleSystem({
  onEvent: (e) => { /* 每次结算后回调，纯数据，见 §4.3 */ },
  onEnd:   (result, state) => { /* 只在胜负产生时回调一次 */ },
  rules:   { enemyAttackInterval: 1.4 },   // 可选：覆盖数值旋钮
});
```

`reason` 的取值：`not-started` / `unknown-monster` / `cooldown` / `battle-over` / `invalid`。
**所有接口都不抛异常** —— 现场演出不该因为一次误触整个黑屏。

---

## 4. 战斗状态

```js
{
  phase: 'idle' | 'playing' | 'win' | 'lose',   // 当前状态
  result: null | 'win' | 'lose',                // 胜负结果
  over: false,
  time: 12.3,                                    // 已进行秒数
  round: 9,                                      // 玩家出手次数

  player: { id, name, type, color, glyph,
            hp, maxHp, hpRatio,                  // 玩家血量
            attack, defense, speed,
            cooldown, skillCooldown, skillReady, attackInterval },

  enemy:  { id, name, type, color, glyph,
            hp, maxHp, hpRatio,                  // 敌人血量
            attack, defense, speed,
            nextAttackIn,                        // 敌人还有多久出手（可以做倒计时条）
            heavyNext, attackInterval },         // 下次是不是重击（可以做预警）

  stats: { playerAttacks, playerSkills, enemyAttacks, damageDealt, damageTaken },
  lastEvent: { ... },
  log: [ { t, type, damage, ... } ],             // 最近 20 条
}
```

`getBattleState()` **每次返回全新对象**，UI 拿到之后随便改都不会影响战斗内部
（符合 `CONTRIBUTING.md` 的「`ui/` 只读 `battle/` 数据」）。可以直接 `JSON.stringify`。

### 4.1 规则

| 项 | 值 | 说明 |
| --- | --- | --- |
| 伤害 | `攻击 × 100/(100+防御)` | 防御 100 时减半；无论多高至少打 1 点，不会卡成打不动 |
| 出手节奏 | `速度` 越高越快 | 以速度 60 为基准，倍率夹在 0.6~1.6 倍之间 |
| 玩家普攻冷却 | `0.55s × 速度倍率` | 防止手势连点刷伤害 |
| 玩家技能 | 1.8 倍伤害，冷却 4s | 技能是「时机」，不吃速度缩放 |
| 敌人出手 | `1.1s × 速度倍率`，开场宽限 1.8s | 宽限期让玩家先熟悉操作 |
| 敌人重击 | 每第 3 次出手，1.5 倍 | 状态里有 `heavyNext` 可以提前预警 |
| 随机性 | **无** | 同样的操作序列一定得到同样的结果 |

> **为什么没有随机数**：任务书写了「优先保证比赛现场稳定运行」。
> 没有暴击、没有闪避，彩排是什么样，现场就是什么样。

### 4.2 战斗单位字段怎么来的

战斗层从 B 的怪物数据里**按优先级取字段**，所以 B 改数据不用改我这边的代码：

```
攻击力：attack → atk → dps → damage → 默认 10
防御力：defense → def → armor → 默认 0
血量：  hp → maxHp → health → 默认 100（下限 1）
速度：  speed → 默认 60（下限 1）
```

**注意**：现在 `creature-data.js` 里只有 `dps`，会被当成「每下攻击力」使用。
如果 B 之后按任务书补上 `attack`/`defense`，战斗层会自动优先采用新字段，无需改动。
这一条需要跟 B 对齐一次口径 —— 见 §8。

### 4.3 事件

`onEvent(event)` 每次结算后回调，`event` 是纯数据（`t` 是秒数）：

| type | 何时 | 关键字段 |
| --- | --- | --- |
| `start` | 开局 | `playerId`, `enemyId` |
| `player-attack` | 玩家普攻命中 | `damage`, `enemyHp`, `killed` |
| `player-skill` | 玩家技能命中 | `damage`, `enemyHp`, `killed` |
| `enemy-attack` | 敌人出手 | `heavy`, `damage`, `playerHp`, `killed` |
| `win` / `lose` | 分出胜负 | `time`, `round` |
| `invalid` | 非法调用 | `reason`, `message` |

UI 的特效、飘字、音效**都应该挂在这个回调上**，而不是每帧去 diff 血量。
回调抛错只会 `console.error`，不会把战斗带崩。

---

## 5. 怎么接入主项目

### 5.1 给 E（`main.js` 只有 E 能改）

把塔防那套 `new Battle()` 换成 `new BattleSystem()`，四处改动：

```js
// ① 顶部 import
import { BattleSystem } from './battle/battle-system.js';

// ② 替换 new Battle()
const battle = new BattleSystem({
  onEvent: (e) => { /* 可选：音效 / 飘字 */ },
  onEnd: (result) => {
    // 复用现有结算面板
    hud.showResult(result === 'win' ? '胜利' : '失败');
  },
});

// ③ 选人阶段结束后（选择系统的确认回调里）开局
battle.startBattle(selectedMonsterId);

// ④ 主循环里：原来 battle.update(dt) 的位置原样调用，签名没变
battle.update(dt);

// ⑤ 手势识别回调里（原来 summoner.cast(result) 的位置）转发攻击
const out = battle.playerAttack();
if (!out.ok && out.reason === 'cooldown') hud.toast('还没冷却好', 'warn');
```

`update(dt)` 的签名和原来的 `battle.update(dt)` 完全一致，循环结构一行都不用改。

### 5.2 给 A（手势）：把识别结果转成攻击

战斗层**不重复实现手势识别**，只接收转发进来的指令。
`gesture-recognizer.js` 现在会返回 `{ id, score }`，建议的映射：

```js
const GESTURE_TO_ACTION = {
  zigzag:   () => battle.playerSkill(),   // 折线 = 技能（重击）
  v_shape:  () => battle.playerSkill(),
  // 其余手势（circle / line_h）以及任何识别成功的结果 = 普攻
};

onRecognized(result) {
  const act = GESTURE_TO_ACTION[result.id] ?? (() => battle.playerAttack());
  const out = act();
  if (!out.ok && out.reason === 'cooldown') hud.toast('还没冷却好', 'warn');
}
```

手势和招式的具体对应关系由 A 定，战斗层不关心 —— 换成别的映射不需要改战斗代码。

### 5.3 给 D（UI）：字段对照表（**这一步必须做**）

现有的 `renderer.js` / `hud.js` 读的是塔防那套字段，**新战斗状态里没有这些**：

| 旧 `battle` 字段 | 新的 `getBattleState()` |
| --- | --- |
| `battle.playerTower.hp` | `state.player.hp` / `state.player.maxHp` |
| `battle.enemyTower.hp` | `state.enemy.hp` / `state.enemy.maxHp` |
| `battle.state`（`'playing'`/`'win'`/`'lose'`） | `state.phase`（同名同义，可直接替换） |
| `battle.time` | `state.time` |
| `battle.creatures`（一整队小怪） | 1v1 没有对应物，改用 `state.player` / `state.enemy` |
| `battle.particles` | 改由 `onEvent` 驱动 |
| `battle.mana` / `manaMax` | **不再需要**（1v1 没有法力经济） |
| `battle.kills` / `summonCount` | `state.stats` |

**所以 `hud.update(battle)` / `renderer.render(battle)` 不能直接传新对象** ——
D 要么加一个几行的适配层，要么换成读 `state.player.hpRatio` / `state.enemy.hpRatio` 画血条。

好消息是画血条需要的两个数（`hpRatio`）和倒计时需要的 `enemy.nextAttackIn` 都是现成的，
不需要 D 自己算。

---

## 6. 数值旋钮

全部集中在 `battle-system.js` 顶部的 `RULES`，改数值不用翻逻辑：

```js
playerAttackCooldown: 0.55,   // 玩家普攻基准冷却
playerSkillCooldown: 4.0,     // 技能冷却
playerSkillMultiplier: 1.8,   // 技能倍率
enemyAttackInterval: 1.1,     // 敌人出手基准间隔
enemyFirstAttackDelay: 1.8,   // 开场宽限
enemyHeavyEvery: 3,           // 每几次出手来一发重击
enemyHeavyMultiplier: 1.5,    // 重击倍率
damageFloor: 1,               // 伤害保底
defenseSoftCap: 100,         // 防御 = 该值时伤害减半
speedBaseline: 60,            // 速度基准
speedFactorMin: 0.6,          // 速度倍率下限
speedFactorMax: 1.6,          // 速度倍率上限
maxDelta: 0.1,                // 单帧推进上限
logLimit: 20,                 // 事件日志条数
```

可以整体覆盖，也可以只覆盖几项：

```js
new BattleSystem({ rules: { enemyAttackInterval: 1.4 } });
```

> `config.js` 属 E 的文件，所以旋钮放在战斗模块自己内部，
> 没有往 `config.js` 里塞东西。等 E 决定要不要搬进 `config.js`。

**当前平衡**（用 `fixture.mjs` 那四只怪实测）：

| 对局 | 结果 | 用时 |
| --- | --- | --- |
| 雷鸟 vs 石灵 | 胜，不掉血 | 1.6s |
| 石灵 vs 巨魔 | **负** | 7.2s |
| 巨魔（用技能）vs 石灵 | 胜，剩 105/180 | 12.0s |

胜负两种结果都摸得到 —— 选哪只怪、用不用技能，真的会影响结果。

---

## 7. 和现有 `battle.js` 的关系

**两者并存，互不影响。**

现有 `battle.js` 是「塔防推线」玩法，被 `ui/renderer.js` 和 `ui/hud.js` 直接依赖
（读 `battle.playerTower` / `enemyTower` / `creatures` / `particles` / `mana`）。
原地改写会连带弄坏 D 的界面和 E 的 `main.js`，所以这里**新增**一个独立模块。

等 E 和 D 都准备好切换了，再由 E 改 `main.js` 指向 `battle-system.js`。
在那之前，现有游戏照常跑，谁都不受影响。

---

## 8. 已知限制 / 待确认

1. **`dps` 的口径**：现在把 `dps`（每秒伤害）当成「每下攻击力」用，这和字段名有出入。
   需要跟 B 确认：是按任务书补 `attack` 字段，还是干脆把 `dps` 改名成 `attack`。
   战斗层的读取优先级已经兼容两种写法，所以**这个决定不阻塞我这边**。
   但平衡数值需要按最终口径再调一次（`fixture.mjs` 与 §6 的表格都是按 `dps` 当攻击力算的）。
2. **怪物数量**：任务书说「3 只已有怪物」，实际 `creature-data.js` 里有 4 只。
   战斗层不限制数量，来几只都能打。
3. **敌人只有 1 只**：状态里是 `enemy` 单数。如果要「一波小怪」，需要改状态结构 —— 现在没做。
4. **技能只有 1 个**：玩家侧就一个倍率重击。要做多技能需要扩接口。
5. **`fixture.mjs` 不是数据源**：它只是让单测/演示能脱离上游独立跑。
   真机上的怪物数据始终来自 B。**提交时不要把它当成正式数据表。**
6. **`src/monsters/` 的去留**：上一轮按任务书写的怪物库（含 `MonsterSelector` 3D 选择器）
   与本次战斗系统无关，按 §5.3 的字段差异，它和本模块暂时接不起来。等用户拍板技术路线后再定。

---

## 9. 验收对照

| 任务书验收标准 | 状态 |
| --- | --- |
| 不依赖真实摄像头也能测试调用攻击接口 | ✅ `node src/battle/battle-system.test.mjs` 58/58 |
| 完整完成开始战斗 | ✅ `startBattle(monsterId)`，未知 id 被拦下 |
| 攻击 | ✅ `playerAttack()` / `playerSkill()`，冷却与伤害都有测试 |
| 血量变化 | ✅ 双方血量、比例、伤害统计、血量地板 0 |
| 敌人反击 | ✅ `update(dt)` 定时触发，含重击与 `nextAttackIn` 预警 |
| 胜负判定 | ✅ 两种结果都有用例覆盖，只结算一次 |
| 说明如何接入主项目 | ✅ §5 |