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
                Label("Quick Search", systemImage: "magnifyingglass")
            }
        }
        .displayName("Keysmith Quick Search")
        .description("Open Keysmith global vault search with one tap.")
    }
}

struct ScanTotpControlWidget: ControlWidget {
    static let kind = "dev.keysmith.controls.scan-totp"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: ScanTotpIntent()) {
                Label("Scan 2FA", systemImage: "qrcode.viewfinder")
            }
        }
        .displayName("Scan 2FA QR")
        .description("Open camera or photos to scan a TOTP QR code.")
    }
}

struct LockVaultControlWidget: ControlWidget {
    static let kind = "dev.keysmith.controls.lock-vault"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: LockVaultIntent()) {
                Label("Lock Vault", systemImage: "lock.shield")
            }
        }
        .displayName("Lock Vault")
        .description("Immediately lock Keysmith and wipe decrypted keys from memory.")
    }
}
