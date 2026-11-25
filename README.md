<div align="center">
  <img src="./assets/logo.png" width="128" height="128" alt="Keysmith Logo" />
  <h1>Keysmith</h1>
  <p><strong>本地优先 · 零知识加密 · 1Password 8 级交互体验的现代密码管理器</strong></p>
  <p>
    以 <strong>Vaultwarden</strong> 作为零知识加密存储与同步底座，打造原生桌面体验与 Passkey / WebAuthn 全流程支持。
  </p>
</div>

---

## 核心特性

- **零知识安全架构**：遵循 Vaultwarden / Bitwarden 协议（Argon2id / PBKDF2 + HKDF + AES-256-CBC-HMAC `EncString Type 2`），坚持内存最小暴露（`zeroize`）、磁盘零明文与验证先于解密三条安全红线。
- **1Password 8 级三栏桌面交互**：
  - 可调宽度三栏布局（Vault 切换器与智能导航 + `@tanstack/react-virtual` 虚拟滚动列表 + 原地查看/编辑详情）。
  - 标志性微交互：字母/数字/符号**三色密码高亮**、**Large Type 大字展示**（含 1-based 字符下标）、RFC 6238 **TOTP 倒计时圆环**、**内嵌式密码生成器**（随机密码 / 助记词 / PIN）、**密码历史归档与还原**、**剪贴板自动清零 Toast**。
- **Passkey（WebAuthn / FIDO2）双向支持**：
  - **网站通行密钥**：由网页端触发并被动唤起保存（绑定已有 `Login` 或自动新建），工作台提供「通行密钥」智能聚合筛选、只读凭据详情与带撤销提醒的解绑操作。
  - **账户免密登录与解锁**：支持 WebAuthn + PRF 扩展派生包装密钥免主密码解锁 Keysmith，并提供 AAGUID 解析与 Signal API 同步管理。
- **Watchtower 本地安全体检**：实时计算 0–100 安全评分，审计弱密码、密码复用、未开启 2FA/Passkey、明文 HTTP、到期凭证，支持显式授权的 HIBP k-匿名泄露检测。
- **Quick Access 迷你悬浮窗**：`⌘⇧Space`（预览环境可用 `⌘K`）呼出，纯键盘流快速复制密码/用户名/TOTP 或展开预览。

---

## 快速开始（桌面端可交互原型）

> 环境要求：Node.js 20+（当前基于 `React 19 + TypeScript + Tailwind CSS v4 + Zustand + Vite` 构建）。

```bash
# 1. 安装依赖
npm install

# 2. 启动桌面端原型开发预览（默认 http://127.0.0.1:5173/）
npm run dev

# 3. 类型检查与生产构建
npm run typecheck && npm run build
```

### 原型体验提示
- 启动后默认进入**已解锁的三栏工作区**，内置 20+ 覆盖 10 种常用模板与 Passkey 的仿真条目。
- 点击侧边栏底部 **锁定**（或按 `⌘L`）可体验锁屏页，演示主密码为 **`keysmith`**，也可直接点击 **Touch ID** 或 **Passkey / 硬件安全密钥** 快捷解锁。
- 点击右上角锁屏底部的 **切换账户 / 登出** 可预览登录/注册引导页（含 `http://localhost:8080` Vaultwarden 连通性检测与 Passkey / PRF 登录）。
- 支持在 **偏好设置（`⌘,`）→ 外观主题** 中切换 `跟随系统 / 浅色 / 深色`，并在 **通行密钥** 标签页管理账户 Passkey。

---

## 项目结构

```text
Keysmith/
├── assets/
│   ├── logo.svg                        # Keysmith 矢量图标
│   └── logo.png                        # Keysmith 应用图标 (1024×1024)
├── docs/                               # 架构、协议与 UI 设计规范
│   ├── README.md                       # 设计总览与分阶段路线
│   ├── 01-architecture.md              # 系统架构、模块边界、安全与 Passkey / IPC 契约
│   ├── 02-protocol-and-schema.md       # Vaultwarden 零知识协议与 KeysmithItem Schema v1
│   └── 03-ui-and-interaction.md        # 1Password 8 风格视觉规范与前端状态架构
├── apps/
│   └── desktop/                        # 桌面端前端工程（React 19 + TS + Tailwind v4）
│       ├── public/
│       │   ├── logo.svg
│       │   └── logo.png
│       └── src/
│           ├── components/             # 三色密码、Large Type、TOTP 环、生成器、Toast 等微交互组件
│           ├── features/               # Auth、LockScreen、Sidebar、ItemList、Detail/Editor、Watchtower、Modals
│           ├── services/               # IPC 门面（tauriClient）、模板、搜索、审计、TOTP、Passkey Web Crypto
│           └── stores/                 # Zustand 状态分层（sessionStore / vaultStore / uiStore）
├── crates/                             # [Phase 1 Rust Core 规划] keysmith-core 共享核心引擎
└── docker/                             # [Phase 1 同步底座规划] Vaultwarden 本地编排
```

---

## 设计文档

- [设计文档总览](./docs/README.md)
- [01 — 系统架构与安全边界设计](./docs/01-architecture.md)
- [02 — Vaultwarden 协议适配与 KeysmithItem 数据模型](./docs/02-protocol-and-schema.md)
- [03 — UI 视觉体系与 1Password 交互规范](./docs/03-ui-and-interaction.md)

---

## 演进路线

- [x] **架构与交互设计**：完成零知识协议、Schema v1、Passkey/PRF 体系与桌面 UI 规范文档
- [x] **桌面端可交互原型**：完成三栏工作区、微交互体系、Watchtower、Quick Access 与 Passkey 界面验证
- [ ] **Phase 1 — Rust 核心与 Tauri v2 闭环**：落地 `keysmith-core`、SQLite 密文缓存与本地 Vaultwarden Docker 联调
- [ ] **Phase 2 — 原生能力深化**：macOS Touch ID Keychain ACL、全局快捷键、SignalR 实时推送与导入导出
- [ ] **Phase 3 — 多端生态**：Manifest V3 浏览器扩展（含 WebAuthn 拦截）、CLI & SSH Agent、移动端客户端
