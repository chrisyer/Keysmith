const I18N = {
  'zh-CN': {
    metaTitle: 'Keysmith — 本地优先 · 零知识加密 · 跨平台密码与通行密钥管理器',
    nav: {
      advantages: '核心优势',
      architecture: '零知识架构',
      developer: '开发者工具',
      platforms: '全平台规划',
      install: '下载安装',
      themeToggleAria: '切换明暗主题',
    },
    common: {
      copy: '复制',
      copied: '已复制 ✓',
    },
    hero: {
      badge: 'v0.1.5 · 开源 MPL-2.0 · Rust + Tauri v2 原生构建',
      titleLead: '把你的秘密，牢牢锁在',
      titleAccent: '自己的设备与私有云里',
      subtitle:
        'Keysmith 是一款本地优先、端到端零知识加密的跨平台密码与通行密钥管理器。以 Rust 驱动核心密码学引擎，告别 Electron 卡顿，完整兼容 Vaultwarden / Bitwarden 实时同步，并原生内置 OpenSSH Agent、屏幕二维码秒扫 2FA 与 Manifest V3 浏览器插件。',
      ctaDownload: '立即下载 v0.1.5',
      ctaReleases: '查看全部发行版 →',
      platMac: 'macOS 13+',
      platWin: 'Windows 10/11',
      platExt: 'Chrome / Edge / Arc / Brave 插件',
      platNext: 'Linux (.deb / .rpm / AppImage) · iOS / Android 推进中',
    },
    preview: {
      regionAria: 'Keysmith 桌面端三栏交互预览',
      windowTitle: 'Keysmith Desktop · Liquid Glass',
      syncState: 'SignalR 实时已同步',
      personalVault: '个人保险库',
      navAll: '全部条目',
      navPasskey: '通行密钥 (Passkey)',
      navTotp: '二次验证 (2FA)',
      navSsh: 'SSH 密钥 & Agent',
      navWatchtower: '瞭望塔安全体检',
      searchHint: '⌘F 搜索站点、用户名或 #标签...',
      usernameLabel: '用户名',
      passwordLabel: '密码',
      totpLabel: '一次性验证码 (2FA)',
      passkeyLabel: '已绑定通行密钥 (WebAuthn)',
      sshKeyLabel: 'Ed25519 公钥 / 指纹',
      sshSocketLabel: 'OpenSSH Agent 状态',
      secretRefLabel: 'CLI 密钥注入命令',
      urlLabel: '关联网址',
    },
    adv: {
      eyebrow: '为什么选择 Keysmith',
      title: '原生桌面级精致体验，Bitwarden / Vaultwarden 的完全自主',
      desc: '不再需要在闭源订阅付费和粗糙臃肿的开源客户端之间妥协。Keysmith 把企业级零知识密码学、极速原生交互与开发者生产力集成在同一个轻量客户端中。',
      c1Title: '端到端零知识 & 私有部署',
      c1Body:
        '完全兼容 Bitwarden / Vaultwarden 1.37+ 协议，采用 Argon2id / PBKDF2 + HKDF + AES-256-CBC-HMAC 本地加解密。密钥生命周期使用 zeroize 自动擦除，载荷与会话令牌全部加密后写入 SQLite。',
      c2Title: 'Rust + Tauri v2 原生极速',
      c2Body:
        '安装包仅 ~10 MB，告别 Electron 内存占用。集成按需开启的 macOS Touch ID 与 Windows Hello 原生生物识别解锁、Liquid Glass 毛玻璃视觉、防截屏保护与剪贴板自动倒计时清除。',
      c3Title: 'Passkey 通行密钥 & 屏幕扫码 2FA',
      c3Body:
        '浏览器扩展无缝接管 WebAuthn 注册与登录（支持 ES256、Ed25519 与 PRF 扩展），跨设备加密同步。添加一次性验证码支持全屏自动识别二维码或剪贴板导入。',
      c4Title: '为开发者打造的工具链',
      c4Body:
        '内置 OpenSSH Ed25519 Agent（支持生物识别签名确认与一键配置 ~/.ssh/config）、命令行密钥注入（ks）、任意原生窗口 Auto-Type 自动键入，以及 19 种结构化条目模板。',
      c5Title: '变更驱动实时同步 & 安全快照',
      c5Body:
        'SignalR WebSocket 实时推送 + 智能退避自愈，离线编辑自动入队并在网络恢复后无冲突合并。支持定时本地零知识加密快照与差旅模式（Travel Mode）。',
      c6Title: '瞭望塔体检 & 8 国语言切换',
      c6Body:
        '支持 HIBP k-匿名泄露检测、弱密码与复用分析、缺少 2FA 与可升级 Passkey 提醒。桌面端与扩展全面支持中/英/日/韩/德/法/西等 8 种语言实时切换。',
    },
    cmp: {
      eyebrow: '横向对比',
      title: 'Keysmith vs 主流密码管理器',
      colFeature: '能力维度',
      r1Name: '自托管 Vaultwarden 协议',
      r1Key: '✅ 原生深度适配 (含 1.37+ / Passkey)',
      r1Bw: '✅ 原生支持',
      r11p: '❌ 仅限官方云端',
      r2Name: '桌面端运行时与体积',
      r2Key: '⚡ Rust + Tauri v2（~10 MB DMG）',
      r2Bw: 'Electron（内存与体积较大）',
      r21p: 'Rust + Electron / Swift',
      r3Name: '内置 OpenSSH Agent & 一键配置',
      r3Key: '✅ 内置 + 生物识别确认 + SSH Config',
      r3Bw: '⚠️ SSH Key 托管（无一键向导）',
      r31p: '✅ 内置 SSH Agent',
      r4Name: '屏幕扫码自动识别 TOTP',
      r4Key: '✅ 全屏自动/框选 + 剪贴板扫码',
      r4Bw: '⚠️ 桌面端需手动输密钥',
      r41p: '✅ 屏幕扫码识别',
      r5Name: '全局快捷浮窗 / 窗口自动键入',
      r5Key: '✅ ⌘⇧Space 快捷访问 + 原生 Auto-Type',
      r5Bw: '❌ 仅复制粘贴',
      r51p: '✅ Quick Access',
      r6Name: '开源协议与订阅费用',
      r6Key: '✅ MPL-2.0 开源 · 永久免费',
      r6Bw: 'GPL / 商业版功能付费',
      r61p: '❌ 闭源 · 个人/家庭按月付费',
    },
    arch: {
      eyebrow: '安全架构',
      title: '密码只在你的内存里短暂停留，磁盘仅存加密负载',
      body: '无论在线还是离线，Keysmith 坚持纯本地加解密原则：主密码通过 Argon2id 或 PBKDF2-SHA256 在本地派生主密钥，绝不上传至任何服务器；条目载荷、私钥与会话令牌在 SQLite 中加密落盘，锁定或休眠瞬间触发 Zeroize 内存清零。',
      li1: '支持 macOS Touch ID（签名版使用 Data Protection Keychain ACL）与 Windows Hello CNG 硬件绑定解锁，敏感操作可设主密码二次验证',
      li2: 'macOS 剪贴板写入 ConcealedType / TransientType 隐私标记，防止剪贴板历史工具偷录',
      li3: '可开启窗口防截屏保护（screen_capture_protected），并定期生成零知识本地加密快照',
      imgCaption: '密钥派生、EncString Type 2 认证解密与内存擦除全部在本地 Rust 安全核心完成',
      svgStep1Eyebrow: 'LOCAL AUTH',
      svgStep1Title: '主密码 + 生物识别',
      svgStep1Sub: 'Argon2id / PBKDF2',
      svgStep1Sub2: 'HKDF 本地派生密钥',
      svgStep2Sub: 'AES-256-CBC-HMAC · Zeroize',
      svgStep2Sub2: 'Passkey · TOTP · SSH Agent',
      svgStep2Sub3: '共享跨平台内核（Desktop / Mobile）',
      svgStep3Eyebrow: 'ENCRYPTED CACHE',
      svgStep3Title: '加密存储 SQLite',
      svgStep3Sub: '离线可用 · 变更队列',
      svgStep3Sub2: '自动定时加密快照',
      svgStep4Eyebrow: 'CLOUD SYNC',
      svgStep4Sub: 'REST + SignalR 推送',
      svgStep4Sub2: '仅存储密文数据块',
    },
    dev: {
      eyebrow: '开发者与浏览器生态',
      title: '从终端 SSH、环境变量注入到浏览器 Passkey 一气呵成',
      body: '告别明文存放在磁盘上的私钥和 .env 文件。Keysmith 在内存中为你托管 Ed25519 SSH 密钥与 API 凭证，并通过 Native Messaging 与浏览器扩展即时通信，实现账号、2FA 与 Passkey 的全自动填充与采集。',
      li1: 'OpenSSH Agent：支持生物识别签名前置确认与一键写入 ~/.ssh/config，Git Commit 签名也适用',
      li2: 'ks CLI 密钥注入：直接通过环境变量占位符为子进程注入敏感 Token，不留明文在 Shell 历史中',
      li3: 'Manifest V3 扩展：拦截 WebAuthn 通行密钥注册/登录、SSO 登录自动保存提示，启动桌面端即自动配置 Native Messaging',
      imgCaption: '统一守护浏览器 Passkey、终端 SSH Agent 与 CLI 运行时密钥',
    },
    plat: {
      eyebrow: '全平台路线图',
      title: '已登陆 macOS / Windows / Linux 与主流浏览器，即将覆盖 Android 与 iOS',
      desc: '核心加密、Vaultwarden 协议、TOTP 与 Passkey 引擎均封装在跨平台的 Rust `keysmith-core` 中，所有终端将共享同一套高安全审计底座与一致体验。',
      statusReady: '已发布 · v0.1.5',
      statusLinux: '已发布 · v0.1.5',
      statusExt: '已发布 · v0.3.0',
      statusPlanned: '即将推出',
      macDesc:
        '支持 Apple Silicon (arm64) 与 Intel (x64)。支持按需开启的原生 Touch ID 解锁、Liquid Glass 毛玻璃、屏幕二维码秒扫、全局快捷访问及 Homebrew Cask 一键升级。',
      winDesc:
        '支持 Windows 10 / 11 (x64)，提供 NSIS (.exe) 与 MSI 安装包。支持 Windows Hello、GDI 屏幕扫码、Win32 Auto-Type 及浏览器注册表自动配置。',
      extName: '浏览器扩展 (MV3)',
      extDesc:
        '兼容 Chrome / Edge / Arc / Brave / Vivaldi。支持内联填充、WebAuthn Passkey 拦截保存与认证、SSO 登录自动接管以及安全密码生成器。',
      linuxDesc:
        '提供 .deb / .rpm / AppImage 安装包，接入 Secret Service + Polkit 验证、logind/ScreenSaver 自动锁定、Wayland/X11 自动键入与扫码，以及 OpenSSH Agent 和 CLI 工具链。',
      iosDesc:
        '通过 Swift + UniFFI 绑定 Rust `keysmith-core`，接入 Face ID / Touch ID 与系统 AutoFill Credential / Passkey Provider，在 iPhone 与 Safari 中原生无缝填充。',
      androidDesc:
        '基于 Kotlin + Rust JNI 集成，支持 Android BiometricPrompt 生物解锁、系统 Autofill Framework 自动填充与 Jetpack Credential Manager 通行密钥托管。',
      calloutTitle: '一套 Rust 核心（keysmith-core），全端一致零知识安全保障',
      calloutDesc:
        '桌面端（macOS / Windows / Linux）与即将上线的 Android、iOS 客户端共享同一套经过测试验证的加密与 Vaultwarden 同步内核，确保全平台数据与 Passkey 完全互通。',
      calloutBtn: '关注移动端进展 →',
    },
    inst: {
      eyebrow: '快速上手',
      title: '选择适合你的安装方式',
      desc: 'v0.1.5 已就绪，提供 macOS / Windows / Linux 安装包、Homebrew Cask、命令行工具与浏览器扩展压缩包。',
      p0Title: 'macOS Homebrew Cask（推荐 · 支持一键升级）',
      p0Desc:
        '请务必携带完整的 tap 前缀 chrisyer/keysmith/keysmith，避免与 Homebrew 官方源中同名应用冲突。当前发布为本地 ad-hoc 签名，首次打开可在 macOS「隐私与安全性」中放行，或按提示手动执行 xattr -dr com.apple.quarantine /Applications/Keysmith.app。',
      p1Title: 'macOS / Linux 一键安装脚本（v0.1.5）',
      p1Desc:
        '自动识别 macOS (Apple Silicon / Intel) 与 Linux (x64 AppImage)，强制严格 SHA-256 校验安装；macOS 版本不自动移除隔离属性，保留系统 Gatekeeper 授权控制。',
      p2Title: 'Windows 10 / 11 (x64) 安装包',
      p2Desc:
        '前往 GitHub Releases 下载 Keysmith_0.1.5_x64-setup.exe (NSIS) 或 Keysmith_0.1.5_x64_en-US.msi 双击安装即可。启动后会自动配置浏览器的 NativeMessagingHosts 注册表。',
      p3Title: 'Keysmith CLI (ks) 与 OpenSSH Agent',
      p3Desc: '可从 Release 下载预编译二进制包，或使用 Cargo 从源码构建 ks 与 keysmith-ssh-agent。',
      p4Title: '浏览器扩展安装（Chrome / Edge / Arc / Brave）',
      p4Desc:
        'Keysmith 桌面端启动时已自动将扩展解压到系统应用目录并注册 Native Messaging。在浏览器扩展管理页开启开发者模式，点击「加载已解压的扩展程序」选中桌面端设置页打开的扩展目录即可（固定扩展 ID：ianpdijhflnmmhbmjdhiombdghhpfkmg）。',
    },
    footer: {
      copy: '独立开源的 Vaultwarden / Bitwarden 零知识客户端（MPL-2.0）',
    },
  },
  en: {
    metaTitle: 'Keysmith — Local-First Zero-Knowledge Password & Passkey Manager',
    nav: {
      advantages: 'Advantages',
      architecture: 'Security',
      developer: 'Developer',
      platforms: 'Platforms',
      install: 'Download',
      themeToggleAria: 'Toggle light and dark theme',
    },
    common: {
      copy: 'Copy',
      copied: 'Copied ✓',
    },
    hero: {
      badge: 'v0.1.5 · Open Source MPL-2.0 · Rust + Tauri v2 Native',
      titleLead: 'Keep every secret locked on',
      titleAccent: 'your devices & private cloud',
      subtitle:
        'Keysmith is a local-first, zero-knowledge password, Passkey, and OpenSSH Agent manager powered by Rust and Tauri v2. Enjoy native speed instead of Electron bloat, full Vaultwarden / Bitwarden real-time sync, screen QR scanning for TOTP, and a Manifest V3 browser extension.',
      ctaDownload: 'Download v0.1.5',
      ctaReleases: 'All Releases →',
      platMac: 'macOS 13+',
      platWin: 'Windows 10/11',
      platExt: 'Chrome / Edge / Arc / Brave Extension',
      platNext: 'Linux (.deb / .rpm / AppImage) · iOS / Android In Progress',
    },
    preview: {
      regionAria: 'Keysmith desktop 3-pane interactive preview',
      windowTitle: 'Keysmith Desktop · Liquid Glass',
      syncState: 'SignalR Synced',
      personalVault: 'Personal Vault',
      navAll: 'All Items',
      navPasskey: 'Passkeys',
      navTotp: '2FA Codes',
      navSsh: 'SSH Keys & Agent',
      navWatchtower: 'Watchtower Audit',
      searchHint: '⌘F Search sites, usernames or #tags...',
      usernameLabel: 'Username',
      passwordLabel: 'Password',
      totpLabel: 'One-Time Password (TOTP)',
      passkeyLabel: 'Bound Passkey (WebAuthn)',
      sshKeyLabel: 'Ed25519 Public Key / Fingerprint',
      sshSocketLabel: 'OpenSSH Agent Status',
      secretRefLabel: 'CLI Secret Injection',
      urlLabel: 'Website URL',
    },
    adv: {
      eyebrow: 'Why Keysmith',
      title: 'Native desktop polish meets full self-hosted Vaultwarden freedom',
      desc: 'No need to choose between closed-source subscriptions and sluggish Electron wrappers. Keysmith unites zero-knowledge cryptography, native craft, and developer tooling in one lightweight app.',
      c1Title: 'End-to-End Zero-Knowledge & Self-Hosted',
      c1Body:
        'Full Bitwarden / Vaultwarden 1.37+ sync compatibility with local Argon2id / PBKDF2 + HKDF + AES-256-CBC-HMAC encryption. Memory secrets are zeroized automatically, with vault payloads and session tokens encrypted at rest in SQLite.',
      c2Title: 'Rust + Tauri v2 Native Speed',
      c2Body:
        'Around 10 MB installer with instant launch and low memory footprint. Integrates Touch ID / Windows Hello unlock, Liquid Glass translucency, screen-capture protection, and auto-clearing concealed clipboards.',
      c3Title: 'WebAuthn Passkeys & Screen QR TOTP',
      c3Body:
        'Browser extension handles WebAuthn passkey creation & assertion (ES256, Ed25519 + PRF) synced across devices. Scan 2FA QR codes directly from any screen or clipboard in one click.',
      c4Title: 'Built-In Developer Toolchain',
      c4Body:
        'Integrated OpenSSH Ed25519 Agent with biometric sign confirmation and 1-click ~/.ssh/config setup, ks CLI runtime secret injection, native Auto-Type, and 19 structured item templates.',
      c5Title: 'Change-Driven Real-Time Sync & Snapshots',
      c5Body:
        'SignalR MessagePack push updates with exponential backoff self-healing, offline edit queuing, scheduled local zero-knowledge encrypted snapshots, and Travel Mode.',
      c6Title: 'Watchtower Audits & 8 Languages',
      c6Body:
        'Detects HIBP k-anonymity breaches, weak/reused passwords, missing 2FA, and passkey upgrades. Full live language switching across 8 locales in both desktop app and browser extension.',
    },
    cmp: {
      eyebrow: 'Comparison',
      title: 'Keysmith vs Popular Password Managers',
      colFeature: 'Capability',
      r1Name: 'Self-Hosted Vaultwarden Protocol',
      r1Key: '✅ Native Support (incl. 1.37+ & Passkeys)',
      r1Bw: '✅ Native Support',
      r11p: '❌ Proprietary Cloud Only',
      r2Name: 'Desktop Runtime & Footprint',
      r2Key: '⚡ Rust + Tauri v2 (~10 MB DMG)',
      r2Bw: 'Electron (Heavy Memory & Bundle)',
      r21p: 'Rust + Electron / Swift',
      r3Name: 'Built-In SSH Agent & 1-Click Config',
      r3Key: '✅ Built-In + Biometric Guard + Config',
      r3Bw: '⚠️ Storage Only (No Setup Wizard)',
      r31p: '✅ Built-In SSH Agent',
      r4Name: 'Screen QR Scan for TOTP',
      r4Key: '✅ Multi-Display / Region + Clipboard Scan',
      r4Bw: '⚠️ Manual Secret Entry on Desktop',
      r41p: '✅ Screen QR Scanning',
      r5Name: 'Quick Access Overlay & Auto-Type',
      r5Key: '✅ ⌘⇧Space Overlay + Native Auto-Type',
      r5Bw: '❌ Copy & Paste Only',
      r51p: '✅ Quick Access',
      r6Name: 'License & Pricing',
      r6Key: '✅ Open Source MPL-2.0 · Free Forever',
      r6Bw: 'GPL / Paid Features',
      r61p: '❌ Closed Source · Subscription',
    },
    arch: {
      eyebrow: 'Security Architecture',
      title: 'Secrets stay in memory briefly—encrypted payloads only on disk',
      body: 'Whether online or offline, Keysmith derives master keys strictly on-device via Argon2id or PBKDF2-SHA256. Vault items, private keys, and session tokens are stored encrypted in SQLite (with non-sensitive sync/index metadata only), and locking triggers immediate zeroize wiping.',
      li1: 'macOS Touch ID (Data Protection Keychain ACL on signed builds) & Windows Hello CNG hardware-backed unlock with configurable reprompt',
      li2: 'macOS NSPasteboard ConcealedType / TransientType markers keep secrets out of clipboard managers',
      li3: 'Optional screen-capture window protection and scheduled zero-knowledge encrypted local snapshots',
      imgCaption: 'Key derivation, EncString Type 2 decryption, and memory wiping run inside the local Rust core',
      svgStep1Eyebrow: 'LOCAL AUTH',
      svgStep1Title: 'Master Password + Biometric',
      svgStep1Sub: 'Argon2id / PBKDF2',
      svgStep1Sub2: 'Local HKDF Key Derivation',
      svgStep2Sub: 'AES-256-CBC-HMAC · Zeroize',
      svgStep2Sub2: 'Passkey · TOTP · SSH Agent',
      svgStep2Sub3: 'Shared Core (Desktop & Mobile)',
      svgStep3Eyebrow: 'ENCRYPTED CACHE',
      svgStep3Title: 'Encrypted SQLite Cache',
      svgStep3Sub: 'Offline Queue · Local Index',
      svgStep3Sub2: 'Encrypted Local Snapshots',
      svgStep4Eyebrow: 'CLOUD SYNC',
      svgStep4Sub: 'REST + SignalR Push',
      svgStep4Sub2: 'Ciphertext Blobs Only',
    },
    dev: {
      eyebrow: 'Developer & Browser Ecosystem',
      title: 'Unified workflow from terminal SSH & CLI secrets to browser Passkeys',
      body: 'Stop leaving raw private keys and plaintext .env files on disk. Keysmith holds your Ed25519 SSH keys and API tokens in memory while communicating seamlessly with the browser extension over Native Messaging.',
      li1: 'OpenSSH Agent: biometric confirmation before signing plus 1-click ~/.ssh/config & Git commit signing setup',
      li2: 'ks CLI injection: pass resolved secrets to subprocess environments without leaking tokens in shell history',
      li3: 'Manifest V3 extension: WebAuthn passkey capture/assertion, automatic SSO login save prompts, and zero-CLI host registration',
      imgCaption: 'One trusted enclave guarding browser Passkeys, OpenSSH signing, and CLI runtime secrets',
    },
    plat: {
      eyebrow: 'Cross-Platform Roadmap',
      title: 'macOS, Windows, Linux & Browser Ready—Android & iOS Next',
      desc: 'All cryptography, Vaultwarden sync, TOTP, and Passkey logic live inside the shared Rust keysmith-core crate, bringing identical security guarantees to every upcoming platform.',
      statusReady: 'Available · v0.1.5',
      statusLinux: 'Available · v0.1.5',
      statusExt: 'Available · v0.3.0',
      statusPlanned: 'Planned / Coming Soon',
      macDesc:
        'Native Universal support for Apple Silicon (arm64) & Intel (x64). Touch ID unlock, Liquid Glass UI, screen QR scanning, Quick Access, and Homebrew Cask.',
      winDesc:
        'Windows 10 / 11 (x64) via NSIS (.exe) or MSI installers. Supports Windows Hello, GDI screen QR capture, Win32 Auto-Type, and auto-configured browser Registry.',
      extName: 'Browser Extension (MV3)',
      extDesc:
        'Works with Chrome, Edge, Arc, Brave, and Vivaldi. Inline autofill, WebAuthn Passkeys, TOTP copy, SSO login capture, and built-in password generator.',
      linuxDesc:
        'Ships .deb, .rpm, and AppImage packages with Secret Service + Polkit auth, logind/ScreenSaver auto-lock, Wayland/X11 Auto-Type & QR scan, plus OpenSSH Agent + ks CLI parity.',
      iosDesc:
        'Powered by Rust keysmith-core via Swift + UniFFI bindings, integrating Face ID / Touch ID and native iOS AutoFill Credential & Passkey Provider.',
      androidDesc:
        'Powered by Rust JNI bindings with Android BiometricPrompt unlock, Autofill Framework, and Jetpack Credential Manager Passkey support.',
      calloutTitle: 'One audited Rust engine (keysmith-core) across Desktop, Linux, iOS & Android',
      calloutDesc:
        'Desktop platforms (macOS, Windows, Linux) and upcoming mobile apps share the exact same tested cryptographic and Vaultwarden sync core for seamless cross-device Passkeys and vault sync.',
      calloutBtn: 'Follow Mobile Roadmap →',
    },
    inst: {
      eyebrow: 'Get Started',
      title: 'Choose your preferred installation method',
      desc: 'v0.1.5 is live with installers for macOS, Windows & Linux (ad-hoc signed macOS/Windows builds), Homebrew Cask, CLI binaries, and the Manifest V3 browser extension.',
      p0Title: 'macOS Homebrew Cask (Recommended · Easy Upgrades)',
      p0Desc:
        'Always include the full chrisyer/keysmith/keysmith tap prefix to avoid colliding with Homebrew’s unrelated official keysmith cask. Builds are currently ad-hoc signed; approve via macOS Privacy & Security or manual xattr -dr com.apple.quarantine.',
      p1Title: 'macOS & Linux One-Line Installer (v0.1.5)',
      p1Desc:
        'Detects macOS (Apple Silicon / Intel) or Linux (x64 AppImage) and installs with strict SHA-256 verification, keeping macOS Gatekeeper approval under your control.',
      p2Title: 'Windows 10 / 11 (x64) Installers',
      p2Desc:
        'Download Keysmith_0.1.5_x64-setup.exe (NSIS) or Keysmith_0.1.5_x64_en-US.msi from GitHub Releases. NativeMessagingHosts registry keys are configured automatically on first run.',
      p3Title: 'Keysmith CLI (ks) & OpenSSH Agent',
      p3Desc: 'Grab prebuilt binaries from GitHub Releases or compile ks and keysmith-ssh-agent from source via Cargo.',
      p4Title: 'Browser Extension (Chrome / Edge / Arc / Brave)',
      p4Desc:
        'Keysmith automatically unpacks the extension and registers Native Messaging when launched. Enable Developer Mode in chrome://extensions, click "Load unpacked", and select the folder opened from Desktop Settings (Fixed ID: ianpdijhflnmmhbmjdhiombdghhpfkmg).',
    },
    footer: {
      copy: 'Independent open-source Vaultwarden / Bitwarden client (MPL-2.0)',
    },
  },
};

const PREVIEW_ITEMS = {
  github: {
    avatarBg: '#24292e',
    avatarText: 'GH',
    title: 'GitHub Main',
    sub: 'dev@keysmith.app',
    tags: [
      { label: 'Passkey', green: false },
      { label: '2FA', green: true },
    ],
    fields: (t) => [
      { label: t.preview.usernameLabel, value: 'dev@keysmith.app', copy: true },
      { label: t.preview.passwordLabel, value: 'vK9!mP4#xQ8$zL2@rT7w', copy: true },
      { label: t.preview.totpLabel, type: 'totp' },
      { label: t.preview.passkeyLabel, value: 'ES256 · github.com (synced via Vaultwarden)', copy: false },
      { label: t.preview.urlLabel, value: 'https://github.com/login', copy: true },
    ],
  },
  ssh: {
    avatarBg: '#16a34a',
    avatarText: 'SSH',
    title: 'Production Bastion',
    sub: 'Ed25519 · Biometric Guard',
    tags: [{ label: 'SSH Agent', green: true }],
    fields: (t) => [
      { label: t.preview.sshKeyLabel, value: 'SHA256:9qF4xN7kL8w2+eR1mB5tY0uP6zC3hJ', copy: true },
      { label: t.preview.sshSocketLabel, value: 'Active · Touch ID confirmation required on sign', copy: false },
      { label: t.preview.urlLabel, value: 'ssh -A ops@bastion.internal', copy: true },
    ],
  },
  api: {
    avatarBg: '#0572ec',
    avatarText: 'API',
    title: 'Cloudflare Deploy Token',
    sub: 'ops@keysmith.app',
    tags: [{ label: 'ks CLI', green: false }],
    fields: (t) => [
      { label: t.preview.usernameLabel, value: 'ops@keysmith.app', copy: true },
      { label: t.preview.passwordLabel, value: 'cf_live_82d94a1f9c02e88b1a749f20', copy: true },
      { label: t.preview.secretRefLabel, value: 'ks run -- wrangler pages deploy', copy: true },
      { label: t.preview.urlLabel, value: 'https://dash.cloudflare.com', copy: true },
    ],
  },
};

function getInitialLang() {
  try {
    const saved = localStorage.getItem('keysmith-site-lang');
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

let currentLang = getInitialLang();
let activePreviewId = 'github';
let lastCopiedKey = null;

function lookupPath(obj, path) {
  return path.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

function applyI18n(lang) {
  currentLang = lang;
  const dict = I18N[lang];
  document.documentElement.lang = lang;
  document.title = dict.metaTitle;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const val = lookupPath(dict, el.dataset.i18n);
    if (typeof val === 'string') {
      el.textContent = val;
    }
  });

  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const val = lookupPath(dict, el.dataset.i18nAria);
    if (typeof val === 'string') {
      el.setAttribute('aria-label', val);
    }
  });

  const langBtn = document.getElementById('lang-toggle');
  if (langBtn) {
    langBtn.textContent = lang === 'zh-CN' ? 'EN' : '中文';
  }

  renderPreviewDetail();
}

function computeSimulatedTotp() {
  const sec = Math.floor(Date.now() / 1000);
  const remaining = 30 - (sec % 30);
  const step = Math.floor(sec / 30);
  const num = ((step * 2654435761) >>> 0) % 1000000;
  const padded = String(num).padStart(6, '0');
  return {
    code: `${padded.slice(0, 3)} ${padded.slice(3)}`,
    remaining,
  };
}

function renderPreviewDetail() {
  const container = document.getElementById('preview-detail');
  if (!container) return;
  const item = PREVIEW_ITEMS[activePreviewId] || PREVIEW_ITEMS.github;
  const dict = I18N[currentLang];
  const totp = computeSimulatedTotp();

  const headerHtml = `
    <div class="detail-header">
      <div class="detail-title-wrap">
        <span class="mockup-avatar" style="background: ${item.avatarBg}; width: 42px; height: 42px; font-size: 0.92rem;">${item.avatarText}</span>
        <div>
          <div style="font-size: 1.05rem; font-weight: 700;">${item.title}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${item.sub}</div>
        </div>
      </div>
      <div class="mockup-badges">
        ${item.tags.map((tag) => `<span class="mini-tag ${tag.green ? 'is-green' : ''}">${tag.label}</span>`).join('')}
      </div>
    </div>
  `;

  const fieldsHtml = item
    .fields(dict)
    .map((f, idx) => {
      if (f.type === 'totp') {
        const key = `${activePreviewId}-totp`;
        const btnLabel = lastCopiedKey === key ? dict.common.copied : dict.common.copy;
        return `
          <div class="detail-field-card">
            <div>
              <div class="detail-field-label">${f.label}</div>
              <div class="totp-live-box">
                <span class="totp-digits" id="preview-totp-code">${totp.code}</span>
                <span class="totp-timer" id="preview-totp-rem">${totp.remaining}s</span>
              </div>
            </div>
            <button type="button" class="copy-mini-btn" data-preview-copy="${key}" data-copy-val="${totp.code.replace(/\s+/g, '')}">${btnLabel}</button>
          </div>
        `;
      }
      const key = `${activePreviewId}-${idx}`;
      const btnLabel = lastCopiedKey === key ? dict.common.copied : dict.common.copy;
      return `
        <div class="detail-field-card">
          <div style="min-width: 0;">
            <div class="detail-field-label">${f.label}</div>
            <div class="detail-field-value">${f.value}</div>
          </div>
          ${f.copy ? `<button type="button" class="copy-mini-btn" data-preview-copy="${key}" data-copy-val="${f.value.replace(/"/g, '&quot;')}">${btnLabel}</button>` : ''}
        </div>
      `;
    })
    .join('');

  container.innerHTML = `${headerHtml}<div class="detail-fields">${fieldsHtml}</div>`;
}

// Theme toggle strictly following dark-mode-toggle guide (two-state UI + storage divergence check)
const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
const osDarkQuery = matchMedia('(prefers-color-scheme: dark)');

function syncMetaSchemeFromStorage() {
  try {
    const val = localStorage.getItem('color-scheme');
    colorSchemeMeta.content = val === 'light' || val === 'dark' ? val : 'light dark';
  } catch {
    colorSchemeMeta.content = 'light dark';
  }
}

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const renderedDark =
    colorSchemeMeta.content === 'dark' ||
    (colorSchemeMeta.content === 'light dark' && osDarkQuery.matches);
  const target = renderedDark ? 'light' : 'dark';
  const systemScheme = osDarkQuery.matches ? 'dark' : 'light';
  try {
    if (target !== systemScheme) {
      localStorage.setItem('color-scheme', target);
    } else {
      localStorage.removeItem('color-scheme');
    }
  } catch {}
  syncMetaSchemeFromStorage();
});

window.addEventListener('storage', (event) => {
  if (event.key === 'color-scheme') {
    syncMetaSchemeFromStorage();
  }
});

// Language switch
document.getElementById('lang-toggle')?.addEventListener('click', () => {
  const next = currentLang === 'zh-CN' ? 'en' : 'zh-CN';
  try {
    localStorage.setItem('keysmith-site-lang', next);
  } catch {}
  applyI18n(next);
});

// Preview item switching + copy feedback
document.querySelectorAll('.mockup-item[data-preview-id]').forEach((btn) => {
  btn.addEventListener('click', () => {
    activePreviewId = btn.dataset.previewId;
    document.querySelectorAll('.mockup-item[data-preview-id]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    lastCopiedKey = null;
    renderPreviewDetail();
  });
});

document.getElementById('preview-detail')?.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-preview-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copyVal || '');
  } catch {}
  lastCopiedKey = btn.dataset.previewCopy;
  renderPreviewDetail();
  setTimeout(() => {
    if (lastCopiedKey === btn.dataset.previewCopy) {
      lastCopiedKey = null;
      renderPreviewDetail();
    }
  }, 1400);
});

// Copy code snippet buttons
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-copy-target]');
  if (!btn) return;
  const target = document.getElementById(btn.dataset.copyTarget);
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.textContent || '');
  } catch {}
  const dict = I18N[currentLang];
  btn.textContent = dict.common.copied;
  setTimeout(() => {
    btn.textContent = dict.common.copy;
  }, 1500);
});

// Accessible Installation Tabs (modern-web-guidance: tabs)
const tablist = document.querySelector('.install-tabs .tablist');
const tabs = [...document.querySelectorAll('.install-tabs .tab-btn')];
const panels = [...document.querySelectorAll('.install-tabs [role="tabpanel"]')];

function selectTab(index, shouldFocus = false) {
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.toggleAttribute('focusgroupstart', selected);
    if (!('focusGroup' in HTMLElement.prototype)) {
      tab.tabIndex = selected ? 0 : -1;
    }
  });
  panels.forEach((panel, i) => {
    const selected = i === index;
    if (selected) {
      panel.removeAttribute('hidden');
      panel.tabIndex = 0;
    } else {
      panel.setAttribute('hidden', 'until-found');
      panel.removeAttribute('tabindex');
    }
  });
  tabs[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
  if (shouldFocus) {
    tabs[index]?.focus({ preventScroll: true });
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index, false));
  tab.addEventListener('focus', () => {
    if (document.activeElement === tab) {
      selectTab(index, false);
    }
  });
});

panels.forEach((panel, index) => {
  panel.addEventListener('beforematch', () => selectTab(index, false));
});

// Fallback for browsers without native focusgroup="tablist"
if (tablist && !('focusGroup' in HTMLElement.prototype)) {
  tablist.setAttribute('role', 'tablist');
  tabs.forEach((tab, i) => {
    tab.setAttribute('role', 'tab');
    tab.tabIndex = i === 0 ? 0 : -1;
  });
  tablist.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const cur = tabs.indexOf(document.activeElement);
    if (cur < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (cur + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    selectTab(next, true);
  });
}

// Initial render + live 1s TOTP tick for interactive preview
applyI18n(currentLang);
setInterval(() => {
  if (activePreviewId !== 'github') return;
  const codeEl = document.getElementById('preview-totp-code');
  const remEl = document.getElementById('preview-totp-rem');
  if (!codeEl || !remEl) return;
  const totp = computeSimulatedTotp();
  codeEl.textContent = totp.code;
  remEl.textContent = `${totp.remaining}s`;
}, 1000);
