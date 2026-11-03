/**
 * 地图注册表
 * ==================================================================
 * 对外：`MAP_IDS` / `buildMap(id)` / `describeMaps()`。
 *
 * `buildMap(id)` 返回 `{ group, meta }`：
 *   group  —— 一个普通 THREE.Group，坐标原点和 arena.glb 一致（地面 y=0、±30 见方）
 *   meta   —— 尺寸、出生点、`heightAt(x,z)`、`inside(x,z)`、面数
 *
 * 换图为什么不用改场景层：
 *   所有地图都自带 `Arena_Spawn_A_Player` / `Arena_Spawn_B_Enemy` 两个命名节点，
 *   scene3d 的 `_spawn()` 按名字找，找不到才用兜底坐标 —— 所以只要把
 *   `this.arena` 换成这里的 group，出生点、半径、相机全部自动对上。
 */

import { buildLayout } from './layouts.js';
import { buildAltar } from './altar.js';
import { THEME_DATA } from './themes.js';

/** 四张地图：一种布局一张，主题各不同 */
export const MAP_DEFS = [
  {
    id: 'ring',
    name: '熔岩祭坛',
    en: 'Inferno Altar',
    layout: 'altar',
    theme: 'inferno',
    accent: '#ff6b35',
    tagline: '三层石阶 + 残墙火盆 + 中式牌楼',
    playable: true,
    note: '现役默认场地：中心最高、向外逐级下沉，单位仍站在 y=0，玩法不受影响',
  },
  {
    id: 'rift',
    name: '熔岩裂谷',
    en: 'Magma Rift',
    layout: 'rift',
    theme: 'lava',
    accent: '#ff6b35',
    tagline: '中央台 + 环形裂谷 + 双桥',
    playable: false,
    note: '玩法可用，但掉下裂谷没有判定，需要先接边界',
  },
  {
    id: 'terrace',
    name: '沙暴阶梯',
    en: 'Sand Ziggurat',
    layout: 'terrace',
    theme: 'sand',
    accent: '#c98a2e',
    tagline: '三层台地，中心最高',
    playable: false,
    note: '单位还不会按台地抬高，需要先接 heightAt',
  },
  {
    id: 'islands',
    name: '云端岛链',
    en: 'Cloud Isles',
    layout: 'islands',
    theme: 'cloud',
    accent: '#c9a24a',
    tagline: '中央台 + 五座浮岛 + 石桥',
    playable: false,
    note: '浮岛之间没有碰撞，走上去会直接穿过',
  },
];

export const MAP_IDS = MAP_DEFS.map((d) => d.id);

export function getMapDef(id) {
  return MAP_DEFS.find((d) => d.id === id) ?? null;
}

/** 构建结果缓存：几何体很重，同一张图只建一次，之后 clone */
const prototypes = new Map();

function prototype(id) {
  if (prototypes.has(id)) return prototypes.get(id);

  const def = getMapDef(id);
  if (!def) return null;

  // altar 是独立构建函数（台阶 + 残墙 + 岩浆场外），其余走通用布局
  const built = def.layout === 'altar' ? buildAltar() : buildLayout(def.layout, def.theme);
  built.meta.id = def.id;
  built.meta.name = def.name;
  built.meta.en = def.en;
  built.meta.accent = def.accent;
  built.meta.playable = def.playable;
  built.meta.tagline = def.tagline;
  built.meta.note = def.note;

  prototypes.set(id, built);
  return built;
}

/**
 * 取一张地图。每次返回新的 Group（几何体和材质共享），可以随便加进场景、改位置。
 * @param {string} id
 * @returns {{group: import('three').Group, meta: object} | null}
 */
export function buildMap(id) {
  const proto = prototype(id);
  if (!proto) return null;

  const group = proto.group.clone(true);
  group.name = proto.group.name;

  return {
    group,
    // meta 里的函数要一起带过去，浅拷贝就够
    meta: { ...proto.meta },
  };
}

/** 全部地图的元数据（预览页 / 测试 / 选图界面都读这个） */
export function describeMaps() {
  return MAP_IDS.map((id) => {
    const { meta } = prototype(id);
    const { heightAt, inside, spawns, ...rest } = meta;
    return { ...rest, spawnA: spawns[0], spawnB: spawns[1] };
  });
}

/** 主题色板，场景层打光时用 */
export function getTheme(id) {
  const def = getMapDef(id);
  return def ? THEME_DATA[def.theme] : null;
}

/**
 * 场景层要用的一张图的光照预设。
 * 直接照着建灯就行，不用再猜色温。
 */
export function getLighting(id) {
  const t = getTheme(id);
  if (!t) return null;
  return {
    background: t.sky,
    fog: { color: t.fog, near: 40, far: 140 },
    key: { color: t.keyLight, intensity: t.keyIntensity },
    hemi: { sky: t.hemi, ground: t.hemiGround, intensity: t.hemiIntensity },
  };
}

export default { MAP_IDS, buildMap, describeMaps, getMapDef, getTheme, getLighting };
