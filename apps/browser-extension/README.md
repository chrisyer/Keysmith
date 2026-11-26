# Keysmith 浏览器扩展（Manifest V3）

Keysmith 浏览器扩展提供网页账号密码一键自动填充、TOTP 验证码复制，以及 `navigator.credentials.create` / `navigator.credentials.get` WebAuthn Passkey 拦截与桌面端联动认证。

## 零命令行自动配置

Keysmith 扩展已在 `manifest.json` 中内置固定扩展 ID（`ianpdijhflnmmhbmjdhiombdghhpfkmg`），且 **Keysmith 桌面端每次启动都会自动为 Chrome / Edge / Arc / Brave 等浏览器注册并更新 Native Messaging 主机配置**，无需手动复制 ID 或执行终端命令。

### 首次使用步骤

1. 打开 Keysmith 桌面应用并解锁（桌面端会自动配置 Native Messaging 桥接，并在 `~/Library/Application Support/dev.keysmith.desktop/browser-extension` 同步最新扩展文件）。
2. 在浏览器中加载扩展（仅首次需要）：
   - 打开 `chrome://extensions`（Edge 为 `edge://extensions`，Arc 为 `arc://extensions`，Brave 为 `brave://extensions`）
   - 开启右上角 **开发者模式（Developer mode）**
   - 点击 **加载已解压的扩展程序（Load unpacked）**
   - 在桌面端 **设置 → 浏览器扩展** 中点击「打开扩展目录」（或直接选择上述路径 / 仓库里的 `apps/browser-extension`）
3. 加载后即可点击工具栏 Keysmith 图标自动匹配网站、填充密码与 Passkey，无需任何额外配置。

> 可选 CLI 手动命令：如只需单独使用命令行版 `ks`，也可直接运行 `ks install-nmh`（未传 ID 时将自动使用默认固定 ID）。
