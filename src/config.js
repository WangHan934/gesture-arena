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
