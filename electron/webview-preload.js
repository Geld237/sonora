// Fichier généré automatiquement par scripts/gen-electron-preload.js — ne pas modifier à la main.
require('electron').contextBridge.executeInMainWorld({
  func: function () {
/*
 * Sonora — bloqueur de publicités YouTube
 * Ce script est injecté au tout début du chargement de chaque page YouTube
 * (Windows : preload Electron / iPhone : WKUserScript).
 *
 * 3 niveaux de protection :
 *   1. Nettoyage des données : on retire les publicités des réponses JSON de YouTube
 *      (adPlacements, playerAds…) avant que le lecteur ne les lise.
 *   2. Masquage : une feuille de style cache tous les emplacements publicitaires.
 *   3. Saut automatique : si une pub vidéo passe quand même, elle est coupée,
 *      accélérée jusqu'à la fin et le bouton « Passer » est cliqué.
 * (Le blocage réseau des serveurs publicitaires est fait en plus par l'application.)
 */
(function () {
  'use strict';
  if (window.__sonoraAdblock) return;
  window.__sonoraAdblock = true;

  /* ---------- 1. Nettoyage des données publicitaires ---------- */
  var AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adBreakParams'];

  function prune(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 4) return obj;
    for (var i = 0; i < AD_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(obj, AD_KEYS[i])) {
        try { delete obj[AD_KEYS[i]]; } catch (e) {}
      }
    }
    if (obj.playerResponse) prune(obj.playerResponse, depth + 1);
    if (Array.isArray(obj)) {
      for (var j = 0; j < obj.length && j < 10; j++) prune(obj[j], depth + 1);
    }
    return obj;
  }

  try {
    var origParse = JSON.parse;
    JSON.parse = function () {
      var r = origParse.apply(this, arguments);
      try { prune(r, 0); } catch (e) {}
      return r;
    };
  } catch (e) {}

  try {
    var origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.call(this).then(function (r) {
        try { prune(r, 0); } catch (e) {}
        return r;
      });
    };
  } catch (e) {}

  // Réponse initiale du lecteur intégrée dans la page
  ['ytInitialPlayerResponse', 'playerResponse'].forEach(function (name) {
    try {
      var value = window[name];
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return value; },
        set: function (v) { value = prune(v, 0); },
      });
    } catch (e) {}
  });

  /* ---------- 2. Masquage des emplacements publicitaires ---------- */
  var CSS = [
    '.video-ads',
    '.ytp-ad-module',
    '.ytp-ad-overlay-container',
    '.ytp-ad-overlay-slot',
    '.ytp-ad-image-overlay',
    '.ytp-ad-text-overlay',
    '.ytp-ad-player-overlay',
    '.ytp-ad-progress-list',
    '.ytp-suggested-action',
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-promoted-video-renderer',
    'ytd-display-ad-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    'ytd-video-masthead-ad-v3-renderer',
    'ytd-primetime-promo-renderer',
    'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    'ytd-merch-shelf-renderer',
    'ytd-ads-engagement-panel-content-renderer',
    'ytd-search-pyv-renderer',
    '#masthead-ad',
    '#player-ads',
    '#panels > ytd-ads-engagement-panel-content-renderer',
    'ytm-promoted-sparkles-web-renderer',
    'ytm-promoted-video-renderer',
    'ytm-companion-ad-renderer',
    'ytm-companion-slot',
    'ad-slot-renderer',
    'ytm-promoted-sparkles-text-search-renderer',
    '.ytm-promoted-sparkles-web-renderer',
    'ytm-paid-content-overlay-renderer',
    'ytd-enforcement-message-view-model',
  ].join(',\n') + ' { display: none !important; }\n'
    // Règle séparée : un sélecteur :has() non reconnu (anciens iOS) n'annule pas la règle principale
    + [
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytm-rich-item-renderer:has(ad-slot-renderer)',
    'ytm-item-section-renderer:has(ad-slot-renderer)',
    'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
  ].join(',\n') + ' { display: none !important; }';

  function addStyle() {
    if (document.getElementById('sonora-adblock-css')) return;
    var root = document.head || document.documentElement;
    if (!root) return;
    var s = document.createElement('style');
    s.id = 'sonora-adblock-css';
    s.textContent = CSS;
    root.appendChild(s);
  }
  addStyle();
  document.addEventListener('DOMContentLoaded', addStyle);

  /* ---------- 3. Saut automatique des pubs vidéo ---------- */
  var mutedByUs = false;
  var spedByUs = false;
  var SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button, .ytp-ad-overlay-close-button, .ytm-skip-ad-button, button.ytp-ad-skip-button-slot';

  function tick() {
    try {
      var playerEl = document.querySelector('.html5-video-player');
      var video = playerEl ? playerEl.querySelector('video') : document.querySelector('video');
      var adShowing = !!(playerEl && (playerEl.classList.contains('ad-showing') || playerEl.classList.contains('ad-interrupting')));
      if (!adShowing && document.querySelector('.ad-showing video, .ytp-ad-player-overlay, .ytm-ad-player-overlay')) adShowing = true;

      if (video && adShowing) {
        if (!video.muted) { video.muted = true; mutedByUs = true; }
        if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
          video.currentTime = video.duration;
        }
        try { video.playbackRate = 16; spedByUs = true; } catch (e) {}
      } else if (video) {
        if (mutedByUs) { video.muted = false; mutedByUs = false; }
        if (spedByUs) { try { video.playbackRate = 1; } catch (e) {} spedByUs = false; }
      }

      var buttons = document.querySelectorAll(SKIP);
      for (var i = 0; i < buttons.length; i++) { try { buttons[i].click(); } catch (e) {} }

      // Fenêtre « Les bloqueurs de publicité ne sont pas autorisés » : on la ferme et on relance la vidéo
      var enforcement = document.querySelector('ytd-enforcement-message-view-model');
      if (enforcement) {
        var dialog = enforcement.closest('tp-yt-paper-dialog');
        if (dialog) dialog.remove(); else enforcement.remove();
        var backdrop = document.querySelector('tp-yt-iron-overlay-backdrop');
        if (backdrop) backdrop.remove();
        if (video && video.paused) video.play().catch(function () {});
      }
    } catch (e) {}
  }
  setInterval(tick, 250);
})();

  },
});
