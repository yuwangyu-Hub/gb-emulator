# GB Emulator — Game Boy 网页模拟器

纯前端的 Game Boy（DMG-001）网页模拟器：零依赖模拟器内核 + three.js 3D 机身 + 卡带收藏抽屉 + 手机端虚拟按键。

**在线体验**：<https://yuwangyu-Hub.github.io/gb-emulator/>

> 仓库不含商业 ROM，直接打开是待机界面 —— 点「上传 ROM」选自己的 `.gb` / `.gbc` 文件即可开玩。本地调试时把 ROM 放进 `roms/`，"试玩示例"按钮就能用（该目录不入库）。

## 功能特性

- **完整模拟器内核**（`src/emulator/`）：SM83 CPU、PPU、APU 4 声道、定时器、DMA，音频时钟驱动主循环
- **3D 展示层**（`src/scene/`）：真机形态 Game Boy 3D 模型，插卡/退卡动画、外壳换色（5 色）、屏幕配色（4 款）、卡带抽屉收藏柜（自动多层）、包装盒摆设
- **卡带收藏**：上传 .gb/.gbc ROM 存入 IndexedDB，点击抽屉里的卡带直接插卡开玩；卡带标签自动匹配封面图库（可选）
- **全屏模式**：LCD 游戏画面整数倍缩放全屏（不拉伸变形），手机端画面居上、虚拟按键居下
- **移动端适配**：触屏虚拟按键（十字键 + 斜排 A/B + START/SELECT）、双指缩放场景、长按不弹系统菜单

## 本地运行

因为用了 ES Module，必须走 HTTP 而不是直接双击打开文件：

```bash
python3 tools/serve.py
# 打开 http://127.0.0.1:8123
```

## 部署到 GitHub Pages

仓库已按 GitHub Pages 的静态托管方式配置好，本目录全部文件（约 75MB，主要是 3D 模型和封面图库）直接推送到 `main` 根目录即可。

**方式一：命令行（已登录 gh CLI 时）**

```bash
gh auth status                        # 确认已登录
gh repo view <用户名>/gb-emulator     # 确认仓库已存在
git push -u origin main               # 推送即触发 Pages 构建
```

**方式二：从零开始新建仓库**

```bash
git init -b main
git add -A
git commit -m "init: game boy web emulator"
gh repo create gb-emulator --public --source=. --remote=origin --push
```

**方式三：纯手动**

1. 在 GitHub 网页新建空仓库（**不要**勾选 README / .gitignore / License，避免首次推送冲突）
2. `git remote add origin git@github.com:<用户名>/gb-emulator.git && git push -u origin main`
3. 仓库 **Settings → Pages → Build and deployment → Source** 选 **Deploy from a branch**，分支 `main`、目录 `/ (root)`，保存

一两分钟后访问 `https://<用户名>.github.io/gb-emulator/`。

> - 全部资源都是相对路径引用，放在仓库子路径下无需任何修改
> - 仓库里已放 `.nojekyll`，跳过 Jekyll 处理（否则构建更慢且可能吞掉下划线开头的文件）
> - 本地开发用的 `tools/serve.py` 不会上传到 Pages（脚本本身可入库，仅 `tools/out/` 被忽略）

## 可选素材说明

| 素材 | 位置 | 是否入库 | 缺失时的表现 |
|------|------|----------|--------------|
| 试玩卡带 ROM（`kirby.gb`） | `roms/` 目录 | **不入库**（见 `.gitignore`） | "试玩示例"按钮提示未内置 ROM，用"上传 ROM"按钮添加即可 |
| 卡带封面图库（`index.json` + 1633 张 jpg） | `assets/carts/` 目录 | 入库 | 卡带标签使用内置程序化绘制的默认样式 |
| 3D 模型（`gb-dmg-v2.glb`，26MB） | `models/` 目录 | 入库 | 无备用模型，机身无法显示 |
| three.js 等依赖 | `vendor/` 目录 | 入库 | 页面完全无法渲染（本地化，不依赖 CDN） |

- 封面图库可用 `tools/fetch_carts.py` 从 [Libretro Thumbnails](https://thumbnails.libretro.com/) 重新抓取生成
- **ROM 已刻意排除在仓库之外**：仓库是公开的，而 `星之卡比` 属任天堂商业软件，公开托管有 DMCA 下架风险。本地调试时把 ROM 放进 `roms/` 即可，不会被 git 跟踪
- 封面图虽为版权素材，但属缩略图性质，风险远低于游戏本体；若要彻底规避，删除 `assets/` 并让 `cartart.js` 走降级分支即可

## 许可与署名

- 本项目代码：MIT License（见 LICENSE）
- 3D 模型 [Game Boy High Poly SDS ready](https://sketchfab.com/3d-models/game-boy-high-poly-sds-ready-4e41c3f5079e4104a0a7f497ab05a087)：CC-BY 4.0（页面页脚已署名，请保留）
- 模拟器内核与 UI 为原创实现；本项目与 Nintendo 无关，Game Boy 为 Nintendo 商标

## 目录结构

```
gb-emulator/
├── index.html          # 入口（importmap + 错误捕获）
├── css/style.css       # 全部样式（含触屏布局与全屏覆盖层）
├── src/
│   ├── main.js         # 主逻辑：场景、交互、上传、全屏、虚拟按键
│   ├── emulator/       # 模拟器内核（cpu/ppu/apu/timers/joypad/gb）
│   ├── scene/          # 3D 展示层（机身/卡带/抽屉/包装盒模型）
│   ├── collection.js   # IndexedDB 卡带收藏
│   └── cartart.js      # 卡带封面匹配（缺失自动降级）
├── vendor/             # three.js 等第三方库（本地化，无 CDN 依赖）
├── models/             # GLB 3D 模型
├── roms/               # 内置试玩 ROM
├── assets/carts/       # 卡带封面图库
└── tools/              # serve.py 本地服务 / bump_version.py 缓存刷新 / smoke.js 冒烟
```

## 维护约定

- 改完代码重新发布前，先跑 `python3 tools/bump_version.py` 刷新 `?v=` 版本号，防止浏览器缓存新旧文件混搭（这是本项目踩过最大的坑）
- 冒烟测试：`node tools/smoke.js`（需 Node 18+，跑一帧渲染并导出 PNG）
