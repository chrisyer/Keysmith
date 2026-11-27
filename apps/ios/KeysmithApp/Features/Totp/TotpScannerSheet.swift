@preconcurrency import AVFoundation
import CoreImage
import PhotosUI
import SwiftUI
import UIKit

/// Scans TOTP `otpauth://` QR codes from live camera (`AVCaptureSession`),
/// photo library (`PhotosPicker`), or clipboard image purely in memory (zero disk writes).
public struct TotpScannerSheet: View {
    let parseQrData: (@Sendable (Data) async throws -> String)?
    let onScanned: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var isDecoding = false
    @State private var cameraUnavailable = false

    public init(
        parseQrData: (@Sendable (Data) async throws -> String)? = nil,
        onScanned: @escaping (String) -> Void
    ) {
        self.parseQrData = parseQrData
        self.onScanned = onScanned
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                viewfinderSection

                VStack(spacing: 10) {
                    PhotosPicker(selection: $selectedPhoto, matching: .images) {
                        Label("从相册选择二维码图片", systemImage: "photo.on.rectangle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(KeysmithColors.accent)

                    Button {
                        Task { await decodeClipboardImage() }
                    } label: {
                        Label("从剪贴板图片识别", systemImage: "doc.on.clipboard")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .disabled(isDecoding)

                if let statusMessage {
                    Text(statusMessage)
                        .font(.caption)
                        .foregroundStyle(KeysmithColors.success)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(KeysmithColors.danger)
                        .multilineTextAlignment(.center)
                }

                Text("纯内存解码 otpauth:// URI，所有图像仅在内存中处理，绝不写入磁盘。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(20)
            .navigationTitle("扫描 TOTP 二维码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("取消") { dismiss() }
                }
            }
            .onChange(of: selectedPhoto) { _, item in
                guard let item else { return }
                Task { await decodePhotoPickerItem(item) }
            }
        }
    }

    @ViewBuilder
    private var viewfinderSection: some View {
        #if targetEnvironment(simulator)
        simulatorViewfinder
        #else
        if cameraUnavailable {
            simulatorViewfinder
        } else {
            ZStack {
                LiveQrCameraPreview(
                    onDetectCode: { code in
                        handleDecodedPayload(code)
                    },
                    onUnavailable: {
                        cameraUnavailable = true
                    }
                )
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(KeysmithColors.accent, lineWidth: 2.5)
                    .frame(width: 210, height: 210)
            }
            .frame(height: 290)
        }
        #endif
    }

    private var simulatorViewfinder: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                    .foregroundStyle(KeysmithColors.accent)
                    .frame(width: 170, height: 170)

                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 74, weight: .light))
                    .foregroundStyle(.white.opacity(0.9))
            }

            Button {
                let demoUri = "otpauth://totp/GitHub:dev@keysmith.app?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
                handleDecodedPayload(demoUri)
            } label: {
                Label("模拟识别 GitHub TOTP 二维码", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(KeysmithColors.success)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 290)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.black.opacity(0.88))
        )
    }

    private func decodePhotoPickerItem(_ item: PhotosPickerItem) async {
        isDecoding = true
        errorMessage = nil
        defer { isDecoding = false }

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                errorMessage = "无法读取所选图片的内存数据"
                return
            }
            try await decodeImageDataInMemory(data)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func decodeClipboardImage() async {
        errorMessage = nil
        guard let image = UIPasteboard.general.image, let pngData = image.pngData() else {
            errorMessage = "剪贴板中没有可识别的图片"
            return
        }
        isDecoding = true
        defer { isDecoding = false }
        do {
            try await decodeImageDataInMemory(pngData)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func decodeImageDataInMemory(_ data: Data) async throws {
        if let parseQrData {
            do {
                let uri = try await parseQrData(data)
                handleDecodedPayload(uri)
                return
            } catch {
                if let fallback = Self.detectQrStringInMemory(from: data) {
                    handleDecodedPayload(fallback)
                    return
                }
                throw error
            }
        }

        if let detected = Self.detectQrStringInMemory(from: data) {
            handleDecodedPayload(detected)
            return
        }

        let adapter = KeysmithCoreAdapter(isExtension: false)
        try await adapter.initializeIfNeeded()
        let uri = try await adapter.totpParseQrImage(data: data)
        handleDecodedPayload(uri)
    }

    private func handleDecodedPayload(_ payload: String) {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        statusMessage = "已识别 TOTP 密钥"
        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
        onScanned(trimmed)
        dismiss()
    }

    private static func detectQrStringInMemory(from data: Data) -> String? {
        guard let ciImage = CIImage(data: data),
              let detector = CIDetector(
                  ofType: CIDetectorTypeQRCode,
                  context: nil,
                  options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
              )
        else {
            return nil
        }
        let features = detector.features(in: ciImage)
        for feature in features {
            if let qr = feature as? CIQRCodeFeature,
               let msg = qr.messageString,
               !msg.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return msg
            }
        }
        return nil
    }
}

#if !targetEnvironment(simulator)
private struct LiveQrCameraPreview: UIViewRepresentable {
    let onDetectCode: (String) -> Void
    let onUnavailable: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onDetectCode: onDetectCode, onUnavailable: onUnavailable)
    }

    func makeUIView(context: Context) -> CameraPreviewUIView {
        let view = CameraPreviewUIView()
        context.coordinator.start(in: view)
        return view
    }

    func updateUIView(_ uiView: CameraPreviewUIView, context: Context) {}

    static func dismantleUIView(_ uiView: CameraPreviewUIView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class CameraPreviewUIView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer
        }
    }

    @MainActor
    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        private let onDetectCode: (String) -> Void
        private let onUnavailable: () -> Void
        private let session = AVCaptureSession()
        private let metadataQueue = DispatchQueue(label: "dev.keysmith.qr.metadata")
        private var hasDelivered = false

        init(onDetectCode: @escaping (String) -> Void, onUnavailable: @escaping () -> Void) {
            self.onDetectCode = onDetectCode
            self.onUnavailable = onUnavailable
        }

        func start(in view: CameraPreviewUIView) {
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            switch status {
            case .authorized:
                configureSession(in: view)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        if granted {
                            self.configureSession(in: view)
                        } else {
                            self.onUnavailable()
                        }
                    }
                }
            default:
                onUnavailable()
            }
        }

        func stop() {
            let captureSession = session
            metadataQueue.async {
                if captureSession.isRunning {
                    captureSession.stopRunning()
                }
            }
        }

        private func configureSession(in view: CameraPreviewUIView) {
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input)
            else {
                onUnavailable()
                return
            }

            session.beginConfiguration()
            session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                session.commitConfiguration()
                onUnavailable()
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: metadataQueue)
            if output.availableMetadataObjectTypes.contains(.qr) {
                output.metadataObjectTypes = [.qr]
            }
            session.commitConfiguration()

            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill

            let captureSession = session
            metadataQueue.async {
                captureSession.startRunning()
            }
        }

        nonisolated func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            let values = metadataObjects.compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
            guard let first = values.first(where: { $0.lowercased().hasPrefix("otpauth://") }) ?? values.first else {
                return
            }
            Task { @MainActor [weak self] in
                guard let self, !self.hasDelivered else { return }
                self.hasDelivered = true
                self.stop()
                self.onDetectCode(first)
            }
        }
    }
}
#endif
