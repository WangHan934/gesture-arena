/**
 * 1v1 决斗模式适配器
 * ==================================================================
 * 把队友 C 交付的 BattleSystem（battle-system.js）包装成统一模式接口。
 *
 * 【和塔防的关键差别】
 *   塔防：手势 = 召唤生物，胜负看谁的塔先倒。
 *   决斗：手势 = 走位 + 出招，胜负看谁的血先空。
 *
 * 【手势怎么映射】
 *   横线       → 走位（**笔画方向决定往哪走**：从左往右 = 靠近，从右往左 = 拉开）
 *   折线 Z     → 普攻
 *   V 形       → 技能
 *   圆         → 不用（决斗里没有对应动作，画了会提示用不上）
 *
 *   横线用方向而不是新增「左右箭头」图形，是因为：
 *     1. 不用学新手势，滑动本身就是最直觉的移动动作
 *     2. 识别器做过旋转对齐，正着画和反着画都会匹配到 line_h，
 *        方向信息要从原始点上取（见 gesture-recognizer.js）
 *
 * 【走位的意义】
 *   引擎里有 distance（0 贴身 / 1 最远），射程见 config.js 的 DUEL_RULES：
 *     贴身  → 能普攻，但会吃到重击
 *     拉开  → 躲得掉重击，但普攻打不到，只能等技能
 *   所以决斗的节奏是「贴上去打几下 → 看到重击预警就撤 → 再贴回去」。
 *
 * 【动画状态放这里，不放渲染器】
 *   冲刺、受击闪白、伤害跳字、平滑走位都是「由操作驱动的时间轴」，
 *   属于模式层的表现状态。渲染器只负责按当前值画，保持无状态。
 */

import { createBattleSystem } from '../battle/battle-system.js';
import { CREATURES } from '../summon/creature-data.js';
import { DUEL, DUEL_RULES, DUEL_STATS } from '../config.js';

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

/** 手势 → 动作。line_h 因为要看方向，在 handleGesture 里单独处理。 */
const ACTION_BY_GESTURE = {
  zigzag: 'attack',
  v_shape: 'skill',
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

    /**
     * 摄像头姿态 → 动作。
     * 模块只输出 5 种姿态，没有「左 / 右」方向，所以走位只能靠画板画横线。
     * 战斗中 1/2 指是空闲的（选怪已经结束），正好拿来当走位用。
     */
    this.cameraMap = {
      one: 'monster:0',      // 选怪阶段：第 1 只；战斗中：靠近
      two: 'monster:1',      // 选怪阶段：第 2 只；战斗中：拉开
      three: 'monster:2',    // 选怪阶段：第 3 只
      fist: 'attack',
      open_palm: 'skill',
    };

    /**
     * 键盘 → 动作。动作词表和 cameraMap 一致，走同一个 handleAction()。
     * 关键作用：摄像头只输出 1/2/3 根手指，选不到第 4 只生物；
     * 键盘 1~4 能选全，比赛现场用它兜底。
     */
    this.keyMap = {
      Digit1: 'monster:0',
      Digit2: 'monster:1',
      Digit3: 'monster:2',
      Digit4: 'monster:3',
      Numpad1: 'monster:0',
      Numpad2: 'monster:1',
      Numpad3: 'monster:2',
      Numpad4: 'monster:3',
      KeyZ: 'attack',
      KeyV: 'skill',
      ArrowLeft: 'away',
      ArrowRight: 'toward',
    };

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
    // 走位的显示值：平滑追向 system.distance，避免一次瞬移
    this._visualDistance = 0;
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
   * 处理手势：翻译成走位或出招指令
   * @param {{id:string, score:number, dir?:'ltr'|'rtl'} | null} result
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

    // 横线 = 走位，方向由笔画决定（从左往右 = 靠近，从右往左 = 拉开）
    if (result.id === 'line_h') {
      return this._move(result.dir === 'rtl' ? 'away' : 'toward');
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
      if (res.reason === 'out-of-range') {
        return { ok: false, message: '太远了，画横线靠近' };
      }
      if (res.reason === 'battle-over') {
        return { ok: false, message: '本局已结束' };
      }
      return { ok: false, message: '现在出不了招' };
    }

    return { ok: true, message: `${ACTION_LABEL[action]} ${res.damage}` };
  }

  /**
   * 走位
   * @param {'toward'|'away'} direction toward = 靠近敌人，away = 拉开
   * @returns {{ok:boolean, message:string, moved?:boolean}}
   */
  _move(direction) {
    const step = this.system.rules.moveStep;
    const res = this.system.moveBy(direction === 'toward' ? -step : step);

    if (!res.ok) {
      if (res.reason === 'edge') {
        return { ok: false, message: direction === 'toward' ? '已经贴身了' : '已经退到最远' };
      }
      return { ok: false, message: '现在动不了' };
    }

    const percent = Math.round((1 - res.distance) * 100);
    return {
      ok: true,
      moved: true,
      message: direction === 'toward' ? `靠近（贴身度 ${percent}%）` : `拉开（贴身度 ${percent}%）`,
    };
  }

  /**
   * 处理一个摄像头动作（来自 cameraMap）
   * @param {string} action 形如 'monster:0' / 'attack' / 'skill'
   * @returns {{ok:boolean, message:string, started?:boolean}}
   */
  handleAction(action) {
    if (typeof action !== 'string') {
      return { ok: false, message: '这个手势在决斗模式用不上' };
    }

    // 显式的走位动作（键盘 ← →）
    if (action === 'toward' || action === 'away') {
      if (this._phase !== 'playing') {
        return { ok: false, message: this._phase === 'select' ? '先选一只生物' : '本局已结束' };
      }
      return this._move(action);
    }

    if (action.startsWith('monster:')) {
      const index = Number(action.slice('monster:'.length));

      // 选怪阶段：手指数量 / 数字键 = 选第几只
      if (this._phase === 'select') {
        const unit = this.roster[index];
        if (!unit) return { ok: false, message: '没有这只生物' };

        const res = this.selectMonster(unit.id);
        if (!res.ok) return { ok: false, message: res.message ?? '选不了这只生物' };

        return { ok: true, message: `选定 ${unit.name}，开打`, started: true };
      }

      // 战斗中：1 指 = 靠近，2 指 = 拉开。
      // 模块没有「左右」方向的姿态，所以用选怪阶段剩下的手指姿势兼职走位。
      if (this._phase === 'playing') {
        if (index === 0) return this._move('toward');
        if (index === 1) return this._move('away');
        return { ok: false, message: '这个手势在战斗中没用' };
      }

      return { ok: false, message: '本局已结束' };
    }

    // 战斗中：复用 handleGesture，冷却和射程逻辑只写一份
    if (action === 'attack' || action === 'skill') {
      if (this._phase === 'select') {
        return { ok: false, message: '先选一只生物' };
      }
      // 注意：普攻对应的是折线，横线现在是走位
      return this.handleGesture({ id: action === 'attack' ? 'zigzag' : 'v_shape', score: 0 });
    }

    return { ok: false, message: '这个手势在决斗模式用不上' };
  }

  /** @deprecated 用 handleAction()。保留别名是为了不破坏已有的摄像头调用。 */
  handleCameraAction(action) {
    return this.handleAction(action);
  }

  /**
   * 摄像头开启时控制条上显示的对照表。
   * 选怪阶段只列前 3 只 —— 模块只输出 1/2/3 根手指，第 4 只只能鼠标点，
   * 列出来会让玩家比划半天没反应。
   */
  getCameraHint() {
    if (this._phase === 'select') {
      return this.roster.slice(0, 3).map((unit, i) => ({
        glyph: ['☝', '✌', '🤟'][i],
        label: unit.name,
      }));
    }
    return [
      { glyph: '☝', label: '靠近' },
      { glyph: '✌', label: '拉开' },
      { glyph: '✊', label: '普攻' },
      { glyph: '🖐', label: '技能' },
    ];
  }

  /** 控制条上显示的键盘提示（按阶段变化） */
  getKeyHint() {
    if (this._phase === 'select') {
      return [{ keys: '1~4', label: '选生物' }];
    }
    return [
      { keys: 'Z', label: '普攻' },
      { keys: 'V', label: '技能' },
      { keys: '← →', label: '走位' },
    ];
  }

  /* ---------------- 图例 / 资源条 ---------------- */

  getLegend() {
    // 只列出真正有用的手势，避免玩家画了没反应
    return [
      { glyph: '→', label: '靠近', cost: null, color: '#7fb0ff' },
      { glyph: '←', label: '拉开', cost: null, color: '#7fb0ff' },
      { glyph: 'Z', label: '普攻', cost: null, color: '#ff8a3d' },
      { glyph: 'V', label: '技能', cost: null, color: '#ffd93d' },
    ];
  }

  /* ---------------- 视图模型 ---------------- */

  getView() {
    const s = this.system.getBattleState();

    const playerX = this._playerX();
    const player = s.player ? this._fighter(s.player, playerX, 'player') : null;
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

        // 走位状态：给渲染器画「够不够得着」的提示
        distance: s.distance,
        inPlayerRange: s.inPlayerRange,
        // 重击会不会打中（拉开就躲得掉）
        heavyWillHit: s.distance <= this.system.rules.enemyHeavyReach,
      },

      stats: {
        time: s.time,
        detail: `用时 ${s.time.toFixed(1)} 秒 · 出手 ${s.round} 次 · 造成 ${s.stats.damageDealt} 伤害`,
      },
    };
  }

  /**
   * 玩家当前的屏幕 x。
   * 用平滑过的 _visualDistance，所以走位是滑过去而不是瞬移。
   */
  _playerX() {
    const near = DUEL.playerNearX;
    const far = DUEL.playerFarX;
    return far + (1 - this._visualDistance) * (near - far);
  }

  /** 把战斗单位整理成渲染器要的形状 */
  _fighter(unit, x, side) {
    return {
      id: unit.id,
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
    this._visualDistance = 0;
  }

  _tickVisual(dt) {
    for (const side of ['player', 'enemy']) {
      this._lunge[side] = Math.max(0, this._lunge[side] - dt);
      this._hit[side] = Math.max(0, this._hit[side] - dt);
    }

    // 走位显示值追向真实距离，做出「滑过去」的感觉
    const target = this.system.distance;
    const k = Math.min(1, dt * 14);
    this._visualDistance += (target - this._visualDistance) * k;

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
        this._pushDamage(event.damage, this._playerX(), event.heavy ? '#ff9b6b' : '#ff8a8a', event.heavy);
        break;

      // 拉开躲掉了重击：飘一个「MISS」，让玩家知道自己躲成功了
      case 'enemy-miss':
        this._lunge.enemy = DUEL.lungeTime * 0.7;
        this._pushText('MISS', this._playerX(), '#8fd6ff', true);
        break;

      default:
        break;
    }
  }

  _pushDamage(value, x, color, big) {
    this._pushText(`-${value}`, x, color, big);
  }

  _pushText(text, x, color, big) {
    this._effects.push({
      kind: 'damage',
      text,
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
