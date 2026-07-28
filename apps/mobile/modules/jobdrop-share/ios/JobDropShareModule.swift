import ExpoModulesCore

/**
 * The JS-facing surface on iOS.
 *
 * Much smaller than its Android counterpart, because iOS has no bubble to
 * manage — no app may draw over other apps, permanently (doc 1 §4.1). The
 * overlay functions exist only so callers need no platform branch; they report
 * "not available" rather than throwing.
 */
public class JobDropShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("JobDropShare")

    // MARK: - Bubble: not possible on this platform

    Function("canDrawOverlay") { () -> Bool in
      false
    }

    Function("requestOverlayPermission") {
      // Intentionally empty. There is no iOS equivalent to grant.
    }

    Function("startBubble") {
      // Intentionally empty. The Share Extension is the iOS capture surface.
    }

    Function("stopBubble") {}

    Function("isBubbleRunning") { () -> Bool in
      false
    }

    // MARK: - Credentials shared with the extension

    Function("setCredentials") { (credentials: CredentialsRecord) in
      ShareStore.saveCredentials(
        ShareStore.Credentials(
          supabaseUrl: credentials.supabaseUrl,
          anonKey: credentials.anonKey,
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken,
          expiresAt: credentials.expiresAt,
          userId: credentials.userId
        )
      )
      // A fresh token means anything stuck on auth is worth retrying.
      ShareUploader.drainQueue()
    }

    Function("clearCredentials") {
      ShareStore.clearCredentials()
    }

    // MARK: - Queue

    Function("drainQueue") { () -> [[String: Any]] in
      ShareStore.drain().map {
        [
          "clientShareId": $0.clientShareId,
          "rawInput": $0.rawInput,
          "queuedAt": $0.queuedAt,
          "source": $0.source,
        ]
      }
    }

    Function("pendingCount") { () -> Int in
      ShareStore.count()
    }
  }
}

public struct CredentialsRecord: Record {
  @Field public var supabaseUrl: String = ""
  @Field public var anonKey: String = ""
  @Field public var accessToken: String = ""
  @Field public var refreshToken: String = ""
  @Field public var expiresAt: Double = 0
  @Field public var userId: String = ""

  public init() {}
}
