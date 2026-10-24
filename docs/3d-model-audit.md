# 3D 模型接入检查 · 2026-10-24

## 原因

原项目使用 Python 静态服务器，前端只渲染 Canvas 符号；没有 WebGL 场景、GLB 文件和模型加载器。此前交付的联网版也只显示预览图，并未接入 3D。把 Blender 文件放入目录不会自动加载。

## 来源与一致性

本次使用用户指定 gesture-arena-art 2/art/blender/AISummoner_Monsters_Arena_v2_FireAnim.blend。该文件与此前保存的完整源文件 SHA-256 一致。对三个怪兽的 34 个网格逐一检查顶点坐标及多边形索引，与用户放入游戏目录的 Untitled.blend 全部一致。

Untitled.blend 包含三个怪兽，没有竞技场、骨骼或动画；完整源文件包含 Arena 集合及炎角战魔的绑定与八个动作。源文件均未覆盖或修改。

## 浏览器资源

| 文件 | 来源集合 | 网格数 | 动画 |
|---|---|---:|---|
| assets/models/fire.glb | FireMonster | 12 | Attack, Cast, Death, Defend, Hit, Idle, Run, Walk |
| assets/models/shadow.glb | ShadowMonster | 11 | 源文件未提供 |
| assets/models/rock.glb | RockMonster | 11 | 源文件未提供 |
| assets/models/arena.glb | Arena | 10 | 静态竞技场 |

GLB 自包含，无缺失纹理或外部二进制引用。Three.js 0.186.1 从官方 npm 包提取，下载包 SHA-512 与官方元数据一致，MIT 许可随文件提供。

## 修复

- 新增本地模型加载器、WebGL 2 场景、灯光、相机及按容器尺寸调整画面。
- 首页和房间大厅展示三个原始怪兽与竞技场；对战按双方选择克隆对应模型与独立骨骼。
- 炎角战魔使用独立 AnimationMixer，按 PvP 事件播放 Attack / Cast / Defend / Hit / Death，并回到 Idle。Walk / Run 同样保留，当前回合玩法不触发移动。
- 修复 GLB 的服务类型为 model/gltf-binary；所有模型与依赖使用本地路径。
- 显示模型加载与 WebGL 初始化错误，不用其他模型降级替换。手势和联网模块保留。

## 验证

- 浏览器首页确认三个真实网格和竞技场可见，控制台无 warning / error。
- 两个独立浏览器端建房、加入、准备；双方都选炎角战魔，验证独立克隆不共享骨骼。
- PvP 火球术造成 22 伤害，双方同步观察 Attack / Hit 动作，控制台无错误。
- 全量测试覆盖原有手势、联网规则、房间重连及新增模型文件结构、动画清单与本地依赖路径。

## 使用

关闭旧的 Python 服务后，在项目目录重新执行 bash start.sh。启动的是 Node.js 联网服务；无需 npm install。若已有 Node.js 服务，也需先停止旧进程再重新启动。浏览器刷新后首页就能看到三个怪兽和竞技场。
