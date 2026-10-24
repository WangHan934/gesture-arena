/**
 * 战斗系统单测
 * ==================================================================
 * 跑法：node src/battle/battle-system.test.mjs
 *
 * 完全不需要摄像头、浏览器、WebGL —— 直接调 startBattle / playerAttack
 * 就能验完「开始战斗 → 攻击 → 血量变化 → 敌人反击 → 胜负判定」整条链路。
 *
 * 怪物表用内置 fixture（字段和 B 的 creature-data.js 完全一致：hp/dps/speed/...），
 * 这样即使 B 的文件还没合并进来也能独立验证。
 * 如果 B 的文件在，末尾会额外跑一遍真实数据的用例。
 */

/* ---------------- 先把模块加载时的 warn 收起来，保持输出干净 ---------------- */

const warnings = [];
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...args) => warnings.push(args.join(' '));
console.error = (...args) => warnings.push(args.join(' '));

const {
  BattleSystem,
  createBattleSystem,
  computeDamage,
  attackIntervalFor,
  toCombatant,
  pickNumber,
  RULES,
  startBattle,
  playerAttack,
  getBattleState,
  resetBattle,
  updateBattle,
  configureDefaultBattle,
} = await import('./battle-system.js');

console.warn = originalWarn;
console.error = originalError;

/* ---------------- 极简单测框架 ---------------- */

let passed = 0;
const failures = [];
let currentGroup = '';
const skips = [];

function group(title) {
  currentGroup = title;
  console.log(`\n── ${title}`);
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ group: currentGroup, name, message: error.message });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function skip(name, why) {
  skips.push(`${currentGroup} / ${name}：${why}`);
  console.log(`  ○ ${name}（跳过：${why}）`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || '值不相等'} —— actual ${JSON.stringify(actual)} / expected ${JSON.stringify(expected)}`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`${message || '数值超出容差'} —— actual ${actual} / expected ${expected} ±${tolerance}`);
  }
}

/* ---------------- 测试用怪物表（与 B 的 creature-data.js 同字段同数值） ---------------- */

const { FIXTURE } = await import('./fixture.mjs');

const makeSystem = (options = {}) => new BattleSystem({ monsters: FIXTURE, ...options });

/** 跑 n 个 0.1s 步长（和主循环的 dt 量级一致） */
function tick(system, n) {
  for (let i = 0; i < n; i++) system.update(0.1);
}

/** 一直推进到战斗结束，返回用掉的步数 */
function tickUntilOver(system, limit = 2000) {
  let steps = 0;
  while (system.phase === 'playing' && steps < limit) {
    system.update(0.1);
    steps += 1;
  }
  return steps;
}

/* ================================================================
 * 1. 纯函数：伤害与节奏
 * ================================================================ */
group('1. 伤害公式与节奏换算（纯函数）');

test('无防御时打出全额伤害', () => {
  assertEqual(computeDamage(100, 0), 100);
});

test('防御 100 时伤害减半', () => {
  assertEqual(computeDamage(100, 100), 50);
});

test('防御 300 时伤害约为四分之一', () => {
  assertEqual(computeDamage(100, 300), 25);
});

test('防御再高也至少打出保底伤害，不会卡成打不动', () => {
  assertEqual(computeDamage(1, 999999), RULES.damageFloor);
  assertEqual(computeDamage(0, 0), RULES.damageFloor);
});

test('负数 / 非法防御被夹到 0，不会变成加血', () => {
  assertEqual(computeDamage(10, -50), 10);
  assertEqual(computeDamage(10, NaN), 10);
  assertEqual(computeDamage(NaN, 0), RULES.damageFloor);
});

test('速度 60 是基准，间隔等于基准值', () => {
  assertEqual(attackIntervalFor(60, 1), 1);
});

test('速度越高出手越快，但被上限夹住', () => {
  assertClose(attackIntervalFor(100, 1), 0.6, 1e-9, '60/100=0.6');
  assertEqual(attackIntervalFor(120, 1), RULES.speedFactorMin, '0.5 被夹到下限 0.6');
  assertEqual(attackIntervalFor(999, 1), RULES.speedFactorMin);
});

test('速度越低出手越慢，但被下限夹住', () => {
  assertClose(attackIntervalFor(30, 1), 1.6, 1e-9, '60/30=2 被夹到 1.6');
  assertEqual(attackIntervalFor(0, 1), 1, '速度非法时回落到基准');
  assertEqual(attackIntervalFor(NaN, 1), 1);
});

test('pickNumber 按候选顺序取第一个有效字段', () => {
  assertEqual(pickNumber({ dps: 7 }, ['attack', 'dps'], 0), 7);
  assertEqual(pickNumber({ attack: 9, dps: 7 }, ['attack', 'dps'], 0), 9, 'attack 优先');
  assertEqual(pickNumber({ dps: NaN }, ['dps'], 5), 5, 'NaN 不算有效值');
  assertEqual(pickNumber(null, ['dps'], 5), 5);
});

/* ================================================================
 * 2. 怪物数据整形
 * ================================================================ */
group('2. 怪物数据整形（兼容 B 的字段）');

test('现有 dps 字段被当作攻击力使用', () => {
  const c = toCombatant(FIXTURE[1]);
  assertEqual(c.id, 'fox');
  assertEqual(c.name, '焰狐');
  assertEqual(c.attack, 14, 'dps → attack');
  assertEqual(c.maxHp, 42);
  assertEqual(c.hp, 42);
  assertEqual(c.defense, 0, '表里没有 defense，按 0 算');
});

test('任务书的 attack/defense 字段一旦补齐会自动优先采用', () => {
  const c = toCombatant({ id: 'x', name: 'X', hp: 50, attack: 33, defense: 12, speed: 70 });
  assertEqual(c.attack, 33);
  assertEqual(c.defense, 12);
});

test('血量为 0 或负数时至少留 1 点，避免开场即判定结束', () => {
  assertEqual(toCombatant({ id: 'x', hp: 0 }).maxHp, 1);
  assertEqual(toCombatant({ id: 'x', hp: -5 }).maxHp, 1);
  assertEqual(toCombatant({}).maxHp, 100, '缺字段时用默认值');
});

test('整形不修改传入的原对象', () => {
  const raw = { id: 'fox', hp: 42, dps: 14, speed: 110 };
  const before = JSON.stringify(raw);
  toCombatant(raw);
  assertEqual(JSON.stringify(raw), before);
});

/* ================================================================
 * 3. startBattle
 * ================================================================ */
group('3. 开始战斗 startBattle(monsterId)');

test('正常开局：进入 playing 且双方血量就位', () => {
  const sys = makeSystem();
  const out = sys.startBattle('fox');
  assert(out.ok, '应当成功');
  assertEqual(sys.phase, 'playing');

  const s = out.state;
  assertEqual(s.player.id, 'fox');
  assertEqual(s.player.hp, 42);
  assertEqual(s.player.maxHp, 42);
  assertEqual(s.result, null);
  assertEqual(s.over, false);
  assert(s.enemy, '应当有敌方');
  assert(s.enemy.hp > 0, '敌方应当有血量');
});

test('不指定对手时自动挑一只不同的怪（确定性）', () => {
  const sys = makeSystem();
  const a = sys.startBattle('fox').state;
  const b = sys.startBattle('fox').state;
  assertEqual(a.enemy.id, b.enemy.id, '同一输入必须得到同一对手，现场才可复现');
  assert(a.enemy.id !== 'fox', '对手不应该是自己');
});

test('可以显式指定对手', () => {
  const sys = makeSystem();
  const s = sys.startBattle('fox', { enemyId: 'stone' }).state;
  assertEqual(s.enemy.id, 'stone');
  assertEqual(s.enemy.hp, 110);
});

test('未知怪物 id 被拦下且不改变状态', () => {
  const sys = makeSystem();
  const out = sys.startBattle('nope');
  assertEqual(out.ok, false);
  assertEqual(out.reason, 'unknown-monster');
  assertEqual(sys.phase, 'idle');
  assertEqual(sys.getBattleState().player, null);
});

test('未知的对手 id 同样被拦下', () => {
  const sys = makeSystem();
  const out = sys.startBattle('fox', { enemyId: 'nope' });
  assertEqual(out.ok, false);
  assertEqual(out.reason, 'unknown-monster');
  assertEqual(sys.phase, 'idle');
});

test('空 id / 非字符串也被拦下', () => {
  const sys = makeSystem();
  assertEqual(sys.startBattle('').ok, false);
  assertEqual(sys.startBattle(null).ok, false);
  assertEqual(sys.startBattle(undefined).ok, false);
});

test('可以重复开局，血量会重置', () => {
  const sys = makeSystem();
  sys.startBattle('fox');
  sys.playerAttack();
  const damaged = sys.getBattleState().enemy.hp;
  assert(damaged < 68, '应当已经扣血');

  const again = sys.startBattle('fox', { enemyId: 'stone' });
  assertEqual(again.state.enemy.hp, 110, '重新开局后血量回到满值');
  assertEqual(again.state.stats.playerAttacks, 0, '统计也要清零');
});

/* ================================================================
 * 4. playerAttack：扣血与冷却
 * ================================================================ */
group('4. 玩家攻击 playerAttack() 与血量变化');

test('未开局就攻击会被拦下', () => {
  const sys = makeSystem();
  const out = sys.playerAttack();
  assertEqual(out.ok, false);
  assertEqual(out.reason, 'not-started');
});

test('一次攻击按公式扣掉敌方血量', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'stone' });
  const out = sys.playerAttack();

  assert(out.ok, '应当命中');
  assertEqual(out.damage, computeDamage(14, 0), '焰狐 dps14 打 0 防 = 14');
  assertEqual(out.enemyHp, 110 - 14);
  assertEqual(out.killed, false);
  assertEqual(sys.getBattleState().enemy.hp, 96);
  assertEqual(sys.getBattleState().stats.damageDealt, 14);
});

test('冷却期内连点被拦下，冷却结束后恢复', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'stone' });
  sys.playerAttack();

  const blocked = sys.playerAttack();
  assertEqual(blocked.ok, false);
  assertEqual(blocked.reason, 'cooldown');
  assert(blocked.remaining > 0, '应当告知还要等多久');
  assertEqual(sys.getBattleState().stats.playerAttacks, 1, '被拦下的攻击不计入统计');

  tick(sys, 4); // 注意不能写 update(0.5)：单帧上限 maxDelta 会把它夹成 0.1s
  assert(sys.playerAttack().ok, '冷却结束后应当能再打');
});

test('速度越高的怪出手越快（采样 10 次攻击的耗时）', () => {
  const slow = makeSystem();
  slow.startBattle('stone', { enemyId: 'brute' });
  const fast = makeSystem();
  fast.startBattle('fox', { enemyId: 'brute' });

  let slowSteps = 0;
  let fastSteps = 0;
  for (let i = 0; i < 10; i++) {
    // 加退出条件：对手可能在中途被打死，战斗结束后 playerAttack 永远返回失败，
    // 没有上限的话这里会死循环（原实现缺这个保护）
    let guard = 0;
    while (!slow.playerAttack().ok && slow.phase === 'playing' && guard++ < 500) {
      slow.update(0.1);
      slowSteps += 1;
    }
    guard = 0;
    while (!fast.playerAttack().ok && fast.phase === 'playing' && guard++ < 500) {
      fast.update(0.1);
      fastSteps += 1;
    }
    if (slow.phase !== 'playing' || fast.phase !== 'playing') break;
  }
  assert(fastSteps < slowSteps, `焰狐(110) 应比 石灵(55) 快：fast ${fastSteps} vs slow ${slowSteps}`);
});

test('一次攻击最多打掉剩余血量，不会出现负数血量', () => {
  const sys = makeSystem();
  sys.startBattle('bird', { enemyId: 'stone' });
  for (let i = 0; i < 20 && sys.phase === 'playing'; i++) {
    sys.playerAttack();
    sys.update(0.4);
  }
  assertEqual(sys.getBattleState().enemy.hp, 0, '血量地板是 0');
});

/* ================================================================
 * 5. 敌人定时反击
 * ================================================================ */
group('5. 敌人定时攻击（简单 AI）');

test(`开场有宽限期：${RULES.enemyFirstAttackDelay} 秒内敌人不出手`, () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'bird' });
  // 差一步到宽限结束，避免踩 0.1 累加的浮点边界
  tick(sys, Math.round(RULES.enemyFirstAttackDelay * 10) - 1);
  assertEqual(sys.getBattleState().stats.enemyAttacks, 0, '宽限期内不应挨打');
  assertEqual(sys.getBattleState().player.hp, 42);
});

test('到了时间敌人就出手，玩家血量下降', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'bird' });
  // 多推一步，确保跨过宽限点；此时距离敌人第二次出手还早
  tick(sys, Math.round(RULES.enemyFirstAttackDelay * 10) + 1);
  const s = sys.getBattleState();

  assertEqual(s.stats.enemyAttacks, 1);
  assertEqual(s.player.hp, 42 - 26, '雷鸟 dps26 → 扣 26');
  assertEqual(s.stats.damageTaken, 26);
  assertEqual(s.phase, 'playing');
});

test('state.enemy.nextAttackIn 会随推进倒计时', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'bird' });
  const before = sys.getBattleState().enemy.nextAttackIn;
  tick(sys, 5);
  const after = sys.getBattleState().enemy.nextAttackIn;
  assert(after < before, `倒计时应当变小：${before} → ${after}`);
  assertClose(before - after, 0.5, 1e-6, '推进 0.5s 就减 0.5');
});

test('敌人出手间隔受自身速度影响', () => {
  const fastEnemy = makeSystem();
  fastEnemy.startBattle('brute', { enemyId: 'bird' });   // speed 95
  const slowEnemy = makeSystem();
  slowEnemy.startBattle('brute', { enemyId: 'stone' });  // speed 55

  tick(fastEnemy, 40);
  tick(slowEnemy, 40);
  assert(
    fastEnemy.getBattleState().stats.enemyAttacks > slowEnemy.getBattleState().stats.enemyAttacks,
    '同样 4 秒内，速度快的敌人出手次数应当更多',
  );
});

test('战斗没开始时 update 不推进、不报错', () => {
  const sys = makeSystem();
  const out = sys.update(1);
  assertEqual(out.ok, false);
  assertEqual(out.reason, 'not-started');
  assertEqual(sys.getBattleState().time, 0);
});

test('单帧巨额 dt 被夹住，不会一次跳完整场战斗', () => {
  const sys = makeSystem();
  sys.startBattle('brute', { enemyId: 'stone' });
  sys.update(9999);
  const s = sys.getBattleState();
  assert(s.time <= RULES.maxDelta, `时间只应推进 ${RULES.maxDelta}s，实际 ${s.time}`);
  assertEqual(s.stats.enemyAttacks, 0, '不应因为一帧就挨打');
});

test('每第 3 次攻击是重击，伤害更高', () => {
  const sys = makeSystem();
  sys.startBattle('brute', { enemyId: 'stone' }); // 石灵 dps7 speed55 → 间隔 1.1×1.0909 ≈ 1.2s
  tick(sys, 42); // t = 4.2s，正好挨满 3 下

  const s = sys.getBattleState();
  assertEqual(s.stats.enemyAttacks, 3, '4.2 秒内应当出手 3 次');
  assertEqual(s.stats.damageTaken, 7 + 7 + 11, '第三次是 7×1.5=10.5 四舍五入为 11');
  assertEqual(s.player.hp, 180 - 25);

  const heavies = s.log.filter((e) => e.type === 'enemy-attack' && e.heavy);
  assertEqual(heavies.length, 1, '应当正好一次重击');
  assertEqual(heavies[0].damage, 11);
});

test('heavyNext 会预告下一次是不是重击', () => {
  const sys = makeSystem();
  sys.startBattle('brute', { enemyId: 'stone' });
  assertEqual(sys.getBattleState().enemy.heavyNext, false, '第 1 次不是重击');
  tick(sys, 18); // 挨第 1 下
  assertEqual(sys.getBattleState().enemy.heavyNext, false, '第 2 次不是重击');
  tick(sys, 12); // 挨第 2 下
  assertEqual(sys.getBattleState().enemy.heavyNext, true, '第 3 次是重击');
});

/* ================================================================
 * 6. 胜负判定
 * ================================================================ */
group('6. 胜负判定');

test('打空敌方血量 → 胜', () => {
  const sys = makeSystem();
  sys.startBattle('bird', { enemyId: 'stone' }); // 雷鸟 26 伤，石灵 110 血 → 5 下

  let hits = 0;
  while (sys.phase === 'playing' && hits < 20) {
    const out = sys.playerAttack();
    if (out.ok) hits += 1;
    sys.update(0.4);
  }

  const s = sys.getBattleState();
  assertEqual(hits, 5, '110 / 26 → 需要 5 下');
  assertEqual(s.phase, 'win');
  assertEqual(s.result, 'win');
  assertEqual(s.over, true);
  assertEqual(s.enemy.hp, 0);
  assertEqual(s.stats.damageDealt, 130, '最后一击只结算到打空为止（26×5）');
  assertEqual(s.stats.enemyAttacks <= 1, true, '速胜：敌人最多还手一次');
});

test('玩家血量被打空 → 负', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'bird' }); // 焰狐 42 血，雷鸟每下 26

  const steps = tickUntilOver(sys);
  const s = sys.getBattleState();

  assertEqual(s.phase, 'lose');
  assertEqual(s.result, 'lose');
  assertEqual(s.over, true);
  assertEqual(s.player.hp, 0);
  assertEqual(s.stats.enemyAttacks, 2, '42 血挨两下 26');
  // 宽限 0.9s + 雷鸟间隔约 0.7s，第二下在 1.6s 左右；
  // 用区间而不是精确步数，避免 0.1 累加的浮点误差把测试变得脆弱
  assert(steps >= 10 && steps <= 20, `应当在 1~2 秒内结束，实际第 ${steps} 步`);
});

test('结束之后再攻击会被拦下并带回结果', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'bird' });
  tickUntilOver(sys);

  const attack = sys.playerAttack();
  assertEqual(attack.ok, false);
  assertEqual(attack.reason, 'battle-over');
  assertEqual(attack.result, 'lose');

  const skill = sys.playerSkill();
  assertEqual(skill.ok, false);
  assertEqual(skill.reason, 'battle-over');
});

test('胜负只结算一次，onEnd 只回调一次', () => {
  let endCalls = 0;
  let lastResult = null;
  const sys = makeSystem({
    onEnd: (result) => { endCalls += 1; lastResult = result; },
  });
  sys.startBattle('bird', { enemyId: 'stone' });
  for (let i = 0; i < 40 && sys.phase === 'playing'; i++) {
    sys.playerAttack();
    sys.update(0.4);
  }
  tick(sys, 20); // 结束后继续推进也不应再次结算

  assertEqual(endCalls, 1);
  assertEqual(lastResult, 'win');
});

test('onEnd 回调抛错不会把战斗带崩', () => {
  const sys = makeSystem({
    onEnd: () => { throw new Error('故意的'); },
  });
  sys.startBattle('bird', { enemyId: 'stone' });

  // 模块内部会 console.error 报告这次失败，这里临时收起来，避免污染 CI/终端输出。
  const captured = [];
  const originalErrorAgain = console.error;
  console.error = (...args) => captured.push(args.join(' '));
  try {
    for (let i = 0; i < 40 && sys.phase === 'playing'; i++) {
      sys.playerAttack();
      sys.update(0.4);
    }
  } finally {
    console.error = originalErrorAgain;
  }

  assertEqual(sys.phase, 'win', '回调抛错后状态依然正确');
  assert(
    captured.some((line) => line.includes('onEnd 回调抛错')),
    '回调失败应当被报出来，而不是被静默吞掉',
  );
});

test('双方血量都会显示在状态里，且比例正确', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'stone' });
  sys.playerAttack();
  const s = sys.getBattleState();
  assertEqual(s.player.hpRatio, 1);
  assertClose(s.enemy.hpRatio, 96 / 110, 1e-9);
});

/* ================================================================
 * 7. 技能
 * ================================================================ */
group('7. 玩家技能 playerSkill()');

test('技能造成倍率伤害', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'stone' });
  // 开局技能带预热冷却（避免一进场就秒杀），先推过它
  tick(sys, Math.ceil(RULES.playerSkillInitialCooldown * 10) + 1);
  const out = sys.playerSkill();
  assert(out.ok);
  assertEqual(out.damage, computeDamage(14 * 1.8, 0), '14×1.8=25.2 → 25');
  assertEqual(out.damage, 25);
  assertEqual(sys.getBattleState().stats.playerSkills, 1);
});

test('技能冷却与普攻冷却互相独立', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'stone' });
  sys.playerSkill();

  const blocked = sys.playerSkill();
  assertEqual(blocked.ok, false);
  assertEqual(blocked.reason, 'cooldown');

  assert(sys.playerAttack().ok, '技能冷却不该挡住普攻');
});

test('技能冷却结束后可再次释放', () => {
  const sys = makeSystem();
  sys.startBattle('brute', { enemyId: 'stone' });
  sys.playerSkill();
  assertEqual(sys.getBattleState().player.skillReady, false);
  tick(sys, Math.ceil(RULES.playerSkillCooldown / RULES.maxDelta) + 1);
  assertEqual(sys.getBattleState().player.skillReady, true);
  assert(sys.playerSkill().ok);
});

test('技能也能打出胜利', () => {
  const sys = makeSystem();
  sys.startBattle('brute', { enemyId: 'stone' }); // 技能 16×1.8=28.8 → 29，石灵 110 血 → 4 下
  let guard = 20;
  while (sys.phase === 'playing' && guard-- > 0) {
    if (!sys.playerSkill().ok) tick(sys, Math.ceil(RULES.playerSkillCooldown / RULES.maxDelta) + 1);
  }
  assertEqual(sys.phase, 'win', `技能应能击杀，实际 ${sys.phase}`);
});

/* ================================================================
 * 8. 状态隔离与重置
 * ================================================================ */
group('8. 状态快照隔离与 resetBattle()');

test('getBattleState 返回的是拷贝，外部乱改不影响内部', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'stone' });

  const baseline = sys.getBattleState();
  const logBefore = baseline.log.length; // startBattle 会记一条 start，所以不是 0

  const tampered = sys.getBattleState();
  tampered.player.hp = 9999;
  tampered.enemy.hp = -1;
  tampered.stats.damageDealt = 123456;
  tampered.log.push({ type: 'fake' });

  const fresh = sys.getBattleState();
  assertEqual(fresh.player.hp, 42, '外部改不动玩家血量');
  assertEqual(fresh.enemy.hp, 110, '外部改不动敌方血量');
  assertEqual(fresh.stats.damageDealt, 0);
  assertEqual(fresh.log.length, logBefore, '外部往里塞的日志不该留下');
  assert(!fresh.log.some((e) => e.type === 'fake'), '假事件不该出现');
});

test('状态可以直接 JSON 序列化（方便传 UI / 存日志）', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'stone' });
  sys.playerAttack();
  const round = JSON.parse(JSON.stringify(sys.getBattleState()));
  assertEqual(round.player.id, 'fox');
  assertEqual(round.enemy.hp, 96);
});

test('未开局时的状态也是合法结构', () => {
  const sys = makeSystem();
  const s = sys.getBattleState();
  assertEqual(s.phase, 'idle');
  assertEqual(s.result, null);
  assertEqual(s.player, null);
  assertEqual(s.enemy, null);
  assert(JSON.stringify(s).length > 0);
});

test('resetBattle 回到未开局，并且能重新开一局', () => {
  const sys = makeSystem();
  sys.startBattle('fox', { enemyId: 'bird' });
  tickUntilOver(sys);
  assertEqual(sys.phase, 'lose');

  const out = sys.resetBattle();
  assert(out.ok);
  assertEqual(sys.phase, 'idle');
  assertEqual(sys.result, null);
  assertEqual(sys.getBattleState().player, null);

  assertEqual(sys.playerAttack().reason, 'not-started', '重置后攻击应被拦下');
  assert(sys.startBattle('brute').ok, '重置后应当能重新开局');
  assertEqual(sys.getBattleState().player.hp, 180);
});

test('日志有上限，长时间跑不会无限增长', () => {
  const sys = makeSystem();
  sys.startBattle('brute', { enemyId: 'stone' });
  tick(sys, 400);
  assert(sys.getBattleState().log.length <= RULES.logLimit, `日志应被裁剪到 ${RULES.logLimit} 条以内`);
});

/* ================================================================
 * 9. 模块级接口（任务书点名的四个函数）
 * ================================================================ */
group('9. 任务书点名的模块级接口');

test('startBattle / playerAttack / getBattleState / resetBattle 可直接 import 使用', () => {
  // 本地没有 B 的文件，所以手动喂一份表给模块级默认实例；真机上不需要这一步
  configureDefaultBattle({ monsters: FIXTURE });
  resetBattle();

  const started = startBattle('fox');
  assert(started.ok, 'startBattle 应当可用');

  const attacked = playerAttack();
  assert(attacked.ok, 'playerAttack 应当可用');

  const state = getBattleState();
  assertEqual(state.phase, 'playing');
  assert(state.player.hp > 0);
  assert(state.enemy.hp > 0);

  resetBattle();
  assertEqual(getBattleState().phase, 'idle');
});

test('只用模块级接口就能跑完一整场（含敌人反击与失败判定）', () => {
  configureDefaultBattle({ monsters: FIXTURE });
  resetBattle();
  startBattle('fox', { enemyId: 'bird' }); // 焰狐不还手，看雷鸟把自己打死

  let guard = 100;
  while (getBattleState().phase === 'playing' && guard-- > 0) updateBattle(0.1);

  const s = getBattleState();
  assertEqual(s.phase, 'lose', '不还手应当落败');
  assertEqual(s.result, 'lose');
  assertEqual(s.player.hp, 0);
  assert(s.stats.enemyAttacks >= 2, '敌人应当反击过至少两次');
  assertEqual(s.enemy.hp, 68, '敌方应当毫发无损');
});

test('createBattleSystem 能建出互不干扰的多个实例', () => {
  const a = createBattleSystem({ monsters: FIXTURE });
  const b = createBattleSystem({ monsters: FIXTURE });
  a.startBattle('fox', { enemyId: 'stone' });
  b.startBattle('brute', { enemyId: 'stone' });

  a.playerAttack();
  assertEqual(b.getBattleState().player.id, 'brute');
  assertEqual(b.getBattleState().stats.playerAttacks, 0, 'A 的攻击不该污染 B');
});

test('listRoster 给出可用的怪物清单（给选择界面用）', () => {
  const sys = makeSystem();
  const roster = sys.listRoster();
  assertEqual(roster.length, 4);
  assert(roster.every((m) => typeof m.id === 'string' && m.maxHp > 0));
  roster[0].maxHp = -1;
  assertEqual(sys.listRoster()[0].maxHp, 110, '拿到的也是拷贝');
});

test('自定义 RULES 可以覆盖数值旋钮', () => {
  const sys = new BattleSystem({
    monsters: FIXTURE,
    rules: { playerAttackCooldown: 0, enemyFirstAttackDelay: 0.1 },
  });
  sys.startBattle('fox', { enemyId: 'stone' });
  for (let i = 0; i < 5; i++) assert(sys.playerAttack().ok, '冷却为 0 时可以连续出拳');
  tick(sys, 1);
  assertEqual(sys.getBattleState().stats.enemyAttacks, 1, '宽限期被改短后立刻挨打');
});

/* ================================================================
 * 10. 分层守卫：战斗层不许碰 UI / 摄像头
 * ================================================================ */
group('10. 分层守卫（战斗层不碰 DOM / 摄像头 / 手势识别）');

const source = await (await import('node:fs/promises')).readFile(
  new URL('./battle-system.js', import.meta.url),
  'utf8',
);

/** 去掉注释再扫，避免注释里提到某个词就误报 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const codeOnly = stripComments(source);

test('不直接操作 DOM', () => {
  for (const token of ['document.', 'window.', 'addEventListener', 'querySelector', 'getContext']) {
    assert(!codeOnly.includes(token), `战斗层不应出现 ${token}`);
  }
});

test('不依赖 Three.js 或任何渲染库', () => {
  for (const token of ['THREE', 'requestAnimationFrame', 'WebGL']) {
    assert(!codeOnly.includes(token), `战斗层不应出现 ${token}`);
  }
});

test('不重复实现手势识别 / 摄像头', () => {
  for (const token of ['getUserMedia', 'MediaStream', 'recognize(', 'gesture-canvas', 'gesture-recognizer']) {
    assert(!codeOnly.includes(token), `战斗层不应出现 ${token}`);
  }
});

test('不 import ui/ 目录（分层要求：battle/ 不能依赖 ui/）', () => {
  const imports = [...codeOnly.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const dynamicImports = [...codeOnly.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const spec of [...imports, ...dynamicImports]) {
    assert(!spec.includes('/ui/') && !spec.startsWith('../ui'), `不应 import ${spec}`);
  }
});

test('没有随机数：同样的操作序列必须得到同样的结果', () => {
  assert(!codeOnly.includes('Math.random'), '战斗结算必须是确定性的，现场才可复现');
});

/* ================================================================
 * 11. 可选：接上 B 的真实怪物表
 * ================================================================ */
group('11. 与上游真实怪物表联调');

let upstream = null;
try {
  upstream = await import('../summon/creature-data.js');
} catch {
  upstream = null;
}

if (upstream && Array.isArray(upstream.CREATURES) && upstream.CREATURES.length > 0) {
  test('用 B 的真实 CREATURES 能打完一整场', () => {
    const sys = new BattleSystem(); // 不注入，走默认上游表
    const first = upstream.CREATURES[0];
    const started = sys.startBattle(first.id);
    assert(started.ok, `应当能用 ${first.id} 开局`);
    assertEqual(sys.getBattleState().player.maxHp, first.hp);

    const steps = tickUntilOver(sys);
    assert(steps > 0 && sys.phase !== 'playing', '应当正常分出胜负');
    assert(['win', 'lose'].includes(sys.getBattleState().result));
  });

  test('真实数据的每一只都能开局', () => {
    for (const def of upstream.CREATURES) {
      const sys = new BattleSystem();
      assert(sys.startBattle(def.id).ok, `${def.id} 应当能开局`);
    }
  });
} else {
  skip('用 B 的真实 CREATURES 能打完一整场', '本地没有 src/summon/creature-data.js');
  skip('真实数据的每一只都能开局', '本地没有 src/summon/creature-data.js');
}

/* ================================================================
 * 汇总
 * ================================================================ */

console.log('\n' + '─'.repeat(56));
if (warnings.length > 0) {
  console.log(`模块加载期提示 ${warnings.length} 条（独立单测时属正常）：`);
  for (const w of warnings) console.log(`  · ${w}`);
}
if (skips.length > 0) {
  console.log(`跳过 ${skips.length} 项：`);
  for (const s of skips) console.log(`  · ${s}`);
}
console.log(`通过 ${passed} 项，失败 ${failures.length} 项。`);

if (failures.length > 0) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ [${f.group}] ${f.name}\n      ${f.message}`);
  process.exitCode = 1;
} else {
  console.log('战斗系统全部用例通过 ✅');
}