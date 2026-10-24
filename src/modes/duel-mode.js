/**
 * 1v1 决斗模式适配器
 * ==================================================================
 * 把队友 C 交付的 BattleSystem（battle-system.js）包装成统一模式接口。
 *
 * 【和塔防的关键差别】
 *   塔防：手势 = 召唤生物，胜负看谁的塔先倒。
 *   决斗：手势 = 出招，胜负看谁的血先空。
 *
 * 【手势怎么映射】
 *   决斗引擎只有两个动作（普攻 / 技能），所以 4 个手势按「线条类 / 图形类」二分：
 *     横线、折线  → 普攻（笔画快，对应快攻）
 *     V 形、圆    → 技能（图形完整，对应蓄力重击）
 *   这个映射写死在 ACTION_BY_GESTURE 里，想改只改这一处。
 *
 * 【动画状态放这里，不放渲染器】
 *   冲刺、受击闪白、伤害跳字都是「由战斗事件驱动的时间轴」，
 *   属于模式层的表现状态。渲染器只负责按当前值画，保持无状态。
 */

import { createBattleSystem } from '../battle/battle-system.js';
import { CREATURES } from '../summon/creature-data.js';
import { DUEL, DUEL_RULES, DUEL_STATS, GESTURE_GLYPH } from '../config.js';

/**
 * 决斗用的生物表：在 B 的原始数据上叠加决斗专用修正。
 * 只覆盖 DUEL_STATS 里列出的字段，其余（名字、图标、颜色、速度）沿用原表，
 * 这样 B 以后新增生物，决斗模式会自动多出一只，不需要改这里。
 */
function buildDuelRoster() {
  return CREATURES.map((def) => ({
    ...def,
    ...(DUEL_STATS[def.id] ?? {}),
  }));
}

/** 手势 → 动作。想改映射只改这里。 */
const ACTION_BY_GESTURE = {
  line_h: 'attack',
  zigzag: 'attack',
  v_shape: 'skill',
  circle: 'skill',
};

/** 动作 → 中文名，给提示气泡用 */
const ACTION_LABEL = {
  attack: '普攻',
  skill: '技能',
};

export class DuelMode {
  constructor() {
    this.id = 'duel';
    this.name = '1v1 决斗';
    this.tagline = '选一只生物，画手势出招，打空对面血量';

    // 决斗专用生物表。注意必须同时传 getMonster：
    // battle-system 在没有 getMonster 时会优先用上游的 getCreatureById，
    // 那样查到的还是原始数值，DUEL_STATS 会被静默忽略（踩过这个坑）。
    const roster = buildDuelRoster();

    this.system = createBattleSystem({
      monsters: roster,
      getMonster: (id) => roster.find((def) => def && def.id === id) ?? null,
      // 节奏覆盖：玩家要画手势才能出招，敌人不能按塔防的节奏打（原因见 config.js）
      rules: DUEL_RULES,
      onEvent: (event) => this._onEvent(event),
    });

    // 可选的生物（战斗单位的只读快照）
    this.roster = this.system.listRoster();

    this._phase = 'select';   // select | playing | win | lose
    this._selectedId = null;

    // 表现状态
    this._lunge = { player: 0, enemy: 0 };
    this._hit = { player: 0, enemy: 0 };
    this._effects = [];
  }

  /* ---------------- 生命周期 ---------------- */

  /** 回到选怪界面 */
  restart() {
    this.system.resetBattle();
    this._phase = 'select';
    this._selectedId = null;
    this._resetVisual();
    return { ok: true, message: '选一只生物开始决斗' };
  }

  /**
   * 选定生物，开始决斗。
   * @param {string} monsterId
   */
  selectMonster(monsterId) {
    const res = this.system.startBattle(monsterId);
    if (!res.ok) return res;

    this._selectedId = monsterId;
    this._phase = 'playing';
    this._resetVisual();
    return res;
  }

  update(dt) {
    if (this._phase === 'playing') {
      this.system.update(dt);

      // 引擎内部已经改完 phase，这里同步一次
      if (this.system.isOver) {
        this._phase = this.system.result;
      }
    }

    this._tickVisual(dt);
  }

  /**
   * 处理手势：翻译成出招指令
   * @param {{id:string, score:number} | null} result
   * @returns {{ok:boolean, message:string}}
   */
  handleGesture(result) {
    if (this._phase === 'select') {
      return { ok: false, message: '先选一只生物' };
    }
    if (this._phase !== 'playing') {
      return { ok: false, message: '本局已结束' };
    }
    if (!result) {
      return { ok: false, message: '没认出来，再画一次' };
    }

    const action = ACTION_BY_GESTURE[result.id];
    if (!action) {
      return { ok: false, message: '这个手势在决斗模式用不上' };
    }

    const res = action === 'skill' ? this.system.playerSkill() : this.system.playerAttack();

    if (!res.ok) {
      if (res.reason === 'cooldown') {
        const wait = (res.remaining ?? 0).toFixed(1);
        return { ok: false, message: `${ACTION_LABEL[action]}冷却中（${wait}s）` };
      }
      if (res.reason === 'battle-over') {
        return { ok: false, message: '本局已结束' };
      }
      return { ok: false, message: '现在出不了招' };
    }

    return { ok: true, message: `${ACTION_LABEL[action]} ${res.damage}` };
  }

  /* ---------------- 图例 / 资源条 ---------------- */

  getLegend() {
    // 只列出真正有用的手势，避免玩家画了没反应
    return [
      { glyph: GESTURE_GLYPH.line_h, label: '普攻', cost: null, color: '#9dc4ff' },
      { glyph: GESTURE_GLYPH.zigzag, label: '普攻', cost: null, color: '#9dc4ff' },
      { glyph: GESTURE_GLYPH.v_shape, label: '技能', cost: null, color: '#ffd93d' },
      { glyph: GESTURE_GLYPH.circle, label: '技能', cost: null, color: '#ffd93d' },
    ];
  }

  /* ---------------- 视图模型 ---------------- */

  getView() {
    const s = this.system.getBattleState();

    const player = s.player ? this._fighter(s.player, DUEL.playerX, 'player') : null;
    const enemy = s.enemy ? this._fighter(s.enemy, DUEL.enemyX, 'enemy') : null;

    const skillRatio = player && !player.skillReady
      ? 1 - Math.min(1, s.player.skillCooldown / this.system.rules.playerSkillCooldown)
      : 1;

    return {
      mode: 'duel',
      phase: this._phase,
      result: this._phase === 'playing' || this._phase === 'select' ? null : this._phase,
      time: s.time,

      hud: {
        left: player ? {
          label: player.name,
          hp: player.hp,
          maxHp: player.maxHp,
          ratio: player.ratio,
          color: '#4ade80',
        } : { label: '我方', hp: 0, maxHp: 1, ratio: 0, color: '#4ade80' },

        right: enemy ? {
          label: enemy.name,
          hp: enemy.hp,
          maxHp: enemy.maxHp,
          ratio: enemy.ratio,
          color: '#f87171',
        } : { label: '对手', hp: 0, maxHp: 1, ratio: 0, color: '#f87171' },

        resource: {
          label: '技能',
          value: player?.skillReady ? '就绪' : '蓄力中',
          max: '',
          ratio: skillRatio,
          // 就绪时条是满的，用金色区分于法力
          ready: Boolean(player?.skillReady),
        },
      },

      legend: this.getLegend(),

      world: {
        player,
        enemy,
        lunge: { ...this._lunge },
        hit: { ...this._hit },
        effects: this._effects,
        enemyNextAttackIn: s.enemy?.nextAttackIn ?? null,
        enemyHeavyNext: Boolean(s.enemy?.heavyNext),
        skillReady: Boolean(player?.skillReady),
        round: s.round,
      },

      stats: {
        time: s.time,
        detail: `用时 ${s.time.toFixed(1)} 秒 · 出手 ${s.round} 次 · 造成 ${s.stats.damageDealt} 伤害`,
      },
    };
  }

  /** 把战斗单位整理成渲染器要的形状 */
  _fighter(unit, x, side) {
    return {
      name: unit.name,
      glyph: unit.glyph,
      color: unit.color,
      hp: unit.hp,
      maxHp: unit.maxHp,
      ratio: unit.hpRatio,
      x,
      side,
      skillReady: unit.skillReady,
      size: DUEL.baseSize,
    };
  }

  /* ---------------- 表现状态 ---------------- */

  _resetVisual() {
    this._lunge.player = 0;
    this._lunge.enemy = 0;
    this._hit.player = 0;
    this._hit.enemy = 0;
    this._effects = [];
  }

  _tickVisual(dt) {
    for (const side of ['player', 'enemy']) {
      this._lunge[side] = Math.max(0, this._lunge[side] - dt);
      this._hit[side] = Math.max(0, this._hit[side] - dt);
    }

    for (const fx of this._effects) {
      fx.life -= dt;
      fx.y -= fx.rise * dt;
    }
    if (this._effects.length) {
      this._effects = this._effects.filter((fx) => fx.life > 0);
    }
  }

  /** 战斗事件 → 动画与跳字 */
  _onEvent(event) {
    switch (event.type) {
      case 'player-attack':
        this._lunge.player = DUEL.lungeTime;
        this._hit.enemy = 0.18;
        this._pushDamage(event.damage, DUEL.enemyX, '#ffe08a', false);
        break;

      case 'player-skill':
        this._lunge.player = DUEL.lungeTime * 1.35;
        this._hit.enemy = 0.24;
        this._pushDamage(event.damage, DUEL.enemyX, '#ffd93d', true);
        break;

      case 'enemy-attack':
        this._lunge.enemy = DUEL.lungeTime;
        this._hit.player = event.heavy ? 0.24 : 0.18;
        this._pushDamage(event.damage, DUEL.playerX, event.heavy ? '#ff9b6b' : '#ff8a8a', event.heavy);
        break;

      default:
        break;
    }
  }

  _pushDamage(value, x, color, big) {
    this._effects.push({
      kind: 'damage',
      value,
      x: x + (Math.random() - 0.5) * 40,
      y: DUEL.fighterY - DUEL.baseSize * 0.9,
      life: 0.85,
      maxLife: 0.85,
      rise: 62,
      color,
      big,
    });
  }
}
