import Foundation
#if canImport(UIKit)
import UIKit
#endif
import UniformTypeIdentifiers

/// Writes secrets to `UIPasteboard.general` with `.localOnly` (no Universal Clipboard Handoff)
/// and `.expirationDate` auto-clear, while broadcasting foreground countdown updates to `KeysmithStore`.
public final class AppleClipboardManager: @unchecked Sendable {
    public static let shared = AppleClipboardManager()

    private let lock = NSLock()
    private var changeCountAtLastCopy: Int = 0
    private var handler: (@Sendable (_ label: String, _ clearAfterSeconds: UInt64) -> Void)?

    public init() {}

    public func registerCopyObserver(_ observer: @escaping @Sendable (_ label: String, _ clearAfterSeconds: UInt64) -> Void) {
        lock.lock()
        handler = observer
        lock.unlock()
    }

    public func copySecret(text: String, label: String, isSensitive: Bool, clearAfterSecs: UInt64) throws {
        #if canImport(UIKit)
        let writeToPasteboard = {
            let item: [String: Any] = [UTType.utf8PlainText.identifier: text]
            var options: [UIPasteboard.OptionsKey: Any] = [:]
            if isSensitive {
                options[.localOnly] = true
            }
            if clearAfterSecs > 0 {
                options[.expirationDate] = Date().addingTimeInterval(TimeInterval(clearAfterSecs))
            }
            UIPasteboard.general.setItems([item], options: options)
            self.lock.lock()
            self.changeCountAtLastCopy = UIPasteboard.general.changeCount
            self.lock.unlock()
        }

        if Thread.isMainThread {
            writeToPasteboard()
        } else {
            DispatchQueue.main.sync(execute: writeToPasteboard)
        }
        #endif

        lock.lock()
        let callback = handler
        lock.unlock()
        callback?(label, clearAfterSecs)
    }

    public func clearNow() throws {
        #if canImport(UIKit)
        let clearPasteboard = {
            self.lock.lock()
            let lastCount = self.changeCountAtLastCopy
            self.lock.unlock()
            if lastCount == 0 || UIPasteboard.general.changeCount == lastCount {
                UIPasteboard.general.items = []
            }
        }
        if Thread.isMainThread {
            clearPasteboard()
        } else {
            DispatchQueue.main.sync(execute: clearPasteboard)
        }
        #endif
    }
}
