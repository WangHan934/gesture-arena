/**
 * 决斗走位 / 射程测试
 * ==================================================================
 * 用法：node tests/duel-range.test.mjs
 *
 * 分两层验：
 *   1. 引擎层（battle-system.js）：距离、射程判定、重击落空、向后兼容
 *   2. 模式层（duel-mode.js）：横线方向 → 靠近 / 拉开、各种提示文案
 *
 * 【向后兼容是重点】
 *   RULES 里所有射程默认 1，也就是「任何距离都能打到」。
 *   不传距离的调用方（包括 battle-system.test.mjs 的 60 项）行为必须和以前一模一样。
 */

import { BattleSystem, RULES } from '../src/battle/battle-system.js';
import { DuelMode } from '../src/modes/duel-mode.js';
import { DUEL_RULES } from '../src/config.js';

/* ---------------- 极简断言 ---------------- */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

/* ---------------- 测试用怪物表 ---------------- */

const MONSTERS = [
  { id: 'a', name: '甲', glyph: '🅰', color: '#88aaff', hp: 100, attack: 10, defense: 0, speed: 60, size: 34 },
  { id: 'b', name: '乙', glyph: '🅱', color: '#ff8888', hp: 100, attack: 10, defense: 0, speed: 60, size: 34 },
];

function makeSystem(rules = {}) {
  return new BattleSystem({ monsters: MONSTERS, rules });
}

/* ---------------- 1. 引擎：距离与射程 ---------------- */

console.log('\n── 1. 引擎：距离与射程');

check('默认射程全为 1（向后兼容）', () => {
  eq(RULES.playerReach, 1, 'playerReach');
  eq(RULES.playerSkillReach, 1, 'playerSkillReach');
  eq(RULES.enemyReach, 1, 'enemyReach');
  eq(RULES.enemyHeavyReach, 1, 'enemyHeavyReach');
});

check('开局距离为 0', () => {
  const sys = makeSystem();
  sys.startBattle('a', { enemyId: 'b' });
  eq(sys.distance, 0, 'distance');
  eq(sys.getBattleState().distance, 0, 'state.distance');
});

check('moveBy 正数拉开、负数靠近', () => {
  const sys = makeSystem();
  sys.startBattle('a', { enemyId: 'b' });

  sys.moveBy(0.4);
  eq(Number(sys.distance.toFixed(2)), 0.4, '拉开后');

  sys.moveBy(-0.1);
  eq(Number(sys.distance.toFixed(2)), 0.3, '靠近后');
});

check('moveBy 夹在 0~1 之间', () => {
  const sys = makeSystem();
  sys.startBattle('a', { enemyId: 'b' });

  sys.moveBy(5);
  eq(sys.distance, 1, '上限');

  sys.moveBy(-5);
  eq(sys.distance, 0, '下限');
});

check('到边界后 moveBy 返回 edge', () => {
  const sys = makeSystem();
  sys.startBattle('a', { enemyId: 'b' });

  const atMin = sys.moveBy(-0.5);
  eq(atMin.ok, false, '已经在 0 时再靠近');
  eq(atMin.reason, 'edge', 'reason');

  sys.moveBy(1);
  const atMax = sys.moveBy(0.5);
  eq(atMax.ok, false, '已经在 1 时再拉开');
  eq(atMax.reason, 'edge', 'reason');
});

check('未开局时 moveBy 被拒绝', () => {
  const sys = makeSystem();
  const res = sys.moveBy(0.2);
  eq(res.ok, false, 'ok');
  eq(res.reason, 'not-started', 'reason');
});

check('默认射程下，任意距离普攻都能命中（向后兼容）', () => {
  for (const d of [0, 0.3, 0.7, 1]) {
    const sys = makeSystem();
    sys.startBattle('a', { enemyId: 'b' });
    sys.setDistance(d);
    const res = sys.playerAttack();
    assert(res.ok, `距离 ${d} 时普攻应该命中，实际 reason=${res.reason}`);
  }
});

check('把 playerReach 调小后，超距离普攻返回 out-of-range', () => {
  // 射程内：能打
  const inRange = makeSystem({ playerReach: 0.5 });
  inRange.startBattle('a', { enemyId: 'b' });
  inRange.setDistance(0.4);
  assert(inRange.playerAttack().ok, '0.4 在射程内应该能打');

  // 射程外：打不到（用新实例，避免被上一次攻击的冷却干扰）
  const outOfRange = makeSystem({ playerReach: 0.5 });
  outOfRange.startBattle('a', { enemyId: 'b' });
  outOfRange.setDistance(0.6);

  const res = outOfRange.playerAttack();
  eq(res.ok, false, 'ok');
  eq(res.reason, 'out-of-range', 'reason');
});

check('技能射程比普攻宽：普攻打不到时技能还能放', () => {
  const sys = makeSystem({ playerReach: 0.5, playerSkillReach: 1 });
  sys.startBattle('a', { enemyId: 'b' });
  sys.setDistance(0.8);
  sys._skillCooldown = 0; // 跳过开局技能预热

  eq(sys.playerAttack().reason, 'out-of-range', '普攻');
  assert(sys.playerSkill().ok, '技能应该能放');
});

check('拉开到重击射程外，敌人重击落空且不掉血', () => {
  const sys = makeSystem({
    enemyHeavyEvery: 1,        // 每次都是重击
    enemyFirstAttackDelay: 0,  // 立刻出手
    enemyHeavyReach: 0.4,
    enemyReach: 1,
  });
  sys.startBattle('a', { enemyId: 'b' });
  sys.setDistance(0.8);

  const hpBefore = sys.getBattleState().player.hp;
  const out = sys.update(0.05);

  assert(out.events.some((e) => e.type === 'enemy-miss'), '应该发出 enemy-miss 事件');
  eq(sys.getBattleState().player.hp, hpBefore, '玩家不该掉血');
});

check('贴身时敌人重击正常命中', () => {
  const sys = makeSystem({
    enemyHeavyEvery: 1,
    enemyFirstAttackDelay: 0,
    enemyHeavyReach: 0.4,
  });
  sys.startBattle('a', { enemyId: 'b' });
  sys.setDistance(0.2);

  const hpBefore = sys.getBattleState().player.hp;
  const out = sys.update(0.05);

  assert(out.events.some((e) => e.type === 'enemy-attack'), '应该发出 enemy-attack 事件');
  assert(sys.getBattleState().player.hp < hpBefore, '玩家应该掉血');
});

check('敌人普通攻击射程设满时，拉远也躲不掉', () => {
  const sys = makeSystem({
    enemyHeavyEvery: 99,       // 不会有重击
    enemyFirstAttackDelay: 0,
    enemyReach: 1,
  });
  sys.startBattle('a', { enemyId: 'b' });
  sys.setDistance(1);

  const hpBefore = sys.getBattleState().player.hp;
  sys.update(0.05);
  assert(sys.getBattleState().player.hp < hpBefore, '满射程普攻应该打中');
});

check('重新开局后距离归零', () => {
  const sys = makeSystem();
  sys.startBattle('a', { enemyId: 'b' });
  sys.moveBy(0.6);

  sys.startBattle('a', { enemyId: 'b' });
  eq(sys.distance, 0, '重开后 distance');
});

check('resetBattle 后距离归零', () => {
  const sys = makeSystem();
  sys.startBattle('a', { enemyId: 'b' });
  sys.moveBy(0.6);

  sys.resetBattle();
  eq(sys.distance, 0, 'reset 后 distance');
});

/* ---------------- 2. 模式层：横线方向 → 走位 ---------------- */

console.log('\n── 2. 决斗模式：横线方向 → 走位');

/** 开一局，返回 mode */
function startDuel() {
  const mode = new DuelMode();
  mode.selectMonster('stone');
  return mode;
}

check('决斗模式用的是 DUEL_RULES 里的射程', () => {
  const mode = new DuelMode();
  eq(mode.system.rules.playerReach, DUEL_RULES.playerReach, 'playerReach');
  eq(mode.system.rules.enemyHeavyReach, DUEL_RULES.enemyHeavyReach, 'enemyHeavyReach');
});

check('甜区存在：重击射程必须比普攻射程窄', () => {
  assert(
    DUEL_RULES.enemyHeavyReach < DUEL_RULES.playerReach,
    `重击射程 ${DUEL_RULES.enemyHeavyReach} 必须小于普攻射程 ${DUEL_RULES.playerReach}，否则没有安全输出位`,
  );
});

check('步长小于甜区宽度，否则玩家会来回抖', () => {
  const width = DUEL_RULES.playerReach - DUEL_RULES.enemyHeavyReach;
  assert(
    DUEL_RULES.moveStep < width,
    `步长 ${DUEL_RULES.moveStep} 必须小于甜区宽度 ${width.toFixed(2)}，否则永远落不进甜区`,
  );
});

check('横线从左往右 → 靠近（距离变小）', () => {
  const mode = startDuel();
  mode.system.setDistance(0.5);

  const res = mode.handleGesture({ id: 'line_h', dir: 'ltr', score: 0 });
  assert(res.ok, `应该成功，实际：${res.message}`);
  assert(mode.system.distance < 0.5, `距离应该变小，实际 ${mode.system.distance}`);
  assert(/靠近/.test(res.message), `提示应该含「靠近」，实际：${res.message}`);
});

check('横线从右往左 → 拉开（距离变大）', () => {
  const mode = startDuel();
  mode.system.setDistance(0.2);

  const res = mode.handleGesture({ id: 'line_h', dir: 'rtl', score: 0 });
  assert(res.ok, `应该成功，实际：${res.message}`);
  assert(mode.system.distance > 0.2, `距离应该变大，实际 ${mode.system.distance}`);
  assert(/拉开/.test(res.message), `提示应该含「拉开」，实际：${res.message}`);
});

check('已经贴身时继续靠近 → 提示"已经贴身了"', () => {
  const mode = startDuel();
  mode.system.setDistance(0);

  const res = mode.handleGesture({ id: 'line_h', dir: 'ltr', score: 0 });
  eq(res.ok, false, 'ok');
  assert(/贴身/.test(res.message), `提示应该提到贴身，实际：${res.message}`);
});

check('已经最远时继续拉开 → 提示"已经退到最远"', () => {
  const mode = startDuel();
  mode.system.setDistance(1);

  const res = mode.handleGesture({ id: 'line_h', dir: 'rtl', score: 0 });
  eq(res.ok, false, 'ok');
  assert(/最远/.test(res.message), `提示应该提到最远，实际：${res.message}`);
});

check('折线 Z → 普攻', () => {
  const mode = startDuel();
  mode.system.setDistance(0);

  const res = mode.handleGesture({ id: 'zigzag', score: 0 });
  assert(res.ok, `应该能打，实际：${res.message}`);
  assert(/普攻/.test(res.message), `提示应该含「普攻」，实际：${res.message}`);
});

check('太远时普攻 → 提示靠近', () => {
  const mode = startDuel();
  mode.system.setDistance(1);

  const res = mode.handleGesture({ id: 'zigzag', score: 0 });
  eq(res.ok, false, 'ok');
  assert(/太远/.test(res.message), `提示应该提到太远，实际：${res.message}`);
});

check('V 形 → 技能，且远距离也能放', () => {
  const mode = startDuel();
  mode.system.setDistance(1);
  mode.system._skillCooldown = 0; // 跳过开局预热

  const res = mode.handleGesture({ id: 'v_shape', score: 0 });
  assert(res.ok, `技能应该能放，实际：${res.message}`);
  assert(/技能/.test(res.message), `提示应该含「技能」，实际：${res.message}`);
});

check('圆在决斗模式用不上', () => {
  const mode = startDuel();
  const res = mode.handleGesture({ id: 'circle', score: 0 });
  eq(res.ok, false, 'ok');
  assert(/用不上/.test(res.message), `提示应该说明用不上，实际：${res.message}`);
});

check('图例里有「靠近 / 拉开」，没有「普攻」重复项', () => {
  const mode = new DuelMode();
  const labels = mode.getLegend().map((l) => l.label);
  assert(labels.includes('靠近'), '图例缺少「靠近」');
  assert(labels.includes('拉开'), '图例缺少「拉开」');
  eq(labels.filter((l) => l === '普攻').length, 1, '「普攻」应该只出现一次');
});

check('world 里带出走位状态给渲染器', () => {
  const mode = startDuel();
  mode.system.setDistance(0.9);
  const w = mode.getView().world;

  eq(typeof w.distance, 'number', 'world.distance');
  eq(w.inPlayerRange, false, '0.9 超出普攻射程');
  eq(typeof w.heavyWillHit, 'boolean', 'world.heavyWillHit');
});

check('摄像头 1 指 / 2 指在战斗中当走位用', () => {
  const mode = startDuel();
  mode.system.setDistance(0.3);

  const toward = mode.handleCameraAction('monster:0');
  assert(/靠近/.test(toward.message), `1 指应该靠近，实际：${toward.message}`);

  mode.system.setDistance(0.3);
  const away = mode.handleCameraAction('monster:1');
  assert(/拉开/.test(away.message), `2 指应该拉开，实际：${away.message}`);
});

/* ---------------- 汇总 ---------------- */

console.log(`\n${'─'.repeat(56)}`);
if (failures.length) {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.message}`);
  console.log('\n走位 / 射程存在失败用例 ❌');
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 通过 / 0 失败`);
  console.log('走位 / 射程全部用例通过 ✅');
}
