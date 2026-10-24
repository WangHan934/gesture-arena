/**
 * 战斗实体
 * ------------------------------------------------------------------
 * Creature = 场上的生物，Tower = 双方的塔。
 * 这里只管「自己有什么状态」，不含任何走位和战斗决策逻辑，
 * 那些在 battle.js 里。
 */

import { WORLD } from '../config.js';

let _nextId = 1;

export class Creature {
  /**
   * @param {object} def creature-data.js 里的生物定义
   * @param {'player'|'enemy'} side
   */
  constructor(def, side) {
    this.id = _nextId++;
    this.def = def;
    this.side = side;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.alive = true;

    // 出生点：从自己塔前一点点出发
    this.x = side === 'player'
      ? WORLD.playerTowerX + 46
      : WORLD.enemyTowerX - 46;

    // y 表示脚底位置，随机错开一点，看起来像站成一排
    this.y = WORLD.groundY - 4 + (Math.random() * 34 - 14);

    this.spawnAnim = 0;    // 0 → 1 出现动画
    this.hitFlash = 0;     // 受击闪白
    this.attackPulse = 0;  // 攻击动效
    this.bobPhase = Math.random() * Math.PI * 2; // 走路上下浮动相位
  }

  get isPlayer() {
    return this.side === 'player';
  }

  get hpRatio() {
    return Math.max(0, this.hp / this.maxHp);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.12;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  update(dt) {
    if (this.spawnAnim < 1) this.spawnAnim = Math.min(1, this.spawnAnim + dt * 4);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.attackPulse > 0) this.attackPulse = Math.max(0, this.attackPulse - dt);
    this.bobPhase += dt * 6;
  }
}

export class Tower {
  constructor(side, hp) {
    this.side = side;
    this.maxHp = hp;
    this.hp = hp;
    this.flash = 0;
  }

  get hpRatio() {
    return Math.max(0, this.hp / this.maxHp);
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 0.1;
  }

  update(dt) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
  }
}
