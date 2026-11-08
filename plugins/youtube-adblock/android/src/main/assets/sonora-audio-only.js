(function () {
  var id = 'sonora-audio-only';
  var css = 'video { opacity: 0 !important; } .html5-video-player, #movie_player, ytm-player, .player-container { background: linear-gradient(135deg, #8b5cf6, #ec4899) !important; }';
  var s = document.getElementById(id);
  if (window.__sonoraAudioOnly) {
    if (!s) { s = document.createElement('style'); s.id = id; s.textContent = css; (document.head || document.documentElement).appendChild(s); }
  } else if (s) { s.remove(); }
})();
