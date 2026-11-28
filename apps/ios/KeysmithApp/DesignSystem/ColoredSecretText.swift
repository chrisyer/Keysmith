import SwiftUI

/// Renders passwords and secret tokens with 3-color syntactic highlighting:
/// - Letters: primary foreground
/// - Digits: KeysmithColors.digit (#0572EC / #58A6FF)
/// - Symbols: KeysmithColors.symbol (#D9480F / #FF7A59)
public struct ColoredSecretText: View {
    public let text: String
    public var font: Font
    public var isMasked: Bool

    public init(
        text: String,
        font: Font = .system(.body, design: .monospaced).monospacedDigit(),
        isMasked: Bool = false
    ) {
        self.text = text
        self.font = font
        self.isMasked = isMasked
    }

    public var body: some View {
        if isMasked {
            Text(String(repeating: "•", count: max(8, min(16, text.count))))
                .font(font)
                .foregroundStyle(.secondary)
                .accessibilityLabel(KSLocalizedStrings(languageCode: "system").t(zhCN: "已隐藏的机密内容", en: "Hidden secret"))
        } else {
            Text(attributedSecret)
                .font(font)
                .textSelection(.enabled)
        }
    }

    private var attributedSecret: AttributedString {
        var result = AttributedString()
        for ch in text {
            var part = AttributedString(String(ch))
            if ch.isNumber {
                part.foregroundColor = KeysmithColors.digit
            } else if !ch.isLetter {
                part.foregroundColor = KeysmithColors.symbol
            } else {
                part.foregroundColor = .primary
            }
            result.append(part)
        }
        return result
    }
}
