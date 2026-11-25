# Keysmith 设计文档总览

> **定位**：本地优先（Local-first）、1Password 8 级桌面交互体验、零知识客户端加密的密码管理器。  
> **后端策略**：直接使用开源成熟的 **Vaultwarden** 作为零知识加密存储与同步底座；**不兼容**官方 Bitwarden 客户端格式，从而彻底释放 1Password 的多模板、分组、多标签与扩展字段能力。

---

## 文档导航

| 文档 | 内容范围 | 适用阶段 |
| :--- | :--- | :--- |
| [01-architecture.md](./01-architecture.md) | 总体系统架构、Monorepo 目录规划、`keysmith-core` 模块边界、安全与锁屏生命周期、macOS Touch ID / 剪贴板防泄露、Tauri v2 IPC 契约、多端复用策略 | 全阶段 |
| [02-protocol-and-schema.md](./02-protocol-and-schema.md) | Vaultwarden 零知识密码学（Argon2id/PBKDF2 + HKDF + EncString Type 2）、注册/登录/同步/SignalR 实时推送 API、SQLite 离线缓存、`KeysmithItem Schema v1` 完整规范、模板矩阵、Watchtower 审计规则 | 核心引擎 & 同步 |
| [03-ui-and-interaction.md](./03-ui-and-interaction.md) | 1Password 8 风格视觉规范、三色密码高亮 / Large Type / TOTP 倒计时等标志性微交互、三栏主界面详设、Quick Access 悬浮窗、Watchtower 面板、快捷键矩阵、前端状态架构 | 桌面 UI & 交互 |

---

## 核心技术栈总览

| 层级 | 选型 | 选型理由 |
| :--- | :--- | :--- |
| **共享核心引擎** | **Rust**（`crates/keysmith-core`） | 内存安全 + `zeroize` 密钥擦除；未来可直接复用至桌面端、浏览器插件（Native Messaging / WASM）、移动端（Tauri Mobile / UniFFI）与 CLI / SSH Agent |
| **桌面端宿主** | **Tauri v2** | 轻量原生 WebView + Rust 无缝直调；原生支持多窗口（Quick Access 浮窗）、全局快捷键、系统托盘与 macOS Keychain / Touch ID |
| **前端界面** | **React 19 + TypeScript + Tailwind CSS v4 + Zustand** | 强类型对接 Rust IPC；TanStack Virtual 支撑千级条目零卡顿；Tailwind v4 语义变量优雅切换明暗主题 |
| **本地缓存** | **SQLite**（`rusqlite` / `sqlx`） | 仅存 Vaultwarden 原始密文信封与非敏感索引字段，实现断网秒开与离线编辑 |
| **同步后端** | **Vaultwarden（Docker）** | 成熟零知识同步、账户体系、2FA、Folder/Trash/Attachment、SignalR WebSocket 实时推送 |

> **本机环境备注**：当前工作区已检测到 `Node v26.3.0` 与 `Docker 29.8.0`，尚未安装 Rust 工具链。进入 Phase 1 编码前需执行 `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` 安装 `rustup`（`rustc` + `cargo`）。

---

## 分阶段落地路线

### Phase 1 — 核心可用闭环（MVP）
1. `docker/docker-compose.yml` 一键拉起本地 Vaultwarden（关闭邮箱验证，便于本地快速注册调试）。
2. 完成 `keysmith-core`：`crypto`（PBKDF2/Argon2id、HKDF、AES-256-CBC-HMAC）、`protocol`（预登录/注册/OAuth2 + WebAuthn 登录/同步/CRUD）、`storage`（SQLite 密文缓存）、`domain`（`KeysmithItem Schema v1` 编解码与 10 套可手动创建模板 + 被动捕获的 `Passkey` 模型）、`passkey`（WebAuthn 断言签名与 PRF 密钥包装）、`totp`、`generator`。
3. 桌面端主窗口：登录/注册引导（含 Passkey / PRF 免密登录）、解锁页、1Password 风格三栏布局、Passkey 聚合筛选与只读凭据详情/解绑、即时搜索、条目查看/编辑、三色密码高亮、Large Type、剪贴板自动清零。

### Phase 2 — 灵魂交互与安全增强
1. **Quick Access 迷你搜索浮窗**（全局快捷键 `⌘⇧Space` 唤醒，纯键盘极速复制密码/用户名/OTP）。
2. **macOS Touch ID 解锁**（`kSecAccessControlBiometryCurrentSet` 保护 Keychain 对称密钥）、**账户 Passkey / WebAuthn PRF 管理**与空闲/休眠自动锁。
3. **Watchtower 安全体检面板**（本地 `zxcvbn` 强度、重复密码、非 HTTPS 提醒、2FA / Passkey 缺失、证件过期、可选 HIBP k-匿名泄露查询）。
4. **SignalR WebSocket 实时同步**、加密附件（Attachments）、8 套 Phase 2 扩展模板、`.1pux` / CSV 导入导出。

### Phase 3 — 多端生态扩展
1. **浏览器扩展（Manifest V3）**：通过 Native Messaging 与桌面端联动解锁，提供网页内联下拉填充、**WebAuthn (`navigator.credentials.create/get`) 自动拦截唤起保存与免密登录**（网页端触发创建，桌面端/系统浮窗确认保存，不在工作台手建）及自动保存提示（或编译 `keysmith-core` 为 WASM 独立模式）。
2. **CLI 与 SSH Agent**：直接链接 `keysmith-core`，支持终端读取密钥注入环境变量（`op run` 风格）及接管 `SSH_AUTH_SOCK`。
3. **移动端（iOS / Android）**：基于 Tauri v2 Mobile 或 `UniFFI`（Swift / Kotlin 原生 UI + Rust Core），并对接 iOS `ASAuthorizationProviderExtension` 与 Android Credential Manager。

---

## 评审确认清单（编码前请确认）

在进入 Phase 1 脚手架搭建前，请确认以下设计决策是否符合预期：

1. **Vaultwarden 密文封装策略**：所有条目统一以 `type = 2 (SecureNote)` 存入 Vaultwarden，`name` 存标题，`folderId` 映射为 **Vault**，`notes` 存加密后的 `ItemPayload` JSON。确认无需兼容 Bitwarden 官方客户端的普通字段展示。
2. **Phase 1 模板范围**：首期工作台支持手动新建 10 种常用模板（`Login`、`Password`、`SecureNote`、`CreditCard`、`Identity`、`ApiCredential`、`Database`、`Server`、`SshKey`、`SoftwareLicense`）；`Passkey` 由网页 WebAuthn 注册时自动唤起保存（工作台侧边栏提供聚合筛选与查看/解绑），其余 8 种归入 Phase 2，是否需要调整优先级？
3. **功能排期顺序**：Phase 1 先保证核心三栏主窗口与加解密同步完全打通，Phase 2 紧接着做 **Quick Access 浮窗 + Touch ID + Watchtower**，是否希望把 Quick Access 提前到 Phase 1 末期？
4. **主题与默认交互**：默认跟随 macOS 系统明暗切换、剪贴板默认 30 秒自动清空、空闲 15 分钟自动锁定，是否有偏好调整？
