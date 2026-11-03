/**
 * 熔岩祭坛（中式地狱）· 新默认场地
 * ==================================================================
 * 替换原来的圆环场。不改任何玩法逻辑：
 *   出生点仍在 ±5.5、可玩半径仍是 12、`heightAt` 在场地内一律返回 0。
 *   台阶只是**外观**往下沉，战斗单位站的高度不变。
 *
 * 为什么台阶要往下沉而不是往上垒：
 *   战斗层把单位固定在 y≈0（见 scene3d 的 _placeAlongLane / _syncTower），
 *   一旦把中央台抬高，单位就会陷进台阶里。让中心最高、向外逐级下沉，
 *   单位仍然站在 y=0 的那一层，视觉上有台阶、逻辑上一行不用改。
 *
 * 参考图 → 实现的对应：
 *   三层同心台阶   → TOP 7.5 / MID 10 / OUT 12，每级 -0.45
 *   中央 + 六法阵  → 中心 r=2.6，外圈 r=8.3（用 MagicCircle，自带旋转呼吸）
 *   环形残墙       → 300° 弧，正面留 60° 缺口（不挡镜头、不挡单位）
 *   塔柱 + 火盆    → 10 根，柱顶火盆位置回传给粒子系统
 *   中式牌楼       → 放在 -Z，正对镜头远处
 *   火山岩 + 岩浆  → 场外 r>13.5 的岩浆环 + 岩柱
 */

import { THREE, V, Batch, ringPoint, angles, countTris, hasFinitePositions } from './kit.js';
import { createMaterials, THEME_DATA } from './themes.js';
import { createTextures } from './textures.js';

/* ================================================================
 * 尺寸（未缩放，和 arena.glb 同一坐标系）
 * ================================================================ */

const TOP_R = 7.5;    // 中央台（出生点 ±5.5 在这里）
const MID_R = 10;     // 第二层
const OUT_R = 12;     // 第三层，也是可玩边界
const WALL_R = 12.35; // 城墙
const STEP = 0.45;    // 每级下沉高度
const WALL_H = 3.2;
const SPAWN_Z = 5.5;

/** 正面缺口：镜头在 +Z 方向，这里留空才不挡单位 */
const FRONT_GAP = Math.PI / 3; // 60°
const GATE_ANGLES = [Math.PI / 2, (Math.PI * 2) / 3, (Math.PI * 4) / 3, (Math.PI * 3) / 2];

/* ================================================================
 * 地面：三层同心
 * ================================================================ */

function buildTiers(b, M) {
  // 中央台（y=0）
  b.add(new THREE.CircleGeometry(TOP_R, 64), M.floor, { p: [0, 0, 0], r: [-Math.PI / 2, 0, 0] });
  // 第一级立面
  b.add(new THREE.CylinderGeometry(TOP_R, TOP_R, STEP, 64, 1, true), M.stone, {
    p: [0, -STEP / 2, 0],
    uv: 1.6,
  });
  // 第二层（y=-0.45）
  b.add(new THREE.RingGeometry(TOP_R, MID_R, 64), M.stone, {
    p: [0, -STEP, 0],
    r: [-Math.PI / 2, 0, 0],
    uv: 1.6,
  });
  b.add(new THREE.CylinderGeometry(MID_R, MID_R, STEP, 64, 1, true), M.stone, {
    p: [0, -STEP * 1.5, 0],
    uv: 1.6,
  });
  // 第三层（y=-0.9）
  b.add(new THREE.RingGeometry(MID_R, OUT_R, 64), M.stone, {
    p: [0, -STEP * 2, 0],
    r: [-Math.PI / 2, 0, 0],
    uv: 1.6,
  });
  // 外沿挡墙（压住岩浆）
  b.add(new THREE.CylinderGeometry(OUT_R, OUT_R, 1.2, 64, 1, true), M.stoneDark, {
    p: [0, -STEP * 2 - 0.6, 0],
    uv: 1.6,
  });

  // 台沿：每级加一圈暗色收边，否则同材质看不出高差
  for (const [r, y] of [[TOP_R, 0], [MID_R, -STEP]]) {
    b.add(new THREE.RingGeometry(r - 0.28, r, 64), M.stoneDark, {
      p: [0, y + 0.012, 0],
      r: [-Math.PI / 2, 0, 0],
    });
  }
}

/* ================================================================
 * 环形残墙 + 塔柱 + 拱门
 * ================================================================ */

function buildWall(b, M, braziers) {
  const SEG = 56;
  const baseY = -STEP * 2;
  const chord = 2 * WALL_R * Math.sin(Math.PI / SEG) * 1.06;

  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;

    // 正面缺口
    let d = Math.abs(a) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < FRONT_GAP / 2) continue;

    // 拱门位置留空
    let isGate = false;
    for (const g of GATE_ANGLES) {
      let dg = Math.abs(a - g) % (Math.PI * 2);
      if (dg > Math.PI) dg = Math.PI * 2 - dg;
      if (dg < 0.16) isGate = true;
    }
    if (isGate) continue;

    // 残破：每 6 段塌一截
    const broken = i % 6 === 3;
    const h = broken ? WALL_H * 0.45 : WALL_H;

    const p = ringPoint(WALL_R, a);
    b.add(new THREE.BoxGeometry(chord, h, 0.62), M.stone, {
      p: [p.x, baseY + h / 2, p.z],
      r: [0, a, 0],
      uv: 1.6,
    });

    if (!broken && i % 3 === 0) {
      b.add(new THREE.BoxGeometry(chord * 0.5, 0.4, 0.7), M.stoneDark, {
        p: [p.x, baseY + h + 0.2, p.z],
        r: [0, a, 0],
        uv: 1.6,
      });
    }
  }

  /* 塔柱 + 火盆：只放在有墙的角度上 */
  const towerAngles = angles(12, Math.PI / 12).filter((a) => {
    let d = Math.abs(a) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d > FRONT_GAP / 2 + 0.12;
  });

  for (const a of towerAngles) {
    const p = ringPoint(WALL_R, a);
    const r = [0, a, 0];
    const y = baseY;

    b.add(new THREE.BoxGeometry(1.5, 0.5, 1.5), M.stoneDark, { p: [p.x, y + 0.25, p.z], r, uv: 1.6 });
    b.add(new THREE.BoxGeometry(1.15, 3.9, 1.15), M.stone, { p: [p.x, y + 2.45, p.z], r, uv: 1.6 });
    b.add(new THREE.BoxGeometry(1.45, 0.32, 1.45), M.stoneDark, { p: [p.x, y + 4.56, p.z], r, uv: 1.6 });

    // 火盆：铁盆 + 火焰锥
    b.add(new THREE.CylinderGeometry(0.52, 0.34, 0.42, 10), M.trim, { p: [p.x, y + 4.93, p.z], r });

    braziers.push(V(p.x, y + 5.0, p.z));
  }

  /* 拱门：券石 + 门楣 */
  for (const a of GATE_ANGLES) {
    const p = ringPoint(WALL_R, a);
    const r = [0, a, 0];
    const half = 1.35;

    for (const s of [-1, 1]) {
      const q = V(p.x + Math.cos(a) * half * s, 0, p.z - Math.sin(a) * half * s);
      b.add(new THREE.BoxGeometry(0.7, WALL_H + 0.5, 0.8), M.stone, {
        p: [q.x, baseY + (WALL_H + 0.5) / 2, q.z],
        r,
        uv: 1.6,
      });
    }
    b.add(new THREE.BoxGeometry(3.4, 0.7, 0.9), M.stoneDark, {
      p: [p.x, baseY + WALL_H + 0.75, p.z],
      r,
      uv: 1.6,
    });
    // 券顶（半圆用几个小方块拼，比圆环省面）
    for (let k = -2; k <= 2; k++) {
      const off = k * 0.55;
      const q = V(p.x + Math.cos(a) * off, 0, p.z - Math.sin(a) * off);
      const lift = Math.cos((k / 5) * Math.PI) * 0.34;
      b.add(new THREE.BoxGeometry(0.6, 0.42, 0.9), M.stone, {
        p: [q.x, baseY + WALL_H + 1.28 + lift, q.z],
        r,
        uv: 1.6,
      });
    }
  }
}

/* ================================================================
 * 中式牌楼
 * ================================================================ */

function buildPaifang(b, M) {
  const angle = Math.PI; // -Z，正对镜头远处
  const p = ringPoint(WALL_R, angle);
  const r = [0, angle, 0];
  const baseY = -STEP * 2;
  const tangent = (o) => V(p.x + Math.cos(angle) * o, 0, p.z - Math.sin(angle) * o);

  for (const [offset, height] of [[-5.2, 5.6], [-2.6, 6.6], [2.6, 6.6], [5.2, 5.6]]) {
    const q = tangent(offset);
    b.add(new THREE.BoxGeometry(0.85, height, 0.85), M.stone, {
      p: [q.x, baseY + height / 2, q.z],
      r,
      uv: 1.6,
    });
    b.add(new THREE.BoxGeometry(1.15, 0.4, 1.15), M.stoneDark, { p: [q.x, baseY + 0.2, q.z], r, uv: 1.6 });
  }

  // 侧板
  for (const offset of [-3.9, 3.9]) {
    const q = tangent(offset);
    b.add(new THREE.BoxGeometry(1.7, 4.4, 0.35), M.stone, {
      p: [q.x, baseY + 2.2, q.z],
      r,
      uv: 1.6,
    });
  }

  // 主梁 + 三层收分屋顶
  const beams = [
    [12.4, 0.62, 1.7, 6.75],
    [9.4, 0.48, 2.2, 7.25],
    [5.8, 0.4, 1.9, 7.7],
    [2.4, 0.34, 1.4, 8.05],
  ];
  for (const [w, h, d, y] of beams) {
    b.add(new THREE.BoxGeometry(w, h, d), M.trim, { p: [p.x, baseY + y, p.z], r, uv: 1.6 });
  }

  // 匾额（自发光）
  b.add(new THREE.BoxGeometry(4.6, 0.72, 0.3), M.glow, { p: [p.x, baseY + 6.1, p.z], r });
}

/* ================================================================
 * 场外：火山岩 + 岩浆
 * ================================================================ */

function buildLavaField(b, M) {
  const baseY = -STEP * 2;

  // 岩浆只铺一圈窄带，外面全部用黑岩盖住 —— 露出的是"裂缝"，不是一整片橙
  b.add(new THREE.RingGeometry(13.0, 20.5, 48), M.veil, {
    p: [0, baseY - 1.6, 0],
    r: [-Math.PI / 2, 0, 0],
  });

  // 黑岩地台：压在岩浆上，只在缝隙里露光
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + 0.12;
    const rr = 14.2 + (i % 4) * 1.9;
    const p = ringPoint(rr, a);
    const w = 3.2 + (i % 3) * 1.4;
    b.add(new THREE.BoxGeometry(w, 0.7, 2.6 + (i % 2) * 1.1), M.stoneDark, {
      p: [p.x, baseY - 1.45, p.z],
      r: [0, a + (i % 5) * 0.1, 0],
      uv: 1.6,
    });
  }

  // 岩浆河：从外圈往远处拉的几条发光带
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const p = ringPoint(16 + (i % 3) * 2.4, a);
    b.add(new THREE.BoxGeometry(0.42, 0.1, 5 + (i % 4) * 1.8), M.glow, {
      p: [p.x, baseY - 1.5, p.z],
      r: [0, a, 0],
    });
  }

  // 火山岩柱：两层，近处矮、远处高
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.15;
    const r = 15.5 + (i % 5) * 2.2;
    const p = ringPoint(r, a);
    const h = 3.4 + (i % 6) * 1.5;
    b.add(new THREE.ConeGeometry(1.5 + (i % 3) * 0.5, h, 5), M.far, {
      p: [p.x, baseY - 1.2 + h / 2, p.z],
      r: [0, a, 0.05],
    });
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.6;
    const p = ringPoint(26 + (i % 3) * 4, a);
    const h = 8 + (i % 4) * 3;
    b.add(new THREE.ConeGeometry(3.2, h, 4), M.far, {
      p: [p.x, baseY - 2 + h / 2, p.z],
      r: [0, a, 0],
    });
  }

  // 正面缺口的矮碎石，避免"墙突然断掉"
  for (let i = -3; i <= 3; i++) {
    const a = (i / 3) * (FRONT_GAP / 2) * 0.8;
    const p = ringPoint(WALL_R, a);
    b.add(new THREE.BoxGeometry(1.4, 0.5 + Math.abs(i) * 0.12, 0.9), M.stoneDark, {
      p: [p.x, baseY + 0.3, p.z],
      r: [0, a, 0],
      uv: 1.6,
    });
  }
}

/* ================================================================
 * 组装
 * ================================================================ */

export function buildAltar() {
  const tex = createTextures();
  const M = createMaterials('inferno', tex);
  const b = new Batch();
  const group = new THREE.Group();
  group.name = 'Map_altar';

  const braziers = [];

  buildTiers(b, M);
  buildWall(b, M, braziers);
  buildPaifang(b, M);
  buildLavaField(b, M);

  // 出生点节点
  for (const [name, z] of [['Arena_Spawn_A_Player', SPAWN_Z], ['Arena_Spawn_B_Enemy', -SPAWN_Z]]) {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(0, 0, z);
    group.add(node);
  }

  b.finish(group);

  const theme = THEME_DATA.inferno;

  return {
    group,
    meta: {
      layout: 'altar',
      theme: 'inferno',
      themeName: theme.name,
      radius: OUT_R,
      wallRadius: WALL_R,
      spawns: [V(0, 0, SPAWN_Z), V(0, 0, -SPAWN_Z)],
      /** 场地内一律 0：台阶只是外观，玩法不能跟着变 */
      heightAt: (x, z) => (Math.hypot(x, z) <= OUT_R ? 0 : -6),
      inside: (x, z) => Math.hypot(x, z) <= OUT_R,
      /** 法阵位置：中心 + 外圈六个 */
      sigils: [
        { x: 0, z: 0, radius: 2.6, y: 0.02 },
        ...angles(6, Math.PI / 6).map((a) => {
          const p = ringPoint(8.3, a);
          return { x: p.x, z: p.z, radius: 1.9, y: -STEP + 0.02 };
        }),
      ],
      /** 火盆位置，粒子系统按这个撒火 */
      braziers,
      tris: countTris(group),
      parts: group.children.length,
      finite: hasFinitePositions(group),
    },
  };
}

export { TOP_R, MID_R, OUT_R, WALL_R, STEP, SPAWN_Z };
