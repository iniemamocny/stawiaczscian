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
    monitor.start(queue: DispatchQueue.global(qos: .background))
    var path = monitor.currentPath
    if path.status == .requiresConnection {
      // Give the monitor up to one second to report an updated path.
      try? await Task.sleep(nanoseconds: 1_000_000_000)
      path = monitor.currentPath
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
      guard let apiUrl = URL(string: apiUrlString) else { return }
      var request = URLRequest(url: apiUrl)
      request.httpMethod = "POST"
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

      let config = URLSessionConfiguration.default
      config.timeoutIntervalForRequest = 30
      config.timeoutIntervalForResource = 30
      let delegate = UploadDelegate { progress in
        self.uploadProgress = progress
      }
      let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

      var form = MultipartFormData()
      let meta = ["platform": "ios", "format": url.pathExtension.lowercased()]
      let metaJSON = try JSONSerialization.data(withJSONObject: meta)
      form.append(name: "meta", data: metaJSON, mimeType: "application/json")
      let fileData = try Data(contentsOf: url)
      form.append(
        name: "file", data: fileData, filename: url.lastPathComponent,
        mimeType: "application/octet-stream")
      let bodyData = form.finalize()
      request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")

      let (respData, resp) = try await withCheckedThrowingContinuation { continuation in
        let task = session.uploadTask(with: request, from: bodyData) { data, response, error in
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
