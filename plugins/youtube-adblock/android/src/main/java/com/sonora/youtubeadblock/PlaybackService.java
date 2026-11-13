package com.sonora.youtubeadblock;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Service de lecture : garde Enora active quand l'écran est verrouillé ou l'application en arrière-plan
 * (titres indépendants, radios, podcasts, fichiers), avec une notification de lecture et les commandes
 * sur l'écran de verrouillage et le casque Bluetooth. Le son reste joué par la page de l'application.
 */
public class PlaybackService extends Service {
    static final String CHANNEL = "enora_playback";
    static final int NOTIF_ID = 4242;
    static final String ACTION = "com.sonora.enora.MEDIA";

    static PlaybackService instance;
    /** Reçoit les commandes (lecture, pause, suivant, précédent) pour les transmettre à l'application. */
    interface Listener { void onAction(String action); }
    static Listener listener;

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private String title = "Enora";
    private String artist = "";
    private boolean playing = false;

    static void start(Context ctx, String title, String artist, boolean playing) {
        if (instance != null) { instance.update(title, artist, playing); return; }
        Intent i = new Intent(ctx, PlaybackService.class);
        i.putExtra("title", title);
        i.putExtra("artist", artist);
        i.putExtra("playing", playing);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
    }

    static void stop(Context ctx) {
        if (instance != null) instance.shutdown();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Lecture en cours", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
        session = new MediaSession(this, "Enora");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play"); }
            @Override public void onPause() { send("pause"); }
            @Override public void onSkipToNext() { send("next"); }
            @Override public void onSkipToPrevious() { send("prev"); }
            @Override public void onStop() { send("pause"); }
        });
        session.setActive(true);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "enora:playback");
        wakeLock.setReferenceCounted(false);
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wm != null) {
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "enora:stream");
            wifiLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION.equals(intent.getAction())) {
            String a = intent.getStringExtra("a");
            if (a != null) send(a);
        } else if (intent != null) {
            title = orEmpty(intent.getStringExtra("title"), "Enora");
            artist = orEmpty(intent.getStringExtra("artist"), "");
            playing = intent.getBooleanExtra("playing", false);
        }
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIF_ID, n);
        applyLocks();
        return START_NOT_STICKY;
    }

    void update(String t, String a, boolean p) {
        title = orEmpty(t, "Enora");
        artist = orEmpty(a, "");
        playing = p;
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_ID, buildNotification());
        applyLocks();
    }

    private void applyLocks() {
        try {
            if (playing) {
                if (!wakeLock.isHeld()) wakeLock.acquire(6 * 3600 * 1000L);
                if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
            } else {
                if (wakeLock.isHeld()) wakeLock.release();
                if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            }
        } catch (Exception ignored) { }
    }

    private Notification buildNotification() {
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) b.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        b.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Précédent", action("prev", 1)).build())
            .addAction(playing
                ? new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pause", action("pause", 2)).build()
                : new Notification.Action.Builder(android.R.drawable.ic_media_play, "Lecture", action("play", 3)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Suivant", action("next", 4)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private PendingIntent action(String a, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(ACTION).putExtra("a", a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void send(String action) {
        Listener l = listener;
        if (l != null) l.onAction(action);
    }

    private static String orEmpty(String v, String d) { return v == null || v.isEmpty() ? d : v; }

    private void shutdown() {
        playing = false;
        applyLocks();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) { }
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) { }
        if (session != null) session.release();
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        shutdown(); // application fermée depuis les applications récentes : la lecture s'arrête
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
