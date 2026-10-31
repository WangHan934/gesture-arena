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
import { ArenaDressing } from '../fx/arena-dressing.js';
import { HealthBarLayer, BAR_GAP } from '../fx/health-bar.js';
import { ModelFlash } from '../fx/model-flash.js';
import { MagicCircle } from '../fx/magic-circle.js';

/** 背景天空：竖直渐变，上近黑、地平线透紫，给暗色场景一点纵深 */
function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#07050f');
  gradient.addColorStop(0.55, '#150d29');
  gradient.addColorStop(0.82, '#2a1a4a');
  gradient.addColorStop(1, '#150d29');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const URLS = {
  fire: new URL('../../assets/models/fire.glb', import.meta.url).href,
  shadow: new URL('../../assets/models/shadow.glb', import.meta.url).href,
  rock: new URL('../../assets/models/rock.glb', import.meta.url).href,
  arena: new URL('../../assets/models/arena.glb', import.meta.url).href,
};

const IDS = ['fire', 'shadow', 'rock'];

/** 三只怪兽的属性和特效颜色（和 PvP 的怪兽表一致） */
const ELEMENT_COLOR = { fire: '#ff8a3d', shadow: '#b388ff', rock: '#9fd8ff' };

/** 战斗时怪兽身高，血条按它算头顶位置 */
const FIGHTER_HEIGHT = 4.9;

/** 技能 id → 手势符号，用来在角色身前勾出这次的招式 */
const SYMBOL_OF = {
  circle: 'circle',
  line_v: 'line_v',
  line_h: 'line_h',
  two: 'two',
  triangle: 'triangle',
  square: 'square',
};

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
    // 背景用一张竖直渐变贴图，比纯色更有纵深：上方近黑，地平线透一点紫
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog('#191033', 30, 82);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 160);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 比之前更暗一点：暗底才能让魔法阵和角色轮廓光「亮得出来」
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // 三灯打光：紫色环境 + 金色主光（带阴影）+ 冷紫轮廓光，最后补一盏冷蓝填充
    this.scene.add(new THREE.HemisphereLight(0x8b7ae0, 0x140d24, 1.05));

    const key = new THREE.DirectionalLight(0xffd3a0, 2.6);
    key.position.set(7, 13, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 46;
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x8a6bff, 6.4);
    rim.position.set(-10, 8, -10);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0x6fa8ff, 0.75);
    fill.position.set(-2, 3, 13);
    this.scene.add(fill);

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
    // 头顶血条（共享层）。血量由 main.js 每帧塞进来，这里只管画
    this.bars = new HealthBarLayer(this.scene);
    // 受击闪红：逐帧衰减，连击不会互相打断
    this.flash = new ModelFlash();
    this.health = null;
    this.time = 0;
    this._camBase = new THREE.Vector3();
    this._baseFov = this.camera.fov;
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
    const entries = Object.entries(URLS);
    let done = 0;
    // 下完一份报一次进度，别让人盯着不动的文案等
    const results = await Promise.allSettled(entries.map(async ([id, url]) => {
      const gltf = await loader.loadAsync(url);
      done += 1;
      this.onStatus?.('loading', `正在加载模型 ${done}/${entries.length}…`);
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
      // 场地放大 1.3 倍，出生点跟着放大，相对位置不变
      this.arena.scale.setScalar(1.3);
      this.scene.add(this.arena);
      // 场地只接阴影，不投阴影：它的城墙会在地面糊一大片黑，压掉角色
      this.arena.traverse((node) => {
        if (node.isMesh) {
          node.receiveShadow = true;
          node.castShadow = false;
        }
      });
    }
    // 布景：火把石柱、红旗、地面同心光环、远山、星空。
    // 半径按两个出生点的间距算，不能量包围盒（那个模型带外圈城墙，会大得离谱）
    if (this.arena) {
      const a = this.arena.getObjectByName('Arena_Spawn_A_Player');
      const b = this.arena.getObjectByName('Arena_Spawn_B_Enemy');
      const span = a && b ? a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())) : 14;
      this.arenaRadius = Math.max(6, span * 1.25);
      // 装饰收敛：火把 10 → 8，旗子 6 → 4，星空压暗，让两只怪兽站到视觉中心
      this.dressing = new ArenaDressing(this.scene, {
        radius: this.arenaRadius,
        torchCount: 8,
        bannerCount: 4,
        lightTorches: 2,
        starOpacity: 0.42,
        mountainColor: 0x120c22,
      });
      // 地面魔法阵：半径按场地收一点，别顶到石墙
      this.magicCircle = new MagicCircle(this.scene, {
        radius: this.arenaRadius * 0.56,
        color: '#a98bff',
        accent: '#ffd08a',
      });
      // 主光的阴影相机跟着场地尺寸走
      if (this.keyLight) {
        const span2 = this.arenaRadius * 0.75;
        this.keyLight.shadow.camera.left = -span2;
        this.keyLight.shadow.camera.right = span2;
        this.keyLight.shadow.camera.top = span2;
        this.keyLight.shadow.camera.bottom = -span2;
        this.keyLight.shadow.camera.updateProjectionMatrix();
      }
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
    // 材质必须按实例 clone：SkeletonUtils.clone 只克隆节点树，材质是共享的。
    // 受击闪红要改 emissive，共享材质会让「同款怪兽」一起闪。
    object.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = false;
      node.material = Array.isArray(node.material)
        ? node.material.map((material) => material.clone())
        : node.material.clone();
    });
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
    // 出生点在场地边缘，两个人隔了整块石台，角色在画面里显得很小。
    // 往场地中心收 38%，两只怪兽靠近魔法阵，构图才是「对峙」而不是「各站一角」。
    const spots = layout.map((slot) => {
      const anchor = this.arena?.getObjectByName(slot.spawn);
      return anchor ? anchor.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(...slot.fallback);
    });
    const center = spots[0].clone().add(spots[1]).multiplyScalar(0.5);
    const placed = spots.map((spot) => {
      const point = spot.clone().lerp(center, 0.26);
      point.y += 0.25;
      return point;
    });
    layout.forEach((slot, seat) => {
      const model = this.build(slot.id, FIGHTER_HEIGHT);
      if (!model) return;
      const position = placed[seat];
      model.root.position.copy(position);
      // 朝向直接算：永远面对对手，跟镜头怎么摆无关
      const dir = placed[seat === 0 ? 1 : 0].clone().sub(position).setY(0).normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      model.root.rotation.y = yaw;
      model.baseYaw = yaw;
      // 前冲 / 击退的方向
      model.toward = dir.clone();
      model.knock = dir.clone().negate();
      model.bobPhase = seat * 1.7 + Math.random() * 0.6;
      model.seat = seat;
      model.base.copy(position);
      model.facing = seat === 0 ? -1 : 1;
      model.color = ELEMENT_COLOR[slot.id] ?? '#ffb45a';
      this.scene.add(model.root);
      this.fighters.push(model);
      model.ring = this.fx.addRing(model.root, model.color, 1.9);
      this.playModel(model, 'Idle');
    });
    // 镜头垂直站在双方连线的侧面：两个人横向并排，不会一前一后互相挡
    const r = this.arenaRadius ?? 18;
    const axis = spots[1].clone().sub(spots[0]).setY(0).normalize();
    const side = new THREE.Vector3(-axis.z, 0, axis.x);
    // 选朝向「世界 +x+z」的那一侧（和布景、牌坊的正面一致）
    if (side.dot(new THREE.Vector3(1, 0, 1)) < 0) side.negate();
    const dist = r * 0.78;
    this.camera.position.copy(center).addScaledVector(side, dist);
    this.camera.position.y = r * 0.5;
    this.camera.lookAt(center.x, 2.6, center.z);
    this._camBase.copy(this.camera.position);
    this._camTarget = new THREE.Vector3(center.x, 2.6, center.z);
  }

  clearFighters() {
    for (const fighter of this.fighters) {
      this.fx.removeRing(fighter.ring);
      fighter.mixer.stopAllAction();
      fighter.mixer.uncacheRoot(fighter.object);
      this.scene.remove(fighter.root);
    }
    this.fighters = [];
    this.bars.clear();
    this.flash.clear();
    this.health = null;
  }

  /**
   * 血条数据：main.js 每帧把双方剩余血量比例传进来。
   * 规则全在 engine.js，这里不做任何计算。
   * @param {number[]} ratios [我方, 敌方]，0~1
   */
  setHealth(ratios) {
    this.health = ratios;
  }

  /** 血条跟着单位走（前冲 / 后仰会改 root.position） */
  _syncBars() {
    for (const fighter of this.fighters) {
      const ratio = this.health?.[fighter.seat];
      if (ratio === undefined || ratio === null) {
        this.bars.remove(`seat${fighter.seat}`);
        continue;
      }
      const p = fighter.root.position;
      this.bars.set(`seat${fighter.seat}`, {
        ratio,
        side: fighter.seat === 0 ? 'player' : 'enemy',
        x: p.x,
        y: p.y + FIGHTER_HEIGHT + BAR_GAP,
        z: p.z,
        width: 1.6,
        visible: !fighter.dead || ratio > 0,
      });
    }
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
    if (!fighter) return;
    // 击退和骨骼动画无关：有 Hit 动画的模型也要被打退半步
    if (name === 'Hit') fighter.recoil = Math.max(fighter.recoil, 0.3);
    this.playModel(fighter, name, name !== 'Idle');
  }

  die(seat) {
    const fighter = this.fighters.find(f => f.seat === seat);
    if (!fighter || fighter.dead) return;
    fighter.dead = true;
    if (fighter.clips.some(c => c.name === 'Death')) this.playModel(fighter, 'Death', true);
    else fighter.fall = 0.001; // 交给 update 做倒下
    // 倒下瞬间爆一下，比单纯播动画有打击感
    const point = this._bodyPoint(fighter);
    this.fx.impact(point, { color: fighter.color, heavy: true });
    this.fx.shockwave(point, { color: fighter.color, radius: 3.4, life: 0.6 });
    this.fx.shake(0.9);
    this.flash.flash(fighter.root, { color: 0xff4030, duration: 0.5, peak: 0.55 });
  }

  /** 命中特效。seat = 被打的那一方 */
  impact(seat, { heavy = false } = {}) {
    const fighter = this.fighters.find(f => f.seat === seat);
    if (!fighter) return;
    const point = this._bodyPoint(fighter);
    this.fx.impact(point, { color: fighter.color, heavy });
    // 受击闪红 + 镜头震一下：这一下才是「打中了」的主要反馈
    this.flash.flash(fighter.root, { color: 0xff3040, peak: heavy ? 0.42 : 0.26 });
    this.fx.shake(heavy ? 0.55 : 0.28);
    // 重击退得多一点，轻击只晃一下
    fighter.knockback = heavy ? 1.15 : 0.7;
    fighter.recoil = Math.max(fighter.recoil, heavy ? 0.34 : 0.28);
    if (heavy) this.fx.shockwave(point, { color: fighter.color, radius: 2.2, life: 0.42 });
  }

  /** 近身挥砍：从出手方向扫一道光弧过去 */
  melee(fromSeat, toSeat, { color = null, heavy = false } = {}) {
    const from = this.fighters.find(f => f.seat === fromSeat);
    const to = this.fighters.find(f => f.seat === toSeat);
    if (!from || !to) return;
    this.fx.slash(this._bodyPoint(from), this._bodyPoint(to), {
      color: color ?? from.color,
      size: heavy ? 5.4 : 4.2,
      life: heavy ? 0.26 : 0.2,
      camera: this.camera,
    });
  }

  /**
   * 把一个座位的位置投影成舞台内的百分比坐标，给 HTML 伤害飘字用。
   * 飘字跟着角色走，比固定在屏幕某个角落准确得多。
   */
  screenPoint(seat) {
    const fighter = this.fighters.find(f => f.seat === seat);
    if (!fighter) return null;
    const point = this._bodyPoint(fighter).project(this.camera);
    return {
      x: (point.x * 0.5 + 0.5) * 100,
      y: (-point.y * 0.5 + 0.5) * 100,
    };
  }

  /** 远程能量束：fromSeat 打到 toSeat */
  beam(fromSeat, toSeat, { color = null } = {}) {
    const from = this.fighters.find(f => f.seat === fromSeat);
    const to = this.fighters.find(f => f.seat === toSeat);
    if (!from || !to) return;
    this.fx.beam(this._bodyPoint(from), this._bodyPoint(to), { color: color ?? from.color });
  }

  /**
   * 技能动作编排：按技能决定「怎么出手、飞什么、怎么炸」。
   *
   * 只有 fire 有骨骼动画（Attack / Cast / Defend / Hit / Death），
   * shadow 和 rock 是刚体，没有绑定 —— 所以动作反馈统一是
   * 「播能播的骨骼动作 + 前冲/后仰 + 特效」，不给刚体伪造骨骼动作。
   */
  castSpell(seat, spellId) {
    const caster = this.fighters.find(f => f.seat === seat);
    const target = this.fighters.find(f => f.seat !== seat);
    if (!caster) return;

    const color = caster.color ?? '#ffb45a';
    const self = this._bodyPoint(caster);
    const to = target ? this._bodyPoint(target) : null;
    // 命中延迟（秒）：飞行类技能的数字和受击反馈要等它真的飞到，不能一出手就跳字
    let impactDelay = 0;

    // 先在身前把这次手势的符号勾出来，观众一眼能看出是哪一招
    this.fx.symbol(this._frontPoint(caster, target), SYMBOL_OF[spellId] ?? 'circle', { color, size: 2.4 });

    switch (spellId) {
      // 火球术：抬手 → 一颗火球飞过去 → 命中炸开
      case 'circle':
        this.play(seat, 'Cast');
        if (to) {
          const speed = 18;
          impactDelay = self.distanceTo(to) / speed;
          this.fx.projectile(self, to, {
            color,
            speed,
            onArrive: (point) => this.fx.shockwave(point, { color, radius: 1.9, life: 0.36 }),
          });
        }
        break;

      // 雷霆万钧：抬手 → 天降闪电 + 冲击波 + 推近
      case 'line_v':
        this.play(seat, 'Cast');
        if (to) {
          this.fx.bolt(to, { color });
          this.fx.shockwave(to, { color, radius: 2.4 });
          this.fx.punch(0.7);
        }
        break;

      // 终极奥义：粗光束 + 大冲击波 + 最强推近
      case 'line_h':
        this.play(seat, 'Cast');
        if (to) {
          this.fx.beam(self, to, { color, radius: 2.2 });
          this.fx.impact(to, { color, heavy: true });
          this.fx.shockwave(to, { color, radius: 3.4, life: 0.6 });
          this.fx.punch(1);
        }
        break;

      // 治愈之光：上浮的绿色光点
      case 'two':
        this.play(seat, 'Cast');
        this.fx.motes(caster.root, { color: '#9dffb0', count: 12, radius: 1.4 });
        break;

      // 召唤援军：金色聚气
      case 'triangle':
        this.play(seat, 'Cast');
        this.fx.motes(caster.root, { color: '#ffe08a', count: 10, radius: 1.3 });
        break;

      // 护盾：球形护罩跟着单位走，持续到技能时间结束
      case 'square':
        this.play(seat, 'Defend');
        this.fx.bubble(caster.root, { color: '#9fd8ff', duration: 3.5, radius: 2.6 });
        break;

      default:
        this.play(seat, 'Cast');
        break;
    }
    return impactDelay;
  }

  /** 躯干高度，特效打这里最像「被打到」 */
  _bodyPoint(fighter) {
    const point = fighter.root.position.clone();
    point.y += 2.3;
    return point;
  }

  /** 身前半个身位：符号勾在胸口前方，朝着对手 */
  _frontPoint(caster, target) {
    const point = this._bodyPoint(caster);
    point.y += 1.15;
    if (target) {
      const dir = target.root.position.clone().sub(caster.root.position).setY(0).normalize();
      point.addScaledVector(dir, 1.8);
    }
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
      if (model.base) {
        // 前冲 / 击退都沿「双方连线」推，不再假设战场一定沿 z 轴
        model.root.position.copy(model.base);
        if (model.lunge > 0) {
          model.lunge = Math.max(0, model.lunge - dt);
          const push = Math.sin((1 - model.lunge / 0.34) * Math.PI) * 1.1;
          model.root.position.addScaledVector(model.toward, push);
        } else if (model.recoil > 0) {
          model.recoil = Math.max(0, model.recoil - dt);
          // 被打退半步：重击退得多，轻击退得少
          const push = Math.sin((1 - model.recoil / 0.3) * Math.PI) * (model.knockback ?? 0.85);
          model.root.position.addScaledVector(model.knock, push);
        }
      }
      if (model.fall > 0) {
        model.fall = Math.min(1, model.fall + dt * 1.4);
        model.root.rotation.z = -model.fall * 1.35;
        model.root.position.y = model.base.y - model.fall * 0.4;
      } else if (model.base) {
        // 站桩呼吸：刚体模型没有 Idle 动画，靠整体轻微起伏 + 微摆，画面才不是静止的
        const phase = model.bobPhase ?? 0;
        const breath = Math.sin(this.time * 1.7 + phase);
        model.root.position.y = model.base.y + breath * 0.05;
        if (model.baseYaw !== undefined) {
          model.root.rotation.y = model.baseYaw + Math.sin(this.time * 0.9 + phase) * 0.025;
        }
      }
    }

    this.time += dt;
    this.fx.update(dt, this.time);
    this.flash.update(dt);
    this.magicCircle?.update(dt, this.time);
    this._syncBars();
    this.bars.update(dt);
    this.dressing?.update(dt, this.time);
    // 震动只改相机位置，不碰朝向；相机还没摆过（选怪前）就跳过
    if (this._camBase.lengthSq() > 0) {
      this.camera.position.copy(this._camBase).add(this.fx.shakeOffset(this.time));
    }
    // 重击时镜头轻轻推近，再自己弹回
    const fov = this._baseFov - this.fx.fovOffset();
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }
}
