import SwiftUI

/// Fullscreen/sheet Large Type view for reading passwords or recovery keys character-by-character.
public struct LargeTypeSheet: View {
    public let title: String
    public let secret: String
    public var closeTitle: String
    @Environment(\.dismiss) private var dismiss

    private let columns = [
        GridItem(.adaptive(minimum: 52, maximum: 72), spacing: 10)
    ]

    public init(title: String, secret: String, closeTitle: String = "Close") {
        self.title = title
        self.secret = secret
        self.closeTitle = closeTitle
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

    private func color(for ch: Character) -> Color {
        if ch.isNumber { return KeysmithColors.digit }
        if !ch.isLetter { return KeysmithColors.symbol }
        return .primary
    }
}
