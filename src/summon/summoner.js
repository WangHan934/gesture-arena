/**
 * 召唤系统
 * ------------------------------------------------------------------
 * 把手势识别结果翻译成一次召唤尝试，并把失败原因翻译成人话。
 *
 * 这样 UI 层不需要知道「法力够不够」「这个手势有没有生物」，
 * 只负责把返回的 message 显示出来。
 */

import { getCreatureByGesture } from './creature-data.js';

export class Summoner {
  constructor(battle) {
    this.battle = battle;
  }

  /**
   * @param {{id:string, score:number} | null} gestureResult 识别器返回的结果
   * @returns {{ok:boolean, message:string, def?:object}}
   */
  cast(gestureResult) {
    if (this.battle.state !== 'playing') {
      return { ok: false, message: '本局已结束' };
    }

    if (!gestureResult) {
      return { ok: false, message: '没认出来，再画一次' };
    }

    const def = getCreatureByGesture(gestureResult.id);
    if (!def) {
      return { ok: false, message: '这个手势还没有对应生物' };
    }

    const res = this.battle.summon(def);
    if (!res.ok) {
      if (res.reason === 'mana') {
        return { ok: false, message: `法力不足（${def.name} 需要 ${def.cost}）`, def };
      }
      return { ok: false, message: '现在无法召唤', def };
    }

    return { ok: true, message: `召唤 ${def.name}`, def };
  }
}
