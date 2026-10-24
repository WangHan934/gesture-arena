/**
 * 摄像头 + MediaPipe Hand Landmarker 封装
 * ============================================================================
 * 只负责「拿到 21 个关键点」，不判断手势，也不画任何东西。
 *
 * 资源默认走项目自带的 vendor/hand/（离线，现场没网也能跑）。
 * 想换 CDN：new CameraTracker({ modelBase: null })。
 * ============================================================================
 */

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class CameraTracker {
  /**
   * @param {{video?:HTMLVideoElement|null, numHands?:number, modelBase?:string|null, detectFps?:number}} [opts]
   */
  constructor({ video = null, numHands = 1, modelBase = 'vendor/hand', detectFps = 30 } = {}) {
    this.video = video;
    this.numHands = numHands;
    this.modelBase = modelBase;
    this.detectFps = detectFps;

    this.landmarker = null;
    this.stream = null;
    this.fps = 0;

    this._lastDetect = 0;
    this._lastTs = 0;
    this._fpsN = 0;
    this._fpsT = 0;
    this._destroyed = false;
  }

  get ready() {
    return !!this.landmarker && !!this.stream && this.video?.readyState >= 2;
  }

  /** @throws {Error} 摄像头被拒 / 没有设备 / 模型加载失败 */
  async start() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const e = new Error('当前环境不支持摄像头（需要 https 或 localhost）');
      e.code = 'insecure';
      throw e;
    }

    if (!this.video) {
      const v = document.createElement('video');
      v.playsInline = true;
      v.muted = true;
      v.autoplay = true;
      v.setAttribute('playsinline', '');
      this.video = v;
      this._ownVideo = true;
    }

    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: 'user',
        },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      await new Promise((resolve, reject) => {
        if (this.video.readyState >= 2) return resolve();
        const timer = setTimeout(() => reject(Object.assign(new Error('摄像头画面 8 秒内没有就绪'), { code: 'timeout' })), 8000);
        this.video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }

    if (!this.landmarker) {
      // 'auto'：先试项目自带的 vendor/hand（离线），失败再退到 CDN
      const bases = this.modelBase === 'auto' ? ['vendor/hand', null] : [this.modelBase];
      let lastErr = null;
      for (const base of bases) {
        try {
          this.landmarker = await this._create(base);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!this.landmarker) {
        throw Object.assign(new Error(`手势模型加载失败：${lastErr?.message || '未知原因'}`), { code: 'model' });
      }
    }

    return this;
  }

  async _create(base) {
    const paths = this._paths(base);
    const mod = await import(/* @vite-ignore */ paths.bundle);
    const fileset = await mod.FilesetResolver.forVisionTasks(paths.wasm);
    const make = (delegate) => mod.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: paths.model, delegate },
      runningMode: 'VIDEO',
      numHands: this.numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.55,
    });
    try {
      return await make('GPU');
    } catch {
      return await make('CPU');   // 没有 WebGL 的机器退到 CPU
    }
  }

  /**
   * 每帧调用。返回第一只手，没有就返回 null。
   * @param {number} [now]
   * @returns {{landmarks:Array<{x:number,y:number,z:number}>, handedness:string, confidence:number}|null}
   */
  read(now = performance.now()) {
    if (!this.ready) return null;

    // 摄像头本身 30fps，没必要每帧都推理
    if (now - this._lastDetect < 1000 / Math.max(5, this.detectFps)) return this._lastResult ?? null;
    this._lastDetect = now;
    this._lastTs = Math.max(now, this._lastTs + 1);

    let res;
    try {
      res = this.landmarker.detectForVideo(this.video, this._lastTs);
    } catch {
      return this._lastResult ?? null;
    }

    const list = res?.landmarks || [];
    const handed = res?.handednesses || [];

    this._fpsN++;
    if (now - this._fpsT > 500) {
      this.fps = Math.round((this._fpsN * 1000) / (now - this._fpsT));
      this._fpsT = now;
      this._fpsN = 0;
    }

    if (!list.length || !list[0] || list[0].length < 21) {
      this._lastResult = null;
      return null;
    }

    this._lastResult = {
      landmarks: list[0],
      handedness: handed[0]?.[0]?.categoryName || '',
      confidence: handed[0]?.[0]?.score ?? 1,
    };
    return this._lastResult;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    try { this.landmarker?.close?.(); } catch { /* 忽略 */ }
    this.landmarker = null;
    this._lastResult = null;
  }

  destroy() {
    this.stop();
    this._destroyed = true;
    if (this._ownVideo) this.video?.remove();
  }

  /* ------------------------------------------------------------------ */

  _paths(base = this.modelBase) {
    if (base === null || base === undefined) {
      return { bundle: `${CDN}/vision_bundle.mjs`, wasm: `${CDN}/wasm`, model: CDN_MODEL };
    }
    const root = new URL(String(base).replace(/\/?$/, '/'), document.baseURI);
    return {
      bundle: new URL('tasks-vision/vision_bundle.mjs', root).href,
      wasm: new URL('tasks-vision/wasm', root).href,
      model: new URL('models/hand_landmarker.task', root).href,
    };
  }
}
