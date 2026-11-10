import UIKit
import WebKit

/// Règles de blocage réseau compilées par WebKit (comme un bloqueur Safari).
enum YouTubeAdblockRules {
    private static var cached: WKContentRuleList?
    private static var compiling = false
    private static var waiting: [(WKContentRuleList?) -> Void] = []

    static func load(_ completion: @escaping (WKContentRuleList?) -> Void) {
        DispatchQueue.main.async {
            if let list = YouTubeAdblockRules.cached {
                completion(list)
                return
            }
            YouTubeAdblockRules.waiting.append(completion)
            if YouTubeAdblockRules.compiling { return }
            YouTubeAdblockRules.compiling = true
            WKContentRuleListStore.default().compileContentRuleList(
                forIdentifier: "SonoraYouTubeAdblock_v1",
                encodedContentRuleList: AdblockScripts.contentRules
            ) { list, error in
                DispatchQueue.main.async {
                    if let error = error { print("Enora: règles non compilées \(error)") }
                    YouTubeAdblockRules.cached = list
                    YouTubeAdblockRules.compiling = false
                    let callbacks = YouTubeAdblockRules.waiting
                    YouTubeAdblockRules.waiting = []
                    callbacks.forEach { $0(list) }
                }
            }
        }
    }
}

/// Écran plein écran affichant YouTube avec le bloqueur de publicités.
final class YouTubeViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let startURL: URL
    private var audioOnly: Bool
    private var webView: WKWebView?
    private let audioButton = UIButton(type: .system)
    private let toolbar = UIStackView()
    private let backButton = UIButton(type: .system)
    private let forwardButton = UIButton(type: .system)
    private let reloadButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let shieldLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var observations: [NSKeyValueObservation] = []

    init(startURL: URL, audioOnly: Bool = false) {
        self.startURL = startURL
        self.audioOnly = audioOnly
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) non utilisé")
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.055, green: 0.059, blue: 0.078, alpha: 1)
        setupToolbar()
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        spinner.startAnimating()
        YouTubeAdblockRules.load { [weak self] rules in
            self?.setupWebView(rules: rules)
        }
    }

    private func makeButton(_ button: UIButton, symbol: String, action: Selector) {
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.tintColor = .white
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    private func setupToolbar() {
        makeButton(closeButton, symbol: "xmark", action: #selector(closeTapped))
        makeButton(backButton, symbol: "chevron.left", action: #selector(backTapped))
        makeButton(forwardButton, symbol: "chevron.right", action: #selector(forwardTapped))
        makeButton(reloadButton, symbol: "arrow.clockwise", action: #selector(reloadTapped))
        makeButton(audioButton, symbol: "headphones", action: #selector(audioTapped))
        updateAudioButton()
        backButton.isEnabled = false
        forwardButton.isEnabled = false

        shieldLabel.text = "🛡 Pubs et pop-ups bloquées"
        shieldLabel.textColor = UIColor(red: 0.29, green: 0.87, blue: 0.5, alpha: 1)
        shieldLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        shieldLabel.textAlignment = .right
        shieldLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

        toolbar.axis = .horizontal
        toolbar.alignment = .center
        toolbar.spacing = 4
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        [closeButton, backButton, forwardButton, reloadButton, audioButton, shieldLabel].forEach { toolbar.addArrangedSubview($0) }
        view.addSubview(toolbar)
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            toolbar.heightAnchor.constraint(equalToConstant: 48)
        ])
    }

    private func setupWebView(rules: WKContentRuleList?) {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()

        let content = config.userContentController
        if let rules = rules { content.add(rules) }   // 1. blocage réseau
        content.addUserScript(WKUserScript(              // 2 + 3. nettoyage, masquage, saut des pubs
            source: AdblockScripts.youtubeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))

        // Mode « audio seul » : la vidéo est masquée, le son continue (lecteur officiel YouTube)
        content.addUserScript(WKUserScript(
            source: "window.__sonoraAudioOnly = \(audioOnly ? "true" : "false");" + AdblockScripts.audioOnlyScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(web, belowSubview: spinner)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        observations = [
            web.observe(\.canGoBack, options: [.initial, .new]) { [weak self] web, _ in self?.backButton.isEnabled = web.canGoBack },
            web.observe(\.canGoForward, options: [.initial, .new]) { [weak self] web, _ in self?.forwardButton.isEnabled = web.canGoForward }
        ]
        webView = web
        web.load(URLRequest(url: startURL))
    }

    @objc private func closeTapped() {
        webView?.pauseAllMediaPlayback(completionHandler: nil)
        dismiss(animated: true)
    }

    @objc private func audioTapped() {
        audioOnly.toggle()
        updateAudioButton()
        webView?.evaluateJavaScript("window.__sonoraAudioOnly = \(audioOnly ? "true" : "false");" + AdblockScripts.audioOnlyScript, completionHandler: nil)
    }

    private func updateAudioButton() {
        audioButton.setImage(UIImage(systemName: audioOnly ? "headphones" : "film"), for: .normal)
        audioButton.tintColor = audioOnly ? UIColor(red: 0.93, green: 0.28, blue: 0.6, alpha: 1) : .white
        audioButton.accessibilityLabel = audioOnly ? "Audio seul" : "Vidéo"
    }

    @objc private func backTapped() { webView?.goBack() }
    @objc private func forwardTapped() { webView?.goForward() }
    @objc private func reloadTapped() { webView?.reload() }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        spinner.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        spinner.stopAnimating()
    }

    // Bloqueur de pop-ups : seules les fenêtres du même site (ou YouTube/Google) s'ouvrent, dans la même vue.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let target = navigationAction.request.url?.host?.lowercased() else {
            return nil
        }
        let current = webView.url?.host?.lowercased() ?? ""
        let trusted = ["youtube.com", "youtu.be", "google.com", "google.fr"].contains { target == $0 || target.hasSuffix("." + $0) }
        if trusted || baseDomain(target) == baseDomain(current) {
            webView.load(navigationAction.request)
        }
        return nil
    }

    private func baseDomain(_ host: String) -> String {
        let parts = host.split(separator: ".").map(String.init)
        let secondLevel: Set<String> = ["co", "com", "org", "net", "gouv", "ac", "gov"]
        let count = parts.count >= 3 && secondLevel.contains(parts[parts.count - 2]) ? 3 : 2
        return parts.suffix(count).joined(separator: ".")
    }
}
