/**
 * 模块 B 自检（不需要摄像头、不需要浏览器）
 *   node tests/hand.test.mjs
 */

import { classifyPose, POSES } from '../src/input/hand/poses.js';
import { PoseStabilizer, holdProgress } from '../src/input/hand/stabilizer.js';
import { poseToEvent, createHandInput, DEFAULT_MAPPING } from '../src/input/hand/index.js';

let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  →  ' + detail : ''}`); }
}

/* ---------------------------------------------------------------- 造一只假手 */

const MCPS = [
  { x: 0.070, y: -0.150 },   // 食指根
  { x: 0.010, y: -0.165 },   // 中指根
  { x: -0.050, y: -0.155 },  // 无名指根
  { x: -0.105, y: -0.135 },  // 小指根
];

/**
 * 生成 21 个关键点。
 * 伸直：指尖比关节更远离手腕；弯曲：指尖收回到指根附近。
 */
function makeHand({ fingers = [false, false, false, false], thumb = false, zoom = 1 } = {}) {
  const lm = new Array(21);

  lm[0] = { x: 0, y: 0, z: 0 };

  // 拇指 1..4
  const thumbTip = thumb ? { x: 0.16, y: -0.20 } : { x: 0.08, y: -0.14 };
  lm[1] = { x: 0.020, y: -0.055, z: 0 };
  lm[2] = { x: 0.050, y: -0.085, z: 0 };
  lm[3] = { x: 0.085, y: -0.120, z: 0 };
  lm[4] = { ...thumbTip, z: 0 };

  // 四根手指 5..20
  MCPS.forEach((mcp, i) => {
    const len = Math.hypot(mcp.x, mcp.y);
    const ux = mcp.x / len;
    const uy = mcp.y / len;
    const base = 5 + i * 4;

    const pip = { x: mcp.x + ux * 0.055, y: mcp.y + uy * 0.055 };
    const dip = fingers[i]
      ? { x: mcp.x + ux * 0.085, y: mcp.y + uy * 0.085 }
      : { x: mcp.x + ux * 0.062, y: mcp.y + uy * 0.062 };
    const tip = fingers[i]
      ? { x: mcp.x + ux * 0.110, y: mcp.y + uy * 0.110 }
      : { x: mcp.x + ux * 0.018, y: mcp.y + uy * 0.018 };

    lm[base] = { ...mcp, z: 0 };
    lm[base + 1] = { ...pip, z: 0 };
    lm[base + 2] = { ...dip, z: 0 };
    lm[base + 3] = { ...tip, z: 0 };
  });

  if (zoom !== 1) for (const p of lm) { p.x *= zoom; p.y *= zoom; }
  return lm;
}

/* ---------------------------------------------------------------- 分类 */

console.log('\n[1] 手势分类');
{
  const mk = (f, t) => classifyPose(makeHand({ fingers: f, thumb: t }));

  ok('五指张开 → open_palm', mk([1, 1, 1, 1], true).pose === POSES.OPEN_PALM);
  ok('握拳 → fist', mk([0, 0, 0, 0], false).pose === POSES.FIST);
  ok('食指 → one', mk([1, 0, 0, 0], true).pose === POSES.ONE);
  ok('食指+中指 → two', mk([1, 1, 0, 0], true).pose === POSES.TWO);
  ok('三指 → three', mk([1, 1, 1, 0], true).pose === POSES.THREE);

  ok('只竖小指 → none', mk([0, 0, 0, 1], false).pose === POSES.NONE);
  ok('食指+无名指 → none', mk([1, 0, 1, 0], false).pose === POSES.NONE);
  ok('竖四指但没拇指 → 仍算 open_palm', mk([1, 1, 1, 1], false).pose === POSES.OPEN_PALM);

  const small = classifyPose(makeHand({ fingers: [1, 1, 1, 1], zoom: 0.18 }));
  ok('手离镜头太远 → none', small.pose === POSES.NONE, small.reason);

  const empty = classifyPose(null);
  ok('没有关键点 → none', empty.pose === POSES.NONE);
}

/* ---------------------------------------------------------------- 稳定器 */

console.log('\n[2] 稳定与去重');
{
  const s = new PoseStabilizer({ stableMs: 260, releaseMs: 180 });

  ok('刚开始不触发', s.push('one', 0) === null);
  ok('100ms 不触发', s.push('one', 100) === null);
  ok('259ms 不触发', s.push('one', 259) === null);
  ok('261ms 触发一次', s.push('one', 261) === 'one');

  let repeats = 0;
  for (let t = 280; t <= 1200; t += 16) if (s.push('one', t)) repeats++;
  ok('一直举着不重复触发', repeats === 0, `又触发了 ${repeats} 次`);

  ok('换成 none 不触发', s.push('none', 1220) === null);
  ok('none 不足 180ms 不解锁', s.push('fist', 1300) === null);
  ok('换成 fist 且保持够久 → 触发', s.push('fist', 1560) === 'fist');

  // 抖动：只出现一帧的毛刺不能触发
  const f = new PoseStabilizer({ stableMs: 260, releaseMs: 180 });
  f.push('one', 0);
  f.push('one', 100);
  f.push('fist', 120);      // 毛刺
  f.push('one', 140);       // 回到 one，计时重来
  ok('单帧毛刺不触发', f.push('one', 300) === null);

  ok('保持进度 0 当刚开始', holdProgress(f, 140) === 0);
  ok('保持进度随时间长', holdProgress(f, 270) > 0 && holdProgress(f, 400) === 1);

  s.reset();
  ok('reset 后重新计时', s.push('one', 5000) === null && s.push('one', 5300) === 'one');
}

/* ---------------------------------------------------------------- 映射 */

console.log('\n[3] 手势 → 事件');
{
  ok('one → SELECT_MONSTER 1',
    JSON.stringify(poseToEvent('one')) === JSON.stringify({ type: 'SELECT_MONSTER', value: 1 }));
  ok('two → SELECT_MONSTER 2', poseToEvent('two').value === 2);
  ok('three → SELECT_MONSTER 3', poseToEvent('three').value === 3);
  ok('fist → ATTACK', poseToEvent('fist').type === 'ATTACK');
  ok('open_palm → CONFIRM', poseToEvent('open_palm').type === 'CONFIRM');
  ok('none 不发事件', poseToEvent('none') === null);

  const custom = { ...DEFAULT_MAPPING, fist: { type: 'CAST' } };
  ok('可自定义映射', poseToEvent('fist', custom).type === 'CAST');
}

/* ---------------------------------------------------------------- 端到端 */

console.log('\n[4] 端到端（假 tracker）');
{
  const hand = createHandInput({ overlay: false, autoTick: false, stableMs: 200, releaseMs: 100 });
  hand._setStatus('ready', 'ok');

  let frame = makeHand({ fingers: [1, 0, 0, 0], thumb: true });
  hand.tracker.read = () => ({ landmarks: frame, handedness: 'Right' });

  const events = [];
  hand.on('gesture', (e) => events.push(e));

  for (let t = 0; t <= 400; t += 16) hand.tick(t);
  ok('举食指 400ms → 收到 1 次选择', events.length === 1, `${events.length} 次`);
  ok('事件内容正确',
    events[0]?.type === 'SELECT_MONSTER' && events[0]?.value === 1 && events[0]?.gesture === 'one',
    JSON.stringify(events[0]));

  for (let t = 416; t <= 1600; t += 16) hand.tick(t);
  ok('继续举着不重复', events.length === 1);

  frame = makeHand({ fingers: [0, 0, 0, 0] });
  for (let t = 1616; t <= 2000; t += 16) hand.tick(t);
  ok('换握拳 → 收到攻击', events.length === 2 && events[1].type === 'ATTACK', JSON.stringify(events[1]));

  frame = makeHand({ fingers: [1, 1, 0, 0], thumb: true });
  for (let t = 2016; t <= 2400; t += 16) hand.tick(t);
  ok('换 2 指 → 选择 2 号',
    events.length === 3 && events[2].type === 'SELECT_MONSTER' && events[2].value === 2,
    JSON.stringify(events[2]));

  // 手离开画面
  hand.tracker.read = () => null;
  for (let t = 2416; t <= 3000; t += 16) hand.tick(t);
  ok('手离开不产生事件', events.length === 3);
}

/* ---------------------------------------------------------------- 结果 */

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
