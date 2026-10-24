import * as THREE from 'three';
import { MONSTERS } from './rules.js';
import { GLTFLoader } from '../../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from '../../vendor/three/examples/jsm/utils/SkeletonUtils.js';

const URLS = {
  fire: new URL('../../assets/models/fire.glb', import.meta.url).href,
  shadow: new URL('../../assets/models/shadow.glb', import.meta.url).href,
  rock: new URL('../../assets/models/rock.glb', import.meta.url).href,
  arena: new URL('../../assets/models/arena.glb', import.meta.url).href,
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
    this.scene.background = new THREE.Color('#171221');
    this.scene.fog = new THREE.Fog('#171221', 28, 65);
    this.camera = new THREE.PerspectiveCamera(43, 1, .1, 150);
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
      this.scene.add(this.arena);
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
        this.scene.add(model.root);
        this.fighters.push(model);
        this.play(model, 'Idle');
      }
      this.camera.position.set(18, 10, 13);
      this.camera.lookAt(0, 1.3, 0);
    } else {
      this.camera.position.set(0, 11, 18);
      this.camera.lookAt(0, 1.3, 0);
    }
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
        if (fighter) this.play(fighter, skill === '护盾' ? 'Defend' : skill === '火球术' ? 'Attack' : 'Cast', true);
        if (target && /造成/.test(log)) this.play(target, 'Hit', true);
      }
    }
    if (battle.winner !== null && battle.winner !== 'draw') {
      const loser = this.fighters.find(f => f.seat !== battle.winner);
      if (loser && !loser.dead) { loser.dead = true; this.play(loser, 'Death', true); }
    }
    this.canvas.dataset.currentAnimations = this.fighters.map(f => `${f.id}:${f.action?.getClip().name || 'static'}`).join(',');
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
    this.renderer.render(this.scene, this.camera);
    this.canvas.dataset.renderedFrames = String((Number(this.canvas.dataset.renderedFrames) || 0) + 1);
  }
}
