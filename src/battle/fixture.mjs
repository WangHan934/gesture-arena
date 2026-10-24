/**
 * 测试 / 演示用的怪物表
 * ==================================================================
 * 字段与 B 的 src/summon/creature-data.js **完全一致**
 * （id / name / gesture / glyph / color / hp / dps / speed / cost / size），
 * 数值也照抄当前仓库里的那四只。
 *
 * 为什么要有这个文件：
 *   战斗层的验收前提是"不依赖摄像头、不依赖浏览器也能跑"。
 *   如果单测直接静态 import B 的文件，B 一改路径或字段，我的测试就整体挂掉；
 *   而且沙箱/CI 里不一定有完整仓库。
 *   所以单测和命令行演示统一用这份 fixture，
 *   另外在测试第 11 组里**如果**上游文件存在，会再跑一遍真实数据做交叉验证。
 *
 * 注意：这不是交付的数据源，真机上的怪物数据始终来自 B。
 */

export const FIXTURE = [
  { id: 'stone', name: '石灵', gesture: 'circle',  glyph: '🗿', color: '#5b8cff', hp: 110, dps: 7,  speed: 55,  cost: 22, size: 36 },
  { id: 'fox',   name: '焰狐', gesture: 'line_h',  glyph: '🦊', color: '#ff8a3d', hp: 42,  dps: 14, speed: 110, cost: 20, size: 32 },
  { id: 'bird',  name: '雷鸟', gesture: 'zigzag',  glyph: '🦅', color: '#ffd93d', hp: 68,  dps: 26, speed: 95,  cost: 38, size: 34 },
  { id: 'brute', name: '巨魔', gesture: 'v_shape', glyph: '👹', color: '#b06bff', hp: 180, dps: 16, speed: 62,  cost: 48, size: 42 },
];

export default FIXTURE;