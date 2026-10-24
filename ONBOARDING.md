# 新成员接入 · 5 分钟上手

> 第一次进来，按顺序做完这 6 步就能开始写代码。
> 卡住了看最后一节「常见问题」，或者直接把报错发给队友。

---

## 第 1 步 · 拿到权限

找队长（仓库所有者）把你的 **GitHub 用户名** 发过去，他会在仓库里邀请你。

然后：

- 查收邮件，标题类似 `[WangHan934] invited you to collaborate`
- 点邮件里的 **View invitation** → **Accept invitation**
- 没收到邮件就去 <https://github.com/notifications> 看

接受后打开 <https://github.com/WangHan934/gesture-arena>，能看到仓库就说明成功了。

> 没有 GitHub 账号？先去 <https://github.com/signup> 注册，用户名用拼音，别用中文。

---

## 第 2 步 · 装 Git

**Windows**：下载 <https://git-scm.com/download/win>，一路下一步默认安装即可。

**macOS**：终端执行 `xcode-select --install`，或者 `brew install git`。

**验证装好了**：

```bash
git --version
```

看到 `git version 2.x.x` 就 OK。

**配一下身份**（只需一次，把名字和邮箱换成你自己的）：

```bash
git config --global user.name "张三"
git config --global user.email "你的GitHub注册邮箱"
```

---

## 第 3 步 · 把项目下到本地

```bash
git clone https://github.com/WangHan934/gesture-arena.git
cd gesture-arena
```

---

## 第 4 步 · 跑起来

| 系统 | 命令 |
|---|---|
| Windows | 双击 `start.bat` |
| macOS / Linux | `bash start.sh` |

浏览器会自动打开 <http://localhost:8000>，能画手势召唤生物就成功了。

> **别双击 index.html**，会白屏。项目用了 ES Module，必须走本地服务器。

---

## 第 5 步 · 认领你的任务

打开仓库的 **Issues** 标签，找到写着你角色编号的那条（A / B / C / D / E）。

每条 Issue 里写了：

- 你负责哪个目录
- 你能改哪些文件
- 现在可以做的具体任务

**只改自己那条 Issue 里写的目录**，别碰别人的。

---

## 第 6 步 · 发第一个 PR

```bash
# 1. 确保在最新代码上开工
git checkout main
git pull

# 2. 建自己的分支（名字换成你的任务）
git checkout -b feature/my-first-task

# 3. 改代码……改完提交
git add .
git commit -m "feat: 说明你改了什么"

# 4. 推上去
git push -u origin feature/my-first-task
```

推完打开仓库页面，顶部会出现黄色提示条 **Compare & pull request**，点它：

- 标题写清楚做了什么，例如 `feat: 焰狐增加拖尾特效`
- 描述里勾选自测项
- 点 **Create pull request**

等队友 review 通过就能合并。

**合并后回到 main 继续下一个任务**：

```bash
git checkout main
git pull
```

---

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 打开是白屏 | 直接双击了 index.html | 用 `start.bat` / `start.sh` 启动 |
| `start.bat` 一闪就没了 | 没装 Python 或 Node.js | 装 <https://www.python.org/downloads/>（勾选 Add to PATH） |
| 端口 8000 被占用 | 有别的程序在用 | 改 `start.bat` 里的 `set PORT=8000` 为 8001 |
| `git push` 报 rejected | 远程有别人的新提交 | 先 `git pull --rebase`，解决冲突再推 |
| 改完没生效 | 浏览器缓存 | Ctrl + F5 强制刷新 |
| 画手势没反应 | 画得太短或形状不对 | 画大一点、标准一点，看画板下方提示 |
| `Permission denied` | 邀请没接受，或没配 SSH | 先确认能打开仓库页面，再用 HTTPS 方式克隆 |

---

## 三条铁律

1. **不直接改 main**。所有改动走分支 + PR。
2. **只改自己负责的目录**。要改别人的文件，先在群里说一声。
3. **提交前自己跑一遍**。能启动、能画手势、能分出胜负。

违反了会互相覆盖代码，恢复起来很麻烦。

---

## 下一步

- 想了解玩法和技术细节 → [README.md](README.md)
- 想知道协作流程和代码规范 → [CONTRIBUTING.md](CONTRIBUTING.md)
