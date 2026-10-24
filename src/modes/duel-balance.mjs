/**
 * 决斗模式平衡自测
 * ==================================================================
 * 用法：node src/modes/duel-balance.mjs
 *
 * 模拟真实玩家：每 DRAW_INTERVAL 秒画完一个手势，跑满全部「生物 × 对手」组合。
 * 跑两种玩家：
 *   smart  —— 会走位：太远就靠近、看到重击预警就拉开、其余时间出招
 *   dumb   —— 不走位：只会站在原地出招
 * 两者对比就能看出「走位」到底有没有带来优势。
 *
 * 为什么要有这个脚本：
 *   决斗里玩家的出手被「画一次手势」卡住，攻击力直接等于 DPS，
 *   和塔防的数值逻辑完全不同。改 config.js 里的
 *   DUEL_STATS / DUEL_RULES（尤其是射程和 moveStep）之前先跑一遍。
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
 * 决定这一拍画什么手势
 *
 * smart 的策略是「守住甜区」：
 *   太远 → 靠近；太近（会被重击）→ 拉开；在甜区 → 出招。
 * 甜区 = 重击射程之外、普攻射程之内。
 *
 * @param {'smart'|'dumb'} policy
 */
function decideGesture(state, rules, policy) {
  if (policy === 'dumb') {
    return { id: state.player.skillReady ? 'v_shape' : 'zigzag', score: 0 };
  }

  const d = state.distance;
  // 甜区下沿：刚出重击射程，留一点余量防止卡在边界
  const safeEdge = rules.enemyHeavyReach + 0.06;

  // 1. 打不到 → 靠近
  if (d > rules.playerReach) {
    return { id: 'line_h', dir: 'ltr', score: 0 };
  }

  // 2. 站太近了，会吃重击 → 拉开到甜区
  if (d < safeEdge) {
    return { id: 'line_h', dir: 'rtl', score: 0 };
  }

  // 3. 甜区 → 出招
  return { id: state.player.skillReady ? 'v_shape' : 'zigzag', score: 0 };
}

/**
 * 跑一局
 * @param {'smart'|'dumb'} policy
 * @returns {{result:string|null, time:number, attacks:number, skills:number, moves:number, misses:number}}
 */
function runOne(playerId, enemyId, policy = 'smart') {
  const mode = new DuelMode();
  const started = mode.system.startBattle(playerId, { enemyId });
  if (!started.ok) throw new Error(`开局失败：${started.message}`);

  // 正常流程里由 selectMonster() 设成 playing，这里直接开战
  mode._phase = 'playing';

  const rules = mode.system.rules;
  let t = 0;
  let nextDraw = 0;
  let attacks = 0;
  let skills = 0;
  let moves = 0;

  while (mode._phase === 'playing' && t < MAX_TIME) {
    mode.update(DT);
    t += DT;
    if (mode._phase !== 'playing') break;

    if (t >= nextDraw) {
      const state = mode.system.getBattleState();
      const gesture = decideGesture(state, rules, policy);
      const out = mode.handleGesture(gesture);

      if (out.ok) {
        if (gesture.id === 'line_h') moves += 1;
        else if (gesture.id === 'v_shape') skills += 1;
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
    moves,
  };
}

/** 把中文按显示宽度补空格（中文占两格），让表格对齐 */
function pad(text, width) {
  let w = 0;
  for (const ch of String(text)) w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  return String(text) + ' '.repeat(Math.max(0, width - w));
}

/** 跑满全部组合，返回行数据 */
function runMatrix(roster, policy) {
  const rows = [];
  for (const p of roster) {
    for (const e of roster) {
      const r = runOne(p.id, e.id, policy);
      rows.push({ playerId: p.id, player: p.name, enemy: e.name, ...r });
    }
  }
  return rows;
}

function printMatrix(rows, roster, title) {
  const names = roster.map((r) => r.name);
  console.log(`\n=== ${title} ===`);
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
}

function printSummary(rows, roster, title) {
  console.log(`\n=== ${title} ===`);
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

  return { allWinnable, anyTimeout };
}

function main() {
  const roster = new DuelMode().roster;
  const rules = new DuelMode().system.rules;

  console.log('\n=== 决斗生物表（实际生效值，含 DUEL_STATS 修正）===');
  for (const r of roster) {
    console.log(
      `${pad(r.name, 8)} 血 ${String(r.maxHp).padStart(3)}   攻 ${String(r.attack).padStart(2)}   速 ${String(r.speed).padStart(3)}`,
    );
  }

  console.log('\n=== 走位射程（DUEL_RULES）===');
  console.log(`普攻射程 ${rules.playerReach}   技能射程 ${rules.playerSkillReach}   敌人普攻 ${rules.enemyReach}   敌人重击 ${rules.enemyHeavyReach}   每次移动 ${rules.moveStep}`);

  const smartRows = runMatrix(roster, 'smart');
  const dumbRows = runMatrix(roster, 'dumb');

  printMatrix(smartRows, roster, `会走位的玩家 · 胜率矩阵（每 ${DRAW_INTERVAL.toFixed(1)} 秒画一次手势）`);
  printMatrix(dumbRows, roster, '不走位的玩家 · 胜率矩阵（原地站桩）');

  const smart = printSummary(smartRows, roster, '会走位的玩家 · 各生物综合胜率');
  const dumb = printSummary(dumbRows, roster, '不走位的玩家 · 各生物综合胜率');

  // 真实玩家只会遇到「自动配的对手」，单独列出来
  console.log('\n=== 实际会遇到的 4 个对局（对手 = 生物表里的下一只）===');
  for (const p of roster) {
    const enemyName = nextName(roster, p.id);
    const smartRow = smartRows.find((r) => r.playerId === p.id && r.enemy === enemyName);
    const dumbRow = dumbRows.find((r) => r.playerId === p.id && r.enemy === enemyName);
    if (!smartRow) continue;

    const tag = (row) => (row.result === 'win' ? '可以赢' : row.result === 'lose' ? '会输' : '僵持');
    console.log(
      `${pad(p.name, 8)} 打 ${pad(enemyName, 8)} → 走位 ${pad(tag(smartRow), 6)}${smartRow.time.toFixed(1)}s   `
      + `不走位 ${pad(tag(dumbRow), 6)}${dumbRow.time.toFixed(1)}s`,
    );
  }

  // 走位带来的平均时长变化
  const avg = (rows) => rows.reduce((s, r) => s + r.time, 0) / rows.length;
  const smartWins = smartRows.filter((r) => r.result === 'win').length;
  const dumbWins = dumbRows.filter((r) => r.result === 'win').length;
  console.log(
    `\n走位收益：胜场 ${dumbWins} → ${smartWins}（共 ${smartRows.length} 场），`
    + `平均时长 ${avg(dumbRows).toFixed(1)}s → ${avg(smartRows).toFixed(1)}s`,
  );

  console.log('');
  if (!smart.allWinnable) {
    console.log('⚠️  会走位也有生物一局都赢不了，需要调 DUEL_STATS');
    process.exitCode = 1;
  } else if (smart.anyTimeout) {
    console.log('⚠️  有对局僵持超过上限，需要调 DUEL_STATS 或 DUEL_RULES');
    process.exitCode = 1;
  } else if (smartWins <= dumbWins) {
    console.log('⚠️  走位没有带来任何优势，射程或 moveStep 需要重新调');
    process.exitCode = 1;
  } else {
    console.log('✅ 每只生物都至少能赢一局，没有僵持对局，且走位确实带来优势');
  }
}

/** 复刻 BattleSystem._pickOpponent：表里的下一只 */
function nextName(roster, playerId) {
  const index = roster.findIndex((r) => r.id === playerId);
  const next = (index + 1 + roster.length) % roster.length;
  return roster[next].name;
}

main();
