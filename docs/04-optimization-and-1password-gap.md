# Keysmith macOS 桌面端优化方案与 1Password 8 能力差距分析

> **文档状态**：Batch 1 + Batch 2 + Batch 3 核心生态已落地并验证（部分需 Apple 付费签名能力项已标注）  
> **适用版本**：Keysmith `v0.1.0`（Tauri v2 + `keysmith-core` + `keysmith-cli` + React/Vite + MV3 Extension）  
> **文档说明**：本文档汇总当前 macOS 编译版本实测暴露的 **4 个原生问题根因与修复设计**、**对标标准 1Password 8 (macOS) 的五维能力差距矩阵**、**分批优化实施路线图（Batch 1 / 2 / 3）** 以及 **落地完成状态记录**。

---

## 第一部分：当前 4 个已知问题的根因诊断与修复方案（P0）

### 1.1 问题 1：打包的 App 没有图标 / 显示白底方块

#### 实证根因
1. **源图带不透明白色底色（非透明 Squircle）**  
   使用 Python Pillow 对当前产物像素实测，[logo.png](../assets/logo.png)（`1024×1024`）、[32x32.png](../apps/desktop/src-tauri/icons/32x32.png) 与 [128x128.png](../apps/desktop/src-tauri/icons/128x128.png) 虽标记为 `RGBA`，但四角像素均为不透明纯白 `RGBA(255, 255, 255, 255)`。此前通过 `qlmanage -t` 将矢量图栅格化为 PNG 时自动填充了纯白画布，打包进入 `Keysmith.app/Contents/Resources/icon.icns` 后表现为一个死白方块，不符合 macOS HIG 要求的**透明外框 + 圆角超椭圆（Squircle）+ 约 10% 透明安全留白**规范。
2. **终端直接启动裸二进制绕过了 `.app` Bundle 元数据**  
   直接运行 `./target/release/keysmith-desktop` 时，macOS 仅将其视作独立 Mach-O 可执行文件，不会读取 [Info.plist](../target/release/bundle/macos/Keysmith.app/Contents/Info.plist) 中的 `CFBundleIconFile`（`icon.icns`），因此 Dock 仅显示默认的终端/可执行文件占位图标。
3. **缺少运行时 Dock 图标兜底与 LaunchServices 缓存刷新**  
   Rust 启动阶段未通过 Cocoa API 主动设置进程图标，导致开发态或命令行直跑二进制时 Dock 始终无图标；此外重复替换 `.icns` 时若未刷新 `.app` 修改时间，Finder / Dock 图标缓存容易滞后。

#### 修复方案
- **重建真透明圆角图标管线**：基于 [logo.svg](../assets/logo.svg) 使用支持透明 Alpha 通道的渲染管线（如无头 Chromium/Playwright 透明背景截图或 CoreGraphics/WebKit 离屏透明渲染）生成 `1024×1024` 真透明 [logo.png](../assets/logo.png)，主体超椭圆按 macOS HIG 规范居中留出约 10% 透明边距（约 `824×824` 主体在 `1024×1024` 画布内），并自动化校验四角像素严格为 `RGBA(0, 0, 0, 0)`。
- **重制应用图标集与 `.icns`**：通过 `tauri icon`（或 `iconutil` 配合真透明 RGBA PNG 分层）重新生成 `apps/desktop/src-tauri/icons/` 下的 `32x32.png`、`128x128.png`、`128x128@2x.png` 与 `icon.icns`，确保所有 chunk 均为真透明 RGBA。
- **运行时设置 Dock 图标兜底**：在 [Cargo.toml](../apps/desktop/src-tauri/Cargo.toml) 为 `objc2-app-kit` 增加 `NSApplication`、`NSImage` feature，并在 [macos.rs](../apps/desktop/src-tauri/src/macos.rs) 新增 `set_app_dock_icon`，于 [lib.rs](../apps/desktop/src-tauri/src/lib.rs) `setup()` 启动阶段内嵌高清图标字节调用 `NSApplication.sharedApplication.setApplicationIconImage(...)`，使直接执行 `keysmith-desktop` 二进制时 Dock 同样显示正确图标。
- **规范启动与刷新缓存**：打包产出 `Keysmith.app` 后执行 `touch` 触发 Finder / LaunchServices 刷新，并在文档中提示通过 `open .../Keysmith.app` 或拖入 `/Applications` 启动。

#### 验收标准
- `assets/logo.png` 及 `src-tauri/icons/*.png` 四角像素检测 `alpha == 0`。
- Finder、DMG 安装界面与 Dock 中均显示边缘锐利、带 10% 安全留白的深蓝渐变圆角徽章，无白色方框。
- 命令行直跑 `target/release/keysmith-desktop` 时 Dock 也能正常显示 Keysmith 图标。

---

### 1.2 问题 2：系统托盘图标有白边

#### 实证根因
1. [lib.rs](../apps/desktop/src-tauri/src/lib.rs#L147-L149) 的 `setup_tray()` 直接复用了 `app.default_window_icon()`：
   - 该图标本身带有不透明白角底色，缩小到系统菜单栏（`18–22pt`）后会在深色/彩色壁纸下形成明显白边或小方框。
2. `TrayIconBuilder` **未启用 `.icon_as_template(true)`**，没有采用 macOS 菜单栏标准的单色模板图渲染协议（Template Image），无法随浅色/深色菜单栏自动反色。

#### 修复方案
- **新增菜单栏专用单色模板图标**：制作 `apps/desktop/src-tauri/icons/tray-icon.png`（`22×22`）与 `tray-icon@2x.png`（`44×44`），仅保留纯黑（`#000000`）钥匙轮廓矢量图形，背景 100% 全透明（`alpha = 0`）。
- **启用模板模式与 PNG 解码支持**：在 [Cargo.toml](../apps/desktop/src-tauri/Cargo.toml#L16) 为 `tauri` 启用 `image-png` feature；在 [lib.rs](../apps/desktop/src-tauri/src/lib.rs#L125-L158) 的 `setup_tray()` 通过 `tauri::image::Image::from_bytes(include_bytes!(...))` 加载专用托盘图标，并显式设置 `.icon_as_template(true)`。
- **顺手统一托盘菜单语言**：将当前英文托盘项（`Show Keysmith` / `Quick Access` / `Lock Vault` / `Quit`）统一为中文（`显示 Keysmith` / `Quick Access` / `锁定保险库` / `退出 Keysmith`），与应用顶部菜单保持一致。

#### 验收标准
- macOS 深色菜单栏自动渲染为纯白锐利钥匙轮廓，浅色菜单栏自动渲染为纯黑轮廓，四周零白边、零锯齿。

---

### 1.3 问题 3：大字展示（Large Type）缺少窗口置顶

#### 实证根因
当前 [LargeTypeModal.tsx](../apps/desktop/src/components/LargeTypeModal.tsx) 仅是挂载在主窗口内部的一个 HTML `<dialog>`（`ModalDialog`）。当用户切到 Terminal、SSH 客户端、远程桌面或浏览器输入密码时，主窗口失去焦点被遮挡，Large Type 也随之被压在底层，无法发挥“置顶对照手输”的核心作用。

#### 修复方案（对标 1Password 8 独立置顶悬浮窗）
- **新增独立悬浮窗 `large-type`**：
  - 在 Rust 侧新增窗口管理命令：`window_open_large_type(label, value)`、`window_close_large_type()`、`window_set_large_type_pin(pinned)` 与 `large_type_get_payload()`。
  - 使用 `tauri::WebviewWindowBuilder` 动态创建或唤醒 `label = "large-type"` 窗口，默认配置：
    - `always_on_top(true)`（始终置顶）
    - `visible_on_all_workspaces(true)`（切换 macOS 桌面空间/全屏应用旁同样可见）
    - `decorations(false)`（紧凑深色无边框悬浮面板，顶部支持 `data-tauri-drag-region` 自由拖拽）
    - 初始尺寸约 `760×340`、居中显示、支持按字符数量自适应调整或手动缩放。
- **零泄密载荷传递与锁屏瞬毁**：
  - **禁止**通过 URL query 传递密码明文，避免明文落入浏览历史或日志。
  - 明文以 `Zeroizing<String>` 暂存于 Rust `AppState`（仅保留当前一条），`large-type` 窗口前端挂载后通过 IPC `large_type_get_payload` 一次性拉取。
  - 窗口关闭或任意锁屏事件（手动锁定、自动锁定、即将扩展的休眠锁定）触发时，Rust 立即关闭销毁 `large-type` 窗口并 `zeroize` 擦除暂存明文。
- **前端双模式路由**：
  - [main.tsx](../apps/desktop/src/main.tsx) / [App.tsx](../apps/desktop/src/App.tsx) 检测当前窗口标识（如 `?window=large-type` 或 `getCurrentWebviewWindow().label === 'large-type'`），渲染专用轻量化 `LargeTypeWindow` 组件，提供**「置顶中 / 取消置顶」开关**、**一键复制**、**1-based 字符下标 + 字母/数字/符号三色区分**、**`Esc` 关闭**。
  - 浏览器原型模式（非 Tauri 环境）继续回退复用 `LargeTypeModal`，保持原型预览可用。
- **最小权限声明**：在 [default.json](../apps/desktop/src-tauri/capabilities/default.json) 为 `main` 与 `large-type` 窗口配置最小必需权限（`core:window:allow-set-always-on-top`、`core:window:allow-close`、`core:window:allow-start-dragging`、`core:window:allow-show`、`core:window:allow-set-focus`）。

#### 验收标准
- 点击任意密码或敏感字段的「大字展示」后弹出独立悬浮窗口；切换到 Terminal / Chrome / VS Code 时大字窗口稳定停留在最前层。
- 支持拖动位置、手动切换置顶/取消置顶、按 `Esc` 关闭；执行锁定操作时悬浮窗立即消失且内存已擦除。

---

### 1.4 问题 4：会有白屏 + `error messaging the mach port for IMKCFRunLoopWakeUpReliable`

#### 实证根因（4 重技术因素 + 终端日志解析）
1. **启动首帧白屏闪烁**  
   [tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json#L13-L24) 中 `main` 窗口未设置 `"visible": false` 与 `"backgroundColor"`，且 [index.html](../apps/desktop/index.html) 在 CSS 加载前没有任何内联底色。窗口创建瞬间 macOS `WKWebView` 先绘制纯白画布，再解析约 `507 KB` 的打包 JS（`index-*.js`）并等待 `sessionGetState()` 返回，形成肉眼可见的白屏期。
2. **初始化异常处理缺失 + 无全局 `ErrorBoundary` → 永久白屏风险**  
   - [sessionStore.ts](../apps/desktop/src/stores/sessionStore.ts#L39-L42) 的 `init()` 没有 `try/catch`，[App.tsx](../apps/desktop/src/App.tsx#L69) 仅写了 `void initSession().then(...)` 未捕获 rejection。一旦 `session_get_state` 在极端状态下异常，`initialized` 永远停在 `false`，页面会死锁在 [App.tsx](../apps/desktop/src/App.tsx#L182-L189) 的空白 `<div>` 上。  
   - [main.tsx](../apps/desktop/src/main.tsx) 未包裹 React `ErrorBoundary`，当某条 Vaultwarden 真实数据包含边界字段（如空数组、异常日期、特殊 URI）导致组件渲染抛出异常时，整个 WebView 会直接崩成全白屏幕。
3. **同步 Tauri 命令占用主线程 + 重加密/解密未卸载（叠加触发 `IMKCFRunLoopWakeUpReliable`）**  
   - 终端日志 `error messaging the mach port for IMKCFRunLoopWakeUpReliable` 源自 macOS Input Method Kit（中文/日文输入法通过 Mach 端口唤醒 AppKit 主 RunLoop）。在终端直接运行裸 Mach-O 二进制时该系统消息本身较常见；**但当 AppKit 主线程 RunLoop 被耗时操作阻塞时，IMK Mach 端口消息更易超时报错，同时造成界面白屏或假死**。  
   - 检查 [commands.rs](../apps/desktop/src-tauri/src/commands.rs) 可见，`session_get_state`、`session_lock`、`session_touch_activity`、`vault_list`、`item_list`、`item_get_all_stats`、`item_get`、`totp_compute`、`generator_generate`、`clipboard_copy_secret` 等均为**同步 `pub fn`**（Tauri 默认在主线程执行同步命令）；此外 [session/mod.rs](../crates/keysmith-core/src/session/mod.rs#L296-L321) 中的 `auth_login` 直接在 async 上下文同步执行 60 万次 PBKDF2-SHA256 与 460+ 条目全量解密，未通过 `tokio::task::spawn_blocking` 隔离到计算线程池。
4. **WebKit 编译目标激进 & 外链 `<a>` 直接导航风险**  
   - [vite.config.ts](../apps/desktop/vite.config.ts#L10) 设置了 `build.target: 'esnext'`，在不同 macOS 版本的系统 `WKWebView` 上存在新语法兼容隐患。  
   - [ItemDetailPane.tsx](../apps/desktop/src/features/detail/ItemDetailPane.tsx#L643-L647) 等处存在多处原生 `<a href="..." target="_blank">`，部分外部站点或非标准 URI 在 `WKWebView` 内点击时可能触发意外空白导航。

#### 修复方案
- **零白闪启动流程（Hide-Until-Ready + 主题底色预涂）**：
  - [tauri.conf.json](../apps/desktop/src-tauri/tauri.conf.json) 主窗设置 `"visible": false`。
  - [index.html](../apps/desktop/index.html) 头部内联极简脚本与背景色，根据系统深浅色或本地偏好在 HTML 解析第 0ms 即涂抹 `#eef0f3`（浅色）或 `#1a1d21`（深色）。
  - React 首帧挂载完成（或初始化完成后）调用 `getCurrentWindow().show()`；Rust 侧同时设 `1200ms` 兜底定时器，若前端异常未显窗也强制 `show()` 并由错误界面接管，杜绝“既隐藏又卡死”。
- **全局容错防白屏（ErrorBoundary + 初始化兜底）**：
  - [sessionStore.ts](../apps/desktop/src/stores/sessionStore.ts) 增加 `try/catch`、`initError` 状态与 `retryInit` 方法，初始化失败时展示带「重试」按钮的诊断恢复页，而非空白 `div`。
  - [main.tsx](../apps/desktop/src/main.tsx) 包裹 `AppErrorBoundary`，并监听全局 `error` / `unhandledrejection`，任何前端渲染异常均展示友好错误卡片与重置入口。
- **全异步命令 & CPU 密集型计算卸载**：
  - 将 [commands.rs](../apps/desktop/src-tauri/src/commands.rs) 中所有读取/写入状态、条目与加解密的命令统一改为 `async fn`，释放 AppKit 主线程。
  - 将 `auth_login`、`auth_register`、`sync_now`、`watchtower_scan` 中的 PBKDF2 / Argon2id 密钥派生、460+ 条目解密与 SQLite I/O 统一通过 `tokio::task::spawn_blocking` 调度，且加解密计算在锁外执行，避免长持 `RwLock` 与阻塞 RunLoop。
- **WKWebView 兼容性与外链加固**：
  - [vite.config.ts](../apps/desktop/vite.config.ts) `build.target` 调整为 `['es2022', 'safari16']`，契合 `minimumSystemVersion: "13.0"` 的系统 WebKit 基线。
  - 新增统一 `openExternalUrl(url)` 工具方法，在 Tauri 环境一律调用 `@tauri-apps/plugin-opener` 的 `openUrl()`，替换全部 `<a target="_blank">` 直接跳转。
  - 在文档中说明：正常通过 `Keysmith.app` 启动完整 Cocoa 应用会话即可规避终端直跑裸二进制的 IMK 警告，叠加主线程卸载后，IMK Mach 端口通信不会再因卡顿超时。

#### 验收标准
- 连续冷启动 10 次无白色闪屏；切换深色模式启动首帧即呈现深色背景。
- 登录/全量同步 460+ 条目期间，窗口拖拽、取消与滚动保持流畅，不卡死主线程。
- 模拟前端组件抛错或后端 IPC 拒绝时，渲染可交互的恢复 UI 而非纯白画布。

---

## 第二部分：与标准 1Password 8 (macOS) 完整能力差距对比

以下按五大维度，基于当前代码库实测能力对标 **1Password 8 for Mac** 正式版标准。

### 2.1 维度一：macOS 原生窗口与系统集成

| 功能项 | Keysmith 现状 | 1Password 8 (macOS) 标准 | 差距说明与影响 | 建议优先级 |
| :--- | :--- | :--- | :--- | :---: |
| **独立悬浮 Quick Access** | 仅主窗口内 `<dialog>`（`QuickAccessModal`） | `⌘⇧Space` 呼出独立无边框全局浮窗，跨任何桌面/全屏 App 上方直接搜密、复制、填充 | 当前若主窗口最小化或关闭，无法独立唤起迷你检索浮窗；唤起会强行拉出主窗打断工作流 | **P0** |
| **独立置顶 Large Type** | 仅主窗口内弹窗 | 独立悬浮置顶窗，切出终端/浏览器依然留在最前 | 对照抄写 SSH/BIOS/隔离终端密码时体验割裂（即问题 3） | **P0** |
| **关闭主窗常驻托盘 + 开机自启** | 关闭主窗直接退出进程（未拦截 `CloseRequested`）；无开机自启 | 点左上角红叉关闭主窗仅隐藏窗口，常驻菜单栏托盘 & 保持已解锁会话或快速唤起；支持登录启动 | 目前手误按 `⌘W` 或点关闭会彻底退出应用、丢失桌面常驻体验 | **P0** |
| **原生毛玻璃（Vibrancy）侧栏** | 纯色 CSS 变量背景 | macOS 原生 `NSVisualEffectView` 半透明毛玻璃侧边栏与自适应窗口阴影 | 视觉质感偏 Web 化，缺少 macOS 原生通透感 | **P1** |
| **菜单栏小组件（Popover）** | 仅 4 项静态文本菜单 | 点击菜单栏图标直接展开迷你搜索列表、近期使用与一键锁库 | 快速取密需先弹主窗，菜单栏实用度低 | **P1** |
| **防截屏/录屏保护** | 未启用 | 开启后对操作系统隐藏敏感窗口内容（`NSWindow.sharingType = .none`） | 共享屏幕或会议录屏时无法自动屏蔽敏感界面 | **P1** |
| **自定义全局快捷键** | 硬编码 `CommandOrControl+Shift+Space` | 设置内自定义 Quick Access、全局锁定、一键自动填充快捷键并冲突检测 | 易与 Alfred / Raycast / 系统输入法快捷键冲突 | **P1** |

### 2.2 维度二：安全架构与系统锁屏联动

| 功能项 | Keysmith 现状 | 1Password 8 (macOS) 标准 | 差距说明与影响 | 建议优先级 |
| :--- | :--- | :--- | :--- | :---: |
| **系统休眠/合盖/锁屏自动秒锁** | 仅支持 10 秒轮询的空闲计时自动锁 | 监听 macOS `willSleep`、屏幕锁定 `com.apple.screenIsLocked`、切换用户事件立即毫秒级锁定并 `zeroize` | 合盖带走电脑时若未到空闲分钟数，内存中仍短暂残留解锁密钥 | **P0** |
| **剪贴板跨设备同步隔离（Universal Clipboard）** | 已写 `ConcealedType` + `TransientType` + SHA-256 防误清 | 除本地隐私标记外，显式禁止通过 macOS 通用剪贴板同步到同一 Apple ID 的 iPhone/iPad | 缺少显式禁止跨设备接力（Handoff/Universal Clipboard）标记（如 `com.apple.is-remote-clipboard` 相关策略或限制） | **P0** |
| **硬件级 Touch ID Keychain ACL** | `LAContext` 认证与 `set_generic_password` 分离存储 | 使用 `SecAccessControlCreateWithFlags(..., biometryCurrentSet)` 将密钥直接绑定到 Secure Enclave 生物识别 ACL，且支持“重启/超 7 天强制重输主密码” | 当前分离调用无法防本地进程绕过验证直读普通 Keychain 项；正式绑定需配合代码签名签名链 | **P1**（需证书，未签名前先保留当前+定期强制主密码策略） |
| **Watchtower 泄露库与 2FA 支持库** | 已实现本地弱/复用/旧/HTTP/过期扫描 + 可选 HIBP k-匿名查询 | 后台静默增量检查 + 内置 `2fa.directory` 支持站点识别（提示“该站支持 2FA 但你未开启”） | 仅做通用缺失 TOTP 提示，未能识别某网站本身支持 2FA 或 Passkey | **P1** |
| **旅行模式（Travel Mode） & 紧急恢复套件** | 无 | 出行一键隐藏非“旅行安全”保险库；生成带恢复密钥的 PDF Emergency Kit | 高敏出行场景与账户防遗失文档缺失 | **P2** |

### 2.3 维度三：条目管理与高频日常工作流

| 功能项 | Keysmith 现状 | 1Password 8 (macOS) 标准 | 差距说明与影响 | 建议优先级 |
| :--- | :--- | :--- | :--- | :---: |
| **密码生成器历史记录** | 即时生成即丢弃 | 保留最近生成的 N 条密码历史（带时间戳与来源），防止注册改密后忘记保存而丢失新密码 | 日常极高频痛点：注册网站时先生成复制密码，还没来得及建条目就关闭弹窗会导致密码永久丢失 | **P1** |
| **多选、批量操作、克隆与归档** | 仅单选编辑/删除 | 支持多选条目批量移动保险库、批量打标、批量移入废纸篓；支持「复制为新条目（Duplicate）」与「归档（Archive）」 | 整理数百条已有 Vaultwarden 密码（实测 460+ 条）时效率极低 | **P1** |
| **加密附件（Attachments）** | 尚未接入附件上传、预览与解密下载 | 每条条目支持上传密钥文件、证书（`.pem`/`.p12`）、恢复码 PDF 等加密附件并预览 | 开发者/运维存 SSH 证书或恢复码图片需依赖第三方 | **P1** |
| **完整导入 / 导出与备份** | 仅支持在线 Vaultwarden 同步 | 支持 `.1pux`、Bitwarden JSON/CSV、Chrome/Safari 密码 CSV 一键导入，支持加密 JSON/明文 CSV 安全导出 | 用户从 1Password / Chrome / Safari 迁移或做冷备份受阻 | **P1** |
| **网站图标（Favicon）缓存与自定义图标** | 仅首字母/模板静态徽章 | 隐私代理拉取网站 Favicon 本地缓存 + 支持用户上传或自选条目图标 | 460+ 条目列表缺少品牌视觉锚点，肉眼扫视辨识度较低 | **P1** |
| **OTP 二维码截图/剪贴板导入** | 需手动粘贴 `otpauth://` 或 Base32 密钥 | 一键扫描屏幕/剪贴板中的 2FA 二维码图片直接解析填充 TOTP | 绑定新 2FA 时少一步第三方解码 | **P1** |
| **SSH 密钥一键生成 Ed25519** | 仅文本框粘贴已有公私钥 | 新建 SSH 密钥条目时一键生成 Ed25519 / RSA 密钥对并计算 SHA-256 指纹 | 开发者工作流不够顺滑 | **P1** |
| **Phase 2 扩展类别模板** | 仅 Phase 1 8 种模板（登录/卡/笔记/身份/SSH/API/数据库/软件许可） | 完整覆盖银行账户、加密钱包、Wi-Fi 路由器、护照、驾照、会员卡、医疗记录、通用文档等 | 生活与证件类密码收纳不全 | **P1** |
| **多账户切换 & 组织集合（Collections）** | 单账户登录，仅同步个人 `folders` | 同时登录多个账户（个人自托管 + 公司团队），侧栏清晰展示组织与共享集合 | 多身份/团队用户无法切换或管理共享条目 | **P2** |

### 2.4 维度四：同步引擎与离线容错

| 功能项 | Keysmith 现状 | 1Password 8 (macOS) 标准 | 差距说明与影响 | 建议优先级 |
| :--- | :--- | :--- | :--- | :---: |
| **Access Token 自动续期（401 静默刷新）** | 仅在登录时保存 `access_token` / `refresh_token`，过期后需重登或报错 | 请求遇 401 自动携带 `refresh_token` 静默换新并重试当前请求 | 长期打开桌面端超过 Token 有效期（通常 1 小时）后同步/保存易失败 | **P0** |
| **离线修改队列（`dirty_op`）与冲突副本** | 离线写操作依赖单次直连请求，断网易失败 | 断网时所有增删改落本地加密队列，恢复网络后台自动增量同步并生成冲突副本保留历史 | 飞机/高铁/弱网下编辑条目存在失败或丢失风险 | **P1** |
| **SignalR WebSocket 实时推送** | `signalrConnected: false`，需手动触发同步 | 与服务端维持长连接（Bitwarden/Vaultwarden Notifications Hub），毫秒级推送他端变更 | 手机或网页新增密码后桌面端无法即时收到 | **P1** |

### 2.5 维度五：生态协同与发布分发

| 功能项 | Keysmith 现状 | 1Password 8 (macOS) 标准 | 差距说明与影响 | 建议优先级 |
| :--- | :--- | :--- | :--- | :---: |
| **浏览器扩展 + Passkey 自动唤起** | 仅文档与 UI 预留了只读 Passkey 模型，无扩展实体 | Chrome/Edge/Firefox 扩展自动填充账号密码 + 拦截 `navigator.credentials.create/get` 自动保存与登录 Passkey + Native Messaging 桌面端一次解锁联动 | **网页自动填充与网页 Passkey 落地**依赖此组件，目前仅能在桌面端查看已有密码 | **P2** |
| **macOS 系统级 AutoFill** | 无 App Extension | `ASAuthorizationProviderExtension` 让 Safari 及原生 App 键盘上方弹出自动填充与系统 Passkey | 原生 App 与 Safari 需切回 Keysmith 复制粘贴 | **P2** |
| **CLI (`ks`) & `keysmith-ssh-agent`** | 无独立 CLI 与 Agent | `op` CLI 脚本注入环境变量（`op run`）+ 内存托管 `SSH_AUTH_SOCK`，`git`/`ssh` 免落盘私钥签名 | 终端开发者高级工作流（含替代损坏的 `op-ssh-sign`）尚未打通 | **P2** |
| **Apple Developer ID 签名、公证与自动更新** | 本地未签名 `.app` / `.dmg` | Developer ID 签名 + Apple Notarization + 内置静默自动更新（Sparkle / Tauri Updater） | 未签名弹窗提示、系统 Gatekeeper 拦截，且限制真 Keychain Biometry ACL | **P2** |

---

## 第三部分：分批优化实施路线图

建议分三批迭代推进，确保每一步都可直接编译打包并在真机上验收：

### Batch 1（P0 — 原生体验、零白屏与可用性闭环）
1. **解决全部 4 个当前实测问题**：
   - 真透明圆角图标管线 + `icon.icns` 重建 + 运行时 `NSApplication` Dock 图标兜底（问题 1）
   - 纯黑透明底系统托盘模板图 + `.icon_as_template(true)`（问题 2）
   - 独立置顶无边框 `large-type` 悬浮窗 + `Zeroizing` 安全传递 + 锁屏即毁（问题 3）
   - `visible: false` + 首帧主题底色 + `sessionStore.init` 容错 + 全局 `ErrorBoundary` + 命令全异步与 `spawn_blocking` 计算卸载 + `openUrl` 外链加固（问题 4）
2. **4 项高性价比核心原生补强（强烈建议同批落地）**：
   - **独立悬浮 Quick Access 窗口**（`⌘⇧Space` 全局唤起不拉出主窗，可直接搜、复制、锁屏即毁）
   - **关闭主窗隐藏到托盘**（拦截 `CloseRequested` 仅隐藏不退出；点击 Dock 图标 / 托盘菜单重新显示；`⌘Q` 才真正退出）
   - **系统休眠/合盖/锁屏自动秒锁**（监听 macOS `willSleep` / `screenIsLocked` 事件触发 `session_lock`）+ 剪贴板防通用剪贴板外泄加固
   - **Access Token 自动续期**：遇 401 自动用 `refresh_token` 换新并无感重试，保证长期常驻桌面端不断连

### Batch 2（P1 — 核心生产力与 1Password 8 主流体验齐平）
- **同步与容错**：`dirty_op` 本地离线加密写队列 + 后台补偿同步 + Vaultwarden SignalR WebSocket 实时增量推送。
- **高频日常功能**：密码生成器历史记录、列表多选/批量操作、条目复制/克隆/归档、加密附件上传下载预览、`.1pux`/Bitwarden/CSV 导入导出。
- **信息增强与开发者体验**：网站 Favicon 隐私缓存、OTP 二维码截图/剪贴板扫码解析、SSH Ed25519 一键生成、Phase 2 扩展模板、侧栏原生毛玻璃 Vibrancy 与防截屏开关。

### Batch 3（P2 — 跨端生态与分发合规）
- Manifest V3 浏览器扩展 + Native Messaging Unix Socket 桌面联动（网页自动填充 + Passkey 自动保存与登录唤起）
- macOS 系统级 `ASAuthorizationProviderExtension`（Safari / 原生 App 自动填充）
- `ks` CLI 与 `keysmith-ssh-agent`（`SSH_AUTH_SOCK` 内存私钥托管）
- 多账户切换、Vaultwarden 组织/集合共享、Apple Developer ID 签名公证与自动更新机制

---

## 第四部分：落地状态总览（Batch 1 / Batch 2 / Batch 3）

| 批次 | 项目 | 落地状态 | 说明 |
| :--- | :--- | :--- | :--- |
| **Batch 1 (P0)** | 问题 1（真透明应用图标 + Dock 运行时兜底） | ✅ 已完成并验证 | 四角像素严格 `RGBA(0,0,0,0)`；`icon.icns` 内含 8 个透明 PNG chunk；启动设置 `NSApplication.setApplicationIconImage` |
| **Batch 1 (P0)** | 问题 2（菜单栏纯黑透明模板托盘图标） | ✅ 已完成并验证 | 专用 `tray-icon.png` / `tray-icon@2x.png` + `.icon_as_template(true)` + 中文托盘菜单 |
| **Batch 1 (P0)** | 问题 3（独立置顶 `large-type` 悬浮窗） | ✅ 已完成并验证 | `always_on_top` + 跨桌面空间 + 自由拖拽 + 置顶开关 + `Zeroizing` 安全传递 + 锁屏瞬毁 |
| **Batch 1 (P0)** | 问题 4（零白闪启动 + 容错 + 异步计算卸载） | ✅ 已完成并验证 | `visible: false` + 首帧主题底色 + `AppErrorBoundary` + `init()` 重试 + 全异步命令 + `spawn_blocking` + `system_open_url` |
| **Batch 1 (P0)** | 独立悬浮 Quick Access / 关闭常驻托盘 / 休眠锁屏 / 剪贴板防外泄 / Token 自动续期 | ✅ 已完成并验证 | `quick-access` 独立浮窗、`CloseRequested` 隐藏与 `Reopen` 唤醒、`willSleep` & `screenIsLocked` 秒锁、`CurrentHostOnly`、401 自动 `refresh_token` |
| **Batch 2 (P1)** | SignalR 实时推送 + 组织集合 + 多账户切换 | ✅ 已完成并验证 | `/notifications/hub` WebSocket 客户端 + `organizations/collections` 解析 + 多账户 `account_switch` |
| **Batch 2 (P1)** | 8 种扩展模板 / 归档 / 克隆 / 批量操作 / 附件 / SSH Ed25519 / QR 扫码 / 生成历史 / Favicon / 导入导出 / Vibrancy / 防截屏 | ✅ 已完成并验证 | 19 种模板、加密生成器历史、加密附件、Ed25519 生成与签名、`rqrr` 二维码解析、`.1pux`/Bitwarden/Chrome/Safari 导入导出、`NSWindowSharingNone` |
| **Batch 3 (P2)** | Manifest V3 浏览器扩展 + `ks` CLI & `keysmith-ssh-agent` + `ks nmh` | ✅ 已完成并验证 | `apps/browser-extension/`（自动填充 + Passkey `create/get` 桥接）与 `crates/keysmith-cli/`（`ks` + OpenSSH `SSH_AUTH_SOCK` + `keysmith.sock`） |
| **外部条件依赖** | Apple Developer ID 签名/公证、硬件 `SecAccessControl` Biometry ACL、macOS 系统级 `ASAuthorizationProviderExtension` | ⏸️ 受本地签名条件限制 | 经 `security find-identity` 检查本地尚无 Apple Developer ID 签名证书（`0 valid identities`）；现阶段已通过 `LAContext` + Keychain + `biometricMaxDays` 策略闭环替代 |
