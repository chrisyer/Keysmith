import AppIntents
import SwiftUI
import WidgetKit

@main
struct KeysmithControlsBundle: WidgetBundle {
    var body: some Widget {
        QuickSearchControlWidget()
        ScanTotpControlWidget()
        LockVaultControlWidget()
    }
}

struct QuickSearchControlWidget: ControlWidget {
    static let kind = "dev.keysmith.controls.quick-search"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: QuickSearchIntent()) {
                Label("快速搜索", systemImage: "magnifyingglass")
            }
        }
        .displayName("Keysmith 快速搜索")
        .description("一键打开 Keysmith 全局搜索。")
    }
}

struct ScanTotpControlWidget: ControlWidget {
    static let kind = "dev.keysmith.controls.scan-totp"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: ScanTotpIntent()) {
                Label("扫 2FA", systemImage: "qrcode.viewfinder")
            }
        }
        .displayName("扫一扫导入 2FA")
        .description("快速打开相机或相册扫描 TOTP 二维码。")
    }
}

struct LockVaultControlWidget: ControlWidget {
    static let kind = "dev.keysmith.controls.lock-vault"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: LockVaultIntent()) {
                Label("锁定保险库", systemImage: "lock.shield")
            }
        }
        .displayName("一键锁定保险库")
        .description("立即锁定 Keysmith 并清除内存敏感密钥。")
    }
}
