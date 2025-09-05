
import SwiftUI
import Foundation

struct ContentView: View {
    @State private var lastExportURL: URL? = nil
    @State private var isUploading = false
    @State private var uploadResult: String? = nil
    @State private var exportFinished = false
    @State private var scannerId = UUID()

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
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
                    Button { Task { await uploadFile(url: url) } } label: {
                        HStack { if isUploading { ProgressView() }; Text("Wyślij do MebloPlan") }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isUploading)
                    if exportFinished {
                        Button("Skanuj ponownie") {
                            lastExportURL = nil
                            exportFinished = false
                            scannerId = UUID()
                        }
                    }
                } else {
                    Text("Zeskanuj pokój i zapisz plik przed wysyłką.").font(.footnote).foregroundColor(.secondary)
                }

                if let result = uploadResult { Text(result).font(.callout).foregroundColor(.green) }
                Spacer()
            }
            .padding()
            .navigationTitle("MebloPlan Scanner")
        }
    }

    func uploadFile(url: URL) async {
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }
        isUploading = true
        defer { isUploading = false }

        do {
            let token = "REPLACE_WITH_API_TOKEN"
            let boundary = "Boundary-\(UUID().uuidString)"
            var request = URLRequest(url: URL(string: "http://localhost:4000/api/scans")!)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            FileManager.default.createFile(atPath: tempURL.path, contents: nil)
            let handle = try FileHandle(forWritingTo: tempURL)
            defer {
                try? handle.close()
                try? FileManager.default.removeItem(at: tempURL)
            }
            // meta
            let meta = ["platform": "ios", "format": url.pathExtension.lowercased()]
            let metaJSON = try JSONSerialization.data(withJSONObject: meta)
            try handle.write(contentsOf: "--\(boundary)\r\n".data(using: .utf8)!)
            try handle.write(contentsOf: "Content-Disposition: form-data; name=\"meta\"\r\n".data(using: .utf8)!)
            try handle.write(contentsOf: "Content-Type: application/json\r\n\r\n".data(using: .utf8)!)
            try handle.write(contentsOf: metaJSON)
            try handle.write(contentsOf: "\r\n".data(using: .utf8)!)
            // file
            try handle.write(contentsOf: "--\(boundary)\r\n".data(using: .utf8)!)
            try handle.write(contentsOf: "Content-Disposition: form-data; name=\"file\"; filename=\"\(url.lastPathComponent)\"\r\n".data(using: .utf8)!)
            try handle.write(contentsOf: "Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
            let inputHandle = try FileHandle(forReadingFrom: url)
            while true {
                let chunk = try inputHandle.read(upToCount: 64 * 1024)
                if let chunk = chunk, !chunk.isEmpty {
                    try handle.write(contentsOf: chunk)
                } else {
                    break
                }
            }
            try inputHandle.close()
            try handle.write(contentsOf: "\r\n".data(using: .utf8)!)
            try handle.write(contentsOf: "--\(boundary)--\r\n".data(using: .utf8)!)

            let (respData, resp) = try await URLSession.shared.upload(for: request, fromFile: tempURL)
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                uploadResult = String(data: respData, encoding: .utf8) ?? "OK"
            } else {
                uploadResult = "Błąd wysyłki (status: \((resp as? HTTPURLResponse)?.statusCode ?? -1))"
            }
        } catch { uploadResult = "Błąd: \(error.localizedDescription)" }
    }
}
