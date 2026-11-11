package com.sonora.youtubeadblock;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Navigateur plein écran avec bloqueur de publicités :
 *  1. blocage réseau des serveurs publicitaires (shouldInterceptRequest) : liste intégrée + listes EasyList / uBlock Origin
 *  2. script anti-pub injecté au début de chaque page (nettoyage des données, masquage, saut des pubs vidéo)
 *  3. blocage des pop-ups et des redirections vers des applis/stores
 */
public class AdblockWebActivity extends Activity {
    static final String EXTRA_URL = "url";
    static final String EXTRA_AUDIO_ONLY = "audioOnly";
    static final String EXTRA_ADBLOCK = "adblock";

    private WebView web;
    private FrameLayout fullscreenContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private final List<String> blockedHosts = new ArrayList<>();
    private final List<String> blockedPaths = new ArrayList<>();
    private String adblockScript = "";
    private String audioOnlyScript = "";
    private boolean adblock = true;
    private boolean audioOnly = false;

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name);
             BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private Button toolbarButton(String label, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setBackgroundColor(Color.TRANSPARENT);
        b.setAllCaps(false);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(12), 0, dp(12), 0);
        b.setOnClickListener(onClick);
        return b;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null) url = "https://m.youtube.com";
        adblock = getIntent().getBooleanExtra(EXTRA_ADBLOCK, true);
        audioOnly = getIntent().getBooleanExtra(EXTRA_AUDIO_ONLY, false);

        // Listes de blocage et scripts (copiés par scripts/setup-android.js)
        for (String line : readAsset("sonora-block.txt").split("\n")) {
            String l = line.trim().toLowerCase(Locale.ROOT);
            if (l.isEmpty() || l.startsWith("#")) continue;
            if (l.contains("/")) blockedPaths.add(l); else blockedHosts.add(l);
        }
        if (adblock) FilterLists.ensureLoaded(this); // listes EasyList / uBlock Origin, en arrière-plan
        adblockScript = readAsset("sonora-adblock.js");
        audioOnlyScript = readAsset("sonora-audio-only.js");

        int bg = Color.rgb(14, 15, 20);
        getWindow().setStatusBarColor(bg);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.rgb(22, 24, 33));
        bar.addView(toolbarButton("✕", v -> finish()));
        bar.addView(toolbarButton("‹", v -> { if (web.canGoBack()) web.goBack(); }));
        bar.addView(toolbarButton("›", v -> { if (web.canGoForward()) web.goForward(); }));
        bar.addView(toolbarButton("⟳", v -> web.reload()));
        TextView shield = new TextView(this);
        shield.setText(adblock ? "🛡 Pubs et pop-ups bloquées" : "");
        shield.setTextColor(Color.rgb(74, 222, 128));
        shield.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        shield.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        shield.setPadding(0, 0, dp(14), 0);
        bar.addView(shield, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        fullscreenContainer = new FrameLayout(this);
        fullscreenContainer.setBackgroundColor(Color.BLACK);
        fullscreenContainer.setVisibility(View.GONE);

        FrameLayout container = new FrameLayout(this);
        container.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        container.addView(fullscreenContainer, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(container);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setSupportMultipleWindows(false);              // les « nouvelles fenêtres » s'ouvrent dans la même vue
        ws.setJavaScriptCanOpenWindowsAutomatically(false); // pas de pop-up automatique
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        final boolean documentStart = adblock && !adblockScript.isEmpty()
                && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (documentStart) {
            WebViewCompat.addDocumentStartJavaScript(web, adblockScript, Collections.singleton("*"));
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (adblock && isBlocked(request.getUrl())) {
                    return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                // On reste dans la vue pour http(s) ; les redirections vers d'autres applis (intent:, market:…) sont bloquées
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return adblock && isBlocked(request.getUrl());
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (adblock && !documentStart && !adblockScript.isEmpty()) view.evaluateJavascript(adblockScript, null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (adblock && !adblockScript.isEmpty()) view.evaluateJavascript(adblockScript, null); // filet de sécurité
                applyAudioOnly();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                customView = view;
                customViewCallback = callback;
                fullscreenContainer.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                fullscreenContainer.setVisibility(View.VISIBLE);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }
        });

        web.loadUrl(url);
    }

    private void applyAudioOnly() {
        if (audioOnlyScript.isEmpty()) return;
        web.evaluateJavascript("window.__sonoraAudioOnly=" + (audioOnly ? "true" : "false") + ";" + audioOnlyScript, null);
    }

    private boolean isBlocked(Uri uri) {
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        for (String h : blockedHosts) {
            if (host.equals(h) || host.endsWith("." + h)) return true;
        }
        if (FilterLists.matches(host)) return true;
        String full = (host + uri.getEncodedPath()).toLowerCase(Locale.ROOT);
        for (String p : blockedPaths) {
            if (full.contains(p)) return true;
        }
        return false;
    }

    private void exitFullscreen() {
        if (customView == null) return;
        fullscreenContainer.removeView(customView);
        fullscreenContainer.setVisibility(View.GONE);
        customView = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (customView != null) { exitFullscreen(); return; }
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
