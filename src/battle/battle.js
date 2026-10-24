/**
 * 战斗系统
 * ------------------------------------------------------------------
 * 一局游戏的完整规则都在这里：
 *   · 法力回复
 *   · 召唤我方生物
 *   · 敌方自动出怪（难度随时间上升）
 *   · 生物走位、互相攻击、攻击塔
 *   · 胜负判定
 *
 * 这一层不碰 DOM，也不碰 canvas —— 纯数据 + 数值推进，
 * 方便以后加联机或做自动化测试。
 */

import { WORLD, ECONOMY, COMBAT } from '../config.js';
import { Creature, Tower } from './entity.js';
import { getCreatureById } from '../summon/creature-data.js';

export class Battle {
  constructor() {
    this.reset();
  }

  /** 开新一局 */
  reset() {
    this.creatures = [];
    this.particles = [];
    this.playerTower = new Tower('player', WORLD.towerHp);
    this.enemyTower = new Tower('enemy', WORLD.towerHp);

    this.mana = ECONOMY.manaStart;
    this.manaPause = 0;
    this.time = 0;
    this.nextWave = COMBAT.enemyFirstWave;
    this.state = 'playing'; // 'playing' | 'win' | 'lose'
    this.kills = 0;
    this.summonCount = 0;
  }

  /* ---------------- 召唤 ---------------- */

  /**
   * 玩家召唤
   * @param {object} def 生物定义
   * @returns {{ok: boolean, reason?: string, creature?: Creature}}
   */
  summon(def) {
    if (this.state !== 'playing') return { ok: false, reason: 'over' };
    if (!def) return { ok: false, reason: 'unknown' };
    if (this.mana < def.cost) return { ok: false, reason: 'mana' };

    this.mana -= def.cost;
    this.manaPause = ECONOMY.manaRegenDelay;

    const c = new Creature(def, 'player');
    this.creatures.push(c);
    this.summonCount++;
    this.burst(c.x, c.y - 18, def.color, 16);

    return { ok: true, creature: c };
  }

  /**
   * 敌方出一波怪
   * 难度随时间提升：兵种池变强 + 同波数量变多，
   * 逼玩家在中前期决出胜负，而不是靠拖时间磨赢。
   */
  spawnEnemy() {
    const tier = Math.floor(this.time / COMBAT.enemyRampEvery);
    const count = 1 + Math.floor(tier / 3); // 1,1,1,2,2,2...

    let pool;
    if (tier < 1) pool = ['fox', 'stone'];
    else if (tier < 2) pool = ['fox', 'stone', 'bird'];
    else pool = ['fox', 'stone', 'bird', 'brute'];

    for (let i = 0; i < count; i++) {
      const id = pool[Math.floor(Math.random() * pool.length)];
      const def = getCreatureById(id);
      if (!def) continue;

      const c = new Creature(def, 'enemy');
      this.creatures.push(c);
      this.burst(c.x, c.y - 18, '#ff6b6b', 12);
    }
  }

  /* ---------------- 每帧推进 ---------------- */

  update(dt) {
    this._updateParticles(dt);
    this.playerTower.update(dt);
    this.enemyTower.update(dt);

    if (this.state !== 'playing') return;

    this.time += dt;

    // 法力回复
    if (this.manaPause > 0) {
      this.manaPause -= dt;
    } else {
      this.mana = Math.min(ECONOMY.manaMax, this.mana + ECONOMY.manaRegen * dt);
    }

    // 敌方波次
    if (this.time >= this.nextWave) {
      this.spawnEnemy();
      this.nextWave += COMBAT.enemyInterval;
    }

    // 生物行为
    for (const c of this.creatures) {
      if (!c.alive) continue;
      c.update(dt);
      this._updateCreature(c, dt);
    }

    // 清理死亡单位
    this.creatures = this.creatures.filter((c) => c.alive);

    // 胜负
    if (this.enemyTower.hp <= 0) this.state = 'win';
    else if (this.playerTower.hp <= 0) this.state = 'lose';
  }

  /** 单个生物的决策：打谁 / 往哪走 */
  _updateCreature(c, dt) {
    const enemySide = c.isPlayer ? 'enemy' : 'player';
    const dir = c.isPlayer ? 1 : -1;

    // 1. 找最近的敌方生物
    let nearest = null;
    let nearestDist = Infinity;
    for (const o of this.creatures) {
      if (!o.alive || o.side !== enemySide) continue;
      const d = Math.abs(o.x - c.x);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = o;
      }
    }

    // 2. 够得着就打
    if (nearest && nearestDist <= COMBAT.attackRange) {
      this._attackCreature(c, nearest, dt);
      return;
    }

    // 3. 前方有敌人 → 朝它靠近，但停在攻击距离外沿
    //    （注意：不能「到了某个距离就完全站住」，否则双方会卡在
    //      中间谁也打不到谁，形成死锁）
    const ahead = nearest && (c.isPlayer ? nearest.x > c.x : nearest.x < c.x);
    if (ahead) {
      const nextX = c.x + dir * c.def.speed * dt;
      if (Math.abs(nearest.x - nextX) > COMBAT.attackRange * 0.85) {
        c.x = nextX;
      }
      return;
    }

    // 4. 前方没敌人 → 推进敌方塔
    const stopAt = c.isPlayer
      ? WORLD.enemyTowerX - COMBAT.towerRange
      : WORLD.playerTowerX + COMBAT.towerRange;

    const reached = c.isPlayer ? c.x >= stopAt : c.x <= stopAt;
    if (reached) {
      this._attackTower(c, dt);
      return;
    }

    c.x += dir * c.def.speed * dt;
    c.x = c.isPlayer ? Math.min(c.x, stopAt) : Math.max(c.x, stopAt);

    // 同阵营轻微分离，避免完全重叠
    for (const o of this.creatures) {
      if (o === c || !o.alive || o.side !== c.side) continue;
      const d = c.x - o.x;
      if (Math.abs(d) < 18 && Math.abs(d) > 0.01) {
        c.x += Math.sign(d) * 10 * dt;
      }
    }
  }

  _attackCreature(attacker, target, dt) {
    target.takeDamage(attacker.def.dps * dt);
    attacker.attackPulse = 0.15;

    if (!target.alive) {
      this.burst(target.x, target.y - 16, target.def.color, 18);
      if (target.side === 'enemy') this.kills++;
    }
  }

  _attackTower(c, dt) {
    const tower = c.isPlayer ? this.enemyTower : this.playerTower;
    tower.takeDamage(c.def.dps * dt);
    c.attackPulse = 0.15;
  }

  /* ---------------- 粒子特效 ---------------- */

  burst(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 130;
      const life = 0.45 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life,
        maxLife: life,
        color,
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }

  _updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 320 * dt; // 重力
      p.vx *= 0.98;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
