
import SwiftUI

struct ContentView: View {
    @State private var lastExportURL: URL? = nil
    @State private var isUploading = false
    @State private var uploadResult: String? = nil

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                RoomPlanScannerView { url in lastExportURL = url }
                    .frame(maxWidth: .infinity, maxHeight: 380)
                    .background(Color.black.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: 24))

                if let url = lastExportURL {
                    Text("Zapisano: \(url.lastPathComponent)").font(.footnote).foregroundColor(.secondary)
                    Button { Task { await uploadFile(url: url) } } label: {
                        HStack { if isUploading { ProgressView() }; Text("Wyślij do MebloPlan") }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isUploading)
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

            var data = Data()
            // meta
            let meta = ["platform": "ios", "format": url.pathExtension.lowercased()]
            let metaJSON = try JSONSerialization.data(withJSONObject: meta)
            data.append("--\(boundary)\r\n".data(using: .utf8)!)
            data.append("Content-Disposition: form-data; name=\"meta\"\r\n".data(using: .utf8)!)
            data.append("Content-Type: application/json\r\n\r\n".data(using: .utf8)!)
            data.append(metaJSON)
            data.append("\r\n".data(using: .utf8)!)
            // file
            let fileData = try Data(contentsOf: url)
            data.append("--\(boundary)\r\n".data(using: .utf8)!)
            data.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(url.lastPathComponent)\"\r\n".data(using: .utf8)!)
            data.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
            data.append(fileData)
            data.append("\r\n".data(using: .utf8)!)
            data.append("--\(boundary)--\r\n".data(using: .utf8)!)

            let (respData, resp) = try await URLSession.shared.upload(for: request, from: data)
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                uploadResult = String(data: respData, encoding: .utf8) ?? "OK"
            } else {
                uploadResult = "Błąd wysyłki (status: \((resp as? HTTPURLResponse)?.statusCode ?? -1))"
            }
        } catch { uploadResult = "Błąd: \(error.localizedDescription)" }
    }
}
