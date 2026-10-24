import { MONSTERS, SPELLS, TURN_MS, MAX_TURNS } from './rules.js';

export function createBattle(firstSeat, now = Date.now()) {
  return {
    turn: firstSeat, turns: 1, deadline: now + TURN_MS, winner: null,
    players: [0, 1].map(() => ({ hp: 140, shield: false, support: false, cooldowns: {} })),
    log: ['对战开始，先手随机决定。'],
  };
}

function note(battle, message) {
  battle.log.push(message);
  battle.log = battle.log.slice(-12);
}

function advance(battle, now) {
  if (battle.winner !== null) return;
  if (battle.turns >= MAX_TURNS) {
    const [a, b] = battle.players;
    battle.winner = a.hp === b.hp ? 'draw' : a.hp > b.hp ? 0 : 1;
    note(battle, '达到回合上限，按剩余生命结算。');
    return;
  }
  battle.turn = 1 - battle.turn;
  battle.turns++;
  battle.deadline = now + TURN_MS;
  const incoming = battle.players[battle.turn];
  for (const key of Object.keys(incoming.cooldowns)) {
    incoming.cooldowns[key] = Math.max(0, incoming.cooldowns[key] - 1);
  }
}

export function castSpell(battle, seat, spellId, now = Date.now()) {
  if (battle.winner !== null) return { ok: false, message: '本局已结束' };
  if (seat !== battle.turn) return { ok: false, message: '请等待对手出招' };
  // A late request cannot beat the server's turn clock.
  if (now >= battle.deadline) {
    expireTurn(battle, now);
    return { ok: false, message: '出招超时，已轮到对手' };
  }
  const spell = SPELLS.find(s => s.id === spellId);
  if (!spell) return { ok: false, message: '无法识别的技能' };
  const player = battle.players[seat];
  const enemy = battle.players[1 - seat];
  if (player.cooldowns[spell.id] > 0) return { ok: false, message: `${spell.name}还需等待 ${player.cooldowns[spell.id]} 个己方回合` };
  let detail;
  if (spell.damage) {
    let damage = spell.damage + (player.support ? 15 : 0);
    player.support = false;
    if (enemy.shield) { damage = Math.floor(damage / 2); enemy.shield = false; }
    enemy.hp = Math.max(0, enemy.hp - damage);
    detail = `造成 ${damage} 点伤害`;
  } else if (spell.heal) {
    const before = player.hp;
    player.hp = Math.min(140, player.hp + spell.heal);
    detail = `回复 ${player.hp - before} 点生命`;
  } else if (spell.shield) {
    player.shield = true;
    detail = '下一次受伤减半';
  } else {
    player.support = true;
    detail = '下一次伤害额外 +15';
  }
  player.cooldowns[spell.id] = spell.cooldown ? spell.cooldown + 1 : 0;
  note(battle, `玩家 ${seat + 1} · ${spell.name}，${detail}`);
  if (enemy.hp === 0) battle.winner = seat;
  else advance(battle, now);
  return { ok: true, message: `${spell.name} · ${detail}` };
}

export function expireTurn(battle, now = Date.now()) {
  if (battle.winner !== null || now < battle.deadline) return false;
  note(battle, `玩家 ${battle.turn + 1} 出招超时，跳过回合。`);
  advance(battle, now);
  return true;
}

export function validMonster(id) { return MONSTERS.some(m => m.id === id); }
