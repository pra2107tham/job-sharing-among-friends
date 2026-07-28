import Foundation

/**
 * Storage shared between the app and the Share Extension.
 *
 * The extension is a separate process with its own container, so the only way
 * they can see the same data is an App Group. Everything the extension needs to
 * send on its own — the queue and the Supabase token — lives here.
 *
 * Deliberately mirrors the Android ShareStore: same field names, same "raw text
 * plus an id, nothing parsed" contract. URL canonicalisation and dedupe are
 * server-side (0016_merge_job_posts.sql) so neither platform reimplements
 * doc 1 §8.
 */
public enum ShareStore {
  /// Must match the group configured by the config plugin and the entitlements.
  public static let appGroup = "group.app.jobdrop.client"

  private static let queueKey = "jobdrop.queue"
  private static let credentialsKey = "jobdrop.credentials"

  private static var defaults: UserDefaults? {
    UserDefaults(suiteName: appGroup)
  }

  public struct Credentials: Codable {
    public let supabaseUrl: String
    public let anonKey: String
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Double
    public let userId: String

    public init(
      supabaseUrl: String,
      anonKey: String,
      accessToken: String,
      refreshToken: String,
      expiresAt: Double,
      userId: String
    ) {
      self.supabaseUrl = supabaseUrl
      self.anonKey = anonKey
      self.accessToken = accessToken
      self.refreshToken = refreshToken
      self.expiresAt = expiresAt
      self.userId = userId
    }
  }

  public struct QueuedShare: Codable {
    public let clientShareId: String
    public let rawInput: String
    public let queuedAt: Double
    public let source: String

    public init(clientShareId: String, rawInput: String, queuedAt: Double, source: String) {
      self.clientShareId = clientShareId
      self.rawInput = rawInput
      self.queuedAt = queuedAt
      self.source = source
    }
  }

  // MARK: - Credentials

  public static func saveCredentials(_ credentials: Credentials) {
    guard let data = try? JSONEncoder().encode(credentials) else { return }
    defaults?.set(data, forKey: credentialsKey)
  }

  public static func credentials() -> Credentials? {
    guard let data = defaults?.data(forKey: credentialsKey) else { return nil }
    return try? JSONDecoder().decode(Credentials.self, from: data)
  }

  public static func clearCredentials() {
    defaults?.removeObject(forKey: credentialsKey)
  }

  // MARK: - Queue

  @discardableResult
  public static func enqueue(rawInput: String, source: String) -> String {
    let id = UUID().uuidString
    let entry = QueuedShare(
      clientShareId: id,
      rawInput: rawInput,
      queuedAt: Date().timeIntervalSince1970 * 1000,
      source: source
    )

    var all = peekAll()
    all.append(entry)
    write(all)
    return id
  }

  public static func peekAll() -> [QueuedShare] {
    guard let data = defaults?.data(forKey: queueKey) else { return [] }
    // A corrupt queue must not brick sharing forever.
    return (try? JSONDecoder().decode([QueuedShare].self, from: data)) ?? []
  }

  public static func remove(clientShareId: String) {
    write(peekAll().filter { $0.clientShareId != clientShareId })
  }

  /// Hand everything to JS and empty the queue in one step.
  public static func drain() -> [QueuedShare] {
    let all = peekAll()
    write([])
    return all
  }

  public static func count() -> Int {
    peekAll().count
  }

  private static func write(_ shares: [QueuedShare]) {
    guard let data = try? JSONEncoder().encode(shares) else { return }
    defaults?.set(data, forKey: queueKey)
  }
}
