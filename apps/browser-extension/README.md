# Keysmith Browser Extension (Manifest V3)

The Keysmith Browser Extension provides one-click autofill for logins, credit cards, and identities, live TOTP 2FA copying, save/update credential prompts, Chrome password-manager takeover controls, and `navigator.credentials.create` / `navigator.credentials.get` WebAuthn Passkey interception backed by the Keysmith desktop app over Native Messaging.

## Supported Languages (Default: English)

- `en` — English (Default)
- `zh-CN` — 简体中文
- `zh-TW` — 繁體中文
- `ja` — 日本語
- `ko` — 한국어
- `de` — Deutsch
- `fr` — Français
- `es` — Español

Switch languages live anytime under the popup **⚙ Settings → Display Language** selector.

## Zero-CLI Auto Setup

Keysmith pins a fixed Extension ID (`ianpdijhflnmmhbmjdhiombdghhpfkmg`) in `manifest.json`, and **Keysmith Desktop automatically registers and refreshes Native Messaging host manifests for Chrome, Edge, Arc, and Brave on every launch**.

### First-Time Setup (One Time Only)

1. Launch **Keysmith Desktop** and unlock your vault (on startup, Keysmith syncs the latest extension bundle to the OS app data directory and configures Native Messaging).
2. Open `chrome://extensions` (or `edge://extensions`, `arc://extensions`, `brave://extensions`) and toggle **Developer mode** on.
3. Click **Load unpacked**.
4. In **Keysmith Desktop → Settings → Browser Extension**, click **Open Extension Folder** and choose that folder (or select `apps/browser-extension` directly in a dev checkout).

> Optional manual CLI command: `ks install-nmh` registers Native Messaging manually using the fixed Extension ID by default.
