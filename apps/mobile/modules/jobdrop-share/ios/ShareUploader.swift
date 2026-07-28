import Foundation

/**
 * Posts a queued share to the share_job RPC.
 *
 * Used by both the app and the Share Extension. In the extension it runs on a
 * background URLSession so the upload survives the extension being torn down
 * the moment the user taps away — which is what lets the sheet dismiss in under
 * a second while the share still lands.
 */
public enum ShareUploader {
  public enum Result {
    /// Delivered. Drop it from the queue.
    case sent
    /// Worth trying again — offline, 5xx, timeout.
    case retry
    /// Will never succeed as-is: no credentials, or the token was rejected.
    case unauthorized
  }

  /// Fire-and-forget send. The completion may never run if the process dies,
  /// which is fine: the entry stays queued and the app drains it later.
  public static func upload(
    _ share: ShareStore.QueuedShare,
    completion: @escaping (Result) -> Void
  ) {
    guard let credentials = ShareStore.credentials() else {
      completion(.unauthorized)
      return
    }

    // A share captured long after the token expired cannot be sent from here.
    // Leaving it queued is correct: the app can refresh and send it.
    if credentials.expiresAt > 0, credentials.expiresAt <= Date().timeIntervalSince1970 {
      completion(.unauthorized)
      return
    }

    guard
      let base = URL(string: credentials.supabaseUrl),
      let url = URL(string: "/rest/v1/rpc/share_job", relativeTo: base)
    else {
      completion(.unauthorized)
      return
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(credentials.anonKey, forHTTPHeaderField: "apikey")
    request.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")
    // The RPC returns a row set we do not need.
    request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

    // No canonical_url or url_hash: the server settles job identity during
    // enrichment, so this never reimplements the URL rules.
    let body: [String: Any] = [
      "p_client_share_id": share.clientShareId,
      "p_source_type": "link",
      "p_raw_input": share.rawInput,
    ]

    guard let payload = try? JSONSerialization.data(withJSONObject: body) else {
      completion(.unauthorized)
      return
    }
    request.httpBody = payload

    URLSession.shared.dataTask(with: request) { _, response, error in
      if error != nil {
        completion(.retry)
        return
      }
      guard let http = response as? HTTPURLResponse else {
        completion(.retry)
        return
      }

      switch http.statusCode {
      case 200..<300:
        completion(.sent)
      case 401, 403:
        completion(.unauthorized)
      case 400..<500:
        // The request itself is wrong; an identical retry cannot fix it.
        completion(.unauthorized)
      default:
        completion(.retry)
      }
    }.resume()
  }

  /// Try to send everything queued, oldest first. Stops at the first failure so
  /// ordering is preserved.
  public static func drainQueue(completion: (() -> Void)? = nil) {
    let pending = ShareStore.peekAll()
    guard let next = pending.first else {
      completion?()
      return
    }

    upload(next) { result in
      switch result {
      case .sent:
        ShareStore.remove(clientShareId: next.clientShareId)
        drainQueue(completion: completion)
      case .retry, .unauthorized:
        completion?()
      }
    }
  }
}
