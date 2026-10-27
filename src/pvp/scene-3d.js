import * as THREE from 'three';
import { MONSTERS } from './rules.js';
import { GLTFLoader } from '../../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from '../../vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { CombatFX } from '../fx/combat-fx.js';
import { sfx } from '../audio/sfx.js';
import { ArenaDressing } from '../fx/arena-dressing.js';

const URLS = {
  fire: new URL('../../assets/models/fire.glb', import.meta.url).href,
  shadow: new URL('../../assets/models/shadow.glb', import.meta.url).href,
  rock: new URL('../../assets/models/rock.glb', import.meta.url).href,
  arena: new URL('../../assets/models/arena.glb', import.meta.url).href,
};

/** 怪兽属性色，用来给特效上色（和 classic / solo 保持同一套） */
const ELEMENT_COLOR = { fire: '#ff8a3d', shadow: '#b388ff', rock: '#9fd8ff' };

/** 这几个技能在 PvP 里算远程，命中前打一道能量束过去 */
const RANGED_SKILLS = new Set(['火球术', '雷霆万钧', '终极奥义']);

/** 技能名 → 手势符号，出手前在角色身前勾出来 */
const SYMBOL_OF = {
  火球术: 'circle',
  雷霆万钧: 'line_v',
  终极奥义: 'line_h',
  治愈之光: 'two',
  召唤援军: 'triangle',
  护盾: 'square',
};

export class Arena3D {
  constructor(canvas, onStatus) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.state = null;
    this.selectedMonster = 'fire';
    this.seat = 0;
    this.fighters = [];
    this.gallery = [];
    this.templates = {};
    this.signature = '';
    this.lastTurns = null;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#120d1c');
    this.scene.fog = new THREE.Fog('#120d1c', 22, 55);
    this.camera = new THREE.PerspectiveCamera(43, 1, .1, 150);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.scene.add(new THREE.HemisphereLight(0xcbd6ff, 0x2a1c2e, 1.85));
    const key = new THREE.DirectionalLight(0xffd9b0, 3.5);
    key.position.set(4, 12, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7f6bff, 4.4);
    rim.position.set(-9, 7, -8);
    this.scene.add(rim);

    // 打斗特效（火花 / 碎石 / 能量束 / 光圈 / 震动）。必须在 scene 建好之后
    this.fx = new CombatFX(this.scene);
    this.time = 0;
    this._camBase = new THREE.Vector3();
    this._baseFov = this.camera.fov;
    this.resize = new ResizeObserver(() => this.fit());
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.lost = true;
      this.onStatus('error', '3D 显示连接中断，请刷新页面；房间和手势仍可使用。');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.onStatus('ready', '3D 显示已恢复');
    });
    this.mount(document.getElementById('model-preview'));
    this.ready = this.load();
  }

  mount(host) {
    if (!host || this.canvas.parentElement === host) return;
    this.resize.disconnect();
    host.appendChild(this.canvas);
    this.resize.observe(host);
    this.fit();
  }

  fit() {
    const host = this.canvas.parentElement;
    const width = host?.clientWidth || 1;
    const height = host?.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.loaded && !this.state) this.frameSelection();
  }

  async load() {
    this.onStatus('loading', '正在加载三个怪兽与竞技场…');
    const loader = new GLTFLoader();
    const results = await Promise.allSettled(Object.entries(URLS).map(async ([id, url]) => {
      const gltf = await loader.loadAsync(url);
      return [id, gltf];
    }));
    const failures = [];
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        const [id, gltf] = result.value;
        this.templates[id] = gltf;
      } else {
        const id = Object.keys(URLS)[i];
        failures.push(id);
        console.error(`[3D] 无法加载 ${URLS[id]}`, result.reason);
      }
    }
    if (this.templates.arena) {
      this.arena = this.templates.arena.scene;
      this.arena.scale.setScalar(1.3);
      this.scene.add(this.arena);
    }
    // 布景：火把石柱、红旗、地面同心光环、远山、星空
    if (this.arena) {
      const a = this.arena.getObjectByName('Arena_Spawn_A_Player');
      const b = this.arena.getObjectByName('Arena_Spawn_B_Enemy');
      const span = a && b ? a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())) : 14;
      this.arenaRadius = Math.max(6, span * 1.25);
      this.dressing = new ArenaDressing(this.scene, { radius: this.arenaRadius, torchCount: 10, bannerCount: 6, lightTorches: 2 });
    }

    for (const [index, id] of ['shadow', 'fire', 'rock'].entries()) {
      if (!this.templates[id]) continue;
      const model = this.makeMonster(id, 3.6);
      model.root.position.set((index - 1) * 4.3, .26, 0);
      this.gallery.push(model);
      this.scene.add(model.root);
      this.play(model, 'Idle');
    }
    this.loaded = true;
    this.signature = '';
    this.canvas.dataset.modelsLoaded = Object.keys(this.templates).sort().join(',');
    this.canvas.dataset.animationClips = (this.templates.fire?.animations || []).map(a => a.name).join(',');
    if (failures.length) {
      this.onStatus('error', `模型加载失败：${failures.join('、')}。请检查 assets/models/ 中对应的 GLB 文件。`);
    } else {
      this.onStatus('ready', '三个原始怪兽与竞技场已加载 · 炎角战魔 8 个原有动作已保留');
    }
  }

  makeMonster(id, height) {
    const template = this.templates[id];
    const object = clone(template.scene);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    const root = new THREE.Group();
    root.add(object);
    root.scale.setScalar(height / Math.max(.001, size.y));
    const mixer = new THREE.AnimationMixer(object);
    return { id, height, root, object, mixer, clips: template.animations, action: null, timer: 0, dead: false };
  }

  play(model, name, once = false) {
    const clip = model.clips.find(c => c.name === name);
    if (!clip) return; // Missing animations are never fabricated or borrowed.
    const next = model.mixer.clipAction(clip);
    if (model.action === next && next.isRunning() && !once) return;
    model.action?.fadeOut(.12);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(.12).play();
    model.action = next;
    model.timer = once && name !== 'Death' ? clip.duration : 0;
  }

  setSelection(id) {
    if (!['fire', 'shadow', 'rock'].includes(id) || id === this.selectedMonster) return;
    this.selectedMonster = id;
    this.canvas.dataset.selectedMonster = id;
    this.signature = '';
  }

  frameSelection() {
    const model = this.gallery.find(m => m.id === this.selectedMonster);
    if (!model) return;
    model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.root);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const distance = Math.max(9, size.y / (2 * tangent), size.x / (2 * tangent * this.camera.aspect)) * (this.camera.aspect < 1.1 ? 1.6 : 1.3);
    this.camera.position.set(center.x, center.y + distance * .12, center.z + distance);
    this.camera.lookAt(center);
  }

  setState(state, seat) {
    this.state = state;
    this.seat = seat;
    const battle = state?.battle;
    const host = battle ? 'battle-view' : state ? 'lobby-preview' : 'model-preview';
    this.mount(document.getElementById(host));
    const signature = battle ? state.players.map(p => p?.monster || '').join('|') + ':' + seat : state ? 'gallery' : 'selection:' + this.selectedMonster;
    if (!this.loaded || signature === this.signature) return;
    this.signature = signature;
    this.lastTurns = null;
    this.lastLog = '';
    for (const fighter of this.fighters) {
      this.fx.removeRing(fighter.ring);
      fighter.mixer.stopAllAction();
      fighter.mixer.uncacheRoot(fighter.object);
      this.scene.remove(fighter.root);
    }
    this.fighters = [];
    this.canvas.dataset.view = battle ? 'battle' : state ? 'lobby' : 'selection';
    this.canvas.setAttribute('aria-label', battle ? '双方选中怪兽的 3D 对战与原始竞技场' : state ? '三个原始 3D 怪兽和竞技场' : `${MONSTERS.find(m => m.id === this.selectedMonster).name}与原始竞技场`);
    this.canvas.dataset.selectedMonster = this.selectedMonster;
    for (const [index, model] of this.gallery.entries()) {
      model.root.visible = !battle && (state || model.id === this.selectedMonster);
      model.root.position.set(state ? (index - 1) * 4.3 : 0, .26, 0);
      model.root.scale.multiplyScalar((state ? 3.6 : 5.8) / model.height);
      model.height = state ? 3.6 : 5.8;
    }
    if (battle) {
      for (let i = 0; i < 2; i++) {
        const id = state.players[i]?.monster;
        if (!this.templates[id]) continue;
        const model = this.makeMonster(id, 4.1);
        const spawnName = i === seat ? 'Arena_Spawn_A_Player' : 'Arena_Spawn_B_Enemy';
        const spawn = this.arena?.getObjectByName(spawnName);
        model.root.position.copy(spawn ? spawn.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, i === seat ? 5.5 : -5.5));
        model.root.position.y += .25;
        model.root.rotation.y = i === seat ? Math.PI : 0;
        model.seat = i;
        model.color = ELEMENT_COLOR[id] ?? '#ffb45a';
        this.scene.add(model.root);
        this.fighters.push(model);
        model.ring = this.fx.addRing(model.root, model.color, 1.7);
        this.play(model, 'Idle');
      }
      const r = this.arenaRadius ?? 18;
      this.camera.position.set(r * 1.1, r * 0.72, r * 1.1);
      this.camera.lookAt(0, 1.3, 0);
    } else {
      this.camera.position.set(0, 13.5, 23);
      this.camera.lookAt(0, 1.3, 0);
    }
    this._camBase.copy(this.camera.position);
    this.fit();
  }

  animateBattle() {
    const battle = this.state?.battle;
    if (!battle) return;
    const log = battle.log.at(-1) || '';
    if (log === this.lastLog) return;
    const firstSnapshot = this.lastTurns === null;
    this.lastLog = log;
    this.lastTurns = battle.turns;
    if (!firstSnapshot) {
      const actor = /玩家 (1|2) · ([^，]+)/.exec(log);
      if (actor) {
        const index = Number(actor[1]) - 1;
        const fighter = this.fighters.find(f => f.seat === index);
        const target = this.fighters.find(f => f.seat !== index);
        const skill = actor[2];
        if (fighter) {
          this.play(fighter, skill === '护盾' ? 'Defend' : skill === '火球术' ? 'Attack' : 'Cast', true);
          this.skillFx(fighter, target, skill, log);
        }
      }
    }
    if (battle.winner !== null && battle.winner !== 'draw') {
      const loser = this.fighters.find(f => f.seat !== battle.winner);
      if (loser && !loser.dead) { loser.dead = true; this.play(loser, 'Death', true); this.fx.impact(this.bodyPoint(loser), { color: loser.color, heavy: true }); sfx.death(); }
    }
    this.canvas.dataset.currentAnimations = this.fighters.map(f => `${f.id}:${f.action?.getClip().name || 'static'}`).join(',');
  }

  /**
   * 技能动作编排。PvP 的伤害和技能名都在服务端算好了，
   * 这里只从战报里读，不重复计算。
   * 视频里是「抬手 → 飞过去 → 炸开」，所以远程技能一律先出飞行物。
   */
  skillFx(actor, target, skill, log) {
    const from = actor ? this.bodyPoint(actor) : null;
    const to = target ? this.bodyPoint(target) : null;
    const actorColor = ELEMENT_COLOR[actor?.id] ?? '#ffb45a';

    // 出手前先在身前勾出手势符号
    if (actor && SYMBOL_OF[skill]) {
      this.fx.symbol(this.frontPoint(actor, target), SYMBOL_OF[skill], { color: actorColor, size: 2.4 });
    }

    // 没有伤害的技能：护盾 / 治疗 / 援军
    if (!/造成/.test(log)) {
      if (!actor) return;
      if (skill === '护盾') this.fx.bubble(actor.root, { color: '#9fd8ff', duration: 3.5, radius: 2.6 });
      else if (skill === '治愈之光') this.fx.motes(actor.root, { color: '#9dffb0', count: 12, radius: 1.4 });
      else this.fx.motes(actor.root, { color: '#ffe08a', count: 10, radius: 1.3 });
      return;
    }

    if (!target || !to) return;
    const color = target.color ?? '#ffb45a';
    const damage = Number((/造成 (\d+) 点伤害/.exec(log) || [])[1] || 0);
    const heavy = damage >= 20;

    this.play(target, 'Hit', true);

    switch (skill) {
      case '火球术':
        if (from) this.fx.projectile(from, to, { color: actorColor, speed: 18 });
        sfx.beam();
        break;
      case '雷霆万钧':
        this.fx.bolt(to, { color: actorColor });
        this.fx.punch(0.7);
        break;
      case '终极奥义':
        if (from) this.fx.beam(from, to, { color: actorColor, radius: 2.2 });
        this.fx.shockwave(to, { color, radius: 3.4, life: 0.6 });
        this.fx.punch(1);
        break;
      default:
        if (from && RANGED_SKILLS.has(skill)) this.fx.beam(from, to, { color: actorColor });
        break;
    }

    this.fx.impact(to, { color, heavy });
    sfx.impact({ heavy });
  }

  /** 躯干高度，特效打这里最像「被打到」 */
  bodyPoint(fighter) {
    const point = fighter.root.position.clone();
    point.y += 2.3;
    return point;
  }

  /** 身前半个身位：符号勾在胸口前方，朝着对手 */
  frontPoint(actor, target) {
    const point = this.bodyPoint(actor);
    point.y += 1.15;
    if (target) {
      const dir = target.root.position.clone().sub(actor.root.position).setY(0).normalize();
      point.addScaledVector(dir, 1.8);
    }
    return point;
  }

  update(dt) {
    if (this.lost) return;
    this.setState(this.state, this.seat);
    this.animateBattle();
    for (const model of [...this.gallery, ...this.fighters]) {
      if (!model.root.visible) continue;
      model.mixer.update(dt);
      if (model.timer > 0) {
        model.timer -= dt;
        if (model.timer <= 0 && !model.dead) this.play(model, 'Idle');
      }
    }

    this.time += dt;
    this.fx.update(dt, this.time);
    this.dressing?.update(dt, this.time);
    if (this._camBase.lengthSq() > 0) {
      this.camera.position.copy(this._camBase).add(this.fx.shakeOffset(this.time));
    }
    const fov = this._baseFov - this.fx.fovOffset();
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
    this.canvas.dataset.renderedFrames = String((Number(this.canvas.dataset.renderedFrames) || 0) + 1);
  }
}
