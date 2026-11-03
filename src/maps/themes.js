/**
 * 四套场地配色
 * ==================================================================
 * 一套主题 = 一组材质 + 一组环境光参数。场景层只负责按 `sky/fog` 打光，
 * 几何体本身不含任何光照信息 —— 这样同一套骨架能换皮，也不会出现
 * 「贴图里烘焙了假光，进引擎和真灯打架」的老问题。
 */

import { mat, THREE } from './kit.js';

/** 原始色板（纯数据，测试和预览页都要读） */
export const THEME_DATA = {
  night: {
    name: '夜火',
    stone: 0x3d424d,
    stoneDark: 0x1e2026,
    trim: 0x4a4438,
    emissive: 0x4fc3ff,
    flame: 0xff8a3d,
    sky: 0x0b1020,
    fog: 0x141a2e,
    accent: '#7fb0ff',
    /** 场景层用：主光颜色 / 强度 / 环境光 */
    keyLight: 0xffd9a8,
    keyIntensity: 2.2,
    hemi: 0x223355,
    hemiGround: 0x0a0d14,
    hemiIntensity: 0.55,
  },
  lava: {
    name: '熔岩',
    stone: 0x2b2421,
    stoneDark: 0x120e0c,
    trim: 0x8a3a1e,
    emissive: 0xff5a1e,
    flame: 0xffb04a,
    sky: 0x140705,
    fog: 0x2a0e08,
    accent: '#ff6b35',
    keyLight: 0xff7a3a,
    keyIntensity: 2.8,
    hemi: 0x5a1e0a,
    hemiGround: 0x0a0403,
    hemiIntensity: 0.95,
  },
  sand: {
    name: '沙暴',
    stone: 0x8a6f4a,
    stoneDark: 0x5a4830,
    trim: 0xa8823e,
    emissive: 0xffc46b,
    flame: 0xffd08a,
    sky: 0x3a2a18,
    fog: 0x8a6a3a,
    accent: '#c98a2e',
    keyLight: 0xffd9a0,
    keyIntensity: 2.8,
    hemi: 0x6a4e2a,
    hemiGround: 0x2a1d10,
    hemiIntensity: 0.75,
  },
  inferno: {
    name: '熔岩祭坛',
    stone: 0xffffff,      // 有贴图时 color 只当染色，给纯白让贴图本色出来
    stoneDark: 0xcfc8cc,
    trim: 0x6b4a33,
    // 贴图缺席时（node 里没有 DOM，createTextures 返回空）改用这套基色，
    // 否则导出 GLB 会得到一堆纯白模型
    solid: { stone: 0x4a4650, stoneDark: 0x2c2a30, trim: 0x5a4030 },
    emissive: 0xff5a1e,
    flame: 0xffb04a,
    sky: 0x0a0606,
    fog: 0x1a0b08,
    accent: '#ff6b35',
    keyLight: 0xffb070,
    keyIntensity: 3.2,
    hemi: 0x40201a,
    hemiGround: 0x0a0403,
    hemiIntensity: 0.6,
  },
  cloud: {
    name: '云端',
    stone: 0x6f828c,
    stoneDark: 0x3a4850,
    trim: 0xc9a24a,
    cloud: 0x46545f,
    emissive: 0xffd24a,
    flame: 0xffd24a,
    sky: 0x1a2430,
    fog: 0x2a3a48,
    accent: '#c9a24a',
    keyLight: 0xfff0c8,
    keyIntensity: 2.4,
    hemi: 0x3a4a5a,
    hemiGround: 0x101820,
    hemiIntensity: 0.65,
  },
};

/**
 * 把色板变成一组可复用的材质。
 * 同一张地图里所有构件共用这几个材质，merge 才能把 draw call 压下来。
 */
export function createMaterials(themeId, tex = null) {
  const t = THEME_DATA[themeId] ?? THEME_DATA.night;

  // 贴图缺席时的基色。导出 GLB 时用得着（node 没有 DOM，拿不到 Canvas 贴图）
  const solid = t.solid ?? { stone: t.stone, stoneDark: t.stoneDark, trim: t.trim };
  const tag = (m, hex) => {
    m.userData.exportColor = hex;
    return m;
  };

  return {
    theme: t,
    stone: tag(mat(t.stone, { roughness: 0.95, vertexColors: true, map: tex?.brick ?? null }), solid.stone),
    stoneDark: tag(mat(t.stoneDark, { roughness: 0.92, vertexColors: true, map: tex?.brick ?? null }), solid.stoneDark),
    /** 中央地面用单独一张（同心刻痕），不跟着砖纹走 */
    floor: tag(mat(t.stone, { roughness: 0.95, vertexColors: true, map: tex?.floor ?? null }), solid.stone),
    trim: tag(mat(t.trim, { roughness: 0.55, metalness: 0.35, vertexColors: true, map: tex?.brick ?? null }), solid.trim),
    /** 会发光的：魔法阵、岩浆缝、指示灯 */
    glow: mat(t.emissive, {
      roughness: 0.35,
      metalness: 0,
      emissive: t.emissive,
      emissiveIntensity: 1.4,
      flat: false,
    }),
    /** 火焰：加色混合，叠在火盆上 */
    flame: new THREE.MeshBasicMaterial({
      color: t.flame,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    /** 半透明的：裂谷底的岩浆面、云海 */
    veil: mat(0x2a0a04, {
      roughness: 0.75,
      opacity: 0.92,
      emissive: t.emissive,
      emissiveIntensity: 0.55,
      flat: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    /** 远景剪影：几乎全黑，只靠雾拉开层次 */
    far: tag(mat(t.stoneDark, { roughness: 1, flat: false, vertexColors: true }), solid.stoneDark),
    /** 云海：只有云端主题用得上，给一个近白的浅色 */
    cloud: tag(mat(t.cloud ?? 0xdfe8ee, { roughness: 1, flat: true, vertexColors: true }), t.cloud ?? 0xdfe8ee),
  };
}
