import Foundation

struct MultipartFormData {
  let boundary: String
  private var body = Data()

  init(boundary: String = "Boundary-\(UUID().uuidString)") {
    self.boundary = boundary
  }

  mutating func append(name: String, data: Data, filename: String? = nil, mimeType: String) {
    body.append("--\(boundary)\r\n")
    var disposition = "Content-Disposition: form-data; name=\"\(name)\""
    if let filename = filename {
      disposition += "; filename=\"\(filename)\""
    }
    body.append("\(disposition)\r\n")
    body.append("Content-Type: \(mimeType)\r\n\r\n")
    body.append(data)
    body.append("\r\n")
  }

  mutating func append(name: String, string: String) {
    append(name: name, data: Data(string.utf8), mimeType: "text/plain")
  }

  func finalize() -> Data {
    var data = body
    data.append("--\(boundary)--\r\n")
    return data
  }

  var contentType: String {
    "multipart/form-data; boundary=\(boundary)"
  }
}

extension Data {
  fileprivate mutating func append(_ string: String) {
    if let data = string.data(using: .utf8) {
      append(data)
    }
  }
}
