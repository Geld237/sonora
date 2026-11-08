import Foundation
import Capacitor
import AVFoundation
import UIKit

/// Plugin Capacitor : ouvre YouTube dans un navigateur intégré avec bloqueur de publicités.
@objc(YouTubeAdblockPlugin)
public class YouTubeAdblockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "YouTubeAdblockPlugin"
    public let jsName = "YouTubeAdblock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        // Lecture audio en arrière-plan et écran verrouillé pour toute l'application
        do {
            // Pas de setActive ici : on ne coupe pas la musique des autres applis au lancement
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        } catch {
            print("Sonora: AVAudioSession error \(error)")
        }
        // Prépare les règles de blocage à l'avance
        YouTubeAdblockRules.load { _ in }
    }

    @objc func open(_ call: CAPPluginCall) {
        let urlString = call.getString("url") ?? "https://m.youtube.com"
        let url = URL(string: urlString) ?? URL(string: "https://m.youtube.com")!
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("Impossible d'ouvrir YouTube")
                return
            }
            // Double appui : une page est déjà ouverte
            guard presenter.presentedViewController == nil else {
                call.resolve()
                return
            }
            let controller = YouTubeViewController(startURL: url, audioOnly: call.getBool("audioOnly") ?? false)
            controller.modalPresentationStyle = .fullScreen
            presenter.present(controller, animated: true) {
                call.resolve()
            }
        }
    }
}
