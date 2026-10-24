/**
 * 战斗系统命令行演示
 * ==================================================================
 * 跑法：node src/battle/demo.mjs
 *
 * 不需要摄像头、浏览器、WebGL —— 纯逻辑推演，把一场战斗逐步打印出来。
 * 用途有两个：
 *   1. 验收：肉眼确认「开始战斗 → 攻击 → 血量变化 → 敌人反击 → 胜负判定」整条链路
 *   2. 现场彩排：不接摄像头也能先把数值和节奏过一遍
 */

/* ---------------- 载入模块 ----------------
 * 用动态 import，是为了把「上游怪物表不在」这条加载期提示收起来，
 * 换成末尾一句友好说明 —— 否则终端里会多出一段像报错的堆栈。
 * 真机上 B 的 src/summon/creature-data.js 存在，这条提示根本不会出现。
 */
const notices = [];
const originalWarn = console.warn;
console.warn = (...args) => notices.push(args.join(' '));

const {
  BattleSystem,
  attackIntervalFor,
  computeDamage,
  configureDefaultBattle,
  getBattleState,
  playerAttack,
  resetBattle,
  startBattle,
  updateBattle,
  RULES,
} = await import('./battle-system.js');
const { FIXTURE } = await import('./fixture.mjs');

console.warn = originalWarn;

const STEP = 0.1; // 和主循环 dt 同量级

/* ---------------- 打印小工具 ---------------- */

const line = (char = '─', n = 64) => char.repeat(n);

function bar(hp, maxHp, width = 18) {
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function hpText(unit) {
  return `${bar(unit.hp, unit.maxHp)} ${String(unit.hp).padStart(3)}/${unit.maxHp}`;
}

function stamp(t) {
  return `t=${t.toFixed(2).padStart(5)}s`;
}

/* ---------------- 演示 1：用类实例，逐步打印整场战斗 ---------------- */

function duel({ playerId, enemyId, useSkill = false, title }) {
  console.log(`\n${line('═')}`);
  console.log(`演示：${title}`);
  console.log(line('═'));

  const events = [];
  const sys = new BattleSystem({
    monsters: FIXTURE,
    onEvent: (event) => events.push(event),
  });

  const started = sys.startBattle(playerId, { enemyId });
  if (!started.ok) {
    console.log(`开局失败：${started.reason}`);
    return;
  }

  const p = started.state.player;
  const e = started.state.enemy;
  console.log(`我方 ${p.name}（${p.id}）   HP ${p.maxHp}  攻 ${p.attack}  速 ${p.speed}  出手间隔 ${attackIntervalFor(p.speed, RULES.playerAttackCooldown).toFixed(2)}s`);
  console.log(`敌方 ${e.name}（${e.id}）   HP ${e.maxHp}  攻 ${e.attack}  速 ${e.speed}  出手间隔 ${attackIntervalFor(e.speed, RULES.enemyAttackInterval).toFixed(2)}s`);
  console.log(`敌人第一次出手宽限：${RULES.enemyFirstAttackDelay}s`);

  // 模拟一个"看到冷却好了就出手"的玩家，直到分出胜负。
  let guard = 4000;
  while (sys.phase === 'playing' && guard-- > 0) {
    // 模拟一个"看到冷却好了就出手"的玩家；结果统一由 onEvent 打印
    if (useSkill) sys.playerSkill(); else sys.playerAttack();
    sys.update(STEP);
  }

  console.log(line());
  for (const event of events) {
    if (event.type === 'start') continue;
    const t = stamp(event.t ?? 0);
    if (event.type === 'player-attack') {
      console.log(`${t}  我方普攻  → 造成 ${String(event.damage).padStart(3)} 伤害   敌方剩余 ${event.enemyHp}/${event.enemyMaxHp}`);
    } else if (event.type === 'player-skill') {
      console.log(`${t}  我方技能  → 造成 ${String(event.damage).padStart(3)} 伤害   敌方剩余 ${event.enemyHp}/${event.enemyMaxHp}`);
    } else if (event.type === 'enemy-attack') {
      const tag = event.heavy ? '敌方重击' : '敌方普攻';
      console.log(`${t}  ${tag}  → 造成 ${String(event.damage).padStart(3)} 伤害   我方剩余 ${event.playerHp}/${event.playerMaxHp}`);
    }
  }

  const final = sys.getBattleState();
  console.log(line());
  console.log(`  我方 ${hpText(final.player)}`);
  console.log(`  敌方 ${hpText(final.enemy)}`);
  console.log(`  用时 ${final.time.toFixed(1)}s   回合 ${final.round}   我方出手 ${final.stats.playerAttacks} 次   敌方出手 ${final.stats.enemyAttacks} 次`);
  console.log(`  结果：${final.result === 'win' ? '胜利 🏆' : '失败 💀'}`);
}

/* ---------------- 演示 2：只用任务书点名的四个模块级接口 ---------------- */

function moduleApiDuel() {
  console.log(`\n${line('═')}`);
  console.log('演示：只用任务书点名的模块级接口（startBattle / playerAttack / getBattleState / resetBattle）');
  console.log(line('═'));

  // 真机上不需要这一行：B 的 CREATURES 会被自动读取。
  // 这里手动喂一份，是为了在没有 src/summon/ 的情况下也能独立演示。
  configureDefaultBattle({ monsters: FIXTURE });

  resetBattle();
  console.log(`resetBattle()          → phase = ${getBattleState().phase}`);

  const started = startBattle('fox', { enemyId: 'bird' });
  console.log(`startBattle('fox')     → ok = ${started.ok}，我方 ${started.state.player.name} vs 敌方 ${started.state.enemy.name}`);

  const first = playerAttack();
  console.log(`playerAttack()         → ok = ${first.ok}，造成 ${first.damage} 伤害，敌方剩 ${first.enemyHp}`);

  const blocked = playerAttack();
  console.log(`playerAttack()（连点）→ ok = ${blocked.ok}，reason = ${blocked.reason}，还需等 ${blocked.remaining}s`);

  console.log('… 焰狐这一局不还手，等雷鸟把自己打死 …');
  let guard = 200;
  while (getBattleState().phase === 'playing' && guard-- > 0) updateBattle(STEP);

  const s = getBattleState();
  console.log(`getBattleState()       → phase = ${s.phase}，result = ${s.result}，我方 ${s.player.hp}/${s.player.maxHp}，敌方 ${s.enemy.hp}/${s.enemy.maxHp}`);
  console.log(`                         敌方出手 ${s.stats.enemyAttacks} 次，我方共掉血 ${s.stats.damageTaken}`);

  resetBattle();
  console.log(`resetBattle()          → phase = ${getBattleState().phase}`);
}

/* ---------------- 演示 3：纯函数验算（贴伤害表，方便对照） ---------------- */

function damageTable() {
  console.log(`\n${line('═')}`);
  console.log('伤害公式验算：攻击 × (100 / (100 + 防御))');
  console.log(line('═'));
  console.log('  攻击\\防御      0    50   100   200   400');
  for (const attack of [10, 26, 50, 100]) {
    const row = [0, 50, 100, 200, 400]
      .map((def) => String(computeDamage(attack, def)).padStart(5))
      .join('');
    console.log(`  ${String(attack).padStart(6)}      ${row}`);
  }
  console.log('  说明：防御 100 时伤害减半；无论防御多高都至少打出 1 点，不会卡成打不动。');
}

/* ---------------- 跑起来 ---------------- */

console.log(line('═'));
console.log('Gesture Arena · 战斗系统演示（不依赖摄像头）');
console.log(line('═'));
if (notices.length > 0) {
  console.log('说明：本地没有 src/summon/creature-data.js，演示改用 fixture.mjs 里同字段同数值的表；');
  console.log('      真机接入会自动读取 B 的 CREATURES，不需要额外接线。');
  console.log(line());
}
console.log('怪物表：');
for (const m of FIXTURE) {
  console.log(`  · ${m.id.padEnd(6)} ${m.name}   HP ${String(m.hp).padStart(3)}  攻 ${String(m.dps).padStart(2)}  速 ${String(m.speed).padStart(3)}  ${m.glyph}`);
}

damageTable();
duel({ playerId: 'bird', enemyId: 'stone', title: '雷鸟（高速高攻） vs 石灵（高血）→ 应当速胜' });
duel({ playerId: 'stone', enemyId: 'brute', title: '石灵（低攻高血） vs 巨魔 → 输出不够，应当落败' });
duel({ playerId: 'brute', enemyId: 'stone', useSkill: true, title: '巨魔（高血）用技能 vs 石灵 → 打满重击节奏' });
moduleApiDuel();

console.log(`\n${line('═')}`);
console.log('演示结束。测试请跑：node src/battle/battle-system.test.mjs');
console.log(line('═'));