# 交付说明 · 2026-10-24

当前版本：两台设备联网的怪兽 PvP。

启动：安装 Node.js 20+，解压后进入目录，执行 `npm start`，或使用 `start.sh` / `start.bat`。无需 `npm install`。

在同一服务器上创建房间、分享六位房间码，两位真人各自选择怪兽并准备。画符号、点击技能或使用 1–6 均可施法。完整操作、跨网络部署方法和摄像头限制请看 README.md。

合并内容：
- gesture-arena-2026-10-24.zip 对应的原项目基础。
- c.html 的六种符号、治疗、护盾与援军机制，改为两位真人交替出招。
- gesture-arena-art.zip 中完整的 art/ 资源，文件内容已逐项核对。

网络服务端尚未部署到公网，跨网络对战需要配置公开的 HTTPS Node.js 服务；同一 Wi-Fi 可用启动时显示的局域网地址。

已接入三个原始怪兽和竞技场的实时 3D 显示。模型位于 assets/models/，源文件位于 art/blender/，Three.js 与加载器位于 vendor/three/，无需 CDN。

炎角战魔原有 8 个骨骼动作完整保留，并按 PvP 事件播放。其他两只源文件未绑定，保持原始静态模型。详细修复记录见 docs/3d-model-audit.md。
