package com.sonora.youtubeadblock;

import android.content.Intent;

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
