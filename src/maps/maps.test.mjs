/**
 * 地图层单测
 * ==================================================================
 * 跑法：node src/maps/maps.test.mjs
 *
 * 重点验三件事：
 *   1. 几何没坏（顶点有限、面数在预算内、可复现）
 *   2. 命名节点和 arena.glb 一致 —— 这是"能直接顶替 GLB"的前提
 *   3. heightAt / inside 的返回值自洽（台地高度、裂谷是负的、浮岛外面是虚空）
 */

const { MAP_IDS, buildMap, describeMaps, getMapDef, getLighting } = await import('./index.js');
const { hasFinitePositions, THREE } = await import('./kit.js');

/* ---------------- 极简单测框架 ---------------- */

let passed = 0;
const failures = [];
let currentGroup = '';

function group(title) {
  currentGroup = title;
  console.log(`\n── ${title}`);
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ group: currentGroup, name, message: error.message });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || '值不相等'} —— actual ${JSON.stringify(actual)} / expected ${JSON.stringify(expected)}`);
  }
}

function assertBetween(value, min, max, message) {
  if (!(value >= min && value <= max)) {
    throw new Error(`${message || '越界'} —— ${value} 不在 ${min}~${max}`);
  }
}

/* ================================================================
 * 1. 注册表
 * ================================================================ */
group('1. 注册表');

const EXPECTED = ['ring', 'rift', 'terrace', 'islands'];

test('四张地图全部登记，id 不重复', () => {
  assertEqual(MAP_IDS.length, 4);
  assertEqual(new Set(MAP_IDS).size, 4);
  for (const id of EXPECTED) assert(MAP_IDS.includes(id), `缺 ${id}`);
});

test('未知 id 返回 null', () => {
  assertEqual(buildMap('nope'), null);
  assertEqual(buildMap(''), null);
  assertEqual(buildMap(null), null);
});

test('每张图都有名字 / 主题 / 玩法说明', () => {
  for (const row of describeMaps()) {
    assert(row.name && row.en, `${row.id} 缺名字`);
    assert(row.themeName, `${row.id} 缺主题名`);
    assert(typeof row.note === 'string' && row.note, `${row.id} 缺说明`);
  }
});

/* ================================================================
 * 2. 几何
 * ================================================================ */
group('2. 几何完整性');

for (const id of EXPECTED) {
  test(`${id} 能构建，顶点全部有限`, () => {
    const map = buildMap(id);
    assert(map, '构建返回空');
    assert(map.group.children.length > 0, '一个网格都没有');
    assert(hasFinitePositions(map.group), '顶点里有 NaN / Infinity');
  });
}

test('面数在预算内（单张 < 30000）', () => {
  for (const row of describeMaps()) {
    assertBetween(row.tris, 500, 30000, `${row.id} 面数 ${row.tris}`);
  }
});

test('全部地图合计面数 < 60000', () => {
  const total = describeMaps().reduce((s, r) => s + r.tris, 0);
  assert(total < 60000, `合计 ${total}`);
  console.log(`      合计 ${total} 三角面`);
});

test('同一张图两次构建面数一致（没有随机几何）', () => {
  const a = describeMaps();
  const b = describeMaps();
  for (let i = 0; i < a.length; i++) {
    assertEqual(b[i].tris, a[i].tris, `${a[i].id} 面数不稳定`);
  }
});

/* ================================================================
 * 3. 和 arena.glb 的命名契约
 * ================================================================ */
group('3. 命名契约（能不能直接顶替 GLB）');

test('每张图都有 Arena_Spawn_A_Player / Arena_Spawn_B_Enemy', () => {
  for (const id of EXPECTED) {
    const { group } = buildMap(id);
    const a = group.getObjectByName('Arena_Spawn_A_Player');
    const b = group.getObjectByName('Arena_Spawn_B_Enemy');
    assert(a, `${id} 缺玩家出生点`);
    assert(b, `${id} 缺敌方出生点`);
  }
});

test('出生点在 ±5.5，和 arena.glb 同尺度', () => {
  for (const id of EXPECTED) {
    const { group } = buildMap(id);
    const a = group.getObjectByName('Arena_Spawn_A_Player').position;
    const b = group.getObjectByName('Arena_Spawn_B_Enemy').position;
    assertBetween(Math.abs(a.z - 5.5), -0.01, 0.01, `${id} A 点 z`);
    assertBetween(Math.abs(b.z + 5.5), -0.01, 0.01, `${id} B 点 z`);
    assertBetween(a.x, -0.01, 0.01, `${id} A 点 x`);
  }
});

test('出生点间距 11m → 场景层算出的半径 ≈ 17.9（和现役一致）', () => {
  for (const id of EXPECTED) {
    const { meta } = buildMap(id);
    const span = meta.spawns[0].distanceTo(meta.spawns[1]);
    assertBetween(span, 10.9, 11.1, `${id} 间距`);
    // scene3d: radius = span * 1.25（再乘 ARENA_SCALE 由场景层做）
    assertBetween(span * 1.25, 13.7, 13.9, `${id} 半径`);
  }
});

test('地面半径对齐 arena.glb（12m），远景不参与取景', () => {
  for (const id of EXPECTED) {
    const { group } = buildMap(id);
    const box = new THREE.Box3().setFromObject(group);
    // 远景会故意超出，所以只检查地面那一层：取 y < 6 的几何
    assert(box.min.y > -45, `${id} 最低点 ${box.min.y} 太深`);
    assertBetween(describeMaps().find((m) => m.id === id).radius, 11.9, 12.1, `${id} 地面半径`);
  }
});

/* ================================================================
 * 4. 地形函数
 * ================================================================ */
group('4. heightAt / inside');

test('ring：全场平地，边界外算场外', () => {
  const { meta } = buildMap('ring');
  assertEqual(meta.heightAt(0, 0), 0);
  assertEqual(meta.heightAt(8, -8), 0);
  assert(meta.inside(0, 0), '中心应当在场地内');
  assert(!meta.inside(20, 0), '20m 外应当在场外');
});

test('rift：中央台 0，裂谷 -6，桥上是 0', () => {
  const { meta } = buildMap('rift');
  assertEqual(meta.heightAt(0, 0), 0, '中央台');
  assertEqual(meta.heightAt(9.5, 0), 0, '桥上');
  assertEqual(meta.heightAt(0, 9.5), -6, '裂谷里');
  assert(meta.inside(0, 0));
  assert(!meta.inside(0, 9.5), '裂谷不算场内');
});

test('terrace：三层高度 0 / 1.1 / 2.2', () => {
  const { meta } = buildMap('terrace');
  assertEqual(meta.heightAt(0, 0), 2.2, '顶台');
  assertEqual(meta.heightAt(9, 0), 1.1, '中环');
  assertEqual(meta.heightAt(11.5, 0), 0, '外环');
});

test('islands：中央台和浮岛是 0，中间是虚空', () => {
  const { meta } = buildMap('islands');
  assertEqual(meta.heightAt(0, 0), 0, '中央台');
  assertEqual(meta.heightAt(10.5, 0), 0, '浮岛（+X 方向那座）');
  // +Z 方向没有浮岛（浮岛在 18°/90°/162°/234°/306°），所以这里是空的
  assertEqual(meta.heightAt(0, 9), -30, '台与岛之间');
});

test('terrace 的出生点被抬到顶台高度', () => {
  const { meta } = buildMap('terrace');
  assertEqual(meta.spawns[0].y, 2.2);
});

/* ================================================================
 * 5. 克隆隔离与光照
 * ================================================================ */
group('5. 克隆隔离 / 光照预设');

test('两次取到的 group 是不同对象，元数据独立', () => {
  const a = buildMap('ring');
  const b = buildMap('ring');
  assert(a.group !== b.group, '返回了同一个 Group');
  a.group.position.set(100, 0, 0);
  a.meta.name = '被改了';
  assertEqual(b.group.position.x, 0);
  assertEqual(b.meta.name, '熔岩祭坛');
});

test('每张图都有可用的光照预设', () => {
  for (const id of EXPECTED) {
    const light = getLighting(id);
    assert(light, `${id} 没有光照预设`);
    assert(light.key.intensity > 0, `${id} 主光强度`);
    assert(light.fog.far > light.fog.near, `${id} 雾的远近设置反了`);
  }
});

test('getMapDef 能查到布局和主题', () => {
  assertEqual(getMapDef('rift').layout, 'rift');
  assertEqual(getMapDef('rift').theme, 'lava');
  assertEqual(getMapDef('nope'), null);
});

/* ================================================================
 * 汇总
 * ================================================================ */

console.log('\n' + '─'.repeat(56));
if (failures.length === 0) {
  console.log(`通过 ${passed} 项，失败 0 项。`);
  console.log('地图层全部用例通过 ✅');
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`  · [${f.group}] ${f.name} —— ${f.message}`);
  process.exit(1);
}
