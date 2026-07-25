import UIKit
import Social
import UniformTypeIdentifiers

/**
 * The iOS capture surface (doc 1 §4.1).
 *
 * iOS will never allow a floating bubble, so this is the closest the platform
 * gets to one gesture: Share → JobDrop → done. The design follows from that —
 * the sheet has ALREADY SENT by the time it is visible, and the only control on
 * it is Undo. There is no "post" button to press, because pressing one would
 * make this two taps instead of one.
 *
 * It runs in a separate process from the app, so it reads credentials and
 * writes the queue through the shared App Group container (ShareStore.swift).
 * If the send does not complete before the sheet dismisses, the entry stays
 * queued and the app drains it on next launch — the share is never lost.
 */
class ShareViewController: UIViewController {

  private let card = UIView()
  private let label = UILabel()
  private let undoButton = UIButton(type: .system)

  private var queuedShareId: String?
  private var dismissWorkItem: DispatchWorkItem?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    buildUI()
    handleIncomingItem()
  }

  // MARK: - UI

  private func buildUI() {
    card.translatesAutoresizingMaskIntoConstraints = false
    card.backgroundColor = UIColor { traits in
      // ink900 / white, from packages/contracts/src/tokens.json.
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.07, green: 0.06, blue: 0.05, alpha: 1)
        : .white
    }
    card.layer.cornerRadius = 16
    card.layer.shadowOpacity = 0.18
    card.layer.shadowRadius = 20
    card.layer.shadowOffset = CGSize(width: 0, height: 6)
    view.addSubview(card)

    label.translatesAutoresizingMaskIntoConstraints = false
    label.font = .systemFont(ofSize: 16, weight: .semibold)
    label.textColor = UIColor { traits in
      traits.userInterfaceStyle == .dark ? .white : UIColor(red: 0.07, green: 0.06, blue: 0.05, alpha: 1)
    }
    label.text = "Sending…"
    label.numberOfLines = 2
    card.addSubview(label)

    undoButton.translatesAutoresizingMaskIntoConstraints = false
    undoButton.setTitle("Undo", for: .normal)
    undoButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
    // accent500
    undoButton.setTitleColor(UIColor(red: 0.16, green: 0.49, blue: 0.38, alpha: 1), for: .normal)
    undoButton.addTarget(self, action: #selector(undoTapped), for: .touchUpInside)
    card.addSubview(undoButton)

    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
      card.heightAnchor.constraint(equalToConstant: 92),

      label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
      label.centerYAnchor.constraint(equalTo: card.centerYAnchor),
      label.trailingAnchor.constraint(lessThanOrEqualTo: undoButton.leadingAnchor, constant: -12),

      undoButton.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
      undoButton.centerYAnchor.constraint(equalTo: card.centerYAnchor),
    ])
  }

  // MARK: - Capture

  private func handleIncomingItem() {
    guard
      let item = extensionContext?.inputItems.first as? NSExtensionItem,
      let attachments = item.attachments
    else {
      finish(withMessage: "Nothing to share")
      return
    }

    // Prefer a URL; fall back to plain text, which covers a pasted JD.
    for provider in attachments {
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] value, _ in
          let text = (value as? URL)?.absoluteString ?? (value as? String)
          DispatchQueue.main.async { self?.capture(text) }
        }
        return
      }
    }

    for provider in attachments {
      if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] value, _ in
          DispatchQueue.main.async { self?.capture(value as? String) }
        }
        return
      }
    }

    finish(withMessage: "That can't be shared yet")
  }

  private func capture(_ text: String?) {
    guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
      finish(withMessage: "Nothing to share")
      return
    }

    guard ShareStore.credentials() != nil else {
      // Queue it anyway — the app will send it once someone signs in. Losing
      // the share because of a session problem is the one outcome doc 1 §5.1
      // rules out.
      ShareStore.enqueue(rawInput: text, source: "share-extension")
      finish(withMessage: "Saved — open JobDrop to send")
      return
    }

    let id = ShareStore.enqueue(rawInput: text, source: "share-extension")
    queuedShareId = id
    label.text = "Sent to your groups"
    scheduleDismiss()

    // Fire the upload but do not wait for it. If the extension is torn down
    // first the entry is still queued, and the app drains it on next launch.
    ShareUploader.drainQueue()
  }

  // MARK: - Undo

  @objc private func undoTapped() {
    dismissWorkItem?.cancel()
    if let id = queuedShareId {
      ShareStore.remove(clientShareId: id)
    }
    finish(withMessage: "Not sent")
  }

  private func scheduleDismiss() {
    let work = DispatchWorkItem { [weak self] in self?.complete() }
    dismissWorkItem = work
    // Long enough to read the confirmation and reach Undo, short enough that it
    // still feels like one gesture.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6, execute: work)
  }

  private func finish(withMessage message: String) {
    label.text = message
    undoButton.isHidden = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.complete() }
  }

  private func complete() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
