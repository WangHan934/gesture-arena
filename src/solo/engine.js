/**
 * 人机对战引擎
 * ==================================================================
 * 纯函数 + 纯数据，不碰 DOM、不碰 3D、不碰网络。
 * 这样现场出问题时可以先怀疑渲染，而不是怀疑规则；
 * 也让平衡性可以直接用 node 跑模拟验证，不用开浏览器。
 *
 * 时间驱动：每次 tick(dt) 推进固定小步长，切标签页回来不会一次连打好几下。
 */

import { SPELLS } from '../pvp/rules.js';

export const PLAYER_HP = 150;
export const ENEMY_HP = 240;

/** 敌人两次出手之间的间隔（秒） */
export const ENEMY_INTERVAL = 2.6;

/**
 * 敌人的出手循环：轻击、轻击、蓄力重击。
 * 故意做成固定循环而不是随机 —— 现场演示时观众能看出节奏，
 * 玩家也能学会"重击前开盾"，这是可玩性的来源。
 */
export const ENEMY_PATTERN = [
  { damage: 6, windup: 0 },
  { damage: 6, windup: 0 },
  { damage: 22, windup: 1.2 },
];

/** 实时制下的技能数值（和回合制 PvP 是两套，互不影响） */
const STATS = {
  circle: { damage: 15, cooldown: 0.9 },
  line_v: { damage: 24, cooldown: 6 },
  two: { heal: 24, cooldown: 8 },
  triangle: { support: 12, cooldown: 7 },
  square: { shield: 3.5, cooldown: 6 },
  line_h: { damage: 40, cooldown: 14 },
};

/**
 * 名称与符号沿用 PvP，数值换成本模式的，玩家认知不用重新学。
 * hint 必须重新生成 —— 直接沿用会把 PvP 的 22 / 42 点写在按钮上，和实际伤害对不上。
 */
export const SOLO_SPELLS = SPELLS.map(spell => {
  const stats = STATS[spell.id];
  const hint = stats.damage ? `造成 ${stats.damage} 点伤害`
    : stats.heal ? `回复 ${stats.heal} 点生命`
    : stats.shield ? `${stats.shield} 秒内受伤减半`
    : `下一次伤害 +${stats.support}`;
  return { ...spell, ...stats, hint };
});

export const SPELL_BY_ID = Object.fromEntries(SOLO_SPELLS.map(s => [s.id, s]));

export function createBattle(playerMonster, enemyMonster) {
  return {
    playerMonster,
    enemyMonster,
    hp: { player: PLAYER_HP, enemy: ENEMY_HP },
    max: { player: PLAYER_HP, enemy: ENEMY_HP },
    shieldLeft: 0,
    support: 0,
    cooldowns: Object.fromEntries(SOLO_SPELLS.map(s => [s.id, 0])),
    enemy: { phase: 'idle', timer: ENEMY_INTERVAL, windup: 0, index: 0, pending: null, telegraph: 0 },
    time: 0,
    winner: null,
    log: [],
    events: [],
  };
}

function note(battle, message) {
  battle.log.push(message);
  battle.log = battle.log.slice(-40);
}

function strike(battle, damage) {
  const blocked = battle.shieldLeft > 0;
  const dealt = blocked ? Math.floor(damage / 2) : damage;
  battle.hp.player = Math.max(0, battle.hp.player - dealt);
  battle.events.push({ type: 'enemyHit', damage: dealt, blocked });
  note(battle, `敌方出手 ${dealt} 点${blocked ? '（护盾减半）' : ''}`);
  if (battle.hp.player <= 0) {
    battle.winner = 'lose';
    note(battle, '你被击倒了。');
  }
}

function step(battle, dt) {
  battle.time += dt;
  if (battle.shieldLeft > 0) battle.shieldLeft = Math.max(0, battle.shieldLeft - dt);
  for (const id in battle.cooldowns) {
    if (battle.cooldowns[id] > 0) battle.cooldowns[id] = Math.max(0, battle.cooldowns[id] - dt);
  }

  const enemy = battle.enemy;
  if (enemy.phase === 'idle') {
    enemy.timer -= dt;
    if (enemy.timer <= 0) {
      const move = ENEMY_PATTERN[enemy.index % ENEMY_PATTERN.length];
      enemy.index++;
      enemy.pending = move;
      if (move.windup > 0) {
        enemy.phase = 'windup';
        enemy.windup = move.windup;
        enemy.telegraph = move.damage;
        battle.events.push({ type: 'enemyWindup', damage: move.damage });
        note(battle, '敌方正在蓄力……');
      } else {
        enemy.timer = ENEMY_INTERVAL;
        strike(battle, move.damage);
      }
    }
  } else {
    enemy.windup -= dt;
    if (enemy.windup <= 0) {
      enemy.phase = 'idle';
      enemy.timer = ENEMY_INTERVAL;
      enemy.telegraph = 0;
      strike(battle, enemy.pending.damage);
    }
  }
}

/**
 * 推进战斗。
 * 单次最多推进 1 秒，并且内部按 50ms 切片 —— 切后台回来、掉帧、断点调试
 * 都不会让敌人一次性打出好几下。
 */
export function tick(battle, dt) {
  if (battle.winner !== null) return;
  let remaining = Math.max(0, Math.min(Number(dt) || 0, 1));
  while (remaining > 0 && battle.winner === null) {
    const slice = Math.min(remaining, 0.05);
    remaining -= slice;
    step(battle, slice);
  }
}

/**
 * 玩家施法。
 * @returns {{ok: boolean, message: string}}
 */
export function cast(battle, id) {
  if (battle.winner !== null) return { ok: false, message: '本局已结束' };
  const spell = SPELL_BY_ID[id];
  if (!spell) return { ok: false, message: '无法识别的技能' };
  if (battle.cooldowns[id] > 0) {
    return { ok: false, message: `${spell.name}冷却中（${battle.cooldowns[id].toFixed(1)} 秒）` };
  }

  battle.cooldowns[id] = spell.cooldown || 0;
  let detail;

  if (spell.damage) {
    const dealt = spell.damage + battle.support;
    battle.support = 0;
    battle.hp.enemy = Math.max(0, battle.hp.enemy - dealt);
    detail = `造成 ${dealt} 点伤害`;
    battle.events.push({ type: 'playerHit', damage: dealt, spell: id });
  } else if (spell.heal) {
    const before = battle.hp.player;
    battle.hp.player = Math.min(battle.max.player, battle.hp.player + spell.heal);
    detail = `回复 ${battle.hp.player - before} 点生命`;
    battle.events.push({ type: 'heal', amount: battle.hp.player - before });
  } else if (spell.shield) {
    battle.shieldLeft = spell.shield;
    detail = `${spell.shield} 秒内受伤减半`;
    battle.events.push({ type: 'shield' });
  } else {
    battle.support = spell.support;
    detail = `下一次伤害 +${spell.support}`;
    battle.events.push({ type: 'support' });
  }

  note(battle, `你 · ${spell.name}，${detail}`);
  if (battle.hp.enemy <= 0) {
    battle.winner = 'win';
    note(battle, '敌方被击倒。');
  }
  return { ok: true, message: `${spell.name} · ${detail}` };
}

/** 渲染层每帧取走事件，避免重复播放动画 */
export function drainEvents(battle) {
  const events = battle.events;
  battle.events = [];
  return events;
}

/** 冷却进度 0~1，给 UI 画遮罩用 */
export function cooldownProgress(battle, id) {
  const spell = SPELL_BY_ID[id];
  if (!spell.cooldown) return 0;
  return Math.max(0, Math.min(1, battle.cooldowns[id] / spell.cooldown));
}
