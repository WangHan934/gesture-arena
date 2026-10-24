/**
 * 手势识别器测试
 * ==================================================================
 * 用法：node tests/gesture.test.mjs
 *
 * 重点覆盖两件事：
 *   1. 四类有效手势能被认出来（圆的起点和方向任意）
 *   2. 无效图形（竖线、斜线、乱涂、太短）不会被误认
 *   3. 横线额外返回笔画方向 dir —— 决斗模式靠它区分「靠近 / 拉开」
 *
 * 坐标用画板的 400×400 逻辑坐标，因为识别器的 minPathLength 是按这个尺度定的。
 */

import { recognize, GESTURE_LEGEND } from '../src/input/gesture-recognizer.js';

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

/* ---------------- 造点工具 ---------------- */

/** 一段直线上的 n+1 个点 */
function seg(a, b, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push({ x: a.x + (b.x - a.x) * (i / n), y: a.y + (b.y - a.y) * (i / n) });
  }
  return pts;
}

/** 把多段首尾相接（去掉重复的接点） */
function chain(...segments) {
  const out = [];
  for (const s of segments) {
    out.push(...(out.length ? s.slice(1) : s));
  }
  return out;
}

/** 圆：可以指定起点角度和方向，用来验证「任意起点都能认」 */
function circle(cx, cy, r, { startAngle = -Math.PI / 2, cw = true, n = 72 } = {}) {
  const pts = [];
  const dir = cw ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = startAngle + dir * (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/* 有效图形的标准画法 */
const shapes = {
  lineLtr: () => seg({ x: 60, y: 200 }, { x: 340, y: 200 }, 24),
  lineRtl: () => seg({ x: 340, y: 200 }, { x: 60, y: 200 }, 24),
  zigzag: () => chain(
    seg({ x: 80, y: 110 }, { x: 320, y: 110 }),
    seg({ x: 320, y: 110 }, { x: 80, y: 290 }),
    seg({ x: 80, y: 290 }, { x: 320, y: 290 }),
  ),
  vShape: () => chain(
    seg({ x: 90, y: 110 }, { x: 200, y: 300 }),
    seg({ x: 200, y: 300 }, { x: 310, y: 110 }),
  ),
  circle: () => circle(200, 200, 110),
};

/* ---------------- 1. 有效手势 ---------------- */

console.log('\n── 1. 有效手势');

check('从左往右的横线 → line_h，方向 ltr', () => {
  const r = recognize(shapes.lineLtr());
  assert(r, '应该识别出来');
  eq(r.id, 'line_h', 'id');
  eq(r.dir, 'ltr', 'dir');
});

check('从右往左的横线 → line_h，方向 rtl', () => {
  const r = recognize(shapes.lineRtl());
  assert(r, '应该识别出来');
  eq(r.id, 'line_h', 'id');
  eq(r.dir, 'rtl', 'dir');
});

check('Z 字 → zigzag', () => {
  const r = recognize(shapes.zigzag());
  assert(r, '应该识别出来');
  eq(r.id, 'zigzag', 'id');
});

check('V 字 → v_shape', () => {
  const r = recognize(shapes.vShape());
  assert(r, '应该识别出来');
  eq(r.id, 'v_shape', 'id');
});

check('圆（默认起点、顺时针）→ circle', () => {
  const r = recognize(shapes.circle());
  assert(r, '应该识别出来');
  eq(r.id, 'circle', 'id');
});

check('圆从任意起点开始都能认（12 个不同起点）', () => {
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const r = recognize(circle(200, 200, 110, { startAngle: angle }));
    assert(r, `起点角度 ${(angle * 180 / Math.PI).toFixed(0)}° 没认出来`);
    eq(r.id, 'circle', `起点角度 ${(angle * 180 / Math.PI).toFixed(0)}° 的 id`);
  }
});

check('圆反着画也能认（逆时针）', () => {
  const r = recognize(circle(200, 200, 110, { cw: false }));
  assert(r, '应该识别出来');
  eq(r.id, 'circle', 'id');
});

check('只有横线带 dir，其它手势不带', () => {
  for (const [name, make] of Object.entries(shapes)) {
    const r = recognize(make());
    assert(r, `${name} 应该识别出来`);
    if (r.id === 'line_h') {
      assert(r.dir === 'ltr' || r.dir === 'rtl', `${name} 的 dir 应该是 ltr 或 rtl`);
    } else {
      eq(r.dir, undefined, `${name}（${r.id}）不该带 dir`);
    }
  }
});

/* ---------------- 2. 无效图形不能误认 ---------------- */

console.log('\n── 2. 无效图形不应被认出来');

check('竖线 → null（负样本）', () => {
  eq(recognize(seg({ x: 200, y: 60 }, { x: 200, y: 340 }, 24)), null, '竖线');
});

check('斜线 ↘ → null（负样本）', () => {
  eq(recognize(seg({ x: 60, y: 60 }, { x: 340, y: 340 }, 24)), null, '斜线↘');
});

check('斜线 ↗ → null（负样本）', () => {
  eq(recognize(seg({ x: 60, y: 340 }, { x: 340, y: 60 }, 24)), null, '斜线↗');
});

check('笔画太短 → null', () => {
  eq(recognize(seg({ x: 200, y: 200 }, { x: 220, y: 200 }, 8)), null, '短笔画');
});

check('点数不足（< 4）→ null', () => {
  eq(recognize([{ x: 0, y: 0 }, { x: 100, y: 0 }]), null, '两个点');
  eq(recognize([]), null, '空数组');
  eq(recognize(null), null, 'null');
  eq(recognize('不是数组'), null, '字符串');
});

check('乱涂不会被认成横线（线性度门槛）', () => {
  // 一条来回折返的横线：路径很长但净位移很短，线性度很高
  const scribble = chain(
    seg({ x: 60, y: 200 }, { x: 340, y: 200 }, 12),
    seg({ x: 340, y: 205 }, { x: 60, y: 205 }, 12),
    seg({ x: 60, y: 210 }, { x: 340, y: 210 }, 12),
  );
  const r = recognize(scribble);
  assert(!r || r.id !== 'line_h', `来回划不该判成横线，实际是 ${r ? r.id : 'null'}`);
});

/* ---------------- 3. 返回结构 ---------------- */

console.log('\n── 3. 返回结构与图例');

check('识别结果带 score，且是 0~1 的数', () => {
  const r = recognize(shapes.circle());
  assert(typeof r.score === 'number' && r.score >= 0 && r.score <= 1, `score 异常：${r.score}`);
});

check('GESTURE_LEGEND 覆盖四类有效手势', () => {
  const ids = GESTURE_LEGEND.map((g) => g.id).sort();
  eq(ids.join(','), 'circle,line_h,v_shape,zigzag', '图例 id');
});

/* ---------------- 汇总 ---------------- */

console.log(`\n${'─'.repeat(56)}`);
if (failures.length) {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.message}`);
  console.log('\n手势识别器存在失败用例 ❌');
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 通过 / 0 失败`);
  console.log('手势识别器全部用例通过 ✅');
}
