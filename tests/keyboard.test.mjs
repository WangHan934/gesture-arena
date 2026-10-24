/**
 * 键盘备用控制测试
 * ==================================================================
 * 用法：node tests/keyboard.test.mjs
 *
 * 验三件事：
 *   1. 按键 → 动作 的映射正确，且和摄像头用同一套动作词表
 *   2. 键盘合成的动作走的是模式层同一条路径（冷却 / 射程 / 法力全部生效）
 *   3. 整条流程能用键盘走完：选玩法 → 选怪 → 走位 → 出招 → 胜负
 *
 * 【为什么这条链必须有测试】
 *   比赛现场摄像头挂了、鼠标失灵时，键盘是唯一的兜底。
 *   如果键盘绕过了冷却或射程判断，就会出现「键盘能无限召唤」这类现场事故。
 */

import { resolveModeAction, isGlobalKey, GLOBAL_KEY_LABELS } from '../src/input/keyboard-input.js';
import { TowerMode } from '../src/modes/tower-mode.js';
import { DuelMode } from '../src/modes/duel-mode.js';
import { CREATURES } from '../src/summon/creature-data.js';

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

/* ---------------- 1. 按键映射 ---------------- */

console.log('\n── 1. 按键 → 动作');

check('塔防：数字键 1~4 → 召唤四只生物', () => {
  const mode = new TowerMode();
  for (let i = 0; i < 4; i++) {
    eq(resolveModeAction(`Digit${i + 1}`, mode), `creature:${i}`, `Digit${i + 1}`);
  }
});

check('塔防：小键盘 1~4 同样有效', () => {
  const mode = new TowerMode();
  eq(resolveModeAction('Numpad2', mode), 'creature:1', 'Numpad2');
});

check('决斗：数字键 1~4 → 选四只生物', () => {
  const mode = new DuelMode();
  for (let i = 0; i < 4; i++) {
    eq(resolveModeAction(`Digit${i + 1}`, mode), `monster:${i}`, `Digit${i + 1}`);
  }
});

check('决斗：Z = 普攻，V = 技能', () => {
  const mode = new DuelMode();
  eq(resolveModeAction('KeyZ', mode), 'attack', 'Z');
  eq(resolveModeAction('KeyV', mode), 'skill', 'V');
});

check('决斗：左右方向键 = 走位', () => {
  const mode = new DuelMode();
  eq(resolveModeAction('ArrowRight', mode), 'toward', '→');
  eq(resolveModeAction('ArrowLeft', mode), 'away', '←');
});

check('没映射的键返回 null', () => {
  const tower = new TowerMode();
  const duel = new DuelMode();
  eq(resolveModeAction('KeyQ', tower), null, '塔防 KeyQ');
  eq(resolveModeAction('KeyZ', tower), null, '塔防 KeyZ');
  eq(resolveModeAction('Digit5', duel), null, '决斗 Digit5');
});

check('模式没有 keyMap 时不报错', () => {
  eq(resolveModeAction('Digit1', null), null, 'null');
  eq(resolveModeAction('Digit1', {}), null, '空对象');
  eq(resolveModeAction('Digit1', { keyMap: '不是对象' }), null, 'keyMap 类型错');
});

check('全局键不和模式动作抢', () => {
  for (const code of Object.keys(GLOBAL_KEY_LABELS)) {
    assert(isGlobalKey(code), `${code} 应该是全局键`);
  }
  assert(!isGlobalKey('Digit1'), 'Digit1 不该是全局键');
  assert(!isGlobalKey('KeyZ'), 'KeyZ 不该是全局键');
});

/* ---------------- 2. 动作走的是同一条路径 ---------------- */

console.log('\n── 2. 键盘动作复用模式层逻辑');

check('塔防：键盘召唤会扣法力（不是白嫖）', () => {
  const mode = new TowerMode();
  const before = mode.battle.mana;

  const out = mode.handleAction('creature:1'); // 焰狐，费用 20
  assert(out.ok, `应该能召唤，实际：${out.message}`);
  assert(mode.battle.mana < before, `法力应该下降，${before} → ${mode.battle.mana}`);
});

check('塔防：法力不足时键盘也召唤失败', () => {
  const mode = new TowerMode();
  mode.battle.mana = 0;

  const out = mode.handleAction('creature:0');
  eq(out.ok, false, 'ok');
  assert(/法力不足/.test(out.message), `应该提示法力不足，实际：${out.message}`);
});

check('决斗：键盘能选到第 4 只生物（摄像头做不到）', () => {
  const mode = new DuelMode();
  eq(mode.roster.length, 4, '生物数量');

  const out = mode.handleAction('monster:3');
  assert(out.ok, `应该能选第 4 只，实际：${out.message}`);
  eq(out.started, true, 'started');
  eq(mode.getView().phase, 'playing', '应该进入战斗');
});

check('决斗：键盘普攻受冷却限制', () => {
  const mode = new DuelMode();
  mode.handleAction('monster:0');

  const first = mode.handleAction('attack');
  assert(first.ok, `第一次应该能打，实际：${first.message}`);

  const second = mode.handleAction('attack');
  eq(second.ok, false, '连续第二次 ok');
  assert(/冷却/.test(second.message), `应该提示冷却，实际：${second.message}`);
});

check('决斗：键盘走位受边界限制', () => {
  const mode = new DuelMode();
  mode.handleAction('monster:0');

  // 连续靠近到贴身
  for (let i = 0; i < 10; i++) mode.handleAction('toward');
  eq(mode.system.distance, 0, '应该贴到 0');

  const res = mode.handleAction('toward');
  eq(res.ok, false, '再靠近 ok');
  assert(/贴身/.test(res.message), `应该提示贴身，实际：${res.message}`);
});

check('决斗：太远时键盘普攻打不到', () => {
  const mode = new DuelMode();
  mode.handleAction('monster:0');
  for (let i = 0; i < 10; i++) mode.handleAction('away');

  const res = mode.handleAction('attack');
  eq(res.ok, false, 'ok');
  assert(/太远/.test(res.message), `应该提示太远，实际：${res.message}`);
});

check('决斗：选怪阶段按键走位会被拦下', () => {
  const mode = new DuelMode();
  const res = mode.handleAction('toward');
  eq(res.ok, false, 'ok');
  assert(/先选/.test(res.message), `应该提示先选生物，实际：${res.message}`);
});

check('handleCameraAction 别名仍然可用（不破坏摄像头调用）', () => {
  const tower = new TowerMode();
  const duel = new DuelMode();

  assert(typeof tower.handleCameraAction === 'function', '塔防别名');
  assert(typeof duel.handleCameraAction === 'function', '决斗别名');

  eq(tower.handleCameraAction('creature:0').ok, true, '塔防别名调用');
  eq(duel.handleCameraAction('monster:0').started, true, '决斗别名调用');
});

/* ---------------- 3. 键盘提示 ---------------- */

console.log('\n── 3. 键盘提示');

check('两个模式都提供 getKeyHint', () => {
  for (const mode of [new TowerMode(), new DuelMode()]) {
    const hint = mode.getKeyHint();
    assert(Array.isArray(hint) && hint.length > 0, `${mode.name} 的 getKeyHint 应该有内容`);
    for (const item of hint) {
      assert(typeof item.keys === 'string' && item.keys, `${mode.name} 缺少 keys`);
      assert(typeof item.label === 'string' && item.label, `${mode.name} 缺少 label`);
    }
  }
});

check('决斗的键盘提示随阶段变化', () => {
  const mode = new DuelMode();
  const selectKeys = mode.getKeyHint().map((i) => i.keys).join(',');

  mode.handleAction('monster:0');
  const fightKeys = mode.getKeyHint().map((i) => i.keys).join(',');

  assert(selectKeys !== fightKeys, `选怪阶段（${selectKeys}）和战斗中（${fightKeys}）的提示应该不同`);
  assert(/Z/.test(fightKeys), '战斗中应该提示 Z 普攻');
});

/* ---------------- 4. 整条流程用键盘走完 ---------------- */

console.log('\n── 4. 完整流程（纯键盘）');

check('决斗：选怪 → 走位 → 普攻 → 打完一局', () => {
  const mode = new DuelMode();

  // 选第 1 只
  const picked = mode.handleAction('monster:0');
  assert(picked.started, '应该开局');

  // 撤到甜区（重击射程之外）
  for (let i = 0; i < 2; i++) mode.handleAction('away');

  // 一直按 Z 打，直到分出胜负
  let guard = 0;
  while (mode.getView().phase === 'playing' && guard++ < 400) {
    mode.update(0.05);
    mode.handleAction('attack');
  }

  const phase = mode.getView().phase;
  assert(phase === 'win' || phase === 'lose', `应该分出胜负，实际：${phase}`);
  console.log(`      （键盘打完一局：${phase}，用时 ${mode.getView().stats.time.toFixed(1)}s）`);
});

check('塔防：键盘召唤 → 推进 → 打完一局', () => {
  const mode = new TowerMode();

  let guard = 0;
  while (mode.getView().phase === 'playing' && guard++ < 4000) {
    mode.update(0.05);
    // 轮流按 1~4，法力够了就召唤
    mode.handleAction(`creature:${guard % CREATURES.length}`);
  }

  const phase = mode.getView().phase;
  assert(phase === 'win' || phase === 'lose', `应该分出胜负，实际：${phase}`);
  console.log(`      （键盘打完一局：${phase}，用时 ${mode.getView().stats.time.toFixed(1)}s）`);
});

/* ---------------- 汇总 ---------------- */

console.log(`\n${'─'.repeat(56)}`);
if (failures.length) {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.message}`);
  console.log('\n键盘备用控制存在失败用例 ❌');
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 通过 / 0 失败`);
  console.log('键盘备用控制全部用例通过 ✅');
}
