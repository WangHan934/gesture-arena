import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBattle, tick, cast, drainEvents, cooldownProgress,
  PLAYER_HP, ENEMY_HP, ENEMY_INTERVAL, ENEMY_PATTERN, SPELL_BY_ID,
} from '../src/solo/engine.js';

const fresh = () => createBattle('fire', 'shadow');

// 和浏览器主循环等价：每帧推进一小步。tick 单次最多推进 1 秒（防切后台连击），
// 所以测试里要按帧循环，而不是一次传入大 dt。
const run = (battle, seconds) => {
  let left = seconds;
  while (left > 0 && battle.winner === null) {
    const slice = Math.min(left, 0.05);
    tick(battle, slice);
    left -= slice;
  }
};

test('开局血量与冷却都是干净的', () => {
  const b = fresh();
  assert.equal(b.hp.player, PLAYER_HP);
  assert.equal(b.hp.enemy, ENEMY_HP);
  assert.equal(b.winner, null);
  assert.equal(b.shieldLeft, 0);
  assert.equal(b.support, 0);
  for (const id of Object.keys(b.cooldowns)) assert.equal(b.cooldowns[id], 0);
});

test('火球术造成固定伤害并进入冷却', () => {
  const b = fresh();
  const out = cast(b, 'circle');
  assert.equal(out.ok, true);
  assert.equal(b.hp.enemy, ENEMY_HP - SPELL_BY_ID.circle.damage);
  assert.equal(b.cooldowns.circle, SPELL_BY_ID.circle.cooldown);
});

test('冷却没走完时施法被拒绝，且不产生伤害', () => {
  const b = fresh();
  cast(b, 'circle');
  const hp = b.hp.enemy;
  const out = cast(b, 'circle');
  assert.equal(out.ok, false);
  assert.match(out.message, /冷却/);
  assert.equal(b.hp.enemy, hp);
});

test('冷却随时间恢复，恢复后可以再放', () => {
  const b = fresh();
  cast(b, 'line_v');
  assert.equal(cast(b, 'line_v').ok, false);
  run(b, SPELL_BY_ID.line_v.cooldown + 0.1);
  assert.equal(b.cooldowns.line_v, 0);
  assert.equal(cast(b, 'line_v').ok, true);
});

test('护盾把受到的伤害减半，并在 3 秒后失效', () => {
  const b = fresh();
  cast(b, 'square');
  assert.equal(b.shieldLeft, SPELL_BY_ID.square.shield);
  // 第一击落在护盾生效期内，伤害减半向下取整
  const first = Math.floor(ENEMY_PATTERN[0].damage / 2);
  run(b, ENEMY_INTERVAL + 0.01);
  assert.equal(b.hp.player, PLAYER_HP - first);
  // 护盾到期后，第二击恢复全额
  run(b, SPELL_BY_ID.square.shield + 0.2);
  assert.equal(b.shieldLeft, 0);
  assert.equal(b.hp.player, PLAYER_HP - first - ENEMY_PATTERN[1].damage);
});

test('援军只强化下一次伤害，之后自动清零', () => {
  const b = fresh();
  cast(b, 'triangle');
  assert.equal(b.support, SPELL_BY_ID.triangle.support);
  cast(b, 'circle');
  const boosted = SPELL_BY_ID.circle.damage + SPELL_BY_ID.triangle.support;
  assert.equal(b.hp.enemy, ENEMY_HP - boosted);
  assert.equal(b.support, 0);
  run(b, 1);
  cast(b, 'circle');
  assert.equal(b.hp.enemy, ENEMY_HP - boosted - SPELL_BY_ID.circle.damage);
});

test('治疗不会超过上限', () => {
  const b = fresh();
  b.hp.player = PLAYER_HP - 5;
  const out = cast(b, 'two');
  assert.equal(b.hp.player, PLAYER_HP);
  assert.match(out.message, /回复 5/);
});

test('敌人按固定间隔出手', () => {
  const b = fresh();
  run(b, ENEMY_INTERVAL - 0.1);
  assert.equal(b.hp.player, PLAYER_HP);
  run(b, 0.2);
  assert.equal(b.hp.player, PLAYER_HP - ENEMY_PATTERN[0].damage);
});

test('重击前有蓄力阶段，蓄力结束才结算伤害', () => {
  const b = fresh();
  run(b, ENEMY_INTERVAL);        // 第 1 击
  run(b, ENEMY_INTERVAL);        // 第 2 击
  const before = b.hp.player;
  run(b, ENEMY_INTERVAL + 0.05);
  assert.equal(b.enemy.phase, 'windup');
  assert.equal(b.hp.player, before, '蓄力期间不该扣血');
  run(b, ENEMY_PATTERN[2].windup + 0.1);
  assert.equal(b.hp.player, before - ENEMY_PATTERN[2].damage);
  assert.equal(b.enemy.phase, 'idle');
});

test('敌人循环是「轻击、轻击、蓄力重击」且按顺序执行', () => {
  assert.equal(ENEMY_PATTERN.length, 3);
  assert.equal(ENEMY_PATTERN[0].windup, 0);
  assert.equal(ENEMY_PATTERN[1].windup, 0);
  assert.ok(ENEMY_PATTERN[2].windup > 0, '第三下必须蓄力');
  assert.ok(ENEMY_PATTERN[2].damage > ENEMY_PATTERN[0].damage, '重击伤害要明显更高');

  const b = fresh();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const before = b.hp.player;
    run(b, ENEMY_INTERVAL + (ENEMY_PATTERN[i].windup > 0 ? ENEMY_PATTERN[i].windup + 0.1 : 0.01));
    seen.push(before - b.hp.player);
  }
  assert.deepEqual(seen, ENEMY_PATTERN.map(m => m.damage));
});

test('一次传入超大 dt 也只推进 1 秒，敌人不会连打好几下', () => {
  const b = fresh();
  tick(b, 30);
  const hits = drainEvents(b).filter(e => e.type === 'enemyHit').length;
  assert.equal(hits, 0, '1 秒内还没到第一次出手');
  assert.ok(b.time <= 1.0001);
});

test('打死敌人判定胜利，之后不能继续施法', () => {
  const b = fresh();
  b.hp.enemy = 10;
  cast(b, 'circle');
  assert.equal(b.winner, 'win');
  assert.equal(b.hp.enemy, 0);
  assert.equal(cast(b, 'circle').ok, false);
});

test('玩家血量归零判定失败', () => {
  const b = fresh();
  b.hp.player = 5;
  run(b, ENEMY_INTERVAL + 0.01);
  assert.equal(b.winner, 'lose');
  assert.equal(b.hp.player, 0);
});

test('结束后 tick 不再改变任何状态', () => {
  const b = fresh();
  b.winner = 'win';
  const snapshot = JSON.stringify({ hp: b.hp, time: b.time });
  tick(b, 5);
  assert.equal(JSON.stringify({ hp: b.hp, time: b.time }), snapshot);
});

test('冷却进度给 UI 用，0 到 1 之间', () => {
  const b = fresh();
  assert.equal(cooldownProgress(b, 'circle'), 0);
  cast(b, 'line_h');
  assert.equal(cooldownProgress(b, 'line_h'), 1);
  run(b, 6);
  assert.ok(cooldownProgress(b, 'line_h') > 0 && cooldownProgress(b, 'line_h') < 1);
});

test('事件队列取走一次就清空，不会重复播动画', () => {
  const b = fresh();
  cast(b, 'circle');
  const first = drainEvents(b);
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'playerHit');
  assert.equal(drainEvents(b).length, 0);
});

test('日志有长度上限，长时间对战不会无限增长', () => {
  const b = fresh();
  for (let i = 0; i < 200; i++) {
    b.cooldowns.circle = 0;
    cast(b, 'circle');
    if (b.winner) break;
  }
  assert.ok(b.log.length <= 40);
});
