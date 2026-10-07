// KherveOS.app: KherveOS in its own Mac window.
//
// Opening the app starts the KherveOS server (port 8787) and the front end
// (Vite, port 5173) when they are not already running, waits for them, and shows
// http://localhost:5173 in a WebKit window: no browser around it. Quitting stops
// only the servers this app started. The project folder is read from the
// KherveOSRepo key of Info.plist (written by build_app.sh).
//
// Note: files on the KherveOS drive live in each browser's storage, so this
// window has its own drive, separate from Chrome's or Safari's.

import Cocoa
import WebKit

let frontURL = URL(string: "http://localhost:5173/")!
let serverURL = URL(string: "http://127.0.0.1:8787/api/health")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var webView: WKWebView!
  var started: [Process] = []
  var downloadTargets: [ObjectIdentifier: URL] = [:]

  var repo: String {
    Bundle.main.object(forInfoDictionaryKey: "KherveOSRepo") as? String ?? "\(NSHomeDirectory())/Documents/PycharmProjects/KherveOS"
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.preferences.isElementFullscreenEnabled = true
    config.preferences.setValue(true, forKey: "developerExtrasEnabled") // right-click › Inspect
    // KherveOS's Ꝃ › Shut Down… posts {type: 'shutdown'} here once everything is saved.
    config.userContentController.add(self, name: "kherveos")
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsMagnification = true

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "KherveOS"
    window.appearance = NSAppearance(named: .darkAqua)
    window.collectionBehavior = [.fullScreenPrimary]
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("KherveOSMain")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    showMessage("Starting KherveOS…")
    DispatchQueue.global().async { self.startServers() }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    for p in started where p.isRunning { p.terminate() }
  }

  // MARK: messages from KherveOS

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "kherveos", let body = message.body as? [String: Any],
          body["type"] as? String == "shutdown" else { return }
    // The page has closed every window and flushed the drive: quit (which stops our servers).
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { NSApp.terminate(nil) }
  }

  // MARK: servers

  func reachable(_ url: URL) -> Bool {
    var ok = false
    let sem = DispatchSemaphore(value: 0)
    var req = URLRequest(url: url)
    req.timeoutInterval = 1.5
    URLSession.shared.dataTask(with: req) { _, resp, _ in
      ok = ((resp as? HTTPURLResponse)?.statusCode ?? 0) > 0
      sem.signal()
    }.resume()
    sem.wait()
    return ok
  }

  /// Runs a command in a login shell (so npm/node from Homebrew are found), in the project folder.
  func launch(_ command: String, log: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", command]
    p.currentDirectoryURL = URL(fileURLWithPath: repo)
    let logURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(log)
    FileManager.default.createFile(atPath: logURL.path, contents: nil)
    if let h = try? FileHandle(forWritingTo: logURL) {
      p.standardOutput = h
      p.standardError = h
    }
    do {
      try p.run()
      started.append(p)
    } catch {
      DispatchQueue.main.async { self.showMessage("Could not start: \(command)\n\(error.localizedDescription)") }
    }
  }

  func startServers() {
    guard FileManager.default.fileExists(atPath: repo + "/package.json") else {
      DispatchQueue.main.async { self.showMessage("KherveOS was not found in \(self.repo).\nRebuild the app with tools/macos/build_app.sh.") }
      return
    }
    if !reachable(serverURL) { launch("cd server && exec .venv/bin/python -m kherveos_server", log: "kherveos-server.log") }
    if !reachable(frontURL) { launch("exec ./node_modules/.bin/vite --strictPort", log: "kherveos-vite.log") }
    for _ in 0..<120 {
      if reachable(frontURL) {
        DispatchQueue.main.async { self.webView.load(URLRequest(url: frontURL)) }
        return
      }
      Thread.sleep(forTimeInterval: 0.5)
    }
    DispatchQueue.main.async {
      self.showMessage("KherveOS did not start in time.\nLogs: \(NSTemporaryDirectory())kherveos-vite.log and kherveos-server.log")
    }
  }

  func showMessage(_ text: String) {
    let safe = text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: "\n", with: "<br>")
    webView.loadHTMLString("""
      <html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
      background:#050706;color:#d7e4da;font:15px -apple-system,sans-serif;text-align:center">
      <div><div style="font-size:28px;color:#22b357;margin-bottom:10px">KherveOS</div>\(safe)</div></body></html>
      """, baseURL: nil)
  }

  // MARK: menus (Edit is what makes ⌘C / ⌘V reach the page)

  func buildMenu() {
    let main = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) {
      let item = NSMenuItem()
      let menu = NSMenu(title: title)
      items.forEach { menu.addItem($0) }
      item.submenu = menu
      main.addItem(item)
    }
    add("KherveOS", [
      NSMenuItem(title: "About KherveOS", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""),
      .separator(),
      NSMenuItem(title: "Hide KherveOS", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"),
      NSMenuItem(title: "Quit KherveOS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"),
    ])
    add("Edit", [
      NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"),
      NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"),
      .separator(),
      NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
      NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
      NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
      NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
    ])
    let reload = NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
    reload.target = self
    let full = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    full.keyEquivalentModifierMask = [.control, .command]
    add("View", [reload, full])
    add("Window", [
      NSMenuItem(title: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"),
      NSMenuItem(title: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: ""),
    ])
    NSApp.mainMenu = main
  }

  @objc func reloadPage() { webView.reload() }

  // MARK: web view

  // Links meant for a real browser (KherveOS's "Open in your real browser") open in the default browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  // Downloads (files dragged or saved out of KherveOS) go to ~/Downloads, never over an existing file.
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let base = (suggestedFilename as NSString).deletingPathExtension
    let ext = (suggestedFilename as NSString).pathExtension
    var target = dir.appendingPathComponent(suggestedFilename)
    var n = 2
    while FileManager.default.fileExists(atPath: target.path) {
      target = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
      n += 1
    }
    downloadTargets[ObjectIdentifier(download)] = target
    completionHandler(target)
  }

  func downloadDidFinish(_ download: WKDownload) {
    if let url = downloadTargets.removeValue(forKey: ObjectIdentifier(download)) {
      NSWorkspace.shared.activateFileViewerSelecting([url])
    }
  }

  // <input type="file"> (Upload…, Open from this computer).
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  // The microphone (KherveNote's speech panel): macOS asks the user once.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == "localhost" ? .grant : .prompt)
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
