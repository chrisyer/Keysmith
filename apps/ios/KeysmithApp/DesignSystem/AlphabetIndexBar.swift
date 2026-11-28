import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public struct KSAlphabetSection: Identifiable {
    public let letter: String
    public let items: [KSItemSummary]
    public var id: String { letter }
}

@MainActor
public enum KSAlphabetIndexer {
    private static let allIndexLetters: [String] =
        (65...90).map { String(UnicodeScalar($0)) } + ["#"]
    private static let sortKeyCache = NSCache<NSString, NSString>()

    public static func sortKey(for title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "#" }
        if let cached = sortKeyCache.object(forKey: trimmed as NSString) {
            return cached as String
        }
        let result: String
        if trimmed.unicodeScalars.allSatisfy(\.isASCII) {
            result = trimmed.uppercased()
        } else {
            let latin = trimmed.applyingTransform(.toLatin, reverse: false)?
                .applyingTransform(.stripDiacritics, reverse: false) ?? trimmed
            result = latin.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        }
        sortKeyCache.setObject(result as NSString, forKey: trimmed as NSString)
        return result
    }

    public static func initialLetter(forPrecomputedKey key: String) -> String {
        guard let first = key.unicodeScalars.first(where: { CharacterSet.alphanumerics.contains($0) }) else {
            return "#"
        }
        if first.value >= 65 && first.value <= 90 {
            return String(first)
        }
        return "#"
    }

    public static func initialLetter(for title: String) -> String {
        initialLetter(forPrecomputedKey: sortKey(for: title))
    }

    public static func group(_ items: [KSItemSummary]) -> [KSAlphabetSection] {
        var buckets: [String: [(item: KSItemSummary, key: String)]] = [:]
        for item in items {
            let key = sortKey(for: item.title)
            let letter = initialLetter(forPrecomputedKey: key)
            buckets[letter, default: []].append((item, key))
        }

        let orderedKeys = allIndexLetters.filter { buckets[$0] != nil }
        return orderedKeys.map { letter in
            let sorted = (buckets[letter] ?? []).sorted { a, b in
                a.key.localizedStandardCompare(b.key) == .orderedAscending
            }.map(\.item)
            return KSAlphabetSection(letter: letter, items: sorted)
        }
    }
}

public struct KSAlphabetIndexBar: View {
    public let letters: [String]
    public var onSelect: (String) -> Void

    @State private var activeLetter: String?
    @State private var isDragging: Bool = false

    public init(letters: [String], onSelect: @escaping (String) -> Void) {
        self.letters = letters
        self.onSelect = onSelect
    }

    public var body: some View {
        ZStack(alignment: .trailing) {
            if isDragging, let activeLetter {
                Text(activeLetter)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(KeysmithColors.accent, in: Circle())
                    .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
                    .offset(x: -36)
                    .allowsHitTesting(false)
            }

            GeometryReader { geo in
                VStack(spacing: 1) {
                    ForEach(letters, id: \.self) { letter in
                        Text(letter)
                            .font(.system(size: 10, weight: activeLetter == letter ? .bold : .semibold, design: .rounded))
                            .foregroundStyle(activeLetter == letter ? KeysmithColors.accent : KeysmithColors.accent.opacity(0.85))
                            .frame(width: 18)
                            .frame(maxHeight: .infinity)
                    }
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 2)
                .background(.ultraThinMaterial, in: Capsule())
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            isDragging = true
                            selectLetter(at: value.location.y, totalHeight: geo.size.height)
                        }
                        .onEnded { _ in
                            isDragging = false
                            activeLetter = nil
                        }
                )
            }
            .frame(width: 22)
            .frame(maxHeight: min(CGFloat(max(letters.count, 1)) * 18 + 14, 420))
        }
    }

    private func selectLetter(at y: CGFloat, totalHeight: CGFloat) {
        guard !letters.isEmpty, totalHeight > 0 else { return }
        let ratio = min(max(y / totalHeight, 0), 0.9999)
        let idx = min(letters.count - 1, max(0, Int(ratio * CGFloat(letters.count))))
        let chosen = letters[idx]
        if activeLetter != chosen {
            activeLetter = chosen
            #if canImport(UIKit)
            UISelectionFeedbackGenerator().selectionChanged()
            #endif
            onSelect(chosen)
        }
    }
}
