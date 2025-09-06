import Foundation
import Network
import RoomPlan
import SwiftUI

struct ContentView: View {
  @State private var lastExportURL: URL? = nil
  @State private var isUploading = false
  @State private var uploadResult: String? = nil
  @State private var exportFinished = false
  @State private var scannerId = UUID()
  @State private var uploadProgress: Double = 0
  @State private var currentTask: URLSessionUploadTask? = nil
  @State private var urlSessionConfiguration: URLSessionConfiguration? = nil

  var body: some View {
    NavigationView {
      VStack(spacing: 16) {
        if RoomCaptureSession.isSupported {
          RoomPlanScannerView { url in
            lastExportURL = url
            exportFinished = true
          }
          .id(scannerId)
          .frame(maxWidth: .infinity, maxHeight: 380)
          .background(Color.black.opacity(0.05))
          .clipShape(RoundedRectangle(cornerRadius: 24))

          if let url = lastExportURL {
            Text("Zapisano: \(url.lastPathComponent)").font(.footnote).foregroundColor(.secondary)
            if exportFinished {
              Text("Eksport zakończony").font(.footnote).foregroundColor(.green)
            }
            Button {
              Task { await uploadFile(url: url) }
            } label: {
              Text("Wyślij do MebloPlan")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isUploading)
            if isUploading {
              ProgressView(value: uploadProgress)
              Button("Anuluj wysyłkę") { currentTask?.cancel() }
                .buttonStyle(.bordered)
            }
            if exportFinished {
              Button("Skanuj ponownie") {
                lastExportURL = nil
                exportFinished = false
                scannerId = UUID()
              }
            }
          } else {
            Text("Zeskanuj pokój i zapisz plik przed wysyłką.").font(.footnote).foregroundColor(
              .secondary)
          }

          if let result = uploadResult {
            Text(result)
              .font(.callout)
              .foregroundColor(result.contains("Błąd") || result.contains("Brak") ? .red : .green)
          }
        } else {
          Text("To urządzenie nie obsługuje RoomPlan.")
            .font(.footnote)
            .foregroundColor(.secondary)
        }
        Spacer()
      }
      .padding()
      .navigationTitle("MebloPlan Scanner")
    }
  }

  class UploadDelegate: NSObject, URLSessionTaskDelegate {
    var onProgress: (Double) -> Void
    init(onProgress: @escaping (Double) -> Void) { self.onProgress = onProgress }
    func urlSession(
      _ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
      totalBytesSent: Int64, totalBytesExpectedToSend: Int64
    ) {
      guard totalBytesExpectedToSend > 0 else { return }
      let progress = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
      DispatchQueue.main.async { self.onProgress(progress) }
    }
  }

  func uploadFile(url: URL) async {
    let monitor = NWPathMonitor()
    let path = await withCheckedContinuation { continuation in
      monitor.pathUpdateHandler = { path in
        continuation.resume(returning: path)
      }
      monitor.start(queue: DispatchQueue.global(qos: .background))
    }
    monitor.cancel()
    guard path.status == .satisfied else {
      uploadResult = "Brak połączenia z internetem"
      return
    }

    guard url.startAccessingSecurityScopedResource() else { return }
    defer { url.stopAccessingSecurityScopedResource() }
    isUploading = true
    uploadProgress = 0
    defer {
      isUploading = false
      currentTask = nil
      uploadProgress = 0
    }

    do {
      let token = Bundle.main.object(forInfoDictionaryKey: "API_TOKEN") as? String ?? ""
      let apiUrlString = Bundle.main.object(forInfoDictionaryKey: "API_URL") as? String ?? ""
      let boundary = "Boundary-\(UUID().uuidString)"
      guard let apiUrl = URL(string: apiUrlString) else { return }
      var request = URLRequest(url: apiUrl)
      request.httpMethod = "POST"
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      request.setValue(
        "multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

      let config = URLSessionConfiguration.default
      config.timeoutIntervalForRequest = 30
      config.timeoutIntervalForResource = 30
      let delegate = UploadDelegate { progress in
        self.uploadProgress = progress
      }
      let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

      let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      FileManager.default.createFile(atPath: tempURL.path, contents: nil)
      let handle = try FileHandle(forWritingTo: tempURL)
      defer {
        try? FileManager.default.removeItem(at: tempURL)
      }
      // meta
      let meta = ["platform": "ios", "format": url.pathExtension.lowercased()]
      let metaJSON = try JSONSerialization.data(withJSONObject: meta)
      try handle.write(contentsOf: "--\(boundary)\r\n".data(using: .utf8)!)
      try handle.write(
        contentsOf: "Content-Disposition: form-data; name=\"meta\"\r\n".data(using: .utf8)!)
      try handle.write(contentsOf: "Content-Type: application/json\r\n\r\n".data(using: .utf8)!)
      try handle.write(contentsOf: metaJSON)
      try handle.write(contentsOf: "\r\n".data(using: .utf8)!)
      // file
      try handle.write(contentsOf: "--\(boundary)\r\n".data(using: .utf8)!)
      try handle.write(
        contentsOf:
          "Content-Disposition: form-data; name=\"file\"; filename=\"\(url.lastPathComponent)\"\r\n"
          .data(using: .utf8)!)
      try handle.write(
        contentsOf: "Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
      let inputHandle = try FileHandle(forReadingFrom: url)
      defer { try? inputHandle.close() }
      while true {
        let chunk = try inputHandle.read(upToCount: 64 * 1024)
        if let chunk = chunk, !chunk.isEmpty {
          try handle.write(contentsOf: chunk)
        } else {
          break
        }
      }
      try handle.write(contentsOf: "\r\n".data(using: .utf8)!)
      try handle.write(contentsOf: "--\(boundary)--\r\n".data(using: .utf8)!)
      try handle.close()  // Zamknięcie zapewnia pełne zapisanie danych na dysk

      let (respData, resp) = try await withCheckedThrowingContinuation { continuation in
        let task = session.uploadTask(with: request, fromFile: tempURL) { data, response, error in
          if let error = error {
            continuation.resume(throwing: error)
          } else {
            continuation.resume(returning: (data ?? Data(), response))
          }
        }
        currentTask = task
        task.resume()
      }

      if let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
        uploadResult = String(data: respData, encoding: .utf8) ?? "OK"
      } else {
        uploadResult = "Błąd wysyłki (status: \((resp as? HTTPURLResponse)?.statusCode ?? -1))"
      }
    } catch {
      if let urlError = error as? URLError, urlError.code == .cancelled {
        uploadResult = "Wysyłkę anulowano"
      } else {
        uploadResult = "Błąd: \(error.localizedDescription)"
      }
    }
  }
}
