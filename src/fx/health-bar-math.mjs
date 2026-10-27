/**
 * 血条数学（纯函数，不 import three，可以在 node 里直接跑测试）
 * ==================================================================
 * 血条看起来简单，但三个数值行为错了都会很明显：
 *   1. 比例越界 / 除零 → Sprite 缩放变 NaN，整条血条消失甚至拖崩渲染
 *   2. 直接赋值 → 掉血是「瞬间跳变」，看不出挨了多少
 *   3. 回血也走残影 → 残影会从右边往左缩，像又挨了一下
 */

/** 血量 → 0~1。maxHp 缺失或 <= 0 时返回 0，绝不让 NaN 漏到渲染层 */
export function clampRatio(hp, maxHp) {
  const h = Number(hp);
  const m = Number(maxHp);
  if (!Number.isFinite(h) || !Number.isFinite(m) || m <= 0) return 0;
  return Math.min(1, Math.max(0, h / m));
}

/** 帧率无关的指数趋近，掉血 / 回血都用它：看起来是「刷」地滑过去，不是瞬移 */
export function approachRatio(current, target, dt, speed = 16) {
  const to = Number.isFinite(target) ? Math.min(1, Math.max(0, target)) : 0;
  const from = Number.isFinite(current) ? current : to;
  const k = 1 - Math.exp(-speed * Math.max(0, dt));
  const next = from + (to - from) * k;
  return Math.abs(to - next) < 0.0015 ? to : next;
}

/**
 * 残影条（受击后慢慢缩的那一段）。
 * 只在下降时追；一旦回血就立刻贴上去 —— 否则回血会看到残影从右往左缩。
 */
export function trailRatio(current, target, dt, speed = 0.5) {
  const to = Number.isFinite(target) ? Math.min(1, Math.max(0, target)) : 0;
  const from = Number.isFinite(current) ? current : to;
  if (from <= to) return to;
  return Math.max(to, from - speed * Math.max(0, dt));
}

/** 填充条从左端对齐：宽度按比例，中心往左挪半个缺口（Sprite 的原点在中心） */
export function fillLayout(ratio, width) {
  const r = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const w = width * r;
  return { width: w, offsetX: -(width - w) / 2 };
}

/**
 * 残影只画「刚掉掉的那一段」（比例从 from 到 to），不是整条半透明。
 * 整条画的话它会盖在填充条上，把颜色冲淡成一块灰板。
 */
export function segmentLayout(from, to, width) {
  const a = Math.min(1, Math.max(0, Number.isFinite(from) ? from : 0));
  const b = Math.min(1, Math.max(0, Number.isFinite(to) ? to : 0));
  const left = -width / 2 + Math.min(a, b) * width;
  const right = -width / 2 + Math.max(a, b) * width;
  return { width: right - left, offsetX: (left + right) / 2 };
}

/** 残血线：低于它就开始呼吸闪烁，提醒「快死了」 */
export const LOW_HEALTH = 0.28;

export function isLowHealth(ratio) {
  return Number.isFinite(ratio) && ratio > 0 && ratio <= LOW_HEALTH;
}

/** 满血时半透明，避免场上六只怪顶着六条亮条太吵；掉过血就恢复实心 */
export function idleOpacity(ratio) {
  return ratio >= 0.999 ? 0.8 : 1;
}
