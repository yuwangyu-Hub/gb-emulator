# 3D 模拟器展厅 — Game Boy / Game Boy Advance 网页模拟器

纯前端掌机模拟器合集：根目录是展厅首页，进去后按机型进入各自的模拟器。全部零依赖内核 + three.js 展示层，ROM 只在浏览器本地运行，不上传服务器。

**在线体验**：<https://yuwangyu-Hub.github.io/gb-emulator/>

| 入口 | 路径 | 状态 |
|------|------|------|
| 展厅首页（选择机型） | `/` | ✅ |
| Game Boy（DMG-001，3D 机身） | `/gb/` | ✅ 可玩 |
| Game Boy Advance（AGB-001，2D 画面） | `/gba/` | ⚠️ 内测，内核未完成 |

> 仓库不含商业 ROM。GB 页点「上传 ROM」选自己的 `.gb` / `.gbc` 即可开玩；本地调试时把 ROM 放进 `gb/roms/`，"试玩示例"按钮就能用（该目录不入库）。
>
> GBA 页目前只能跑自带的合成测试 ROM：ARM7TDMI 与 PPU 已就位，但 BIOS HLE（SWI）尚未实现，真机商业 ROM 会停在黑屏。

## 目录结构

```
3DemulatorLibrary/           # 仓库根 = 站点根（目录名随意，Pages 只认仓库内容）
├── index.html               # 展厅首页（选机型）
├── css/hub.css              # 首页样式（两台掌机的 SVG 机身）
├── gb/                      # Game Boy 模拟器（3D）
│   ├── index.html
│   ├── css/ src/ vendor/ models/ assets/ tools/
│   └── roms/                # 本地 ROM，不入库
├── gba/                     # Game Boy Advance 模拟器（2D）
│   ├── index.html
│   ├── css/ src/ tools/
└── tools/                   # 站点级工具
    ├── serve.py             # 本地开发服务器（no-store + ?v=mtime 重写）
    └── bump_version.py      # 部署前刷新全部 ?v= 版本号
```

## Game Boy（`/gb/`）

### 功能特性

- **完整模拟器内核**（`src/emulator/`）：SM83 CPU、PPU、APU 4 声道、定时器、DMA，音频时钟驱动主循环
- **3D 展示层**（`src/scene/`）：真机形态 Game Boy 3D 模型，插卡/退卡动画、外壳换色（5 色）、屏幕配色（4 款）、卡带抽屉收藏柜（自动多层）、包装盒摆设
- **首屏加载进度**：模型带字节级进度条（`src/scene/modelLoader.js`），弱网下不会对着空白画布等
- **卡带收藏**：上传 .gb/.gbc ROM 存入 IndexedDB，点击抽屉里的卡带直接插卡开玩；卡带标签自动匹配封面图库（可选）
- **全屏模式**：LCD 游戏画面整数倍缩放全屏（不拉伸变形），手机端画面居上、虚拟按键居下
- **移动端适配**：触屏虚拟按键（十字键 + 斜排 A/B + START/SELECT）、双指缩放场景、长按不弹系统菜单

## Game Boy Advance（`/gba/`）

**内测中**：界面、控制、全屏、音频链路都已接好，内核还在打磨。

现状：

- ✅ ARM7TDMI 解释器（ARM + Thumb）、PPU mode0-5（文本 BG / 仿射 BG / 精灵 / 窗口 / 混色）、DMA、定时器、IRQ
- ✅ 自带合成测试 ROM（`node gba/tools/smoke.js`）可完整跑通：填满帧缓冲、输出 PNG
- ❌ BIOS HLE 未实现（`swi()` 目前是空壳），真机商业 ROM 启动后会停在黑屏
- ❌ 存档类型（EEPROM / Flash）只做了字符串探测，未做读写

已修的内核 bug（排查真机 ROM 时定位）：

| 问题 | 后果 |
|------|------|
| `MSR` 译码只匹配 `0x0129f000` / `0x0121f000` 两个定值，却按立即数取 `op & 0xff` | `msr CPSR_cf, r0` 把 0 写进 CPSR，模式位清零，启动前 52 条指令就跳飞 |
| `armSWI` / Thumb SWI 在 HLE 分支 `return true` 但没改 PC | 同一条 SWI 原地死循环 |
| `thumbLongBranch` 把 `h=2`（BL 前半）当成后半、`h=1` 当成立即数 | BL 用上一次残留的 LR 算目标，PC 跳进 ROM 数据区的奇数地址 |

下一步要做的：实现 BIOS HLE 的常用 SWI（`VBlankIntrWait` / `Halt` / `LZ77UnCompVram` / `CpuSet` / `CpuFastSet` / `Div` / `BgAffineSet` 等）。

## 本地运行

站点根目录跑一个静态服务即可，`/`、`/gb/`、`/gba/` 会同时可用。因为用了 ES Module，必须走 HTTP 而不是直接双击打开文件：

```bash
python3 tools/serve.py 8140
# 展厅 http://127.0.0.1:8140/
# GB   http://127.0.0.1:8140/gb/
# GBA  http://127.0.0.1:8140/gba/
```

## 部署到 GitHub Pages

仓库已按 GitHub Pages 的静态托管方式配置好，本目录全部文件直接推送到 `main` 根目录即可（约 48MB，主要是 3D 模型和封面图库）。

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
| 试玩卡带 ROM（`kirby.gb`） | `gb/roms/` 目录 | **不入库**（见 `.gitignore`） | "试玩示例"按钮提示未内置 ROM，用"上传 ROM"按钮添加即可 |
| 卡带封面图库（`index.json` + 1633 张 jpg） | `gb/assets/carts/` 目录 | 入库 | 卡带标签使用内置程序化绘制的默认样式 |
| 3D 模型（`gb-dmg-v2.glb`，3.6MB） | `gb/models/` 目录 | 入库 | 无备用模型，机身无法显示 |
| 包装盒模型（`gb-dmg-v1-backup.glb`，0.6MB） | `gb/models/` 目录 | 入库 | 右侧包装盒不显示，其余功能正常 |
| three.js 等依赖 | `gb/vendor/` 目录 | 入库 | 页面完全无法渲染（本地化，不依赖 CDN） |

- 封面图库可用 `tools/fetch_carts.py` 从 [Libretro Thumbnails](https://thumbnails.libretro.com/) 重新抓取生成
- **ROM 已刻意排除在仓库之外**：仓库是公开的，而 `星之卡比` 属任天堂商业软件，公开托管有 DMCA 下架风险。本地调试时把 ROM 放进 `roms/` 即可，不会被 git 跟踪
- 封面图虽为版权素材，但属缩略图性质，风险远低于游戏本体；若要彻底规避，删除 `assets/` 并让 `cartart.js` 走降级分支即可

## 许可与署名

- 本项目代码：MIT License（见 LICENSE）
- 3D 模型 [Game Boy High Poly SDS ready](https://sketchfab.com/3d-models/game-boy-high-poly-sds-ready-4e41c3f5079e4104a0a7f497ab05a087)：CC-BY 4.0（页面页脚已署名，请保留）
- 模拟器内核与 UI 为原创实现；本项目与 Nintendo 无关，Game Boy 为 Nintendo 商标

## 维护约定

- 改完代码重新发布前，先跑 `python3 tools/bump_version.py` 刷新 `?v=` 版本号（会遍历展厅首页 + `gb/` + `gba/`），防止浏览器缓存新旧文件混搭（这是本项目踩过最大的坑）
- 冒烟测试：GB 用 `node tools/smoke.js`、GBA 用 `node tools/smoke.js`（分别在 `gb/`、`gba/` 目录下执行，需 Node 18+）
- 静态检查：`node tools/checkimports.js`（在 `gb/` 目录下执行，校验模块导入路径、导出符号、index.html 资源引用）
- 本地预览：`python3 tools/serve.py 8140`（展厅首页）

### 模型体积（首屏最大的瓶颈）

原始 Sketchfab 模型是 89.9 万三角面 / 26MB，浏览器要下完才渲染。已用 [glTF Transform](https://gltf-transform.dev/) 处理到 22.5 万面 / 3.6MB，**网格名与层级保持不变**（`gameboyModel.js` 靠 `game_mesh` / `sticker` 等名字识别部件，处理时不能 join/flatten）。重新处理时：

```bash
npx @gltf-transform/cli weld    in.glb a1.glb
npx @gltf-transform/cli simplify a1.glb a2.glb --ratio 0.25 --error 0.002   # ratio 低于 0.2 屏幕边框会出现棱角
npx @gltf-transform/cli quantize a2.glb a3.glb                              # KHR_mesh_quantization，three 原生支持
npx @gltf-transform/cli dedup a3.glb a4.glb
npx @gltf-transform/cli prune a4.glb out.glb
# 包装盒模型只有 108 个面但贴图是 4 张 1MB PNG，转 JPEG 后 4.2MB → 0.6MB
npx @gltf-transform/cli jpeg b4.glb out.glb --quality 82 --formats png
```

> 不要用 `optimize` 一站式命令：它默认带 draco 压缩（需要额外解码器），且会 join/flatten 场景，破坏按网格名取部件的逻辑。
