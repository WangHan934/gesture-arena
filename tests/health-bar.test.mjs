/**
 * 血条数学测试
 * ==================================================================
 * 用法：node --test tests/health-bar.test.mjs
 *
 * 只测纯函数（src/fx/health-bar-math.mjs），不碰 three / canvas：
 *   · 比例越界、除零、NaN 不能漏到渲染层（会让 Sprite 缩放变 NaN，血条直接消失）
 *   · 掉血要「滑」过去而不是瞬移，且趋近必须与帧率无关
 *   · 残影只在掉血时追，回血要立刻贴上去
 *   · 填充条左端对齐的偏移量算对，否则血条会从中间往两边缩
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approachRatio, clampRatio, fillLayout, idleOpacity, isLowHealth, LOW_HEALTH, segmentLayout, trailRatio,
} from '../src/fx/health-bar-math.mjs';

test('血量比例夹在 0~1', () => {
  assert.equal(clampRatio(140, 140), 1);
  assert.equal(clampRatio(70, 140), 0.5);
  assert.equal(clampRatio(0, 140), 0);
  assert.equal(clampRatio(-30, 140), 0, '负血量不能画到框外');
  assert.equal(clampRatio(200, 140), 1, '溢出上限要夹住');
});

test('非法血量返回 0，不出 NaN', () => {
  assert.equal(clampRatio(Number.NaN, 140), 0);
  assert.equal(clampRatio(50, 0), 0);
  assert.equal(clampRatio(50, -10), 0);
  assert.equal(clampRatio(undefined, undefined), 0);
  assert.equal(clampRatio('50', '100'), 0.5, '数字字符串也认');
});

test('比例趋近：一帧不会跳到目标，但会朝目标走', () => {
  const one = approachRatio(1, 0.5, 1 / 60);
  assert.ok(one < 1 && one > 0.5, `一帧后应该在中间，实际 ${one}`);
  assert.ok(approachRatio(1, 0.5, 1 / 60) === one, '同样输入结果稳定');
});

test('比例趋近与帧率无关：60 帧和 120 帧走到的位置接近', () => {
  let a = 1;
  for (let i = 0; i < 60; i++) a = approachRatio(a, 0.2, 1 / 60);
  let b = 1;
  for (let i = 0; i < 120; i++) b = approachRatio(b, 0.2, 1 / 120);
  assert.ok(Math.abs(a - b) < 0.01, `60fps=${a.toFixed(4)} 120fps=${b.toFixed(4)}`);
});

test('比例趋近最终会贴到目标（不会永远差一点）', () => {
  let v = 1;
  for (let i = 0; i < 240; i++) v = approachRatio(v, 0.4, 1 / 60);
  assert.equal(v, 0.4);
});

test('比例趋近不吃 NaN 目标', () => {
  const v = approachRatio(0.8, Number.NaN, 1 / 60);
  assert.ok(Number.isFinite(v));
});

test('残影只在掉血时追，且不会掉到目标下面', () => {
  assert.equal(trailRatio(1, 0.5, 1 / 60), 1 - 0.5 / 60, '按速度线性追');
  // 追到目标就停住，不会越过
  let v = 1;
  for (let i = 0; i < 200; i++) v = trailRatio(v, 0.5, 1 / 60);
  assert.equal(v, 0.5);
});

test('回血时残影立刻贴上去，不往回缩', () => {
  assert.equal(trailRatio(0.4, 0.9, 1 / 60), 0.9);
  assert.equal(trailRatio(0.4, 0.4, 1 / 60), 0.4);
});

test('填充条左端对齐：满血占满，半血左半边，空血宽度 0', () => {
  assert.deepEqual(fillLayout(1, 1.25), { width: 1.25, offsetX: -0 });
  assert.deepEqual(fillLayout(0.5, 1.25), { width: 0.625, offsetX: -0.3125 });
  const empty = fillLayout(0, 1.25);
  assert.equal(empty.width, 0);
  assert.equal(empty.offsetX, -0.625);
});

test('填充条布局不吃非法比例', () => {
  assert.equal(fillLayout(Number.NaN, 1.25).width, 0);
  assert.equal(fillLayout(2, 1.25).width, 1.25, '超过 1 也夹住');
  assert.equal(fillLayout(-1, 1.25).width, 0);
});

test('残血线：只有 0 < 比例 <= 0.28 才闪', () => {
  assert.equal(isLowHealth(LOW_HEALTH), true);
  assert.equal(isLowHealth(0.1), true);
  assert.equal(isLowHealth(0), false, '已经死了就不用闪了');
  assert.equal(isLowHealth(0.5), false);
  assert.equal(isLowHealth(Number.NaN), false);
});

test('满血半透明、掉过血就恢复实心', () => {
  assert.equal(idleOpacity(1), 0.8);
  assert.equal(idleOpacity(0.999), 0.8);
  assert.equal(idleOpacity(0.9), 1);
  assert.equal(idleOpacity(0), 1);
});

test('残影段只覆盖「刚掉掉的那一截」', () => {
  // 1.0 → 0.4：残影段从 0.4 到 1.0，右端贴着条的右端
  const seg = segmentLayout(0.4, 1, 1.3);
  assert.ok(Math.abs(seg.width - 0.78) < 1e-9);
  assert.ok(Math.abs(seg.offsetX - 0.26) < 1e-9, `右端对齐，中心偏右，实际 ${seg.offsetX}`);
});

test('残影段：追平后宽度为 0，不会盖住填充条', () => {
  assert.equal(segmentLayout(0.5, 0.5, 1.3).width, 0);
});

test('残影段：两端顺序颠倒也能画（取区间）', () => {
  const a = segmentLayout(0.4, 1, 1.3);
  const b = segmentLayout(1, 0.4, 1.3);
  assert.ok(Math.abs(a.width - b.width) < 1e-9);
  assert.ok(Math.abs(a.offsetX - b.offsetX) < 1e-9);
});

test('残影段不吃非法输入', () => {
  assert.equal(segmentLayout(Number.NaN, 1, 1.3).width, 1.3);
  assert.equal(segmentLayout(-1, 2, 1.3).width, 1.3, '超范围要夹住');
});
