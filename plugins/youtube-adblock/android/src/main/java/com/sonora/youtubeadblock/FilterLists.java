package com.sonora.youtubeadblock;

import android.content.Context;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Listes de filtres reconnues (EasyList, Peter Lowe, uBlock Origin) pour le bloqueur de publicités.
 * On en retient les règles « domaine entier » (||domaine^), téléchargées en arrière-plan, gardées sur
 * l'appareil et renouvelées tous les 4 jours. La liste intégrée d'Enora reste active dans tous les cas.
 */
final class FilterLists {
    private static final String BASE = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/";
    private static final String[] LISTS = {
        "easylist/easylist.txt", "peter-lowe/serverlist.txt", "ublock-origin/filters.txt", "ublock-origin/badware.txt",
    };
    private static final long MAX_AGE = 4L * 24 * 3600 * 1000;
    private static final Pattern DOMAIN_RULE = Pattern.compile(
        "^\\|\\|([a-z0-9][a-z0-9.-]*\\.[a-z]{2,})\\^(\\$(third-party|3p|popup|all|doc|document)(,(third-party|3p|popup))*)?$");
    // Jamais bloqués, quoi que disent les listes : les sites dont l'application a besoin
    private static final String[] NEVER = { "youtube.com", "google.com", "googlevideo.com", "ytimg.com", "gstatic.com", "ggpht.com", "googleapis.com" };

    private static volatile Set<String> domains = Collections.emptySet();
    private static volatile boolean started = false;

    private FilterLists() {}

    /** Charge les listes une seule fois par lancement, sans bloquer l'affichage. */
    static void ensureLoaded(Context context) {
        if (started) return;
        started = true;
        final File file = new File(context.getApplicationContext().getFilesDir(), "adblock-domains.txt");
        Thread t = new Thread(() -> {
            try {
                if (file.exists()) domains = read(file);
                if (!file.exists() || System.currentTimeMillis() - file.lastModified() > MAX_AGE || domains.isEmpty()) {
                    Set<String> fresh = download();
                    if (fresh.size() > 1000) { // un téléchargement incomplet ne remplace pas les anciennes listes
                        write(file, fresh);
                        domains = fresh;
                    }
                }
            } catch (Exception ignored) {
                // Pas de connexion : la liste intégrée continue de bloquer
            }
        }, "enora-filter-lists");
        t.setDaemon(true);
        t.start();
    }

    /** Le domaine (ou l'un de ses domaines parents) figure-t-il dans les listes ? */
    static boolean matches(String host) {
        Set<String> set = domains;
        if (set.isEmpty() || host == null) return false;
        String h = host;
        while (true) {
            if (set.contains(h)) return true;
            int dot = h.indexOf('.');
            if (dot < 0 || h.indexOf('.', dot + 1) < 0) return false; // on s'arrête avant l'extension seule (.com)
            h = h.substring(dot + 1);
        }
    }

    static int size() { return domains.size(); }

    private static Set<String> download() throws Exception {
        Set<String> out = new HashSet<>();
        for (String name : LISTS) {
            HttpURLConnection c = (HttpURLConnection) new URL(BASE + name).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(25000);
            try {
                if (c.getResponseCode() != 200) continue;
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        if (line.length() < 6 || line.charAt(0) != '|') continue;
                        Matcher m = DOMAIN_RULE.matcher(line.trim().toLowerCase(Locale.ROOT));
                        if (m.matches() && !isNeeded(m.group(1))) out.add(m.group(1));
                    }
                }
            } finally {
                c.disconnect();
            }
        }
        return out;
    }

    private static boolean isNeeded(String domain) {
        for (String n : NEVER) if (domain.equals(n)) return true;
        return false;
    }

    private static Set<String> read(File file) throws Exception {
        Set<String> out = new HashSet<>();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) if (!line.isEmpty()) out.add(line);
        }
        return out;
    }

    private static void write(File file, Set<String> set) throws Exception {
        File tmp = new File(file.getPath() + ".tmp");
        try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8))) {
            for (String d : set) { w.write(d); w.write('\n'); }
        }
        if (!tmp.renameTo(file)) tmp.delete();
    }
}
