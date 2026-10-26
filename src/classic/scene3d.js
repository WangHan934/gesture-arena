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
 *
 * 【伤害跳字】
 *   血量变化由渲染层自己比对（不靠玩法层推事件），两种玩法共用一条路径：
 *     决斗 = 整块伤害，立刻跳；塔防 = dps × dt 的碎伤害，攒 0.25 秒跳一次整数。
 *   攒的逻辑在 damage-tracker.js，画在 floaters.js 的 2D 覆盖层上。
 */

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from '../../vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { WORLD } from '../config.js';
import { DamageTracker } from './damage-tracker.js';
import { FloatingNumbers } from './floaters.js';
import { CombatFX } from '../fx/combat-fx.js';
import { sfx } from '../audio/sfx.js';

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

/** 伤害跳字的颜色：打敌人是金色，自己挨打是红色 */
const DAMAGE_COLOR = { enemy: '#ffe08a', player: '#ff8a8a' };

/** 跳字多大算「大字」：塔防按占血量的比例，决斗按单次伤害值 */
const BIG_RATIO = 0.06;
const BIG_DUEL_VALUE = 22;

/** 手势 id → 符号形状，出手时在角色身前勾出来 */
const GESTURE_SHAPE = {
  circle: 'circle',
  line_h: 'line_h',
  line_v: 'line_v',
  zigzag: 'zigzag',
  v_shape: 'v_shape',
  triangle: 'triangle',
  square: 'square',
  two: 'two',
};

export class ClassicScene3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(state:string, message:string) => void} [onStatus]
   * @param {{fxCanvas?: HTMLCanvasElement | null}} [options]
   *   fxCanvas = 盖在 3D 画布上的透明层，用来画伤害跳字。不给就只不画跳字
   */
  constructor(canvas, onStatus = () => {}, { fxCanvas = null } = {}) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.loaded = false;
    this.lost = false;
    this.kind = null;      // 'tower' | 'duel'
    this.units = new Map(); // key → { key, model, kind, retiring }
    this.templates = {};

    // 伤害跳字：血量变化由 DamageTracker 攒，FloatingNumbers 负责画
    this.floaters = fxCanvas ? new FloatingNumbers(fxCanvas) : null;
    this.damage = new DamageTracker();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#120d1c');
    this.scene.fog = new THREE.Fog('#120d1c', 24, 58);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    // 打斗特效：命中火花、碎石、能量束、脚底光圈、镜头震动。
    // 注意必须放在 scene 建好之后 —— 它构造时就会往场景里塞粒子池
    this.fx = new CombatFX(this.scene);
    this.time = 0;
    this._camBase = new THREE.Vector3();
    this._baseFov = this.camera.fov;
    // 上一次播过的手势序号 / 上一帧玩家的走位位置
    this._gestureSeq = 0;
    this._lastPlayerT = undefined;

    this.scene.add(new THREE.HemisphereLight(0xcbd6ff, 0x2a1c2e, 1.85));
    const key = new THREE.DirectionalLight(0xffd9b0, 3.5);
    key.position.set(4, 12, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7f6bff, 4.4);
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
    // 覆盖层必须跟着改尺寸，否则跳字会错位
    this.floaters?.resize();
  }

  _frameCamera() {
    // 侧后方的三分之四视角，既看得到整条推进路线，也看得到怪兽侧面
    this.camera.position.set(11, 7.2, 8.6);
    this.camera.lookAt(0, 1.5, 0);
    this._camBase.copy(this.camera.position);
  }

  /* ---------------- 主入口 ---------------- */

  /**
   * @param {{mode:string, world:any}} view 模式层给出的视图模型
   * @param {number} dt
   */
  render(view, dt) {
    if (!this.loaded || this.lost) {
      // 3D 没了就别留着上一帧的字
      if (this.floaters?.items.length) this.floaters.clear();
      return;
    }

    const kind = view.mode === 'duel' ? 'duel' : 'tower';
    if (kind !== this.kind) {
      this._clearUnits();
      this.kind = kind;
      this._frameCamera();
    }

    if (kind === 'duel') this._syncDuel(view.world);
    else this._syncTower(view.world);

    this._updateUnits(dt);
    this._flushDamage(dt);

    this.time += dt;
    this.fx.update(dt, this.time);
    // 震动只改相机位置，不碰朝向，避免画面晃得人晕
    this.camera.position.copy(this._camBase).add(this.fx.shakeOffset(this.time));
    // 重击时镜头轻轻推近，再自己弹回
    const fov = this._baseFov - this.fx.fovOffset();
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);

    // 投影要用渲染后的相机矩阵，所以放在 render 之后
    this.floaters?.update(dt);
    this.floaters?.draw(this.camera);
  }

  /* ---------------- 塔防 ---------------- */

  _syncTower(world) {
    const seen = new Set();

    for (const creature of world?.creatures ?? []) {
      const key = `c${creature.id}`;
      seen.add(key);
      const unit = this._ensureUnit(key, creature.def?.id, 'creature', creature.def?.color);
      if (!unit) continue;

      const t = creature.x / WORLD.width;
      this._placeAlongLane(unit, t, creature.side === 'player' ? 1 : -1);

      // 这一帧有没有在往前走
      const moved = unit.lastT !== undefined && Math.abs(t - unit.lastT) > 0.0004;
      unit.lastT = t;

      // 受击/出手时切动画，走路时播 Walk，其余时间待机
      if (creature.hitFlash > 0) this._play(unit.model, 'Hit', true);
      else if (creature.attackPulse > 0) this._play(unit.model, 'Attack', true);
      else if (moved) this._play(unit.model, 'Walk');
      else this._play(unit.model, 'Idle');

      // 刚体模型（紫晶影魔 / 幽晶岩魔）没有 Walk 动画，用上下颠一下代替走路
      if (moved && !this._hasClip(unit.model, 'Walk')) {
        unit.root.position.y += Math.abs(Math.sin(this.time * 9 + unit.bobPhase)) * 0.14;
      }

      // 出场时从小到大，别凭空蹦出来
      const pop = creature.spawnAnim ?? 1;
      unit.model.root.scale.setScalar(unit.baseScale * (0.35 + 0.65 * pop));

      this._noteDamage(unit, creature.side, creature.hp, creature.maxHp);
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
      unit = {
        key,
        root,
        mesh,
        model: null,
        kind: 'tower',
        retiring: 0,
        side: which === 0 ? 'player' : 'enemy',
        headY: 1.9, // 晶体顶到这里的跳字高度
        color: which === 0 ? '#6fa8ff' : '#ff7a6b',
        ring: null,
      };
      unit.ring = this.fx.addRing(root, unit.color, 1.35);
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

    this._noteDamage(unit, unit.side, tower.hp, tower.maxHp);
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

    // 玩家在走位（distance 变化）时播走路
    const playerUnit = this.units.get('duelPlayer');
    if (playerUnit) {
      const moved = this._lastPlayerT !== undefined && Math.abs(tPlayer - this._lastPlayerT) > 0.0004;
      this._lastPlayerT = tPlayer;
      if (moved && !world.lunge?.player) {
        if (this._hasClip(playerUnit.model, 'Walk')) this._play(playerUnit.model, 'Walk');
        else playerUnit.root.position.y += Math.abs(Math.sin(this.time * 9 + playerUnit.bobPhase)) * 0.12;
      }
    }

    // 手势符号 + 对应动作（seq 变了才播一次）
    this._playGesture(world.gesture);

    // 被打了就闪一下（用受击动画代替颜色闪烁）
    if (world.hit?.player > 0.1) this._play(this.units.get('duelPlayer')?.model, 'Hit', true);
    if (world.hit?.enemy > 0.1) this._play(this.units.get('duelEnemy')?.model, 'Hit', true);
  }

  _syncFighter(key, fighter, facing, lunge, t) {
    const unit = this._ensureUnit(key, fighter.id, 'fighter', fighter.color);
    if (!unit) return;

    unit.jitter = 0; // 决斗是正面对峙，不做横向错开
    this._placeAlongLane(unit, t, facing, lunge);
    unit.model.root.scale.setScalar(unit.baseScale);

    this._noteDamage(unit, fighter.side, fighter.hp, fighter.maxHp);
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

  _ensureUnit(key, creatureId, role, color = '#ffb45a') {
    const existing = this.units.get(key);
    if (existing) {
      // 决斗重开时换了一只生物：key 没变但模型要跟着换，
      // 否则会一直用上一局那只的模型和身高（跳字高度也会错）
      if (existing.creatureId === creatureId) return existing;
      this._removeUnit(key);
    }

    const modelId = MODEL_OF[creatureId] ?? 'fire';
    const template = this.templates[modelId];
    if (!template) return null;

    const model = this._makeModel(modelId, HEIGHT_OF[creatureId] ?? 2.4);
    if (!model) return null;

    const unit = {
      key,
      creatureId,
      model,
      role,
      root: model.root,
      baseScale: model.root.scale.x,
      jitter: (Math.random() - 0.5) * 2,
      retiring: 0,
      // 跳字从头顶冒出来，高度用生物的实际身高（巨魔会更高）
      headY: HEIGHT_OF[creatureId] ?? 2.4,
      // 刚体模型走路时上下颠的相位，避免全场同步
      bobPhase: Math.random() * Math.PI * 2,
      // 特效颜色跟着生物属性走：火系橙、岩系青、影系紫
      color,
      ring: null,
    };

    this.scene.add(model.root);
    this._play(model, 'Idle');
    unit.ring = this.fx.addRing(model.root, color, unit.headY * 0.42);
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

  /** 这个模型有没有某个动画片段（刚体模型一个都没有） */
  _hasClip(model, name) {
    return Boolean(model?.clips?.some((clip) => clip.name === name));
  }

  _play(model, name, once = false) {    // 注意：这里要的是「模型」不是「单位包装对象」，传错会直接把主循环搞挂
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
      // 倒下瞬间来一发爆点，比单纯播动画有打击感
      this.fx.impact(this._bodyPoint(unit), { color: unit.color ?? '#ffb45a', heavy: true });
      sfx.death();
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

  /* ---------------- 伤害跳字 ----------------
   * 血量变化不靠玩法层推送事件，而是渲染层自己比对：
   *   决斗 world 里 fighter.hp 是整块减少的，一比对就是一次攻击；
   *   塔防 creature.hp 是 dps × dt 逐帧减少的，交给 DamageTracker 攒时间片。
   * 这样两种玩法共用一条代码路径，玩法层一行都不用改。
   */

  _noteDamage(unit, side, hp, maxHp) {
    if (!unit || !this.floaters) return;
    unit.side = side === 'player' ? 'player' : 'enemy';

    const out = this.damage.note(unit.key, hp, maxHp, { instant: this.kind === 'duel' });
    if (out) this._popDamage(unit, out);
  }

  _popDamage(unit, { value, ratio }) {
    const big = this.kind === 'duel' ? value >= BIG_DUEL_VALUE : ratio >= BIG_RATIO;
    this._spawnFloater(unit, `-${value}`, DAMAGE_COLOR[unit.side] ?? DAMAGE_COLOR.enemy, big);

    const point = this._bodyPoint(unit);
    const color = unit.color ?? '#ffb45a';

    // 决斗里的大招是远程手段：先打一道能量束过去，再在对方身上爆开
    if (big && this.kind === 'duel') {
      const from = this._oppositeBodyPoint(unit);
      if (from) this.fx.beam(from, point, { color });
      sfx.beam();
    }

    this.fx.impact(point, { color, heavy: big });
    if (big) {
      // 重击再加一圈地面冲击波 + 镜头推近，打击感主要来自这两下
      this.fx.shockwave(point, { color, radius: 2.6, life: 0.45 });
      this.fx.punch(0.7);
    }
    if (unit.kind === 'tower') sfx.towerHit();
    else sfx.impact({ heavy: big });
  }

  /** 躯干高度：特效打在这里最像「被打到」，打脚底会像踩地，打头顶会飘 */
  _bodyPoint(unit) {
    const point = unit.root.position.clone();
    point.y += (unit.headY ?? 2.4) * 0.55;
    return point;
  }

  /** 决斗里对手的躯干位置，用来当能量束的起点 */
  _oppositeBodyPoint(unit) {
    const other = this.units.get(unit.key === 'duelPlayer' ? 'duelEnemy' : 'duelPlayer');
    return other ? this._bodyPoint(other) : null;
  }

  /** 身前半个身位，符号勾在这里，朝着对手 */
  _frontOf(unit, other) {
    const point = this._bodyPoint(unit);
    point.y += 1.15;
    if (other) {
      const dir = other.root.position.clone().sub(unit.root.position).setY(0).normalize();
      point.addScaledVector(dir, 1.8);
    }
    return point;
  }

  /**
   * 手势 → 身前勾出符号 + 播对应动作。
   * 用自增 seq 判断，同一个手势只播一次。
   */
  _playGesture(gesture) {
    if (!gesture || gesture.seq === this._gestureSeq) return;
    this._gestureSeq = gesture.seq;
    if (!gesture.id) return;

    const unit = this.units.get('duelPlayer');
    if (!unit) return;

    const enemy = this.units.get('duelEnemy');
    this.fx.symbol(this._frontOf(unit, enemy), GESTURE_SHAPE[gesture.id] ?? 'circle', {
      color: unit.color ?? '#9fd8ff',
      size: 2.4,
    });

    // 有骨骼就播对应动作；刚体模型靠 _syncFighter 的前冲给反馈
    if (gesture.id === 'zigzag') this._play(unit.model, 'Attack', true);
    else if (gesture.id === 'v_shape') this._play(unit.model, 'Cast', true);
    else if (gesture.id === 'line_h') this._play(unit.model, 'Walk', true);
  }

  /** 塔防攒够一个时间片的伤害，在这里统一跳出来 */
  _flushDamage(dt) {
    if (!this.floaters) return;
    for (const entry of this.damage.tick(dt)) {
      const unit = this.units.get(entry.key);
      if (unit) this._popDamage(unit, entry);
    }
  }

  _spawnFloater(unit, text, color, big) {
    if (!this.floaters) return;
    const pos = unit.root.position.clone();
    pos.y += (unit.headY ?? 2.4) * 0.95;
    // 同一只怪连续挨打时，字别精确叠在一起
    pos.x += (Math.random() - 0.5) * 0.7;
    pos.z += (Math.random() - 0.5) * 0.7;
    this.floaters.spawn(text, pos, { color, big });
  }

  _removeUnit(key) {
    const unit = this.units.get(key);
    if (!unit) return;
    if (unit.model) {
      unit.model.mixer.stopAllAction();
      unit.model.mixer.uncacheRoot(unit.model.object);
    }
    this.fx.removeRing(unit.ring);
    this.scene.remove(unit.root);
    this.units.delete(key);
    this.damage.forget(key); // 记录跟着单位一起走，否则打一局会攒下几百条
  }

  _clearUnits() {
    for (const key of [...this.units.keys()]) this._removeUnit(key);
    this.damage.clear();
    this.floaters?.clear();
  }

  destroy() {
    this._clearUnits();
    this.fx.dispose();
    this.resize.disconnect();
    this.renderer.dispose();
  }
}
