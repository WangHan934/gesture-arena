import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
async function readGlb(name) {
  const bytes = await readFile(new URL(`assets/models/${name}.glb`, root));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON');
  return { bytes, json: JSON.parse(bytes.toString('utf8', 20, 20 + length)) };
}

test('all four original models are complete, self-contained GLB assets', async () => {
  const manifest = JSON.parse(await readFile(new URL('assets/models/manifest.json', root)));
  for (const [name, meshes] of [['fire',12],['shadow',11],['rock',11],['arena',10]]) {
    const { bytes, json } = await readGlb(name);
    assert.equal(json.meshes.length, meshes);
    assert.equal(json.buffers.length, 1);
    assert.equal(json.buffers[0].uri, undefined);
    assert(json.scenes[json.scene ?? 0].nodes.length > 0);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.models[name+'.glb'].sha256);
  }
  const comparison = manifest.user_mesh_geometry_matches || {};
  if (Object.keys(comparison).length) {
    assert.equal(Object.keys(comparison).length, 34);
    assert(Object.values(comparison).every(Boolean));
  }
});

test('the original eight fire animations and skin bindings survive export', async () => {
  const { json } = await readGlb('fire');
  assert.deepEqual(json.animations.map(a=>a.name).sort(), ['Attack','Cast','Death','Defend','Hit','Idle','Run','Walk']);
  assert(json.skins.length > 0);
  assert(json.skins[0].joints.length > 0);
  for (const animation of json.animations) assert(animation.channels.length > 0);
});

test('unrigged source monsters are not given replacement animations', async () => {
  for (const name of ['shadow','rock']) {
    const { json } = await readGlb(name);
    assert.equal((json.animations || []).length, 0);
    assert.equal((json.skins || []).length, 0);
  }
});

test('the arena retains original spawn anchors', async () => {
  const { json } = await readGlb('arena');
  const names = json.nodes.map(n=>n.name);
  assert(names.includes('Arena_Spawn_A_Player'));
  assert(names.includes('Arena_Spawn_B_Enemy'));
  assert(names.includes('Arena_Gate'));
});

test('local Three.js import map and loaders are present', async () => {
  const html = await readFile(new URL('index.html',root),'utf8');
  assert(html.includes('"three":"./vendor/three/build/three.module.js"'));
  for (const name of ['build/three.module.js','build/three.core.js','examples/jsm/loaders/GLTFLoader.js','examples/jsm/utils/BufferGeometryUtils.js','examples/jsm/utils/SkeletonUtils.js','LICENSE']) {
    assert((await readFile(new URL('vendor/three/'+name,root))).length > 0);
  }
  const main = await readFile(new URL('src/main.js',root),'utf8');
  assert(main.includes("import('./pvp/scene-3d.js')"));
  assert(!main.includes("getContext('2d')"));
});
