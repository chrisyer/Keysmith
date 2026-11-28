import SwiftUI

/// Fullscreen/sheet Large Type view for reading passwords or recovery keys character-by-character.
public struct LargeTypeSheet: View {
    public let title: String
    public let secret: String
    public var closeTitle: String
    public var copyTitle: String?
    public var onCopy: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    private let columns = [
        GridItem(.adaptive(minimum: 52, maximum: 72), spacing: 10)
    ]

    public init(
        title: String,
        secret: String,
        closeTitle: String = "Close",
        copyTitle: String? = nil,
        onCopy: (() -> Void)? = nil
    ) {
        self.title = title
        self.secret = secret
        self.closeTitle = closeTitle
        self.copyTitle = copyTitle
        self.onCopy = onCopy
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(secret)
                        .font(.system(.title3, design: .monospaced).monospacedDigit())
                        .opacity(0)
                        .frame(height: 0)
                        .accessibilityHidden(true)

                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(Array(secret.enumerated()), id: \.offset) { index, ch in
                            VStack(spacing: 4) {
                                Text(String(ch))
                                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                                    .foregroundStyle(color(for: ch))
                                    .frame(maxWidth: .infinity)
                                Text("\(index + 1)")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(Color.secondary.opacity(0.10))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                            )
                        }
                    }

                    HStack(spacing: 14) {
                        legendDot(color: .primary, label: "Aa")
                        legendDot(color: KeysmithColors.digit, label: "0-9")
                        legendDot(color: KeysmithColors.symbol, label: "!@#")
                        Spacer()
                        Text("\(secret.count)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 4)

                    if let onCopy {
                        Button {
                            onCopy()
                            dismiss()
                        } label: {
                            Label(copyTitle ?? "Copy", systemImage: "doc.on.doc")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .controlSize(.large)
                        .tint(KeysmithColors.accent)
                        .padding(.top, 4)
                    }
                }
                .padding()
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(closeTitle) {
                        dismiss()
                    }
                }
            }
        }
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
        }
    }

    private func color(for ch: Character) -> Color {
        if ch.isNumber { return KeysmithColors.digit }
        if !ch.isLetter { return KeysmithColors.symbol }
        return .primary
    }
}
