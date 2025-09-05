
import SwiftUI
import RoomPlan

struct RoomPlanScannerView: UIViewRepresentable {
    typealias UIViewType = RoomCaptureView
    var onExported: (URL) -> Void

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = context.coordinator
        var config = RoomCaptureSession.Configuration()
        config.captureMethod = .LiDAR
        view.captureSession = RoomCaptureSession()
        view.captureSession.delegate = context.coordinator
        if RoomCaptureSession.isSupported {
            view.captureSession.run(configuration: config)
        }
        return view
    }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onExported: onExported) }

    final class Coordinator: NSObject, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
        private let onExported: (URL) -> Void
        init(onExported: @escaping (URL) -> Void) { self.onExported = onExported }
        func captureView(_ view: RoomCaptureView, didPresent processedResult: CapturedRoom, error: Error?) {
            guard error == nil else { return }
            export(room: processedResult, from: view)
        }
        private func export(room: CapturedRoom, from view: RoomCaptureView) {
            do {
                let fm = FileManager.default
                let docs = try fm.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let url = docs.appendingPathComponent("scan_\(Int(Date().timeIntervalSince1970)).usdz")
                try room.export(to: url)
                view.captureSession.stop()
                onExported(url)
            } catch {
                print("Export error: \(error)")
            }
        }
    }
}
