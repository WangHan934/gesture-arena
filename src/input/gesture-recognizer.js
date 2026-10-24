/**
 * 手势识别器
 * ------------------------------------------------------------------
 * 基于 $1 Unistroke Recognizer 的简化实现（学术界经典轻量算法）。
 *
 * 原理只有四步：
 *   1. 重采样：把任意长度的轨迹均匀取成 64 个点
 *   2. 等比缩放：让最长边变成 1（保持形状，不会把横线拉成正方形）
 *   3. 居中：减去重心，消除位置差异
 *   4. 比对：和每个内置模板逐点算平均距离，最小的那个就是答案
 *
 * 两个关键处理：
 *   · 圆形是闭合图形，起点可能在任何位置，所以用「循环移位」对齐后再比
 *   · 竖线、斜线这类不该触发召唤的形状，做成「负样本模板」，
 *     匹配到就直接判为无效，避免误召唤
 *
 * 想加新手势？在 TEMPLATES 里加一条就行，不用改算法。
 */

import { GESTURE } from '../config.js';

const RESAMPLE_N = 64;

/* ---------------- 基础几何工具 ---------------- */

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 轨迹总长度 */
function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/**
 * 线性度 = 路径总长 / 首尾直线距离
 *   一条直线 ≈ 1；一个圆 ≈ 3.14；来回折的乱线会远大于 1。
 * 用来挡住「横着乱划也被当成横线」这类误判。
 */
function linearityOf(points) {
  const len = pathLength(points);
  const span = dist(points[0], points[points.length - 1]);
  if (span < 1e-6) return Infinity; // 首尾重合，视为完全闭合
  return len / span;
}

/** 去掉相邻的重复点，避免重采样时卡住 */
function dedupe(points) {
  const out = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    if (dist(points[i], out[out.length - 1]) > 1e-6) {
      out.push({ x: points[i].x, y: points[i].y });
    }
  }
  return out;
}

/** 把轨迹均匀重采样成 n 个点 */
function resample(points, n) {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  const total = pathLength(pts);
  if (total === 0) {
    const p = pts[0];
    return Array.from({ length: n }, () => ({ x: p.x, y: p.y }));
  }

  const interval = total / (n - 1);
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let acc = 0;

  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= interval && d > 0) {
      const t = (interval - acc) / d;
      const q = {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      };
      out.push(q);
      pts.splice(i, 0, q); // 插入新点，下一轮从它继续算
      acc = 0;
    } else {
      acc += d;
    }
  }

  const last = pts[pts.length - 1];
  while (out.length < n) out.push({ x: last.x, y: last.y });

  return out.slice(0, n);
}

/**
 * 归一化：重采样 → 等比缩放 → 居中
 * @returns {{points: Array<{x:number,y:number}>, aspect: number}}
 */
function normalize(rawPoints) {
  const deduped = dedupe(rawPoints);
  let pts = resample(deduped, RESAMPLE_N);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const w = maxX - minX;
  const h = maxY - minY;
  const scale = Math.max(w, h) || 1;

  pts = pts.map((p) => ({ x: (p.x - minX) / scale, y: (p.y - minY) / scale }));

  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length;
  cy /= pts.length;

  return {
    points: pts.map((p) => ({ x: p.x - cx, y: p.y - cy })),
    aspect: (w + 1) / (h + 1),
  };
}

/* ---------------- 模板形状 ---------------- */

/** 圆形 ○ */
function circlePoints() {
  const pts = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 100, y: Math.sin(a) * 100 });
  }
  return pts;
}

/** 横线 — */
function horizontalLine() {
  return [{ x: 0, y: 0 }, { x: 200, y: 0 }];
}

/** Z 字形 ⚡（画布 y 向下，所以是横-斜-横） */
function zigzag() {
  return [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 0, y: 150 },
    { x: 200, y: 150 },
  ];
}

/** V 字形 ∨ */
function vShape() {
  return [
    { x: 0, y: 0 },
    { x: 100, y: 150 },
    { x: 200, y: 0 },
  ];
}

/* --- 负样本：匹配到就说明「这不是有效手势」 --- */

function verticalLine() {
  return [{ x: 0, y: 0 }, { x: 0, y: 200 }];
}

function diagonalDown() {
  return [{ x: 0, y: 0 }, { x: 200, y: 200 }];
}

function diagonalUp() {
  return [{ x: 0, y: 200 }, { x: 200, y: 0 }];
}

/* ---------------- 模板表 ---------------- */

/**
 * 建模板
 * minLinearity / maxLinearity：线性度门槛，用于过滤形状不对的候选。
 * 例如横线必须是「直」的，圆的路径必须是「绕」的。
 */
function makeTemplate(id, raw, { closed = false, valid = true, minLinearity = 0, maxLinearity = Infinity } = {}) {
  const { points } = normalize(raw);
  return {
    id,
    points,
    reversed: [...points].reverse(),
    closed,
    valid,
    minLinearity,
    maxLinearity,
  };
}

/**
 * 模板表：id 要和 creature-data.js 里的 gesture 字段对应。
 */
const TEMPLATES = [
  // 圆的路径长 ≈ 周长 ≈ 3.14 倍直径，所以线性度下限设 2.2
  makeTemplate('circle', circlePoints(), { closed: true, minLinearity: 2.2 }),
  // 横线必须接近一条直线，来回划的不算
  makeTemplate('line_h', horizontalLine(), { maxLinearity: 1.45 }),
  makeTemplate('zigzag', zigzag()),
  makeTemplate('v_shape', vShape()),

  // 负样本
  makeTemplate('_vline', verticalLine(), { valid: false }),
  makeTemplate('_diag_down', diagonalDown(), { valid: false }),
  makeTemplate('_diag_up', diagonalUp(), { valid: false }),
];

/* ---------------- 比对 ---------------- */

function averageDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += dist(a[i], b[i]);
  return sum / a.length;
}

/** 循环移位找最小距离，用于闭合图形（圆）的起点对齐 */
function cyclicMinDistance(a, b) {
  const n = a.length;
  let best = Infinity;
  for (let shift = 0; shift < n; shift++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += dist(a[i], b[(i + shift) % n]);
    const avg = sum / n;
    if (avg < best) best = avg;
    if (best < 0.01) break; // 已经足够好，提前结束
  }
  return best;
}

/** 候选轨迹和一个模板的匹配分，越小越像 */
function scoreAgainst(candidate, tpl) {
  if (tpl.closed) {
    return Math.min(
      cyclicMinDistance(candidate, tpl.points),
      cyclicMinDistance(candidate, tpl.reversed)
    );
  }
  // 正序 / 逆序都试，这样从右往左画也能认出来
  return Math.min(
    averageDistance(candidate, tpl.points),
    averageDistance(candidate, tpl.reversed)
  );
}

/**
 * 识别手势
 * @param {Array<{x:number,y:number}>} points 画板上的轨迹点
 * @returns {{id:string, score:number} | null} 识别结果，null 表示没认出来
 */
export function recognize(points) {
  return recognizeFrom(points, TEMPLATES, GESTURE.matchThreshold);
}

function recognizeFrom(points, templates, threshold) {
  if (!Array.isArray(points) || points.length < 4) return null;
  if (pathLength(points) < GESTURE.minPathLength) return null;

  const candidate = normalize(points).points;
  const linearity = linearityOf(points);

  let best = null;
  for (const tpl of templates) {
    // 形状门槛：线性度不符合的模板直接跳过
    if (linearity < tpl.minLinearity || linearity > tpl.maxLinearity) continue;

    const score = scoreAgainst(candidate, tpl);
    if (!best || score < best.score) {
      best = { id: tpl.id, score, valid: tpl.valid };
    }
  }

  if (!best) return null;
  if (best.score > threshold) return null;
  if (!best.valid) return null; // 撞上负样本，直接判无效

  const result = { id: best.id, score: best.score };

  // 横线额外给出笔画方向，决斗模式用它区分「靠近 / 拉开」。
  // 必须在**原始点**上算：normalize() 里有旋转对齐（rotateToZero），
  // 方向信息在那之后就被抹平了 —— 这也是为什么正着画和反着画都能匹配上 line_h。
  if (best.id === 'line_h') {
    const first = points[0];
    const last = points[points.length - 1];
    result.dir = last.x >= first.x ? 'ltr' : 'rtl';
  }

  return result;
}

const SPELL_TEMPLATES = [
  makeTemplate('circle', circlePoints(), { closed: true, minLinearity: 2.2 }),
  makeTemplate('line_h', horizontalLine(), { maxLinearity: 1.45 }),
  makeTemplate('line_v', verticalLine(), { maxLinearity: 1.45 }),
  makeTemplate('triangle', [{x:100,y:0},{x:200,y:180},{x:0,y:180},{x:100,y:0}], { closed: true, minLinearity: 2.2 }),
  makeTemplate('square', [{x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200},{x:0,y:0}], { closed: true, minLinearity: 2.2 }),
  makeTemplate('two', [{x:0,y:35},{x:35,y:0},{x:135,y:0},{x:180,y:35},{x:180,y:75},{x:0,y:200},{x:200,y:200}]),
  makeTemplate('_diag_down', diagonalDown(), {valid:false}),
  makeTemplate('_diag_up', diagonalUp(), {valid:false}),
];

/** PvP has its own vocabulary; the original tower/duel recognizer is unchanged. */
export function recognizeSpell(points) {
  return recognizeFrom(points, SPELL_TEMPLATES, 0.23);
}

/** 给 UI 用的手势图例 */
export const GESTURE_LEGEND = [
  { id: 'circle', symbol: '○' },
  { id: 'line_h', symbol: '—' },
  { id: 'zigzag', symbol: 'Z' },
  { id: 'v_shape', symbol: 'V' },
];
