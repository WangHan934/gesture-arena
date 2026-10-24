/**
 * 摄像头手势输入 · 游戏侧胶水层
 * ==================================================================
 * 队友 B 的模块（./hand/）只负责「看手 → 发事件」，不认识游戏。
 * 这一层负责：
 *   1. 懒加载 —— 玩家点「摄像头」按钮才请求权限，一进游戏绝不弹授权框
 *   2. 把原始姿态名转给主循环，由各模式自己决定这个姿态干什么
 *   3. 状态变化（请求中 / 就绪 / 失败）翻译成给玩家看的提示
 *
 * 【为什么不直接改 B 的模块】
 *   模块只认 5 种姿态，但两种玩法要的动作不一样。
 *   把「姿态 → 动作」的映射放在各模式的 cameraMap 里，
 *   加第三种玩法时不用碰输入层，也不会和 A 的改动冲突。
 */

import { createHandInput } from './hand/index.js';

/** 这些姿态是模块支持的，其余一律忽略 */
export const SUPPORTED_POSES = ['open_palm', 'fist', 'one', 'two', 'three'];

export class CameraInput {
  /**
   * @param {object} [options]
   * @param {(pose: string, event: object) => void} [options.onPose] 识别出一个手势时回调
   * @param {(status: {state:string, message:string}) => void} [options.onStatus] 状态变化
   * @param {object} [options.handOptions] 透传给 createHandInput
   */
  constructor(options = {}) {
    this.onPose = options.onPose ?? null;
    this.onStatus = options.onStatus ?? null;
    this.handOptions = options.handOptions ?? {};

    /** @type {ReturnType<typeof createHandInput> | null} */
    this.hand = null;
    this._starting = false;
    this._status = { state: 'idle', message: '摄像头未开启' };
  }

  get active() {
    return this._status.state === 'ready' || this._status.state === 'requesting';
  }

  get status() {
    return this._status;
  }

  getFrame(now) {
    if (this._status.state !== 'ready' || !this.hand) return null;
    const detection = this.hand.tracker.read(now);
    return detection ? { ...detection, pose: this.hand.pose.pose } : null;
  }

  /**
   * 开启摄像头。第一次调用才创建模块实例（避免一进游戏就下载 26MB 模型）。
   * 失败不抛错，只把原因写进状态。
   * @returns {Promise<boolean>}
   */
  async enable() {
    if (this._starting) return false;
    if (this._status.state === 'ready') return true;

    this._starting = true;

    if (!this.hand) {
      this.hand = createHandInput({
        // 现场误触多就把 stableMs 调大
        stableMs: 260,
        releaseMs: 180,
        ...this.handOptions,
      });

      this.hand.on('gesture', (ev) => {
        if (!SUPPORTED_POSES.includes(ev.gesture)) return;
        this.onPose?.(ev.gesture, ev);
      });

      this.hand.on('status', (detail) => {
        this._setStatus(detail.state, detail.message);

        // B 的模块有个小瑕疵：setError() 只填了错误区，底部那行还停在
        // 「正在请求摄像头…」，跟上面的错误提示自相矛盾。
        // 这里用他自己的 setStatus 盖掉，不改他的文件。
        if (detail.state === 'error') {
          this.hand?.overlay?.setStatus('error', '摄像头不可用');
        }
      });
    }

    this._setOverlayVisible(true);

    let ok = false;
    try {
      ok = await this.hand.start();
    } catch (error) {
      // B 的 start() 正常不会抛，这里只是兜底
      this._setStatus('error', error?.message ?? String(error));
    } finally {
      this._starting = false;
    }

    return ok === true;
  }

  /** 关闭摄像头（保留实例，下次 enable 直接复用，不用重新下载模型） */
  disable() {
    if (!this.hand) {
      this._setStatus('idle', '摄像头未开启');
      return;
    }
    this.hand.stop();
    this._setOverlayVisible(false);
    this._setStatus('idle', '摄像头已关闭');
  }

  /** 关闭时把画中画面板一起收掉，否则它会一直停在「已停止」 */
  _setOverlayVisible(visible) {
    const root = this.hand?.overlay?.root;
    if (root) root.style.display = visible ? '' : 'none';
  }

  /** 切换开关，返回切换后的状态 */
  async toggle() {
    if (this.active) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  destroy() {
    this.hand?.destroy();
    this.hand = null;
    this._setStatus('idle', '摄像头未开启');
  }

  _setStatus(state, message) {
    this._status = { state, message };
    this.onStatus?.({ state, message });
  }
}
