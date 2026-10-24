/**
 * 全局配置
 * ------------------------------------------------------------------
 * 所有可调数值集中在这里，改数值不需要动逻辑代码。
 * 调平衡时优先改这个文件，不要散落到各处。
 */

/** 战场世界尺寸（逻辑坐标，渲染时整体缩放） */
export const WORLD = {
  width: 1000,
  height: 420,
  groundY: 330,        // 地面线 y 坐标，生物站在这里
  playerTowerX: 70,    // 我方塔中心 x
  enemyTowerX: 930,    // 敌方塔中心 x
  towerHp: 240,        // 塔的生命值
};

/** 法力（召唤资源）经济 */
export const ECONOMY = {
  manaMax: 100,
  manaStart: 30,
  manaRegen: 10,        // 每秒回复
  manaRegenDelay: 0.35, // 召唤后暂停回复的秒数，防止连点
};

/** 战斗参数 */
export const COMBAT = {
  attackRange: 46,      // 生物互相攻击的距离
  towerRange: 40,       // 攻击塔的距离
  enemyFirstWave: 3.0,  // 第一波敌人出现的秒数
  enemyInterval: 2.75,   // 敌人召唤间隔
  enemyRampEvery: 15,   // 每 N 秒敌人强度提升一档
};

/** 手势输入参数 */
export const GESTURE = {
  minPathLength: 60,    // 笔画太短直接判为无效
  matchThreshold: 0.32, // 识别阈值，越小越严格
  maxPoints: 400,       // 最多记录的轨迹点，防止卡顿
  fadeDelay: 0.45,      // 识别后轨迹保留的秒数
};

/**
 * 手势的显示符号，控制条图例用。
 * 键必须和 gesture-recognizer.js 里模板的 id 一致。
 */
export const GESTURE_GLYPH = {
  circle: '○',
  line_h: '—',
  zigzag: 'Z',
  v_shape: 'V',
};

/**
 * 决斗模式的画面参数（逻辑坐标，和 WORLD 同一坐标系）。
 * 塔防模式的坐标在 WORLD 里，这里单独一组，互不影响。
 */
export const DUEL = {
  playerX: 290,      // 玩家站位
  enemyX: 710,       // 敌人站位
  fighterY: 336,     // 站位基准线（略低于塔防地面线，视觉上更靠近镜头）
  baseSize: 92,      // 生物 emoji 的基准字号
  lungeDistance: 54, // 出手时向前冲的距离
  lungeTime: 0.18,   // 冲刺动画时长（秒）
};

/**
 * 决斗模式的战斗节奏覆盖值。
 *
 * 为什么不能直接用 battle-system.js 里的 RULES：
 *   那套默认值假设玩家「点一下按钮」就出招，所以敌人 1.1 秒一次。
 *   但决斗模式玩家要**画完一个手势**才能出招，实测一次绘制约 0.9~1.2 秒，
 *   照原节奏会被敌人按着打，四只生物全败。
 *   这里把敌人放慢到和「画一次手势」同频，胜负才回到操作上。
 *
 * 只覆盖这几个键，其余仍走 RULES 默认值。
 */
export const DUEL_RULES = {
  playerAttackCooldown: 0.5,   // 玩家普攻基准冷却（还会按速度缩放）
  enemyAttackInterval: 1.6,    // 敌人出手间隔基准
  enemyFirstAttackDelay: 1.5,  // 开场宽限，够玩家看清局面并画出第一笔
};

/**
 * 决斗模式的生物数值修正（只覆盖列出的字段，其余沿用 creature-data.js）。
 *
 * 为什么必须单独一套：
 *   塔防里「攻击」是持续输出，「血量」是挡在前面的时间，两者可以极端分化 ——
 *   石灵 7 攻击 / 110 血当肉盾，雷鸟 26 攻击 / 68 血当炮台，都很合理。
 *   但 1v1 里玩家的出手被「画一次手势 ≈ 1 秒」卡住，
 *   于是攻击力直接等于 DPS，血量只决定能挨几下 —— 高攻怪必胜、肉盾必败。
 *   实测原样搬过来：雷鸟、巨魔 100% 胜率，石灵、焰狐 50%。
 *
 * 修正原则：
 *   把攻击力压到一个窄区间（13~20），靠血量和速度拉开差异；
 *   焰狐血量太低（42）在 1v1 里挨两下就死，单独补到 72。
 *
 * 改这里之前先跑 `node src/modes/duel-balance.mjs` 看胜率表。
 */
export const DUEL_STATS = {
  stone: { attack: 13 },        // 石灵：肉盾，补攻击才有威胁
  fox: { attack: 17, hp: 72 },  // 焰狐：快攻，但原血量在 1v1 里太脆
  bird: { attack: 20 },         // 雷鸟：仍是最高攻，但从 26 压到 20
  brute: { attack: 16, hp: 165 }, // 巨魔：靠重击和血量取胜；180 血在 1v1 里谁也打不过
};



