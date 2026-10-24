/**
 * 单机玩法的 3D 渲染层
 * ==================================================================
 * 用队友那套 3D 竞技场和怪兽模型，来渲染「塔防制」和「1v1 决斗」两个旧玩法。
 *
 * 【为什么不直接用 pvp/scene-3d.js 的 Arena3D】
 *   Arena3D 的 setState() 和 PvP 的状态结构（state.players / state.battle / seat）绑死了，
 *   而且构造时就会把三只怪兽摆成图鉴。单机玩法没有那套状态。
 *   这里只复用它的「资产和摆位约定」：同一批 GLB、同样的光照、竞技场里的命名出生点。
 *
 * 【坐标怎么映射】
 *   旧玩法的坐标是 2D 逻辑坐标（x ∈ 0..WORLD.width），这里映射到竞技场的两个出生点之间：
 *     t = x / WORLD.width
 *     position = lerp(出生点A, 出生点B, t)
 *   这样两种玩法共用一套映射：
 *     塔防：我方塔在 t≈0.07，敌方塔在 t≈0.93，生物沿这条路走
 *     决斗：玩家在 t 较小一侧，敌人 t≈0.71
 *
 * 【生物怎么对应模型】
 *   旧玩法有 4 只生物，3D 资源只有 3 只怪兽，所以按体型/气质对应，
 *   巨魔没有独立模型，用岩魔放大来区分。见 MODEL_OF / HEIGHT_OF。
 */

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from '../../vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { WORLD } from '../config.js';

/** 旧生物 id → 3D 模型 id */
const MODEL_OF = { stone: 'rock', fox: 'fire', bird: 'shadow', brute: 'rock' };
/** 旧生物 id → 3D 里的高度（巨魔没有独立模型，靠体型区分） */
const HEIGHT_OF = { stone: 2.6, fox: 2.2, bird: 2.4, brute: 3.7 };

const URLS = {
  fire: new URL('../../assets/models/fire.glb', import.meta.url).href,
  shadow: new URL('../../assets/models/shadow.glb', import.meta.url).href,
  rock: new URL('../../assets/models/rock.glb', import.meta.url).href,
  arena: new URL('../../assets/models/arena.glb', import.meta.url).href,
};

/** 生物退场动画保留多久（秒），播完再移除 */
const RETIRE_TIME = 0.45;

/** 推进路线相对两个出生点的拉伸倍数，让两端的塔站到场地边缘 */
const LANE_SCALE = 1.32;

/** 水晶塔比生物再往外拉一点，站到竞技场边缘 */
const TOWER_LANE_SCALE = 1.58;

/** 决斗里敌人固定在路线的这个位置（0 = 我方端，1 = 敌方端） */
const DUEL_ENEMY_T = 0.68;

export class ClassicScene3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(state:string, message:string) => void} [onStatus]
   */
  constructor(canvas, onStatus = () => {}) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.loaded = false;
    this.lost = false;
    this.kind = null;      // 'tower' | 'duel'
    this.units = new Map(); // key → { key, model, kind, retiring }
    this.templates = {};

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#171221');
    this.scene.fog = new THREE.Fog('#171221', 30, 70);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;

    this.scene.add(new THREE.HemisphereLight(0xe2d9ff, 0x4a3241, 2.7));
    const key = new THREE.DirectionalLight(0xffecd2, 4.2);
    key.position.set(4, 12, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9b85ff, 3);
    rim.position.set(-9, 7, -8);
    this.scene.add(rim);

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      this.onStatus('error', '3D 显示中断，请刷新页面；画板和键盘仍可用。');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.onStatus('ready', '3D 显示已恢复');
    });

    this.resize = new ResizeObserver(() => this.fit());
    if (canvas.parentElement) this.resize.observe(canvas.parentElement);
    this.fit();
  }

  /* ---------------- 资源 ---------------- */

  async load() {
    this.onStatus('loading', '正在加载竞技场与怪兽模型…');
    const loader = new GLTFLoader();
    const entries = Object.entries(URLS);

    const results = await Promise.allSettled(
      entries.map(async ([id, url]) => [id, await loader.loadAsync(url)]),
    );

    const failed = [];
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        const [id, gltf] = result.value;
        this.templates[id] = gltf;
      } else {
        failed.push(entries[i][0]);
        console.error(`[3D] 加载失败 ${entries[i][1]}`, result.reason);
      }
    }

    if (this.templates.arena) {
      this.arena = this.templates.arena.scene;
      this.scene.add(this.arena);
    }

    // 竞技场里带命名的出生点，两个单位沿这两个点对峙
    this.spawnA = this._spawn('Arena_Spawn_A_Player', new THREE.Vector3(0, 0.25, 5.5));
    this.spawnB = this._spawn('Arena_Spawn_B_Enemy', new THREE.Vector3(0, 0.25, -5.5));

    this.loaded = true;
    this.fit();
    this._frameCamera();

    if (failed.length) {
      this.onStatus('error', `模型加载失败：${failed.join('、')}，画面会缺少对应怪兽。`);
      return false;
    }
    this.onStatus('ready', '竞技场与怪兽模型已加载');
    return true;
  }

  _spawn(name, fallback) {
    const node = this.arena?.getObjectByName(name);
    if (!node) return fallback;
    const pos = node.getWorldPosition(new THREE.Vector3());
    pos.y += 0.25;
    return pos;
  }

  /* ---------------- 尺寸与相机 ---------------- */

  fit() {
    const host = this.canvas.parentElement;
    const width = host?.clientWidth || 1;
    const height = host?.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _frameCamera() {
    // 侧后方的三分之四视角，既看得到整条推进路线，也看得到怪兽侧面
    this.camera.position.set(11, 7.2, 8.6);
    this.camera.lookAt(0, 1.5, 0);
  }

  /* ---------------- 主入口 ---------------- */

  /**
   * @param {{mode:string, world:any}} view 模式层给出的视图模型
   * @param {number} dt
   */
  render(view, dt) {
    if (!this.loaded || this.lost) return;

    const kind = view.mode === 'duel' ? 'duel' : 'tower';
    if (kind !== this.kind) {
      this._clearUnits();
      this.kind = kind;
      this._frameCamera();
    }

    if (kind === 'duel') this._syncDuel(view.world);
    else this._syncTower(view.world);

    this._updateUnits(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------- 塔防 ---------------- */

  _syncTower(world) {
    const seen = new Set();

    for (const creature of world?.creatures ?? []) {
      const key = `c${creature.id}`;
      seen.add(key);
      const unit = this._ensureUnit(key, creature.def?.id, 'creature');
      if (!unit) continue;

      const t = creature.x / WORLD.width;
      this._placeAlongLane(unit, t, creature.side === 'player' ? 1 : -1);

      // 受击/出手时切动画，其余时间待机
      if (creature.hitFlash > 0) this._play(unit.model, 'Hit', true);
      else if (creature.attackPulse > 0) this._play(unit.model, 'Attack', true);
      else this._play(unit.model, 'Idle');

      // 出场时从小到大，别凭空蹦出来
      const pop = creature.spawnAnim ?? 1;
      unit.model.root.scale.setScalar(unit.baseScale * (0.35 + 0.65 * pop));
    }

    this._retireMissing(seen);

    // 塔：用晶体代替，高度随血量收缩
    this._syncTowerCrystal('towerPlayer', 0, world?.playerTower);
    this._syncTowerCrystal('towerEnemy', 1, world?.enemyTower);
  }

  _syncTowerCrystal(key, which, tower) {
    if (!tower) return;
    let unit = this.units.get(key);
    if (!unit) {
      const geo = new THREE.OctahedronGeometry(0.9, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: which === 0 ? 0x6fa8ff : 0xff7a6b,
        emissive: which === 0 ? 0x1b3a80 : 0x7a1f18,
        metalness: 0.35,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const root = new THREE.Group();
      root.add(mesh);
      this.scene.add(root);
      unit = { key, root, mesh, model: null, kind: 'tower', retiring: 0 };
      this.units.set(key, unit);
    }

    const ratio = Math.max(0.08, tower.hp / tower.maxHp);
    const scale = 0.7 + ratio * 0.6;
    unit.mesh.scale.setScalar(scale);
    // 八面体半径 0.9，底面贴地要抬 0.9×scale，否则会浮在半空
    unit.mesh.position.y = 0.9 * scale;
    unit.mesh.rotation.y += 0.01;

    const t = which === 0 ? WORLD.playerTowerX / WORLD.width : WORLD.enemyTowerX / WORLD.width;
    unit.root.position.copy(this._lanePoint(t, TOWER_LANE_SCALE));
  }

  /* ---------------- 决斗 ---------------- */

  _syncDuel(world) {
    if (!world?.player || !world?.enemy) return;

    // 不能直接拿 fighter.x 映射 —— 那是 2D 屏幕坐标（150~710），
    // 摊到 3D 巷道里双方会挤在中间重叠。改用玩法层的 distance：
    // 贴身（0）站到敌人跟前，最远（1）退到自己这端。
    const d = Math.min(1, Math.max(0, world.distance ?? 0));
    // 贴身（0）→ 0.42，最远（1）→ 0.18，让对峙点落在场地中心附近
    const tPlayer = 0.42 - d * 0.24;

    this._syncFighter('duelPlayer', world.player, 1, world.lunge?.player ?? 0, tPlayer);
    this._syncFighter('duelEnemy', world.enemy, -1, world.lunge?.enemy ?? 0, DUEL_ENEMY_T);

    // 被打了就闪一下（用受击动画代替颜色闪烁）
    if (world.hit?.player > 0.1) this._play(this.units.get('duelPlayer')?.model, 'Hit', true);
    if (world.hit?.enemy > 0.1) this._play(this.units.get('duelEnemy')?.model, 'Hit', true);
  }

  _syncFighter(key, fighter, facing, lunge, t) {
    const unit = this._ensureUnit(key, fighter.id, 'fighter');
    if (!unit) return;

    unit.jitter = 0; // 决斗是正面对峙，不做横向错开
    this._placeAlongLane(unit, t, facing, lunge);
    unit.model.root.scale.setScalar(unit.baseScale);
  }

  /* ---------------- 摆位 ---------------- */

  /** 沿两个出生点之间的连线取点。scale 把这条线往两端撑开 */
  _lanePoint(t, scale = LANE_SCALE) {
    const clamped = Math.min(1, Math.max(0, t));
    const a = this.spawnA;
    const b = this.spawnB;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const point = a.clone().lerp(b, clamped);
    // 以中点为中心向外拉伸
    return mid.clone().add(point.sub(mid).multiplyScalar(scale));
  }

  /** 巷道方向的单位向量 */
  _laneDir() {
    return this.spawnB.clone().sub(this.spawnA).normalize();
  }

  /** 巷道方向的垂直向量，用来把生物横向摊开，避免全挤在一条线上 */
  _laneSide() {
    return new THREE.Vector3().crossVectors(this._laneDir(), new THREE.Vector3(0, 1, 0)).normalize();
  }

  /**
   * 放到推进路线的 t 位置。
   * @param {number} facing 1 = 朝出生点B方向（敌方），-1 = 朝A
   * @param {number} lunge 0~1，出手时往前冲一点
   */
  _placeAlongLane(unit, t, facing, lunge = 0) {
    const dir = this._laneDir();
    unit.root.position.copy(this._lanePoint(t));

    // 横向错开：让多只生物并排推进而不是叠在一起
    unit.root.position.addScaledVector(this._laneSide(), (unit.jitter ?? 0) * 1.9);

    if (lunge > 0) {
      unit.root.position.addScaledVector(dir, facing * Math.min(1, lunge * 4) * 0.55);
    }

    // 朝向：模型默认朝 -Z，路线方向是 A→B
    const angle = Math.atan2(dir.x, dir.z);
    unit.root.rotation.y = facing > 0 ? angle : angle + Math.PI;
  }

  /* ---------------- 单位池 ---------------- */

  _ensureUnit(key, creatureId, role) {
    const existing = this.units.get(key);
    if (existing) return existing;

    const modelId = MODEL_OF[creatureId] ?? 'fire';
    const template = this.templates[modelId];
    if (!template) return null;

    const model = this._makeModel(modelId, HEIGHT_OF[creatureId] ?? 2.4);
    if (!model) return null;

    const unit = {
      key,
      model,
      role,
      root: model.root,
      baseScale: model.root.scale.x,
      jitter: (Math.random() - 0.5) * 2,
      retiring: 0,
    };

    this.scene.add(model.root);
    this._play(model, 'Idle');
    this.units.set(key, unit);
    return unit;
  }

  /** 克隆模板，把脚底对齐到 y=0，再按目标高度缩放 */
  _makeModel(id, height) {
    const template = this.templates[id];
    if (!template) return null;

    const object = clone(template.scene);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));

    const root = new THREE.Group();
    root.add(object);
    root.scale.setScalar(height / Math.max(0.001, size.y));

    return {
      id,
      root,
      object,
      mixer: new THREE.AnimationMixer(object),
      clips: template.animations ?? [],
      action: null,
      timer: 0,
      dead: false,
    };
  }

  _play(model, name, once = false) {
    // 注意：这里要的是「模型」不是「单位包装对象」，传错会直接把主循环搞挂
    if (!model || !Array.isArray(model.clips)) return;
    const clip = model.clips.find((c) => c.name === name);
    if (!clip) return; // 没有这个动作就保持当前状态，不伪造
    const next = model.mixer.clipAction(clip);
    if (model.action === next && next.isRunning() && !once) return;

    model.action?.fadeOut(0.12);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(0.12).play();
    model.action = next;
    model.timer = once && name !== 'Death' ? clip.duration : 0;
  }

  /** 生物被打死后 creatures 里就没有了，这里补一个退场动画再移除 */
  _retireMissing(seen) {
    for (const [key, unit] of this.units) {
      if (unit.kind === 'tower' || unit.retiring > 0) continue;
      if (seen.has(key)) continue;
      unit.retiring = RETIRE_TIME;
      if (unit.model) this._play(unit.model, 'Death', true);
    }
  }

  _updateUnits(dt) {
    for (const [key, unit] of this.units) {
      if (unit.model) {
        unit.model.mixer.update(dt);
        if (unit.model.timer > 0) {
          unit.model.timer -= dt;
          if (unit.model.timer <= 0 && !unit.model.dead) this._play(unit.model, 'Idle');
        }
      }

      if (unit.retiring > 0) {
        unit.retiring -= dt;
        if (unit.retiring <= 0) this._removeUnit(key);
      }
    }
  }

  _removeUnit(key) {
    const unit = this.units.get(key);
    if (!unit) return;
    if (unit.model) {
      unit.model.mixer.stopAllAction();
      unit.model.mixer.uncacheRoot(unit.model.object);
    }
    this.scene.remove(unit.root);
    this.units.delete(key);
  }

  _clearUnits() {
    for (const key of [...this.units.keys()]) this._removeUnit(key);
  }

  destroy() {
    this._clearUnits();
    this.resize.disconnect();
    this.renderer.dispose();
  }
}
