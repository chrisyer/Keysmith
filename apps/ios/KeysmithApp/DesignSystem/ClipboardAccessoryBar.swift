import SwiftUI

/// Liquid Glass capsule bar shown in `.tabViewBottomAccessory` (iPhone) or floating overlay (iPad)
/// when a sensitive secret has been copied to the local-only pasteboard.
public struct ClipboardAccessoryBar: View {
    public let store: KeysmithStore

    public init(store: KeysmithStore) {
        self.store = store
    }

    public var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(KeysmithColors.success)
                .frame(width: 8, height: 8)

            Text(statusText)
                .font(.caption.weight(.medium))
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: 4)

            if store.clipboardRemainingSeconds > 0 {
                Text("\(store.clipboardRemainingSeconds)s")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(KeysmithColors.accent)
            } else {
                Text(store.l10n.t(zhCN: "不自动清除", en: "Manual"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Button {
                store.clearClipboardNow()
            } label: {
                Text(store.l10n.clearClipboard)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KeysmithColors.danger)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(KeysmithColors.danger.opacity(0.14), in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .modifier(VibrancyCapsuleModifier(vibrancyEnabled: store.session.vibrancyEnabled))
    }

    private var statusText: String {
        let label = store.clipboardLabel.isEmpty ? store.l10n.t(zhCN: "内容", en: "Secret") : store.clipboardLabel
        return store.l10n.t(
            zhCN: "已复制\(label)（仅本机）",
            zhTW: "已複製\(label)（僅本機）",
            en: "Copied \(label) (Local)",
            ja: "\(label) をコピー（ローカルのみ）",
            ko: "\(label) 복사됨 (로컬 전용)",
            de: "\(label) kopiert (Lokal)",
            fr: "\(label) copié (Local)",
            es: "\(label) copiado (Local)"
        )
    }
}

private struct VibrancyCapsuleModifier: ViewModifier {
    let vibrancyEnabled: Bool

    func body(content: Content) -> some View {
        if vibrancyEnabled {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content
                .background(Color(.secondarySystemGroupedBackground), in: Capsule())
                .overlay(
                    Capsule()
                        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                )
        }
    }
}
