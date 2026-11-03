/**
 * 四种场地布局
 * ==================================================================
 * 尺寸全部对齐 arena.glb 的**逐部件实测值**（未缩放，1u=1m）：
 *
 *   Arena_Floor      直径 24.2  → 可玩地面半径 12
 *   Arena_Wall       半径 12.5  → 墙高 2.25
 *   Arena_Pillars    半径 10.3  → 柱顶 4.35
 *   Arena_Stands     半径 15.9  → 看台顶 3.5
 *   Arena_Gate       宽 12 高 7.07（牌坊）
 *   Arena_CenterSeal 直径 3.4
 *   Arena_Cliffs     60 × 60，最高 12.5（远景，不是场地）
 *   Arena_Spawn_A/B  ±5.5
 *
 * ⚠️ 第一版把包围盒的 60 当成了场地直径，地面做成半径 26，结果相机（距中心 27.7）
 *    直接站在场地内部，整个画面被压平。**包围盒量的是崖壁，不是地面。**
 *
 * 布局差异（决定怎么打）：
 *   ring     圆环场    全平地，对称公平          ← 现役玩法直接可用
 *   rift     双桥断崖  中央台 + 环形裂谷 + 双桥   ← 需要坠落判定
 *   terrace  阶梯高台  三层台地，中心最高         ← 需要按高度摆单位
 *   islands  岛链浮台  中央台 + 5 座浮岛 + 石桥   ← 需要碰撞
 */

import { THREE, V, Batch, ringPoint, angles, nearGate, countTris, hasFinitePositions } from './kit.js';
import { createMaterials, THEME_DATA } from './themes.js';

/* ================================================================
 * 尺寸常量（对齐 arena.glb）
 * ================================================================ */

const FLOOR_R = 12;
const WALL_R = 12.55;
const WALL_H = 2.3;
const PILLAR_R = 10.4;
const GATE_ANGLES = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];
const GRAND_GATE_ANGLE = Math.PI; // 牌坊在 -Z，正对镜头远处
const SPAWN_Z = 5.5;

/* ================================================================
 * 构件
 * ================================================================ */

/** 环墙：40 段，门洞处留空，隔几段加垛口 */
function buildWall(b, M, radius = WALL_R, height = WALL_H) {
  const SEG = 40;
  const chord = 2 * radius * Math.sin(Math.PI / SEG) * 1.04;
  const gateHalf = 0.24; // 弧度，约 3m 半宽

  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    if (nearGate(a, GATE_ANGLES, gateHalf)) continue;

    const p = ringPoint(radius, a);
    b.add(new THREE.BoxGeometry(chord, height, 0.55), M.stone, {
      p: [p.x, height / 2, p.z],
      r: [0, a, 0],
    });

    // 垛口：每 3 段一个，纯为剪影
    if (i % 3 === 0) {
      b.add(new THREE.BoxGeometry(chord * 0.55, 0.42, 0.62), M.stoneDark, {
        p: [p.x, height + 0.21, p.z],
        r: [0, a, 0],
      });
    }
  }
}

/** 方柱 + 柱顶火盆。默认 12 根围在环墙内侧，岛屿图会改成 6 根围着中央台 */
function buildPillars(b, M, radius = PILLAR_R, count = 12) {
  const list = angles(count, Math.PI / count); // 错开半个间隔，不压在门上
  for (const a of list) {
    const p = ringPoint(radius, a);
    const r = [0, a, 0];

    b.add(new THREE.BoxGeometry(1.2, 0.35, 1.2), M.stoneDark, { p: [p.x, 0.175, p.z], r });
    b.add(new THREE.BoxGeometry(0.9, 2.9, 0.9), M.stone, { p: [p.x, 1.8, p.z], r });
    b.add(new THREE.BoxGeometry(1.1, 0.28, 1.1), M.stoneDark, { p: [p.x, 3.39, p.z], r });
    b.add(new THREE.CylinderGeometry(0.4, 0.28, 0.35, 8), M.trim, { p: [p.x, 3.7, p.z], r });
    b.add(new THREE.ConeGeometry(0.28, 0.6, 6), M.flame, { p: [p.x, 4.15, p.z], r });
  }
}

/** 普通拱门：两根柱子 + 一条横梁 */
function buildGate(b, M, angle, width = 5) {
  const p = ringPoint(WALL_R, angle);
  const half = width / 2 + 0.55;

  for (const s of [-1, 1]) {
    const dx = Math.cos(angle) * half * s;
    const dz = -Math.sin(angle) * half * s;
    b.add(new THREE.BoxGeometry(0.8, 4.2, 0.8), M.stone, {
      p: [p.x + dx, 2.1, p.z + dz],
      r: [0, angle, 0],
    });
  }

  b.add(new THREE.BoxGeometry(width + 2.0, 0.75, 1.0), M.stoneDark, {
    p: [p.x, 4.45, p.z],
    r: [0, angle, 0],
  });
}

/** 牌坊：三开间 + 收分屋顶（宽 12 / 高 6.7，对齐原模型） */
function buildPaifang(b, M, angle) {
  const p = ringPoint(WALL_R, angle);
  const r = [0, angle, 0];
  const tangent = (offset) => V(
    p.x + Math.cos(angle) * offset,
    0,
    p.z - Math.sin(angle) * offset,
  );

  // 四根柱子：外柱矮、内柱高，中间高两边低的轮廓
  for (const [offset, height] of [[-5.4, 4.4], [-2.7, 5.2], [2.7, 5.2], [5.4, 4.4]]) {
    const q = tangent(offset);
    b.add(new THREE.BoxGeometry(0.72, height, 0.72), M.stone, { p: [q.x, height / 2, q.z], r });
    b.add(new THREE.BoxGeometry(1.0, 0.3, 1.0), M.stoneDark, { p: [q.x, 0.15, q.z], r });
  }

  // 侧板：把柱子之间填实，不然正面看就是四根孤立的杆
  for (const offset of [-4.05, 4.05]) {
    const q = tangent(offset);
    b.add(new THREE.BoxGeometry(1.5, 3.4, 0.3), M.stone, { p: [q.x, 1.7, q.z], r });
  }

  // 主梁 + 三层收分屋顶（宽度递减，读作屋檐）
  b.add(new THREE.BoxGeometry(12.2, 0.55, 1.5), M.trim, { p: [p.x, 5.35, p.z], r });
  b.add(new THREE.BoxGeometry(9.2, 0.42, 2.0), M.trim, { p: [p.x, 5.8, p.z], r });
  b.add(new THREE.BoxGeometry(5.6, 0.36, 1.7), M.trim, { p: [p.x, 6.2, p.z], r });
  b.add(new THREE.BoxGeometry(2.2, 0.32, 1.2), M.trim, { p: [p.x, 6.55, p.z], r });

  // 匾额：压在主梁下面、内柱之间
  b.add(new THREE.BoxGeometry(4.2, 0.62, 0.26), M.glow, { p: [p.x, 4.85, p.z], r });
}

/** 看台：三圈台阶，坐在墙外 */
function buildStands(b, M) {
  for (let t = 0; t < 3; t++) {
    const radius = 13.0 + t * 0.9;
    const height = 0.62 * (t + 1);
    const SEG = 32;
    const chord = 2 * radius * Math.sin(Math.PI / SEG) * 1.06;

    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      if (nearGate(a, GATE_ANGLES, 0.26)) continue;
      const p = ringPoint(radius, a);
      b.add(new THREE.BoxGeometry(chord, height, 0.95), M.stoneDark, {
        p: [p.x, height / 2, p.z],
        r: [0, a, 0],
      });
    }
  }
}

/** 中心法阵 + 6 个符文圈 */
function buildSeal(b, M, { centerR = 1.7, sigilR = 7, sigilSize = 1.15 } = {}) {
  b.add(new THREE.TorusGeometry(centerR, 0.09, 6, 40), M.glow, {
    p: [0, 0.03, 0],
    r: [-Math.PI / 2, 0, 0],
  });
  b.add(new THREE.RingGeometry(centerR - 0.22, centerR, 40), M.glow, {
    p: [0, 0.025, 0],
    r: [-Math.PI / 2, 0, 0],
  });

  for (const a of angles(6, Math.PI / 6)) {
    const p = ringPoint(sigilR, a);
    b.add(new THREE.TorusGeometry(sigilSize, 0.07, 5, 22), M.glow, {
      p: [p.x, 0.03, p.z],
      r: [-Math.PI / 2, 0, 0],
    });
    for (let k = 0; k < 3; k++) {
      b.add(new THREE.BoxGeometry(0.07, 0.04, sigilSize * 2), M.glow, {
        p: [p.x, 0.03, p.z],
        r: [0, (k / 3) * Math.PI, 0],
      });
    }
  }
}

/** 两个出生点的光圈 */
function buildSpawnRings(b, M, y = 0.04) {
  for (const z of [SPAWN_Z, -SPAWN_Z]) {
    b.add(new THREE.TorusGeometry(1.3, 0.08, 5, 26), M.glow, {
      p: [0, y, z],
      r: [-Math.PI / 2, 0, 0],
    });
  }
}

/* ================================================================
 * 地面（四种）
 * ================================================================ */

function floorFlat(b, M) {
  b.add(new THREE.CircleGeometry(FLOOR_R, 56), M.stone, { p: [0, 0, 0], r: [-Math.PI / 2, 0, 0] });
  // 同心石圈：原模型靠这几圈纹理撑住细节，纯色地板会显得很空
  for (const [r0, r1] of [[11.2, 11.45], [9.0, 9.2], [6.0, 6.2]]) {
    b.add(new THREE.RingGeometry(r0, r1, 56), M.stoneDark, {
      p: [0, 0.015, 0],
      r: [-Math.PI / 2, 0, 0],
    });
  }
}

function floorRift(b, M) {
  const INNER = 8;
  const OUTER = 11;

  // 中央台
  b.add(new THREE.CylinderGeometry(INNER, INNER, 1.0, 40), M.stoneDark, { p: [0, -0.5, 0] });
  b.add(new THREE.CircleGeometry(INNER, 40), M.stone, { p: [0, 0.01, 0], r: [-Math.PI / 2, 0, 0] });

  // 外环走道
  b.add(new THREE.RingGeometry(OUTER, FLOOR_R, 56), M.stone, {
    p: [0, 0, 0],
    r: [-Math.PI / 2, 0, 0],
  });
  b.add(new THREE.CylinderGeometry(FLOOR_R, FLOOR_R, 1.0, 56, 1, true), M.stoneDark, { p: [0, -0.5, 0] });

  // 裂谷里的岩浆面
  b.add(new THREE.RingGeometry(INNER, OUTER, 40), M.veil, {
    p: [0, -3.5, 0],
    r: [-Math.PI / 2, 0, 0],
  });

  // 两座桥，对齐 ±X 的门
  for (const a of [Math.PI / 2, (Math.PI * 3) / 2]) {
    const mid = ringPoint((INNER + OUTER) / 2, a);
    b.add(new THREE.BoxGeometry(OUTER - INNER + 0.8, 0.5, 2.6), M.stone, {
      p: [mid.x, -0.2, mid.z],
      r: [0, a, 0],
    });
    for (const s of [-1, 1]) {
      const rail = V(mid.x + Math.cos(a) * 1.35 * s, 0, mid.z - Math.sin(a) * 1.35 * s);
      b.add(new THREE.BoxGeometry(OUTER - INNER + 0.8, 0.35, 0.22), M.stoneDark, {
        p: [rail.x, 0.42, rail.z],
        r: [0, a, 0],
      });
    }
  }

  // 外圈地面上的岩浆缝
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.1;
    const p = ringPoint(11.5, a);
    b.add(new THREE.BoxGeometry(1.8, 0.05, 0.16), M.glow, {
      p: [p.x, 0.03, p.z],
      r: [0, a + 0.6, 0],
    });
  }
}

function floorTerrace(b, M) {
  const TOP = 7;
  const MID = 10;
  const H1 = 1.1;
  const H2 = 2.2;

  // 外环（0m）
  b.add(new THREE.RingGeometry(MID, FLOOR_R, 56), M.stone, {
    p: [0, 0.01, 0],
    r: [-Math.PI / 2, 0, 0],
  });

  // 中环（1.1m）
  b.add(new THREE.CylinderGeometry(MID, MID, H1, 56), M.stoneDark, { p: [0, H1 / 2, 0] });
  b.add(new THREE.RingGeometry(TOP, MID, 56), M.stone, {
    p: [0, H1 + 0.01, 0],
    r: [-Math.PI / 2, 0, 0],
  });

  // 顶台（2.2m）
  b.add(new THREE.CylinderGeometry(TOP, TOP, H2 - H1, 48), M.stoneDark, { p: [0, (H1 + H2) / 2, 0] });
  b.add(new THREE.CircleGeometry(TOP, 48), M.stone, {
    p: [0, H2 + 0.01, 0],
    r: [-Math.PI / 2, 0, 0],
  });

  // 台沿：三层同材质，全靠这两圈 0.5m 宽的暗色收边才看得出高差
  for (const [r, y] of [[MID, H1], [TOP, H2]]) {
    b.add(new THREE.RingGeometry(r - 0.5, r, 56), M.stoneDark, {
      p: [0, y + 0.02, 0],
      r: [-Math.PI / 2, 0, 0],
    });
  }

  // 四向台阶：5 级，从 r=7 走到 r=10
  for (const a of GATE_ANGLES) {
    for (let i = 0; i < 5; i++) {
      const r = TOP + i * 0.62;
      const h = H2 - i * (H2 / 5);
      const p = ringPoint(r + 0.3, a);
      b.add(new THREE.BoxGeometry(3.0, h, 0.7), M.stone, {
        p: [p.x, h / 2, p.z],
        r: [0, a, 0],
      });
    }
  }
}

function floorIslands(b, M) {
  // 中央台
  b.add(new THREE.CylinderGeometry(7, 5.6, 1.2, 32), M.stoneDark, { p: [0, -0.6, 0] });
  b.add(new THREE.CircleGeometry(7, 32), M.stone, { p: [0, 0.01, 0], r: [-Math.PI / 2, 0, 0] });

  // 五座浮岛 + 石桥
  for (const a of angles(5, Math.PI / 2)) {
    const p = ringPoint(10.5, a);
    b.add(new THREE.CylinderGeometry(3.2, 2.4, 1.0, 20), M.stoneDark, { p: [p.x, -0.5, p.z] });
    b.add(new THREE.CircleGeometry(3.2, 20), M.stoneDark, { p: [p.x, 0.01, p.z], r: [-Math.PI / 2, 0, 0] });

    const mid = ringPoint(8.7, a);
    b.add(new THREE.BoxGeometry(4.2, 0.4, 1.6), M.stone, { p: [mid.x, -0.1, mid.z], r: [0, a, 0] });
  }

  // 中央台的残破矮墙（只围 6 段，做出"曾经完整"的感觉）
  for (let i = 0; i < 18; i++) {
    if (i % 3 !== 0) continue;
    const a = (i / 18) * Math.PI * 2;
    const p = ringPoint(6.4, a);
    b.add(new THREE.BoxGeometry(1.9, 1.1 + (i % 2) * 0.4, 0.4), M.stoneDark, {
      p: [p.x, 0.6, p.z],
      r: [0, a, 0],
    });
  }
}

/* ================================================================
 * 远景（按主题）
 * ================================================================ */

function backdropCliffs(b, M) {
  // 近处崖壁：贴着看台外沿，这是原模型最有辨识度的一层
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.2;
    const r = 19 + (i % 4) * 2.4;
    const p = ringPoint(r, a);
    const h = 4.5 + (i % 5) * 1.4;
    b.add(new THREE.ConeGeometry(1.9 + (i % 3) * 0.5, h, 5), M.far, {
      p: [p.x, h / 2 - 1, p.z],
      r: [0, a, 0],
    });
  }
  // 远处山影
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.5;
    const p = ringPoint(26 + (i % 3) * 3.5, a);
    const h = 9 + (i % 4) * 3;
    b.add(new THREE.ConeGeometry(4.5, h, 4), M.far, { p: [p.x, h / 2 - 3, p.z], r: [0, a, 0] });
  }
}

function backdropLava(b, M) {
  // 岩浆湖
  b.add(new THREE.RingGeometry(13, 34, 40), M.veil, { p: [0, -4.2, 0], r: [-Math.PI / 2, 0, 0] });
  // 黑曜石尖峰
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.15;
    const r = 15 + (i % 5) * 2.6;
    const p = ringPoint(r, a);
    const h = 4 + (i % 6) * 1.8;
    b.add(new THREE.ConeGeometry(1.8 + (i % 3) * 0.5, h, 5), M.far, {
      p: [p.x, h / 2 - 2, p.z],
      r: [0, a, 0.06],
    });
  }
  // 烟柱
  for (let i = 0; i < 7; i++) {
    const p = ringPoint(22 + i * 2, i * 0.9);
    b.add(new THREE.CylinderGeometry(1.4, 2.2, 14, 6), M.far, { p: [p.x, 4, p.z] });
  }
}

function backdropDunes(b, M) {
  // 沙丘：压扁的球
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.3;
    const r = 16 + (i % 5) * 2.8;
    const p = ringPoint(r, a);
    b.add(new THREE.SphereGeometry(4 + (i % 4) * 1.4, 8, 6), M.stoneDark, {
      p: [p.x, -1.4, p.z],
      s: [1.6, 0.42, 1.2],
    });
  }
  // 半埋的巨型雕像头
  b.add(new THREE.SphereGeometry(3.4, 10, 8), M.stoneDark, { p: [0, 0.8, -21], s: [1, 0.9, 1.05] });
  b.add(new THREE.BoxGeometry(2.6, 0.5, 0.8), M.stoneDark, { p: [0, 0.55, -24] });
  for (const s of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.9, 1.8, 0.7), M.stoneDark, { p: [2.9 * s, 2.0, -21], r: [0, 0, 0.3 * s] });
  }
}

function backdropClouds(b, M) {
  // 云海：压扁的二十面体，越远越低
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.1;
    const r = 26 + (i % 5) * 4.0;
    const p = ringPoint(r, a);
    b.add(new THREE.IcosahedronGeometry(2.2 + (i % 3) * 0.7, 0), M.cloud, {
      p: [p.x, -13 - (i % 3) * 1.2, p.z],
      s: [1.6, 0.28, 1.6],
    });
  }
  // 远处的云塔
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const p = ringPoint(34 + (i % 4) * 4, a);
    b.add(new THREE.ConeGeometry(2.2, 6 + (i % 3) * 2, 6), M.cloud, {
      p: [p.x, -14, p.z],
      s: [1, 1, 0.8],
    });
  }
}

/* ================================================================
 * 组装
 * ================================================================ */

/** 出生点节点：名字必须和 scene3d 里取的一致 */
function addSpawns(group, y = 0) {
  const a = new THREE.Object3D();
  a.name = 'Arena_Spawn_A_Player';
  a.position.set(0, y, SPAWN_Z);
  group.add(a);

  const b = new THREE.Object3D();
  b.name = 'Arena_Spawn_B_Enemy';
  b.position.set(0, y, -SPAWN_Z);
  group.add(b);
}

/**
 * 建一张场地。
 * @param {'ring'|'rift'|'terrace'|'islands'} layout
 * @param {string} themeId night | lava | sand | cloud
 */
export function buildLayout(layout, themeId) {
  const M = createMaterials(themeId);
  const b = new Batch();
  const group = new THREE.Group();
  group.name = `Map_${layout}`;

  let spawnY = 0;
  let heightAt;
  let inside;

  if (layout === 'ring') {
    floorFlat(b, M);
    buildWall(b, M);
    buildPillars(b, M);
    for (const a of GATE_ANGLES) {
      if (a === GRAND_GATE_ANGLE) buildPaifang(b, M, a);
      else buildGate(b, M, a);
    }
    buildStands(b, M);
    buildSeal(b, M);
    buildSpawnRings(b, M);
    backdropCliffs(b, M);

    heightAt = () => 0;
    inside = (x, z) => Math.hypot(x, z) <= FLOOR_R + 0.6;
  } else if (layout === 'rift') {
    floorRift(b, M);
    buildWall(b, M);
    buildPillars(b, M);
    for (const a of GATE_ANGLES) {
      if (a === GRAND_GATE_ANGLE) buildPaifang(b, M, a);
      else buildGate(b, M, a);
    }
    buildStands(b, M);
    buildSeal(b, M);
    buildSpawnRings(b, M);
    backdropLava(b, M);

    const onBridge = (x, z) => Math.abs(z) <= 1.4 && Math.abs(x) >= 7.5 && Math.abs(x) <= 11.5;
    heightAt = (x, z) => {
      const r = Math.hypot(x, z);
      if (r <= 8 || (r >= 11 && r <= FLOOR_R) || onBridge(x, z)) return 0;
      return -6;
    };
    inside = (x, z) => heightAt(x, z) >= 0;
  } else if (layout === 'terrace') {
    floorTerrace(b, M);
    buildWall(b, M);
    buildPillars(b, M);
    for (const a of GATE_ANGLES) {
      if (a === GRAND_GATE_ANGLE) buildPaifang(b, M, a);
      else buildGate(b, M, a);
    }
    buildStands(b, M);
    buildSeal(b, M, { centerR: 1.2, sigilR: 4.6, sigilSize: 0.8 });
    buildSpawnRings(b, M, 2.24);
    backdropDunes(b, M);

    spawnY = 2.2;
    heightAt = (x, z) => {
      const r = Math.hypot(x, z);
      if (r < 7) return 2.2;
      if (r < 10) return 1.1;
      return 0;
    };
    inside = (x, z) => Math.hypot(x, z) <= FLOOR_R + 0.6;
  } else {
    floorIslands(b, M);
    buildPillars(b, M, 6.2, 6);
    buildSeal(b, M, { centerR: 1.2, sigilR: 4.2, sigilSize: 0.7 });
    buildSpawnRings(b, M);
    backdropClouds(b, M);

    const satellites = angles(5, Math.PI / 2).map((a) => ringPoint(10.5, a));
    heightAt = (x, z) => {
      if (Math.hypot(x, z) <= 7) return 0;
      for (const s of satellites) {
        if (Math.hypot(x - s.x, z - s.z) <= 3.2) return 0;
      }
      return -30;
    };
    inside = (x, z) => heightAt(x, z) >= 0;
  }

  addSpawns(group, spawnY);
  b.finish(group);

  const theme = THEME_DATA[themeId] ?? THEME_DATA.night;

  return {
    group,
    meta: {
      layout,
      theme: themeId,
      themeName: theme.name,
      radius: FLOOR_R,
      wallRadius: WALL_R,
      spawns: [V(0, spawnY, SPAWN_Z), V(0, spawnY, -SPAWN_Z)],
      heightAt,
      inside,
      tris: countTris(group),
      parts: group.children.length,
      finite: hasFinitePositions(group),
    },
  };
}

export { FLOOR_R, WALL_R, WALL_H, SPAWN_Z, GATE_ANGLES };
