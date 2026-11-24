# CYBER AQUA · 深海水族宠物机

3D 水族宠物机：喂养 / 玩耍 / 清洁 / 鱼群与访客管理，自由环绕镜头，饲料瓶真实颗粒物理，
海绵宝宝系列访客（海绵宝宝 / 派大星 / 章鱼哥）。纯前端实现，Three.js 已内置于 `www/vendor/`，无外部 CDN 依赖。

## 目录

```
www/                  Web 应用本体（PWA 壳 + 全部源码与资源）
  index.html          页面与 UI 结构
  guide.html          交互式 iPhone 安装教程（三条路线 / 勾选进度 / 命令复制 / FAQ）
  app.css             视觉系统 / 响应式 / 自定义滚动条
  src/                场景、鱼、访客、饲料瓶物理、粒子、后期、音频、UI、存档
  vendor/             three.module.js（r160，离线内置）
  icons/              PWA / iOS 图标
  manifest.webmanifest / sw.js   安装与离线缓存
package.json          Capacitor 依赖与脚本
capacitor.config.json iOS 原生壳配置（webDir = www）
tools/build-ios.sh    macOS 一键生成 .ipa
tools/sync-pages.sh   把 www/ 快照推送到 pages 分支（刷新永久网址）
tools/pngresize.py    图标尺寸生成脚本
.github/workflows/ios-build.yml   无 Mac 云编译 IPA（GitHub Actions）
.github/workflows/pages.yml       push 到 main 自动部署 www/ 到 GitHub Pages（永久 https 网址）
```

## 本地运行

```bash
npm run serve          # 或: python -m http.server 8765 --directory www
# 浏览器打开 http://127.0.0.1:8765/index.html
```

## 安装到 iPhone

> 交互式图文教程：浏览器打开 `www/guide.html`（应用内"设置 ▸ 添加到主屏幕 / 安装说明 ▸ 打开完整安装教程"亦可进入），
> 含三条路线的逐步勾选进度、可复制命令、分享菜单示意图与 FAQ。以下为文字版摘要。

### 方式 A · PWA（无需 Mac，推荐先体验）

**本项目已部署的永久网址：<https://zhouzhenxing745.github.io/cyber-aqua-pet/>**
（GitHub Pages，`pages` 分支 = `www/` 根目录快照；更新代码后执行 `bash tools/sync-pages.sh` 重新发布。）

1. iPhone Safari 打开上面的网址 → 分享按钮 → **添加到主屏幕** → 右上角“添加”。
2. 主屏幕图标启动后为全屏独立应用，离线可玩（进度保存在本机 localStorage）。
3. 想部署到自己的账号：将 `www/` 目录部署到任意 **HTTPS** 静态托管（GitHub Pages / Netlify / Vercel / Cloudflare Pages 均可）。
   Service Worker 与"添加到主屏幕"要求安全上下文（https 或 localhost）。
   临时体验可用免账号隧道：`npx --yes cloudflared tunnel --url http://127.0.0.1:8765`。

局域网临时体验：`python -m http.server 8765 --directory www` 后 iPhone 访问 `http://<电脑IP>:8765`，
可正常游玩，但 http 环境下不会注册 Service Worker（无离线缓存、不能添加主屏幕）。

### 方式 B · 无 Mac：GitHub Actions 云编译 IPA + 侧载

1. 项目推送到 GitHub（含 `.github/workflows/ios-build.yml`），push 自动触发或 Actions ▸ iOS Build ▸ Run workflow。
2. 运行变绿后在 run 页 Artifacts 下载 `CyberAqua-unsigned-ipa`，解压得 `.ipa`。
3. 电脑安装 **Sideloadly**（或 AltStore + AltServer），数据线连接 iPhone 并信任电脑。
4. 拖入 `.ipa` → 输入 Apple ID（免费即可）→ Start；手机 设置 ▸ 通用 ▸ VPN与设备管理 信任证书后启动。
5. 免费 Apple ID 签名 7 天有效，到期重签一次即可（进度保留）。

### 方式 C · 有 Mac：Capacitor 原生签名（.ipa / TestFlight）

原生编译**必须在 macOS + Xcode** 上进行（Apple 工具链限制；方式 B 用云端 macOS 绕过本机限制）：

```bash
npm install
npm run ios:build      # = bash tools/build-ios.sh
```

脚本会自动：生成 `ios/` 原生工程 → 同步 `www/` → 替换应用图标 → 归档 → 产出
`build/CyberAqua-unsigned.ipa`（未签名）。

- 未签名 ipa：用 **AltStore / Sideloadly / Apple Configurator 2**  sideload 到 iPhone。
- 正式分发：`npm run ios:open` 打开 Xcode，配置开发者证书 / Team 后 Archive 签名，走 TestFlight 或 App Store。

## 操作一览

- 拖动画面旋转视角，滚轮 / 双指缩放，双指拖动平移；右侧镜头轨提供 自由 / 正面 / 俯瞰 / 侧面 / 水下 / 跟随 六种机位与自动环绕。
- 点饲料瓶拿起 → 拖动到水面上方 → 倾斜倒料（或按住"倾倒"/ 空格 / 底部滑杆调倾倒角）；颗粒受重力与瓶壁约束真实流动。
- 底部常驻控制台：倾倒角、光照、波纹、气泡、游速、辉光、鱼群数量、水色、昼夜、网格、想法气泡、画质（低/中/高）+ 随机布景 / 截图 / 复位，全部实时生效。
- 主动作坞：喂食 / 玩耍 / 清洁 / 鱼群 / 访客；右上角声音开关一键静音全部音效。

## 代码审核结论（本轮已修复）

- 玻璃 / 水面 / 光柱 / 瓶身 fresnel 着色器 `pow(负数, 小数)` 产生 NaN 黑块 → 全部 clamp 修复。
- 暗色礁石材质过黑 + 尖刺几何，在亮沙底上读作"黑洞" → 提亮材质并改为平滑卵石几何。
- 派大星下半身埋入沙中、花短裤被星形身体包裹 → 抬高站位并加宽短裤厚度；章鱼哥鼻子下垂角度修正。
- 自动喂食倾倒窗口过短（1.5s），颗粒来不及流到瓶口 → 延长至 2.8s，实测 60→29 粒、鱼进食饱食度上升。
- Service Worker 旧版 stale-while-revalidate 导致更新后仍跑旧代码 → 改为 network-first + 离线回退；navigate 缓存误写 index.html 的问题一并修正，版本升至 v3，`guide.html` 纳入离线预缓存。
- 桌面 1101×1153 与移动 390×844 实测：无重叠、无出屏、控制台横向滚动可触及全部控件；重复投喂 / 补满 / 缩放 / 画质切换 / 复位重启均稳定，控制台无报错。

## 已知限制

- `.ipa` 编译依赖 macOS / Xcode：本机没有 Mac 时走方式 B 的 GitHub Actions 云编译；签名安装包仍须 Apple 证书（免费账号 7 天 / 付费账号长期）。
- 免费开发者账号 sideload 的应用每 7 天需重签一次；PWA 方式无此限制。