/**
 * 生物数据表
 * ------------------------------------------------------------------
 * 这是策划同学的「主战场」：调数值、加新生物都改这里。
 *
 * 字段说明：
 *   id      唯一标识，代码里引用它
 *   name    显示名
 *   gesture 对应手势模板 id（见 src/input/gesture-recognizer.js）
 *   glyph   用 emoji 当立绘，换成图片见 README 的 Roadmap
 *   color   主题色，用于光晕和血条
 *   hp      生命值
 *   dps     每秒伤害
 *   speed   移动速度（像素/秒，战场宽 1000）
 *   cost    召唤消耗的法力
 *   size    emoji 字号
 */

export const CREATURES = [
  {
    id: 'stone',
    name: '石灵',
    gesture: 'circle',
    glyph: '🗿',
    color: '#5b8cff',
    hp: 110,
    dps: 7,
    speed: 55,
    cost: 22,
    size: 36,
  },
  {
    id: 'fox',
    name: '焰狐',
    gesture: 'line_h',
    glyph: '🦊',
    color: '#ff8a3d',
    hp: 42,
    dps: 14,
    speed: 110,
    cost: 20,
    size: 32,
  },
  {
    id: 'bird',
    name: '雷鸟',
    gesture: 'zigzag',
    glyph: '🦅',
    color: '#ffd93d',
    hp: 68,
    dps: 26,
    speed: 95,
    cost: 38,
    size: 34,
  },
  {
    id: 'brute',
    name: '巨魔',
    gesture: 'v_shape',
    glyph: '👹',
    color: '#b06bff',
    hp: 180,
    dps: 16,
    speed: 62,
    cost: 48,
    size: 42,
  },
];

/** 按 id 查生物 */
export function getCreatureById(id) {
  return CREATURES.find((c) => c.id === id) || null;
}

/** 按手势 id 查生物 */
export function getCreatureByGesture(gestureId) {
  return CREATURES.find((c) => c.gesture === gestureId) || null;
}
