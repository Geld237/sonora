package com.sonora.youtubeadblock;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin Capacitor (Android) : ouvre une page (YouTube ou un site de streaming)
 * dans un navigateur intégré avec bloqueur de publicités et de pop-ups.
 */
@CapacitorPlugin(name = "YouTubeAdblock")
public class YouTubeAdblockPlugin extends Plugin {

    @Override
    public void load() {
        // Commandes de la notification, de l'écran de verrouillage et du casque -> application
        PlaybackService.listener = (action) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            notifyListeners("mediaAction", data);
        };
    }

    /** Lecture en cours (hors YouTube) : notification de lecture et maintien en arrière-plan. */
    @PluginMethod
    public void setNowPlaying(PluginCall call) {
        askNotificationsOnce();
        try {
            PlaybackService.start(getContext(), call.getString("title", "Enora"), call.getString("artist", ""), Boolean.TRUE.equals(call.getBoolean("playing", false)));
            call.resolve();
        } catch (Exception e) {
            call.reject("Service de lecture indisponible : " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopPlayback(PluginCall call) {
        PlaybackService.stop(getContext());
        call.resolve();
    }

    /** Android 13+ : la notification de lecture demande une autorisation (demandée une seule fois). */
    private void askNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33 || getActivity() == null) return;
        SharedPreferences prefs = getContext().getSharedPreferences("enora", 0);
        if (prefs.getBoolean("notifAsked", false)) return;
        prefs.edit().putBoolean("notifAsked", true).apply();
        if (getContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            getActivity().requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 4243);
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "https://m.youtube.com");
        boolean audioOnly = Boolean.TRUE.equals(call.getBoolean("audioOnly", false));
        boolean adblock = !Boolean.FALSE.equals(call.getBoolean("adblock", true));

        Intent intent = new Intent(getContext(), AdblockWebActivity.class);
        intent.putExtra(AdblockWebActivity.EXTRA_URL, url);
        intent.putExtra(AdblockWebActivity.EXTRA_AUDIO_ONLY, audioOnly);
        intent.putExtra(AdblockWebActivity.EXTRA_ADBLOCK, adblock);
        getActivity().startActivity(intent);

        JSObject ret = new JSObject();
        ret.put("opened", true);
        call.resolve(ret);
    }
}
