import SwiftUI

/// Multi-tasking privacy blur overlay (`.inactive` / `.background`) and live screen capture warning banner.
public struct PrivacyShieldOverlay: View {
    public let isAppSwitcherBlurVisible: Bool
    public let isScreenCapturedWarningVisible: Bool
    public let l10n: KSLocalizedStrings
    public var vibrancyEnabled: Bool

    public init(
        isAppSwitcherBlurVisible: Bool,
        isScreenCapturedWarningVisible: Bool,
        l10n: KSLocalizedStrings,
        vibrancyEnabled: Bool = true
    ) {
        self.isAppSwitcherBlurVisible = isAppSwitcherBlurVisible
        self.isScreenCapturedWarningVisible = isScreenCapturedWarningVisible
        self.l10n = l10n
        self.vibrancyEnabled = vibrancyEnabled
    }

    public var body: some View {
        ZStack {
            if isScreenCapturedWarningVisible {
                VStack {
                    HStack(spacing: 8) {
                        Image(systemName: "eye.slash.fill")
                            .foregroundStyle(.white)
                        Text(l10n.t(
                            zhCN: "检测到屏幕录制/投屏，敏感字段已自动遮罩",
                            en: "Screen recording detected — sensitive fields masked"
                        ))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(KeysmithColors.danger, in: Capsule())
                    .padding(.top, 8)
                    Spacer()
                }
                .allowsHitTesting(false)
            }

            if isAppSwitcherBlurVisible {
                Group {
                    if vibrancyEnabled {
                        Rectangle()
                            .fill(.ultraThinMaterial)
                    } else {
                        Rectangle()
                            .fill(Color(.systemBackground))
                    }
                }
                .ignoresSafeArea()
                .overlay {
                    VStack(spacing: 14) {
                        KSAppLogoView(size: 64)
                        Text("Keysmith")
                            .font(.title3.weight(.bold))
                        Text(l10n.t(
                            zhCN: "已启用多任务隐私保护遮罩",
                            en: "Privacy Shield Active"
                        ))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                    .padding(24)
                }
                .transition(.opacity)
            }
        }
    }
}
