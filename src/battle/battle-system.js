/**
 * 战斗系统（1v1 决斗制）
 * ==================================================================
 * 归属：CONTRIBUTING.md 分工表的「C 战斗」= src/battle/
 *
 * 【这一层管什么】
 *   血量、攻击、技能、伤害结算、敌人定时攻击、胜负判定。
 *
 * 【这一层不管什么】
 *   不碰 DOM、不碰 canvas、不认识手势和摄像头、不 import ui/。
 *   攻击指令由主程序（main.js）从手势结果转发进来，本模块只管收到之后怎么算。
 *
 * 【为什么不直接改 battle.js】
 *   现有 battle.js 是「塔防推线」玩法，被 ui/renderer.js 和 ui/hud.js 依赖
 *   （读 battle.playerTower / enemyTower / creatures / particles / mana）。
 *   原地改写会连带弄坏 D 界面和 E 的 main.js —— 所以这里新增一个独立模块，
 *   两者并存、互不影响，等 E 决定什么时候把 main.js 切过来。
 *   接入方式见同目录 README.md。
 *
 * 【稳定性优先】
 *   全部结算都是确定性的：没有随机数、没有物理、没有浮点累积状态。
 *   同样的调用序列一定得到同样的结果 —— 比赛现场不会出现"这次怎么和彩排不一样"。
 */

/* ----------------------------------------------------------------
 * 上游怪物表（B 的 src/summon/creature-data.js）
 *
 * 这里用动态 import + 兜底，而不是像 battle.js 那样静态 import：
 * 静态 import 一旦上游文件缺失或改名，整个战斗模块会在**加载期**直接挂掉，
 * 连 startBattle 都调不到。现在是"最坏情况只是没有默认怪物表"，
 * 只要注入 options.monsters 依然能正常跑完一整场战斗。
 *
 * 真机上 B 的文件存在，走的就是他的数据，不需要任何额外接线。
 * ---------------------------------------------------------------- */
let upstreamMonsters = [];
let upstreamLookup = null;

try {
  const upstream = await import('../summon/creature-data.js');
  if (Array.isArray(upstream.CREATURES)) upstreamMonsters = upstream.CREATURES;
  if (typeof upstream.getCreatureById === 'function') upstreamLookup = upstream.getCreatureById;
} catch (error) {
  // 独立跑单测、或 B 的文件还没合并进来时会出现。不影响注入式用法。
  console.warn(
    '[battle] 没找到 ../summon/creature-data.js，请用 options.monsters 注入怪物表：',
    error?.message ?? error,
  );
}

/* ================================================================
 * 数值旋钮
 * 全部集中在这里，调平衡不用翻逻辑。
 * （CONTRIBUTING.md 要求魔法数字不要散落在逻辑里；config.js 属 E 的文件，
 *   所以本模块自带一份 RULES，并在 README 里说明如何覆盖。）
 * ================================================================ */
export const RULES = {
  /** 玩家普通攻击的基准冷却（秒），会再按速度缩放 */
  playerAttackCooldown: 0.55,
  /** 玩家技能的冷却（秒），不吃速度缩放 —— 技能是"时机"，不是"频率" */
  playerSkillCooldown: 4.0,
  /**
   * 开局时技能自带的初始冷却（秒）。
   * 0 会让高攻单位在第一帧就用 1.8 倍技能直接秒掉脆皮，
   * 战斗 0 秒结束、对手一次都没出手 —— 体验上是致命的。
   * 但也不能太长：一局决斗通常 2~4 秒，预热超过这个数技能就永远用不上。
   */
  playerSkillInitialCooldown: 1.0,
  /** 技能伤害倍率 */
  playerSkillMultiplier: 1.8,

  /** 敌人两次攻击之间的基准间隔（秒），同样按速度缩放。
   *  刻意比玩家普攻的 0.55s 慢一倍：玩家有先手和操作优势，但不至于碾压 ——
   *  这样"选哪只怪"和"打不打技能"才真的会影响胜负。 */
  enemyAttackInterval: 1.1,
  /**
   * 开场宽限：敌人第一次出手前留出的时间。
   * 太长会让高速高攻单位在对手还手前就把人打死（实测 1.8s 时半数对局敌人零出手），
   * 只要够玩家看清局面、按出第一下就够。
   */
  enemyFirstAttackDelay: 0.9,
  /** 敌人每打几次来一次重击 */
  enemyHeavyEvery: 3,
  /** 重击倍率 */
  enemyHeavyMultiplier: 1.5,

  /** 伤害保底，避免高防目标变成"打不动"导致战斗卡死 */
  damageFloor: 1,
  /** 减伤公式的柔化系数：防御 = 该值时伤害减半 */
  defenseSoftCap: 100,
  /**
   * 没有 defense 字段时的基础防御。
   * 现有怪物表只有 hp/dps/speed，默认 0 = 伤害全额生效（保持原行为）。
   * 想放慢整体节奏、让战斗更有操作空间时，调到 30~50 即可，
   * 伤害会按 100/(100+防御) 等比下降。
   */
  baseDefense: 0,

  /** 速度换算基准值：speed = 60 时倍率为 1.0 */
  speedBaseline: 60,
  /** 速度倍率的上下限，防止极端数值把节奏拉爆 */
  speedFactorMin: 0.6,
  speedFactorMax: 1.6,

  /** 单帧推进上限（秒），防止切标签页回来后一次跳掉整场战斗 */
  maxDelta: 0.1,
  /** 事件日志保留条数 */
  logLimit: 20,

  /* ---------------- 距离 / 射程（可选玩法） ----------------
   * 距离 distance ∈ [0, 1]：0 = 贴身，1 = 最远。
   * 默认全部射程 = 1，也就是「任何距离都能打到」—— 不传距离时行为与原来完全一致，
   * 现有单测不受影响。决斗模式会覆盖成下面的值来玩走位。
   */
  /** 玩家普攻的最大命中距离 */
  playerReach: 1,
  /** 玩家技能的最大命中距离（技能是远程手段，所以默认比普攻宽） */
  playerSkillReach: 1,
  /** 敌人普通攻击的最大命中距离 */
  enemyReach: 1,
  /** 敌人重击的最大命中距离。调小 = 拉开距离可以躲掉重击 */
  enemyHeavyReach: 1,
};

/* ================================================================
 * 纯函数：数值换算
 * 导出是为了让单测能直接验算，也让 UI 能自己算预览值。
 * ================================================================ */

/**
 * 从怪物数据里按候选字段顺序取第一个有效数字。
 * 兼容 B 现有的 hp/dps/speed，也兼容任务书里的 attack/defense，
 * 谁先出现用谁 —— 这样 B 之后补字段不需要改我这边的代码。
 */
export function pickNumber(source, keys, fallback) {
  if (source) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  }
  return fallback;
}

/**
 * 伤害公式：攻击 × (柔化系数 / (柔化系数 + 防御))
 *   defense = 0    → 100% 伤害
 *   defense = 100  → 50% 伤害
 *   defense = 300  → 25% 伤害
 * 单调递减、永远不会变成 0，且一定有保底伤害。
 */
export function computeDamage(attack, defense, rules = RULES) {
  const atk = Number.isFinite(attack) ? Math.max(0, attack) : 0;
  const def = Number.isFinite(defense) ? Math.max(0, defense) : 0;
  const mitigated = atk * (rules.defenseSoftCap / (rules.defenseSoftCap + def));
  return Math.max(rules.damageFloor, Math.round(mitigated));
}

/**
 * 速度 → 出手间隔。
 *   速度越高，间隔越短（暗影系高速怪的价值就体现在这里）。
 *   结果被夹在 [speedFactorMin, speedFactorMax] 倍之间，保证节奏可控。
 */
export function attackIntervalFor(speed, baseInterval, rules = RULES) {
  const value = Number.isFinite(speed) && speed > 0 ? speed : rules.speedBaseline;
  const factor = Math.min(
    rules.speedFactorMax,
    Math.max(rules.speedFactorMin, rules.speedBaseline / value),
  );
  return baseInterval * factor;
}

/**
 * 把 B 的怪物数据整形成战斗单位。
 * 只读，不修改传入对象。
 */
export function toCombatant(def, fallbackName = '未知生物', rules = RULES) {
  const maxHp = Math.max(1, Math.round(pickNumber(def, ['hp', 'maxHp', 'health'], 100)));
  return {
    id: String(def?.id ?? 'unknown'),
    name: String(def?.name ?? fallbackName),
    type: def?.type ?? null,
    color: typeof def?.color === 'string' ? def.color : '#8ab4ff',
    glyph: typeof def?.glyph === 'string' ? def.glyph : '❔',
    size: pickNumber(def, ['size'], 34),

    maxHp,
    hp: maxHp,

    // 现有 creature-data 只有 dps，先当攻击力用；
    // 任务书要求的 attack 一旦补齐，会自动优先取 attack。
    attack: Math.max(0, pickNumber(def, ['attack', 'atk', 'dps', 'damage'], 10)),
    // 没有 defense 字段时用 baseDefense 兜底：
    // 防御为 0 会让伤害全额生效，战斗 2 秒内结束、没有操作空间。
    defense: Math.max(0, pickNumber(def, ['defense', 'def', 'armor'], rules.baseDefense)),
    speed: Math.max(1, pickNumber(def, ['speed'], rules.speedBaseline)),
  };
}

/* ================================================================
 * 战斗系统
 * ================================================================ */

export class BattleSystem {
  /**
   * @param {object} [options]
   * @param {Array}    [options.monsters]  怪物表，默认用 B 的 CREATURES
   * @param {Function} [options.getMonster] 按 id 取怪物，默认用 B 的 getCreatureById
   * @param {object}   [options.rules]     覆盖 RULES 里的部分旋钮
   * @param {Function} [options.onEvent]   (event) => void，每次结算后回调（纯数据）
   * @param {Function} [options.onEnd]     (result, state) => void，只在胜负产生时回调一次
   */
  constructor(options = {}) {
    this.rules = { ...RULES, ...(options.rules ?? {}) };
    this._monsters = Array.isArray(options.monsters) ? options.monsters : upstreamMonsters;
    this._getMonster = typeof options.getMonster === 'function'
      ? options.getMonster
      : (upstreamLookup ?? ((id) => this._monsters.find((def) => def && def.id === id) ?? null));
    this._onEvent = options.onEvent ?? null;
    this._onEnd = options.onEnd ?? null;

    this._player = null;
    this._enemy = null;
    this._phase = 'idle'; // idle | playing | win | lose
    this._result = null;  // null | 'win' | 'lose'
    this._time = 0;
    this._round = 0;
    this._playerCooldown = 0;
    this._skillCooldown = 0;
    this._enemyTimer = 0;
    this._enemyAttackCount = 0;
    this._distance = 0;   // 0 = 贴身，1 = 最远
    this._log = [];
    this._lastEvent = null;
    this._stats = this._emptyStats();
  }

  _emptyStats() {
    return { playerAttacks: 0, playerSkills: 0, enemyAttacks: 0, damageDealt: 0, damageTaken: 0 };
  }

  /**
   * 换掉怪物表 / 数值旋钮，并顺带重置战斗。
   * 正常接入**不需要**调用 —— 真机上 B 的 CREATURES 会自动被读取。
   * 只有"没有上游数据来源"时（独立单测、单独演示）才用它手动喂一份。
   */
  configure(options = {}) {
    if (Array.isArray(options.monsters)) this._monsters = options.monsters;
    if (typeof options.getMonster === 'function') this._getMonster = options.getMonster;
    if (options.rules) this.rules = { ...this.rules, ...options.rules };
    if (options.onEvent !== undefined) this._onEvent = options.onEvent;
    if (options.onEnd !== undefined) this._onEnd = options.onEnd;
    return this.resetBattle();
  }

  /* ---------------- 只读查询 ---------------- */

  get phase() { return this._phase; }
  get result() { return this._result; }
  get isPlaying() { return this._phase === 'playing'; }
  get isOver() { return this._phase === 'win' || this._phase === 'lose'; }

  /** 当前距离 0~1（0 = 贴身） */
  get distance() { return this._distance; }

  /**
   * 走位：调整距离。
   * @param {number} delta 正数 = 拉开，负数 = 靠近
   * @returns {{ok:boolean, distance:number, reason?:string}}
   */
  moveBy(delta) {
    if (this._phase !== 'playing') {
      return { ok: false, reason: this._phase === 'idle' ? 'not-started' : 'battle-over', distance: this._distance };
    }
    if (!Number.isFinite(delta) || delta === 0) {
      return { ok: false, reason: 'invalid-delta', distance: this._distance };
    }

    const before = this._distance;
    this._distance = Math.min(1, Math.max(0, this._distance + delta));

    return { ok: this._distance !== before, reason: this._distance === before ? 'edge' : undefined, distance: this._distance };
  }

  /** 直接设置距离（0~1），主要给测试和外部定位用 */
  setDistance(value) {
    const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    this._distance = v;
    return { ok: true, distance: v };
  }

  /** 当前距离下，玩家普攻够不够得着 */
  canPlayerReach() {
    return this._distance <= this.rules.playerReach;
  }

  /** 可用怪物列表（给选择界面用，只读拷出） */
  listRoster() {
    return this._monsters.map((def) => toCombatant(def));
  }

  /**
   * 战斗状态快照 —— 每次调用都返回**全新对象**。
   * UI 拿到之后随便怎么改都不会影响战斗内部状态（分层要求：ui/ 只读数据）。
   */
  getBattleState() {
    const p = this._player;
    const e = this._enemy;

    return {
      phase: this._phase,
      result: this._result,          // 胜负结果：null | 'win' | 'lose'
      over: this.isOver,
      time: Number(this._time.toFixed(3)),
      round: this._round,

      // 走位状态：0 = 贴身，1 = 最远
      distance: Number(this._distance.toFixed(3)),
      inPlayerRange: this.canPlayerReach(),

      player: p ? {
        id: p.id, name: p.name, type: p.type, color: p.color, glyph: p.glyph,
        hp: p.hp, maxHp: p.maxHp, hpRatio: p.hp / p.maxHp,
        attack: p.attack, defense: p.defense, speed: p.speed,
        cooldown: Number(this._playerCooldown.toFixed(3)),
        skillCooldown: Number(this._skillCooldown.toFixed(3)),
        skillReady: this._skillCooldown <= 0,
        attackInterval: Number(attackIntervalFor(p.speed, this.rules.playerAttackCooldown, this.rules).toFixed(3)),
      } : null,

      enemy: e ? {
        id: e.id, name: e.name, type: e.type, color: e.color, glyph: e.glyph,
        hp: e.hp, maxHp: e.maxHp, hpRatio: e.hp / e.maxHp,
        attack: e.attack, defense: e.defense, speed: e.speed,
        nextAttackIn: Number(Math.max(0, this._enemyTimer).toFixed(3)),
        heavyNext: this._isHeavyNext(),
        attackInterval: Number(attackIntervalFor(e.speed, this.rules.enemyAttackInterval, this.rules).toFixed(3)),
      } : null,

      stats: { ...this._stats },
      lastEvent: this._lastEvent ? { ...this._lastEvent } : null,
      log: this._log.map((entry) => ({ ...entry })),
    };
  }

  /* ---------------- 控制接口 ---------------- */

  /**
   * 开始战斗。
   * @param {string} monsterId 玩家选中的怪物 id（来自选择系统）
   * @param {{ enemyId?: string }} [options] 不传则自动挑一只不同的当对手
   * @returns {{ok:boolean, reason?:string, state?:object}}
   */
  startBattle(monsterId, options = {}) {
    const playerDef = this._lookup(monsterId);
    if (!playerDef) {
      return this._fail('unknown-monster', `怪物库里没有 id 为「${monsterId}」的怪物`);
    }

    let enemyDef = null;
    if (options.enemyId) {
      enemyDef = this._lookup(options.enemyId);
      if (!enemyDef) {
        return this._fail('unknown-monster', `怪物库里没有 id 为「${options.enemyId}」的怪物`);
      }
    } else {
      enemyDef = this._pickOpponent(monsterId);
    }

    this._player = toCombatant(playerDef, '未知生物', this.rules);
    this._enemy = toCombatant(enemyDef, '未知生物', this.rules);
    this._phase = 'playing';
    this._result = null;
    this._time = 0;
    this._round = 0;
    this._playerCooldown = 0;
    // 开局技能需要预热，否则高攻单位第一帧就能用 1.8 倍技能秒掉脆皮
    this._skillCooldown = this.rules.playerSkillInitialCooldown;
    this._enemyTimer = this.rules.enemyFirstAttackDelay;
    this._enemyAttackCount = 0;
    this._distance = 0;
    this._log = [];
    this._stats = this._emptyStats();

    this._emit({
      type: 'start',
      playerId: this._player.id,
      playerName: this._player.name,
      enemyId: this._enemy.id,
      enemyName: this._enemy.name,
    });

    return { ok: true, state: this.getBattleState() };
  }

  /**
   * 玩家普通攻击。由主程序把「手势攻击指令」转发到这里。
   * @returns {{ok:boolean, reason?:string, damage?:number, enemyHp?:number, killed?:boolean, state?:object}}
   */
  playerAttack() {
    const guard = this._guard();
    if (guard) return guard;

    if (this._playerCooldown > 0) {
      return {
        ok: false,
        reason: 'cooldown',
        remaining: Number(this._playerCooldown.toFixed(3)),
        state: this.getBattleState(),
      };
    }

    // 走位：太远就打不到（射程默认 1，也就是永远够得着）
    if (this._distance > this.rules.playerReach) {
      return {
        ok: false,
        reason: 'out-of-range',
        distance: Number(this._distance.toFixed(3)),
        state: this.getBattleState(),
      };
    }

    const interval = attackIntervalFor(this._player.speed, this.rules.playerAttackCooldown, this.rules);
    this._playerCooldown = interval;
    this._round += 1;
    this._stats.playerAttacks += 1;

    const damage = computeDamage(this._player.attack, this._enemy.defense, this.rules);
    const killed = this._damageEnemy(damage);

    this._emit({
      type: 'player-attack',
      damage,
      enemyHp: this._enemy.hp,
      enemyMaxHp: this._enemy.maxHp,
      killed,
    });

    if (killed) this._finish('win');

    return {
      ok: true,
      damage,
      enemyHp: this._enemy.hp,
      enemyMaxHp: this._enemy.maxHp,
      killed,
      state: this.getBattleState(),
    };
  }

  /**
   * 玩家技能：一次倍率重击，冷却更长。
   * 也是确定性的，没有随机暴击。
   */
  playerSkill() {
    const guard = this._guard();
    if (guard) return guard;

    if (this._skillCooldown > 0) {
      return {
        ok: false,
        reason: 'cooldown',
        remaining: Number(this._skillCooldown.toFixed(3)),
        state: this.getBattleState(),
      };
    }

    // 技能是远程手段，射程比普攻宽
    if (this._distance > this.rules.playerSkillReach) {
      return {
        ok: false,
        reason: 'out-of-range',
        distance: Number(this._distance.toFixed(3)),
        state: this.getBattleState(),
      };
    }

    this._skillCooldown = this.rules.playerSkillCooldown;
    this._round += 1;
    this._stats.playerSkills += 1;

    const damage = computeDamage(
      this._player.attack * this.rules.playerSkillMultiplier,
      this._enemy.defense,
      this.rules,
    );
    const killed = this._damageEnemy(damage);

    this._emit({
      type: 'player-skill',
      damage,
      enemyHp: this._enemy.hp,
      enemyMaxHp: this._enemy.maxHp,
      killed,
    });

    if (killed) this._finish('win');

    return {
      ok: true,
      damage,
      enemyHp: this._enemy.hp,
      enemyMaxHp: this._enemy.maxHp,
      killed,
      state: this.getBattleState(),
    };
  }

  /**
   * 推进时间：冷却回复 + 敌人定时攻击。
   * 主程序的主循环里每帧调一次即可（和现有 battle.update(dt) 同一个位置）。
   * @param {number} dt 秒
   * @returns {{ok:boolean, events:Array, state:object}}
   */
  update(dt) {
    if (this._phase !== 'playing') {
      return { ok: false, reason: this._phase === 'idle' ? 'not-started' : 'battle-over', events: [], state: this.getBattleState() };
    }

    const step = Number.isFinite(dt) && dt > 0
      ? Math.min(dt, this.rules.maxDelta)
      : 0;

    const events = [];
    this._time += step;
    this._playerCooldown = Math.max(0, this._playerCooldown - step);
    this._skillCooldown = Math.max(0, this._skillCooldown - step);
    this._enemyTimer -= step;

    // 敌人 AI：简单的定时出手；每 enemyHeavyEvery 次来一发重击。
    // 用 while 是为了在极小的 maxDelta 下依然能正确补齐节奏。
    let safety = 8;
    while (this._enemyTimer <= 0 && this._phase === 'playing' && safety-- > 0) {
      events.push(this._enemyTurn());
      if (this._phase === 'playing') {
        this._enemyTimer += attackIntervalFor(this._enemy.speed, this.rules.enemyAttackInterval, this.rules);
      }
    }

    return { ok: true, events, state: this.getBattleState() };
  }

  /** 重置回未开始状态，可以重新 startBattle */
  resetBattle() {
    this._player = null;
    this._enemy = null;
    this._phase = 'idle';
    this._result = null;
    this._time = 0;
    this._round = 0;
    this._playerCooldown = 0;
    this._skillCooldown = 0;
    this._enemyTimer = 0;
    this._enemyAttackCount = 0;
    this._distance = 0;
    this._log = [];
    this._stats = this._emptyStats();
    this._lastEvent = null;
    return { ok: true, state: this.getBattleState() };
  }

  /* ---------------- 内部 ---------------- */

  _lookup(id) {
    if (typeof id !== 'string' || !id) return null;
    const found = this._getMonster(id);
    if (found) return found;
    // 兜底：直接在数组里找，防止 B 改了 getCreatureById 的行为
    return this._monsters.find((def) => def && def.id === id) ?? null;
  }

  /** 默认对手：怪物表里下一只（确定性，彩排和现场结果一致） */
  _pickOpponent(playerId) {
    if (this._monsters.length <= 1) return this._monsters[0];
    const index = this._monsters.findIndex((def) => def && def.id === playerId);
    const next = (index + 1 + this._monsters.length) % this._monsters.length;
    return this._monsters[next];
  }

  /** 未开始 / 已结束的统一拦截 */
  _guard() {
    if (this._phase === 'idle') {
      return this._fail('not-started', '还没开始战斗，请先调用 startBattle(monsterId)');
    }
    if (this.isOver) {
      return { ok: false, reason: 'battle-over', result: this._result, state: this.getBattleState() };
    }
    return null;
  }

  _fail(reason, message) {
    this._emit({ type: 'invalid', reason, message });
    return { ok: false, reason, message, state: this.getBattleState() };
  }

  _isHeavyNext() {
    return (this._enemyAttackCount + 1) % this.rules.enemyHeavyEvery === 0;
  }

  /** 扣敌方血，返回是否击杀 */
  _damageEnemy(damage) {
    this._enemy.hp = Math.max(0, this._enemy.hp - damage);
    this._stats.damageDealt += damage;
    return this._enemy.hp <= 0;
  }

  /** 敌人一次出手 */
  _enemyTurn() {
    this._enemyAttackCount += 1;
    this._stats.enemyAttacks += 1;

    const heavy = this._enemyAttackCount % this.rules.enemyHeavyEvery === 0;
    const multiplier = heavy ? this.rules.enemyHeavyMultiplier : 1;

    // 走位：拉开到重击射程之外就能躲掉重击（普攻射程默认更宽，躲不掉）
    const reach = heavy ? this.rules.enemyHeavyReach : this.rules.enemyReach;
    if (this._distance > reach) {
      const miss = {
        type: 'enemy-miss',
        heavy,
        distance: Number(this._distance.toFixed(3)),
        playerHp: this._player.hp,
        playerMaxHp: this._player.maxHp,
        killed: false,
      };
      this._emit(miss);
      return miss;
    }

    const damage = computeDamage(this._enemy.attack * multiplier, this._player.defense, this.rules);

    this._player.hp = Math.max(0, this._player.hp - damage);
    this._stats.damageTaken += damage;

    const killed = this._player.hp <= 0;
    const event = {
      type: 'enemy-attack',
      heavy,
      damage,
      playerHp: this._player.hp,
      playerMaxHp: this._player.maxHp,
      killed,
    };

    this._emit(event);
    if (killed) this._finish('lose');

    return event;
  }

  _finish(result) {
    if (this._phase !== 'playing') return;
    this._phase = result;
    this._result = result;

    const state = this.getBattleState();
    this._emit({ type: result, time: state.time, round: state.round });

    if (typeof this._onEnd === 'function') {
      try {
        this._onEnd(result, state);
      } catch (error) {
        console.error('[battle] onEnd 回调抛错：', error);
      }
    }
  }

  /** 记录并广播一个事件。回调抛错不影响战斗本身。 */
  _emit(event) {
    // t 一定要带上：UI 要靠它排特效、命令行演示要靠它还原时间轴，
    // 少了它外面看到的所有事件时间戳都会是 0。
    this._lastEvent = { t: Number(this._time.toFixed(3)), ...event };
    this._log.push({ ...this._lastEvent });
    if (this._log.length > this.rules.logLimit) this._log.shift();

    if (typeof this._onEvent === 'function') {
      try {
        this._onEvent(this._lastEvent);
      } catch (error) {
        console.error('[battle] onEvent 回调抛错：', error);
      }
    }
  }
}

/** 工厂函数，风格和 createMonsterSelector 保持一致 */
export function createBattleSystem(options) {
  return new BattleSystem(options);
}

/* ================================================================
 * 模块级默认实例
 * 任务书要求的 startBattle / playerAttack / getBattleState / resetBattle
 * 可以直接 import 来用，不必自己 new。
 * 如果同时要跑多场战斗（比如 AI 对战演示），请用 createBattleSystem() 各建一个。
 * ================================================================ */
const defaultSystem = new BattleSystem();

export const startBattle = (monsterId, options) => defaultSystem.startBattle(monsterId, options);
export const playerAttack = () => defaultSystem.playerAttack();
export const playerSkill = () => defaultSystem.playerSkill();
export const getBattleState = () => defaultSystem.getBattleState();
export const resetBattle = () => defaultSystem.resetBattle();
export const updateBattle = (dt) => defaultSystem.update(dt);

/**
 * 给模块级默认实例换怪物表。
 * 只给单测 / 孤立演示用；正式接入请用 createBattleSystem 或在构造函数里传 monsters。
 */
export const configureDefaultBattle = (options) => defaultSystem.configure(options);

export default BattleSystem;