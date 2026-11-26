# Keysmith 浏览器扩展（Manifest V3）

Keysmith 浏览器扩展提供网页账号密码一键自动填充、TOTP 验证码复制，以及 `navigator.credentials.create` / `navigator.credentials.get` WebAuthn Passkey 拦截与桌面端联动认证。

## 安装步骤

1. **构建并安装 `ks` CLI**：
   确保 `ks` 已编译并在 `PATH` 中可用（例如 `~/.cargo/bin/ks` 或 `/usr/local/bin/ks`）。

2. **在浏览器中加载扩展**：
   - 打开 `chrome://extensions`（Edge 为 `edge://extensions`，Arc 为 `arc://extensions`）
   - 开启右上角 **开发者模式（Developer mode）**
   - 点击 **加载已解压的扩展程序（Load unpacked）**
   - 选择本目录：`apps/browser-extension`
   - 复制扩展卡片上的 **ID**（32 位字母串）

3. **注册 Chrome Native Messaging 主机**：
   在终端运行（将 `<extension-id>` 替换为上一步复制的 ID）：
   ```bash
   ks install-nmh <extension-id>
   ```
   如需同时安装到 Edge 或 Arc：
   ```bash
   ks install-nmh --chrome --edge --arc <extension-id>
   ```

4. **使用**：
   - 启动并解锁 Keysmith 桌面应用
   - 点击浏览器工具栏 Keysmith 图标即可查看当前网站匹配的登录项并一键自动填充
   - 当网页发起 Passkey 注册或登录时，扩展会通过 `dev.keysmith.desktop` Native Messaging 桥接转发至 Keysmith；若桌面端锁定或未匹配，将自动无感回退至浏览器原生 WebAuthn。
