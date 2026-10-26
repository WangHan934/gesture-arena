/**
 * 人机对战的 3D 场景
 * ==================================================================
 * 和 PvP 的 scene-3d.js 是两份独立实现，故意不共享状态：
 * 现场只要这个模式出问题，另一边的联网对战不受影响。
 *
 * 炎角战魔有骨骼动画就直接播；紫晶影魔、幽晶岩魔源文件没有绑定，
 * 用根节点位移（前冲 / 后仰 / 倒下）给反馈，不伪造骨骼动作。
 */

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from '../../vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { CombatFX } from '../fx/combat-fx.js';

const URLS = {
  fire: new URL('../../assets/models/fire.glb', import.meta.url).href,
  shadow: new URL('../../assets/models/shadow.glb', import.meta.url).href,
  rock: new URL('../../assets/models/rock.glb', import.meta.url).href,
  arena: new URL('../../assets/models/arena.glb', import.meta.url).href,
};

const IDS = ['fire', 'shadow', 'rock'];

/** 三只怪兽的属性和特效颜色（和 PvP 的怪兽表一致） */
const ELEMENT_COLOR = { fire: '#ff8a3d', shadow: '#b388ff', rock: '#9fd8ff' };

export class SoloScene {
  constructor(canvas, onStatus) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.templates = {};
    this.fighters = [];
    this.preview = null;
    this.mode = 'select';
    this.loaded = false;
    this.lost = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#171221');
    this.scene.fog = new THREE.Fog('#171221', 28, 65);

    this.camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150);
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

    this.resizeObserver = new ResizeObserver(() => this.fit());
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.lost = true;
      this.onStatus?.('error', '3D 显示中断，请刷新页面；战斗计时会暂停。');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.onStatus?.('ready', '3D 显示已恢复');
    });

    this.ready = this.load();

    // 打斗特效：命中火花、碎石、能量束、脚底光圈、镜头震动
    this.fx = new CombatFX(this.scene);
    this.time = 0;
    this._camBase = new THREE.Vector3();
  }

  mount(host) {
    if (!host || this.canvas.parentElement === host) return;
    this.resizeObserver.disconnect();
    host.appendChild(this.canvas);
    this.resizeObserver.observe(host);
    this.fit();
  }

  fit() {
    const host = this.canvas.parentElement;
    const width = host?.clientWidth || 1;
    const height = host?.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async load() {
    this.onStatus?.('loading', '正在加载竞技场与怪兽…');
    const loader = new GLTFLoader();
    const results = await Promise.allSettled(Object.entries(URLS).map(async ([id, url]) => {
      const gltf = await loader.loadAsync(url);
      return [id, gltf];
    }));
    const failed = [];
    results.forEach((result, index) => {
      const id = Object.keys(URLS)[index];
      if (result.status === 'fulfilled') {
        const [loadedId, gltf] = result.value;
        this.templates[loadedId] = gltf;
      } else {
        failed.push(id);
      }
    });
    if (this.templates.arena) {
      this.arena = this.templates.arena.scene;
      this.scene.add(this.arena);
    }
    this.loaded = true;
    if (failed.length) {
      this.onStatus?.('error', `模型加载失败：${failed.join('、')}，请检查 assets/models/`);
    } else {
      this.onStatus?.('ready', '竞技场就绪');
    }
    return this;
  }

  /** 从模板克隆一只，并把脚底对齐到地面 */
  build(id, height) {
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

    const mixer = new THREE.AnimationMixer(object);
    return {
      id, root, object, mixer, clips: template.animations || [],
      action: null, timer: 0, lunge: 0, recoil: 0, fall: 0, dead: false,
      base: new THREE.Vector3(), facing: 1,
    };
  }

  /** 选怪阶段：只站一只，正面看 */
  showSelect(id) {
    this.mode = 'select';
    this.clearFighters();
    if (this.preview) {
      this.scene.remove(this.preview.root);
      this.preview.mixer.stopAllAction();
      this.preview = null;
    }
    const model = this.build(id, 5.2);
    if (!model) return;
    model.root.position.set(0, 0.26, 0);
    this.scene.add(model.root);
    this.preview = model;
    this.playModel(model, 'Idle');
    this.camera.position.set(0, 5.2, 12.5);
    this.camera.lookAt(0, 2.2, 0);
    this._camBase.copy(this.camera.position);
  }

  /** 战斗：双方就位 */
  showFight(playerId, enemyId) {
    this.mode = 'fight';
    if (this.preview) {
      this.scene.remove(this.preview.root);
      this.preview.mixer.stopAllAction();
      this.preview = null;
    }
    this.clearFighters();
    // 相机在右前方斜侧，双方各侧 20 度，能看到侧面轮廓而不是纯背影/纯正面
    const layout = [
      { id: playerId, spawn: 'Arena_Spawn_A_Player', facing: Math.PI * 0.89, fallback: [0, 0, 5.5] },
      { id: enemyId, spawn: 'Arena_Spawn_B_Enemy', facing: -Math.PI * 0.11, fallback: [0, 0, -5.5] },
    ];
    layout.forEach((slot, seat) => {
      const model = this.build(slot.id, 4.1);
      if (!model) return;
      const anchor = this.arena?.getObjectByName(slot.spawn);
      const position = anchor
        ? anchor.getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(...slot.fallback);
      position.y += 0.25;
      model.root.position.copy(position);
      model.root.rotation.y = slot.facing;
      model.seat = seat;
      model.base.copy(position);
      model.facing = seat === 0 ? -1 : 1;
      model.color = ELEMENT_COLOR[slot.id] ?? '#ffb45a';
      this.scene.add(model.root);
      this.fighters.push(model);
      model.ring = this.fx.addRing(model.root, model.color, 1.7);
      this.playModel(model, 'Idle');
    });
    this.camera.position.set(15.5, 7.6, 13.5);
    this.camera.lookAt(0, 2.1, 0);
    this._camBase.copy(this.camera.position);
  }

  clearFighters() {
    for (const fighter of this.fighters) {
      this.fx.removeRing(fighter.ring);
      fighter.mixer.stopAllAction();
      fighter.mixer.uncacheRoot(fighter.object);
      this.scene.remove(fighter.root);
    }
    this.fighters = [];
  }

  playModel(model, name, once = false) {
    const clip = model.clips.find(c => c.name === name);
    if (clip) {
      const next = model.mixer.clipAction(clip);
      if (model.action === next && next.isRunning() && !once) return;
      model.action?.fadeOut(0.12);
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once;
      next.fadeIn(0.12).play();
      model.action = next;
      model.timer = once && name !== 'Death' ? clip.duration : 0;
      return;
    }
    // 没有骨骼动画的模型：用根节点位移给一个能看懂的反馈
    if (name === 'Attack' || name === 'Cast') model.lunge = 0.34;
    else if (name === 'Hit') model.recoil = 0.3;
    else if (name === 'Defend') model.timer = 0.5;
  }

  /** 对外：按座位播一个动作 */
  play(seat, name) {
    const fighter = this.fighters.find(f => f.seat === seat);
    if (fighter) this.playModel(fighter, name, name !== 'Idle');
  }

  die(seat) {
    const fighter = this.fighters.find(f => f.seat === seat);
    if (!fighter || fighter.dead) return;
    fighter.dead = true;
    if (fighter.clips.some(c => c.name === 'Death')) this.playModel(fighter, 'Death', true);
    else fighter.fall = 0.001; // 交给 update 做倒下
    // 倒下瞬间爆一下，比单纯播动画有打击感
    this.fx.impact(this._bodyPoint(fighter), { color: fighter.color, heavy: true });
  }

  /** 命中特效。seat = 被打的那一方 */
  impact(seat, { heavy = false } = {}) {
    const fighter = this.fighters.find(f => f.seat === seat);
    if (!fighter) return;
    this.fx.impact(this._bodyPoint(fighter), { color: fighter.color, heavy });
  }

  /** 远程能量束：fromSeat 打到 toSeat */
  beam(fromSeat, toSeat, { color = null } = {}) {
    const from = this.fighters.find(f => f.seat === fromSeat);
    const to = this.fighters.find(f => f.seat === toSeat);
    if (!from || !to) return;
    this.fx.beam(this._bodyPoint(from), this._bodyPoint(to), { color: color ?? from.color });
  }

  /** 躯干高度，特效打这里最像「被打到」 */
  _bodyPoint(fighter) {
    const point = fighter.root.position.clone();
    point.y += 2.3;
    return point;
  }

  update(dt) {
    if (this.lost) return;
    for (const model of [this.preview, ...this.fighters].filter(Boolean)) {
      model.mixer.update(dt);
      if (model.timer > 0) {
        model.timer -= dt;
        if (model.timer <= 0 && !model.dead) this.playModel(model, 'Idle');
      }
      if (model.lunge > 0) {
        model.lunge = Math.max(0, model.lunge - dt);
        const push = Math.sin((1 - model.lunge / 0.34) * Math.PI) * 1.1;
        model.root.position.z = model.base.z + push * model.facing;
      } else if (model.recoil > 0) {
        model.recoil = Math.max(0, model.recoil - dt);
        const push = Math.sin((1 - model.recoil / 0.3) * Math.PI) * 0.7;
        model.root.position.z = model.base.z - push * model.facing;
      } else if (model.base) {
        model.root.position.z = model.base.z;
      }
      if (model.fall > 0) {
        model.fall = Math.min(1, model.fall + dt * 1.4);
        model.root.rotation.z = -model.fall * 1.35;
        model.root.position.y = model.base.y - model.fall * 0.4;
      }
    }

    this.time += dt;
    this.fx.update(dt, this.time);
    // 震动只改相机位置，不碰朝向；相机还没摆过（选怪前）就跳过
    if (this._camBase.lengthSq() > 0) {
      this.camera.position.copy(this._camBase).add(this.fx.shakeOffset(this.time));
    }

    this.renderer.render(this.scene, this.camera);
  }
}
