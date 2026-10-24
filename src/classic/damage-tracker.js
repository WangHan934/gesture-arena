/**
 * 伤害跳字的「攒伤害」逻辑
 * ==================================================================
 * 为什么需要攒：
 *   决斗引擎一次攻击就是一块整数伤害（13~40），可以直接跳；
 *   塔防引擎是按 dps × dt 每帧扣血，一帧只有 0.2~0.4 点，
 *   逐帧跳字会变成刷屏的小数，什么也看不清。
 *   所以塔防这边先攒着，攒够一个时间片（默认 0.25 秒）再跳一个整数。
 *
 * 【为什么单独成文件】
 *   纯数据，不碰 DOM 也不碰 three，可以直接跑单元测试。
 *   scene3d.js 只负责「把这个数字画在哪个位置」。
 *
 * 【血量上限变了就重来】
 *   开了新一局 / 换了一只生物，maxHp 会变，这时血量会「跳上去」。
 *   这种情况不能当成回血，也不能当成受伤，直接重置记录、不跳字。
 */

/** 塔防攒多久跳一次（秒） */
export const TOWER_FLUSH_INTERVAL = 0.25;

/** 小于这个值的伤害不算数（浮点噪声） */
export const MIN_DAMAGE = 0.02;

/** 一次攒够目标最大血量的这个比例，就立刻跳，不等时间片 */
export const BURST_RATIO = 0.05;

export class DamageTracker {
  /**
   * @param {{flushInterval?:number, burstRatio?:number}} [options]
   */
  constructor({ flushInterval = TOWER_FLUSH_INTERVAL, burstRatio = BURST_RATIO } = {}) {
    this.flushInterval = flushInterval;
    this.burstRatio = burstRatio;
    /** key → { hp, maxHp, acc, wait } */
    this.records = new Map();
  }

  /**
   * 记一次血量。第一次见到这个 key 只登记，不跳字。
   * @param {string} key 单位标识（和渲染层的 unit key 一致）
   * @param {number} hp 当前血量
   * @param {number} maxHp 血量上限
   * @param {{instant?:boolean}} [options] instant = 整块伤害（决斗），立刻跳
   * @returns {{value:number, ratio:number} | null} 需要跳字时返回伤害值
   */
  note(key, hp, maxHp, { instant = false } = {}) {
    if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return null;

    const rec = this.records.get(key);
    if (!rec) {
      this.records.set(key, { hp, maxHp, acc: 0, wait: 0 });
      return null;
    }

    // 换了生物 / 开了新一局：上限变了，或者血变多了 —— 重置，不跳字
    if (Math.abs(rec.maxHp - maxHp) > 1e-6 || hp > rec.hp + MIN_DAMAGE) {
      rec.maxHp = maxHp;
      rec.hp = hp;
      rec.acc = 0;
      rec.wait = 0;
      return null;
    }

    const delta = rec.hp - hp;
    rec.hp = hp;
    if (delta < MIN_DAMAGE) return null;

    rec.acc += delta;
    const ready = instant || rec.acc >= maxHp * this.burstRatio;
    return ready ? this._flush(rec) : null;
  }

  /**
   * 推进时间片，把攒够时间的伤害吐出来。
   * @param {number} dt
   * @returns {Array<{key:string, value:number, ratio:number}>}
   */
  tick(dt) {
    const out = [];
    if (!(dt > 0)) return out;

    for (const [key, rec] of this.records) {
      if (rec.acc < MIN_DAMAGE) continue;
      rec.wait += dt;
      if (rec.wait < this.flushInterval) continue;
      out.push({ key, ...this._flush(rec) });
    }
    return out;
  }

  /** 单位退场了，把它的记录一起丢掉，否则打一局会攒下几百条 */
  forget(key) {
    this.records.delete(key);
  }

  clear() {
    this.records.clear();
  }

  _flush(rec) {
    const value = Math.max(1, Math.round(rec.acc));
    rec.acc = 0;
    rec.wait = 0;
    return { value, ratio: value / rec.maxHp };
  }
}
