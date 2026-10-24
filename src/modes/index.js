/**
 * 模式注册表
 * ==================================================================
 * 玩法是可插拔的：每个模式导出一个对象，实现同一套接口
 * （接口定义见同目录 README.md）。
 *
 * 要加第三种玩法（比如「节奏点击」），只需要：
 *   1. 新建 xxx-mode.js，实现 reset / update / handleGesture / getView / restart
 *   2. 在下面的 MODES 里登记一行
 *   3. 如果画面完全不一样，再写一个 xxx-scene.js
 * main.js 不用改。
 */

import { TowerMode } from './tower-mode.js';
import { DuelMode } from './duel-mode.js';

export const MODES = {
  tower: {
    id: 'tower',
    name: '塔防制',
    tagline: '画手势召唤生物，推进拆掉敌方核心',
    desc: '源源不断的敌人会来攻你的塔。用手势召唤生物反推，拆掉对面核心就赢。',
    accent: '#5b8cff',
    create: () => new TowerMode(),
  },
  duel: {
    id: 'duel',
    name: '1v1 决斗',
    tagline: '选一只生物，画手势出招，打空对面血量',
    desc: '和一只怪物单挑。线条类手势普攻，图形类手势放技能，先打空对方血量就赢。',
    accent: '#ffd93d',
    create: () => new DuelMode(),
  },
};

export const MODE_IDS = Object.keys(MODES);

/** 没选过模式时的默认值 */
export const DEFAULT_MODE = 'tower';

/** 玩家选过的模式存在这里，下次进来直接用 */
const STORAGE_KEY = 'ga.mode';

export function isValidMode(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MODES, id);
}

/**
 * 按优先级决定开局用哪个模式：
 *   1. URL 参数 ?mode=duel （方便演示时直接甩链接）
 *   2. localStorage 上次选的
 *   3. 默认塔防
 * @returns {string | null} 返回 null 表示「没选过，需要弹选择界面」
 */
export function resolveInitialMode(search = '', storage = null) {
  try {
    const params = new URLSearchParams(search);
    const fromUrl = params.get('mode');
    if (isValidMode(fromUrl)) return fromUrl;
  } catch {
    /* URLSearchParams 不可用就跳过 */
  }

  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (isValidMode(saved)) return saved;
  } catch {
    /* 隐私模式下 localStorage 会抛错 */
  }

  return null;
}

export function rememberMode(id, storage = null) {
  if (!isValidMode(id)) return;
  try {
    storage?.setItem(STORAGE_KEY, id);
  } catch {
    /* 存不了就算了，不影响这一局 */
  }
}

export function createMode(id) {
  const def = MODES[id];
  if (!def) throw new Error(`[modes] 未知模式：${id}`);
  return def.create();
}
