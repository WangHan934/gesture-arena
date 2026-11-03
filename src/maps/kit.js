/**
 * 场地构件工具
 * ==================================================================
 * 目标：用纯 Three.js 几何体拼出和 `arena.glb` **同尺寸、同命名**的场地，
 * 这样它能直接顶替 GLB，场景层一行都不用改。
 *
 * 尺寸基准（实测自 arena.glb，未缩放）：
 *   包围盒 60 × 13.84 × 60 → 地面半径 30，环墙在 r≈26.5
 *   出生点 ±5.5（scene3d 会再乘 ARENA_SCALE = 1.3）
 *   命名节点：Arena_Floor / Arena_Wall / Arena_Pillars / Arena_Gate /
 *            Arena_Stands / Arena_CenterSeal / Arena_SpawnRings /
 *            Arena_Spawn_A_Player / Arena_Spawn_B_Enemy
 *
 * 为什么要合并几何：
 *   一圈墙 48 段 + 12 根柱 + 看台 3 圈，逐个 Mesh 会有 200+ draw call。
 *   这里按材质把静态几何 merge 成几个大 Mesh，draw call 压到 10 以内。
 *   代价是不能单独动某一块 —— 但场地本来就是静态的，无所谓。
 */

import * as THREE from '../../vendor/three/lib/three.module.js';

export { THREE };

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 合并一堆几何体。
 *
 * 为什么不用 vendor 里的 BufferGeometryUtils：
 *   它内部 `import ... from 'three'`（裸模块名），浏览器靠 importmap 能解析，
 *   node 直接跑单测就 ERR_MODULE_NOT_FOUND。自己写 30 行，两边都能用。
 *
 * 做法：全部转成非索引，再拼 position / normal / uv 三个属性。
 * 顶点会变多（盒子 24 → 36），但三角面数不变，且省掉了合并时的索引偏移计算。
 */
function mergeSimple(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));

  let total = 0;
  for (const g of parts) total += g.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);

  let offset = 0;
  for (const g of parts) {
    const count = g.attributes.position.count;
    position.set(g.attributes.position.array, offset * 3);
    normal.set(g.attributes.normal.array, offset * 3);
    uv.set(g.attributes.uv.array, offset * 2);
    offset += count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/* ================================================================
 * 材质
 * ================================================================ */

export function mat(color, options = {}) {
  const {
    roughness = 0.9,
    metalness = 0.05,
    flat = true,
    opacity = 1,
    side = THREE.FrontSide,
    emissive = 0x000000,
    emissiveIntensity = 1,
    depthWrite = true,
    vertexColors = false,
    map = null,
  } = options;

  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    flatShading: flat,
    transparent: opacity < 1,
    opacity,
    side,
    emissive,
    emissiveIntensity,
    depthWrite,
    vertexColors,
    map,
  });
}

/* ================================================================
 * 合批器
 * ================================================================ */

/**
 * 按材质把几何体攒起来，最后 merge 成少量 Mesh。
 *
 * 用法：
 *   const b = new Batch();
 *   b.add(new THREE.BoxGeometry(1,2,1), stone, { p: [0,1,0], r: [0,0.5,0] });
 *   b.finish(group);
 */
export class Batch {
  constructor() {
    /** @type {Map<THREE.Material, THREE.BufferGeometry[]>} */
    this.buckets = new Map();
  }

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Material} material
   * @param {{p?:number[], r?:number[], s?:number[]}} [t] 平移 / 欧拉旋转 / 缩放
   */
  add(geo, material, t = {}) {
    const g = geo.clone();

    // 没有 uv 的自定义几何（三角面片）补一个，否则 merge 会因属性不一致失败
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }

    const p = t.p ?? [0, 0, 0];
    const r = t.r ?? [0, 0, 0];
    const s = t.s ?? [1, 1, 1];

    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p[0], p[1], p[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])),
      new THREE.Vector3(s[0], s[1], s[2]),
    );
    g.applyMatrix4(m);

    // 世界坐标 UV：按面的朝向做盒式投影，砖纹在不同大小的构件上才是同一个尺度
    if (t.uv) this._projectUV(g, t.uv);

    // 顶点色脏迹：每 0.6m 一个色块 + 接地压暗。
    // 纯色 flatShading 是「塑料感」的根源 —— 同一块石头每个面深浅一样，
    // 眼睛立刻判定它是假的。这一步不改面数、不用贴图，就能把表面做脏。
    this._paint(g);

    const list = this.buckets.get(material);
    if (list) list.push(g);
    else this.buckets.set(material, [g]);

    return this;
  }

  /**
   * 按世界坐标重写 UV（盒式投影）。
   * BoxGeometry 的 UV 是每个面 0~1，直接贴砖纹的话 0.9m 的柱子和 12m 的墙
   * 会得到同样数量的砖 —— 一个像马赛克，一个像巨石。按世界尺寸投影就没这问题。
   */
  _projectUV(g, tile) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    if (!pos || !nor) return;

    const n = pos.count;
    const uv = new Float32Array(n * 2);

    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));

      let u;
      let v;
      if (ny >= nx && ny >= nz) {
        u = x / tile;
        v = z / tile;
      } else if (nx >= nz) {
        u = z / tile;
        v = y / tile;
      } else {
        u = x / tile;
        v = y / tile;
      }
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }

    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }

  /** 按世界坐标给顶点刷一层明暗扰动 + 接地 AO */
  _paint(g) {
    const pos = g.attributes.position;
    if (!pos) return;

    const n = pos.count;
    const colors = new Float32Array(n * 3);

    const hash = (x, y, z) => {
      const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      return v - Math.floor(v);
    };

    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      // 0.6m 一格：色块够大，看起来像石头本身的深浅，而不是噪点
      const h = hash(Math.floor(x / 0.6), Math.floor(y / 0.6), Math.floor(z / 0.6));
      let v = 0.84 + h * 0.2;

      // 接地压暗：贴地的面更深，等于一个廉价的 AO
      const ao = 0.85 + 0.15 * Math.min(1, Math.max(0, y / 1.2));
      v *= ao;

      colors[i * 3] = v;
      colors[i * 3 + 1] = v;
      colors[i * 3 + 2] = Math.min(1.05, v * 1.03); // 冷一点点，和暖光形成互补
    }

    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }

  /** 把攒好的几何合并后挂到 group 上 */
  finish(group) {
    for (const [material, geos] of this.buckets) {
      const merged = geos.length === 1 ? geos[0] : mergeSimple(geos);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/* ================================================================
 * 常用形状
 * ================================================================ */

/** 圆环上按角度取点（0° 在 +Z 方向，顺时针） */
export function ringPoint(radius, angle) {
  return V(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
}

/** 一圈等分的角度 */
export function angles(count, offset = 0) {
  return Array.from({ length: count }, (_, i) => offset + (i / count) * Math.PI * 2);
}

/** 某个角度是否落在门洞里（用来在墙上开洞） */
export function nearGate(angle, gateAngles, halfWidthRad) {
  for (const g of gateAngles) {
    let d = Math.abs(angle - g) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < halfWidthRad) return true;
  }
  return false;
}

/** 统计三角面数 */
export function countTris(root) {
  let tris = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return Math.round(tris);
}

/** 顶点必须全部有限，否则整帧黑屏 */
export function hasFinitePositions(root) {
  let ok = true;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const attr = o.geometry.attributes.position;
    if (!attr) return;
    for (let i = 0; i < attr.array.length; i++) {
      if (!Number.isFinite(attr.array[i])) {
        ok = false;
        return;
      }
    }
  });
  return ok;
}
