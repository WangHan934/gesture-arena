/**
 * 伤害跳字的攒伤害逻辑测试
 * ==================================================================
 * 用法：node --test tests/damage-number.test.mjs
 *
 * 只测纯数据层（src/classic/damage-tracker.js），不碰 3D 和 canvas：
 *   · 决斗是整块伤害，必须立刻跳
 *   · 塔防是 dps × dt 的碎伤害，必须攒够时间片再跳整数
 *   · 换局 / 换生物（血量上限变了或血回满）不能误跳成「受伤」
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DamageTracker, MIN_DAMAGE, TOWER_FLUSH_INTERVAL } from '../src/classic/damage-tracker.js';

test('第一次见到单位只登记，不跳字', () => {
  const tracker = new DamageTracker();
  assert.equal(tracker.note('c1', 100, 100), null);
  assert.equal(tracker.note('c1', 100, 100), null);
});

test('决斗整块伤害立刻跳字', () => {
  const tracker = new DamageTracker();
  tracker.note('duelEnemy', 110, 110);
  const out = tracker.note('duelEnemy', 97, 110, { instant: true });
  assert.deepEqual(out, { value: 13, ratio: 13 / 110 });
});

test('塔防逐帧碎伤害先攒着，到时间片才跳整数', () => {
  const tracker = new DamageTracker();
  tracker.note('c1', 100, 100);

  // 60fps 下每帧 0.35 点，10 帧才 3.5 点 —— 逐帧跳字会刷屏
  let flushed = [];
  for (let i = 0; i < 10; i++) {
    const out = tracker.note('c1', 100 - 0.35 * (i + 1), 100);
    if (out) flushed.push(out);
    flushed = flushed.concat(tracker.tick(1 / 60));
  }
  assert.equal(flushed.length, 0, '不到时间片不该跳字');

  // 再推进一点，攒够一个时间片
  const out = tracker.tick(TOWER_FLUSH_INTERVAL);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'c1');
  assert.equal(out[0].value, 4, '3.5 点伤害取整成 4');
});

test('塔防攒够最大血量的 5% 就立刻跳，不等时间片', () => {
  const tracker = new DamageTracker();
  tracker.note('c1', 100, 100);
  const out = tracker.note('c1', 94, 100);
  assert.equal(out?.value, 6);
});

test('跳过的字不会重复跳第二次', () => {
  const tracker = new DamageTracker();
  tracker.note('c1', 100, 100);
  tracker.note('c1', 90, 100);
  assert.equal(tracker.tick(TOWER_FLUSH_INTERVAL).length, 0, '已经跳过了，不该再来一次');
});

test('新一局血回满：重置记录，不跳成受伤', () => {
  const tracker = new DamageTracker();
  tracker.note('duelPlayer', 60, 110);
  const out = tracker.note('duelPlayer', 110, 110, { instant: true });
  assert.equal(out, null);

  // 重置之后的第一下伤害照常跳
  const hit = tracker.note('duelPlayer', 97, 110, { instant: true });
  assert.equal(hit?.value, 13);
});

test('血量上限变了（换了生物）也重置', () => {
  const tracker = new DamageTracker();
  tracker.note('duelPlayer', 72, 72);
  const out = tracker.note('duelPlayer', 72, 165, { instant: true });
  assert.equal(out, null);
});

test('回血不算伤害', () => {
  const tracker = new DamageTracker();
  tracker.note('c1', 50, 100);
  assert.equal(tracker.note('c1', 70, 100), null);
  assert.equal(tracker.note('c1', 70, 100), null);
});

test('浮点噪声不跳字', () => {
  const tracker = new DamageTracker();
  tracker.note('c1', 100, 100);
  assert.equal(tracker.note('c1', 100 - MIN_DAMAGE / 2, 100), null);
});

test('最小伤害至少显示 1，不会出现 -0', () => {
  const tracker = new DamageTracker({ flushInterval: 0.1 });
  tracker.note('c1', 100, 100);
  tracker.note('c1', 99.9, 100);
  const out = tracker.tick(0.1);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 1);
});

test('forget / clear 之后当作新单位重新登记', () => {
  const tracker = new DamageTracker();
  tracker.note('c1', 100, 100);
  tracker.forget('c1');
  assert.equal(tracker.note('c1', 40, 100, { instant: true }), null, 'forget 后第一次只登记');

  tracker.clear();
  assert.equal(tracker.records.size, 0);
});

test('非法血量不会污染记录', () => {
  const tracker = new DamageTracker();
  assert.equal(tracker.note('x', Number.NaN, 100), null);
  assert.equal(tracker.note('y', 10, 0), null);
  assert.equal(tracker.records.size, 0);
});
