/**
 * 决斗模式平衡自测
 * ==================================================================
 * 用法：node src/modes/duel-balance.mjs
 *
 * 模拟一个真实玩家：每 DRAW_INTERVAL 秒画完一个手势，
 * 技能就绪时优先放技能，跑满全部「生物 × 对手」组合，打印胜率矩阵。
 *
 * 为什么要有这个脚本：
 *   决斗里玩家的出手被「画一次手势」卡住，攻击力直接等于 DPS，
 *   和塔防的数值逻辑完全不同。改 config.js 里的 DUEL_STATS / DUEL_RULES
 *   之前先跑一遍，否则很容易调出「某只怪必胜」。
 *
 * 判断标准（都是真实玩家会遇到的组合，对手是自动配的下一只）：
 *   - 每一只作为玩家都要能赢
 *   - 没有对局超过 30 秒
 */

import { DuelMode } from './duel-mode.js';

/** 玩家画完一个手势的平均耗时（秒）。人类实测 0.9~1.2，取 1.0。 */
const DRAW_INTERVAL = 1.0;

/** 单局模拟的时间步长 */
const DT = 1 / 60;

/** 超过这个时间算僵持 */
const MAX_TIME = 60;

/**
 * 跑一局
 * @returns {{result:string|null, time:number, attacks:number, skills:number}}
 */
function runOne(playerId, enemyId) {
  const mode = new DuelMode();
  const started = mode.system.startBattle(playerId, { enemyId });
  if (!started.ok) throw new Error(`开局失败：${started.message}`);

  // 正常流程里由 selectMonster() 设成 playing，这里直接开战
  mode._phase = 'playing';

  let t = 0;
  let nextDraw = 0;
  let attacks = 0;
  let skills = 0;

  while (mode._phase === 'playing' && t < MAX_TIME) {
    mode.update(DT);
    t += DT;
    if (mode._phase !== 'playing') break;

    if (t >= nextDraw) {
      const ready = mode.system.getBattleState().player.skillReady;
      const out = mode.handleGesture({ id: ready ? 'v_shape' : 'line_h', score: 0 });
      if (out.ok) {
        if (ready) skills += 1;
        else attacks += 1;
      }
      nextDraw = t + DRAW_INTERVAL;
    }
  }

  const state = mode.system.getBattleState();
  return {
    result: state.result,
    time: Number(state.time.toFixed(2)),
    attacks,
    skills,
  };
}

/** 把中文按显示宽度补空格（中文占两格），让表格对齐 */
function pad(text, width) {
  let w = 0;
  for (const ch of String(text)) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  return String(text) + ' '.repeat(Math.max(0, width - w));
}

function main() {
  const roster = new DuelMode().roster;
  const names = roster.map((r) => r.name);

  console.log('\n=== 决斗生物表（实际生效值，含 DUEL_STATS 修正）===');
  for (const r of roster) {
    console.log(
      `${pad(r.name, 8)} 血 ${String(r.maxHp).padStart(3)}   攻 ${String(r.attack).padStart(2)}   速 ${String(r.speed).padStart(3)}`,
    );
  }

  const rows = [];
  for (const p of roster) {
    for (const e of roster) {
      const r = runOne(p.id, e.id);
      rows.push({ playerId: p.id, player: p.name, enemy: e.name, ...r });
    }
  }

  console.log(`\n=== 胜率矩阵（玩家每 ${DRAW_INTERVAL.toFixed(1)} 秒画一次手势）===`);
  console.log(pad('玩家\\对手', 12) + names.map((n) => pad(n, 10).padStart(10)).join(''));
  for (const p of names) {
    const cells = rows
      .filter((r) => r.player === p)
      .map((r) => {
        const tag = r.result === 'win' ? '胜' : r.result === 'lose' ? '负' : '僵';
        return pad(`${tag}${r.time.toFixed(1)}s`, 10).padStart(10);
      });
    console.log(pad(p, 12) + cells.join(''));
  }

  console.log('\n=== 各生物综合胜率 ===');
  let allWinnable = true;
  let anyTimeout = false;

  for (const p of roster) {
    const mine = rows.filter((r) => r.playerId === p.id);
    const wins = mine.filter((r) => r.result === 'win').length;
    const draws = mine.filter((r) => r.result === null).length;
    const avg = mine.reduce((s, r) => s + r.time, 0) / mine.length;
    const slow = mine.filter((r) => r.time >= MAX_TIME).length;

    if (wins === 0) allWinnable = false;
    if (draws > 0 || slow > 0) anyTimeout = true;

    const flag = wins === 0 ? '  <-- 一局都赢不了' : wins === mine.length ? '  <-- 全胜' : '';
    console.log(
      `${pad(p.name, 8)} ${wins}/${mine.length}  胜率 ${String(Math.round((wins / mine.length) * 100)).padStart(3)}%  平均 ${avg.toFixed(2)}s${flag}`,
    );
  }

  // 真实玩家只会遇到「自动配的对手」，单独列出来
  console.log('\n=== 实际会遇到的 4 个对局（对手 = 生物表里的下一只）===');
  for (const p of roster) {
    const real = rows.find((r) => r.playerId === p.id && r.enemy === nextName(roster, p.id));
    if (!real) continue;
    const tag = real.result === 'win' ? '可以赢' : real.result === 'lose' ? '会输' : '僵持';
    console.log(`${pad(p.name, 8)} 打 ${pad(real.enemy, 8)} → ${tag}  ${real.time.toFixed(1)}s`);
  }

  console.log('');
  if (!allWinnable) {
    console.log('⚠️  有生物一局都赢不了，需要调 DUEL_STATS');
    process.exitCode = 1;
  } else if (anyTimeout) {
    console.log('⚠️  有对局僵持超过上限，需要调 DUEL_STATS 或 DUEL_RULES');
    process.exitCode = 1;
  } else {
    console.log('✅ 每只生物都至少能赢一局，且没有僵持对局');
  }
}

/** 复刻 BattleSystem._pickOpponent：表里的下一只 */
function nextName(roster, playerId) {
  const index = roster.findIndex((r) => r.id === playerId);
  const next = (index + 1 + roster.length) % roster.length;
  return roster[next].name;
}

main();
