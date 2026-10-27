/**
 * 场地布景
 * ==================================================================
 * 参考概念图给竞技场加「低多边形 + 火光」的氛围：
 *   · 一圈火把石柱（六棱柱 + 火盆 + 火光点光 + 跳动火苗）
 *   · 石墙上挂红旗
 *   · 地面同心发光圆环
 *   · 远处三角山峰剪影 + 星空
 *
 * 【为什么全部程序化生成】
 *   仓库里只有 4 个 glb（三只怪兽 + 竞技场），没有火把、旗帜、山的模型。
 *   这些装饰件几何都很简单（棱柱 / 平面 / 圆锥 / 点），用代码生成比
 *   往仓库塞一堆 glb 更划算，也能随场地半径自动调整位置。
 *
 * 【性能】火把点光会显著增加着色成本，所以默认只给最近的两支加真实点光，
 *   其余用自发光火苗 + 贴图光晕糊弄 —— 视觉上分不出来，帧率差很多。
 */

import * as THREE from 'three';

/** 生成一张径向渐变贴图，做火苗和光晕 */
function glowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,240,200,1)');
  gradient.addColorStop(0.3, 'rgba(255,170,80,0.85)');
  gradient.addColorStop(0.65, 'rgba(255,110,40,0.28)');
  gradient.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ArenaDressing {
  /**
   * @param {THREE.Scene} scene
   * @param {{radius?:number, torchCount?:number, bannerCount?:number, lightTorches?:number}} options
   *   radius = 场地半径，装饰件按它排布
   */
  constructor(scene, { radius = 9, torchCount = 10, bannerCount = 6, lightTorches = 2 } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.group = new THREE.Group();
    this.flames = [];
    this.rings = [];
    this.time = 0;
    this.glow = glowTexture();

    this._buildPillars(torchCount, lightTorches);
    this._buildBanners(bannerCount);
    this._buildFloorRings();
    this._buildMountains();
    this._buildStars();

    scene.add(this.group);
  }

  /* ---------------- 火把石柱 ---------------- */

  _buildPillars(count, lightCount) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x4a4152, roughness: 0.9, metalness: 0.05 });
    const brazier = new THREE.MeshStandardMaterial({ color: 0x2b2530, roughness: 0.7, metalness: 0.3, emissive: 0x3a1a08, emissiveIntensity: 0.6 });

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = this.radius;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      const pillar = new THREE.Group();
      pillar.position.set(x, 0, z);

      // 六棱柱柱身：低多边形感靠「面数少 + 硬边」
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 3.1, 6, 1), stone);
      shaft.position.y = 1.55;
      shaft.castShadow = true;
      pillar.add(shaft);

      // 柱顶火盆
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.3, 0.42, 6, 1), brazier);
      bowl.position.y = 3.3;
      pillar.add(bowl);

      // 火苗：两片交叉的发光面片，比粒子便宜
      const flameMaterial = new THREE.SpriteMaterial({
        map: this.glow,
        color: 0xffa040,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const flame = new THREE.Sprite(flameMaterial);
      flame.position.y = 3.72;
      flame.scale.setScalar(1.15);
      pillar.add(flame);
      this.flames.push({ sprite: flame, phase: Math.random() * Math.PI * 2, base: 1.15 });

      // 只给最近的两支加真实点光，其余靠自发光
      if (i < lightCount) {
        const light = new THREE.PointLight(0xff9a4a, 9, this.radius * 1.6, 2);
        light.position.y = 3.7;
        pillar.add(light);
        this.flames[this.flames.length - 1].light = light;
      }

      this.group.add(pillar);
    }
  }

  /* ---------------- 旗帜 ---------------- */

  _buildBanners(count) {
    const cloth = new THREE.MeshStandardMaterial({
      color: 0xb0252e,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: 0x3a0a0e,
      emissiveIntensity: 0.8,
    });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd6b57a, roughness: 0.6, metalness: 0.4 });

    for (let i = 0; i < count; i++) {
      // 插在火把之间的位置，避免和柱子重叠
      const angle = ((i + 0.5) / count) * Math.PI * 2;
      // 稍微往内收，贴在石墙内壁上；正好等于半径会被墙体包住看不见
      const r = this.radius * 0.9;
      const banner = new THREE.Group();
      banner.position.set(Math.cos(angle) * r, 2.3, Math.sin(angle) * r);
      // 全部朝向相机方位（等距 45°），否则大部分旗帜会被看成一条线
      banner.rotation.y = Math.PI / 4;

      const clothMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), cloth);
      banner.add(clothMesh);

      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6), trim);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = 1.05;
      banner.add(bar);

      this.group.add(banner);
    }
  }

  /* ---------------- 地面同心圆 ---------------- */

  _buildFloorRings() {
    // 概念图里地面是同心圆纹路 + 白色发光圆环
    const specs = [
      { r: this.radius * 0.34, opacity: 0.5, color: 0xbfd8ff },
      { r: this.radius * 0.62, opacity: 0.3, color: 0x9fb4ff },
      { r: this.radius * 0.88, opacity: 0.22, color: 0xd6b57a },
    ];

    for (const spec of specs) {
      const geometry = new THREE.RingGeometry(spec.r * 0.985, spec.r, 64);
      const material = new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      this.group.add(ring);
      this.rings.push({ mesh: ring, base: spec.opacity, phase: Math.random() * Math.PI * 2 });
    }
  }

  /* ---------------- 远山与星空 ---------------- */

  _buildMountains() {
    // 远处的三角山峰剪影：几个暗色圆锥，越远越暗
    const material = new THREE.MeshBasicMaterial({ color: 0x1a1526, fog: false });
    const far = this.radius * 4.2;

    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2 + 0.3;
      const height = 9 + (i % 3) * 4.5;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(height * 0.72, height, 4, 1), material);
      cone.position.set(Math.cos(angle) * far, height * 0.5 - 1.5, Math.sin(angle) * far);
      cone.rotation.y = Math.random() * Math.PI;
      this.group.add(cone);
    }
  }

  _buildStars() {
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // 只撒在头顶半球，避免穿到地面以下
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      const r = this.radius * 6;
      positions[i * 3] = Math.cos(theta) * Math.cos(phi) * r;
      positions[i * 3 + 1] = Math.sin(phi) * r + 6;
      positions[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xcfd8ff,
      size: 0.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(geometry, material);
    this.group.add(this.stars);
  }

  /* ---------------- 每帧 ---------------- */

  update(dt, time = 0) {
    this.time += dt;
    const t = time || this.time;

    // 火苗跳动：缩放 + 亮度都抖一点，点光跟着抖
    for (const flame of this.flames) {
      const flicker = 1 + Math.sin(t * 11 + flame.phase) * 0.12 + Math.sin(t * 23.7 + flame.phase * 2) * 0.06;
      flame.sprite.scale.setScalar(flame.base * flicker);
      if (flame.light) flame.light.intensity = 9 * flicker;
    }

    // 地面圆环缓慢呼吸
    for (const ring of this.rings) {
      ring.mesh.material.opacity = ring.base * (0.8 + Math.sin(t * 1.6 + ring.phase) * 0.2);
    }
  }

  dispose() {
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.scene.remove(this.group);
    this.glow.dispose();
  }
}
