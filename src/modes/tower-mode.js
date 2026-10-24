/**
 * 塔防模式适配器
 * ==================================================================
 * 把现有的 Battle（battle.js）包装成统一模式接口，供 main.js 路由调用。
 *
 * 【为什么要有适配器】
 *   两套玩法的内部数据结构完全不同：
 *     塔防 = playerTower / enemyTower / creatures[] / mana
 *     决斗 = player / enemy / 技能冷却
 *   ui/hud.js 和 main.js 不应该为每套玩法写一份 if-else，
 *   所以在这里统一翻译成同一个 view 模型（见同目录 README.md）。
 *
 * 【这一层不改玩法】
 *   Battle 的规则一行没动。适配器只做「调用 + 翻译」。
 */

import { Battle } from '../battle/battle.js';
import { Summoner } from '../summon/summoner.js';
import { CREATURES } from '../summon/creature-data.js';
import { ECONOMY, GESTURE_GLYPH } from '../config.js';

export class TowerMode {
  constructor() {
    this.id = 'tower';
    this.name = '塔防制';
    this.tagline = '画手势召唤生物，推进拆掉敌方核心';

    this.battle = new Battle();
    this.summoner = new Summoner(this.battle);
  }

  /** 开新一局 */
  restart() {
    this.battle.reset();
    return { ok: true, message: '新的一局开始' };
  }

  /** 推进一帧 */
  update(dt) {
    this.battle.update(dt);
  }

  /**
   * 处理一次手势识别结果
   * @param {{id:string, score:number} | null} result
   * @returns {{ok:boolean, message:string}}
   */
  handleGesture(result) {
    const out = this.summoner.cast(result);
    return { ok: out.ok, message: out.message };
  }

  /** 控制条上的手势图例 */
  getLegend() {
    return CREATURES.map((c) => ({
      glyph: GESTURE_GLYPH[c.gesture] ?? '?',
      label: c.name,
      cost: c.cost,
      color: c.color,
    }));
  }

  /** 资源条的含义（塔防 = 法力） */
  getResourceLabel() {
    return '法力';
  }

  /**
   * 统一视图模型。
   * hud.js / renderer.js 只认这个结构，不认 Battle 内部字段。
   */
  getView() {
    const b = this.battle;

    return {
      mode: 'tower',
      phase: b.state,                       // playing | win | lose
      result: b.state === 'playing' ? null : b.state,
      time: b.time,

      hud: {
        left: {
          label: '我方核心',
          hp: b.playerTower.hp,
          maxHp: b.playerTower.maxHp,
          ratio: b.playerTower.hpRatio,
          color: '#4ade80',
        },
        right: {
          label: '敌方核心',
          hp: b.enemyTower.hp,
          maxHp: b.enemyTower.maxHp,
          ratio: b.enemyTower.hpRatio,
          color: '#f87171',
        },
        resource: {
          label: '法力',
          value: Math.floor(b.mana),
          max: ECONOMY.manaMax,
          ratio: b.mana / ECONOMY.manaMax,
        },
      },

      legend: this.getLegend(),

      // 塔防渲染器直接吃 Battle 实例（renderer.js 的既有实现）
      world: b,

      stats: {
        time: b.time,
        detail: `用时 ${b.time.toFixed(1)} 秒 · 召唤 ${b.summonCount} 次 · 击杀 ${b.kills} 个`,
      },
    };
  }
}
