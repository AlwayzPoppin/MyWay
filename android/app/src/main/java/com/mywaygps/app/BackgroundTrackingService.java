package com.mywaygps.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Persistent Android location foreground service. It deliberately does not use
 * Capacitor callbacks: Android can keep this service running after the WebView
 * has been backgrounded or removed from Recents.
 */
public class BackgroundTrackingService extends Service {
    static final String ACTION_START = "com.mywaygps.app.START_BACKGROUND_TRACKING";
    static final String ACTION_STOP = "com.mywaygps.app.STOP_BACKGROUND_TRACKING";
    static final String PREFS = "myway_background_tracking";
    static final String KEY_RUNNING = "running";
    private static final String CHANNEL_ID = "myway_background_location";
    private static final int NOTIFICATION_ID = 41021;
    private static final long MIN_UPLOAD_INTERVAL_MS = 20_000L;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private final ExecutorService uploadExecutor = Executors.newSingleThreadExecutor();
    private long lastUploadAt = 0L;
    private Location lastUploadedLocation;

    public static void start(Context context) {
        Intent intent = new Intent(context, BackgroundTrackingService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        context.startService(new Intent(context, BackgroundTrackingService.class).setAction(ACTION_STOP));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location location = result.getLastLocation();
                if (location != null) handleLocation(location);
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTracking();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!hasLocationPermission() || !hasConfiguration()) {
            getPreferences().edit().putBoolean(KEY_RUNNING, false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        startTracking();
        getPreferences().edit().putBoolean(KEY_RUNNING, true).apply();
        return START_STICKY;
    }

    private void startTracking() {
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 15_000L)
            .setMinUpdateIntervalMillis(8_000L)
            .setMinUpdateDistanceMeters(15f)
            .setMaxUpdateDelayMillis(30_000L)
            .build();
        try {
            fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException ignored) {
            getPreferences().edit().putBoolean(KEY_RUNNING, false).apply();
        }
    }

    private void stopTracking() {
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        getPreferences().edit().putBoolean(KEY_RUNNING, false).apply();
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    private void handleLocation(Location location) {
        long now = System.currentTimeMillis();
        float moved = lastUploadedLocation == null ? Float.MAX_VALUE : location.distanceTo(lastUploadedLocation);
        if (now - lastUploadAt < MIN_UPLOAD_INTERVAL_MS && moved < 15f) return;
        lastUploadAt = now;
        lastUploadedLocation = new Location(location);
        uploadExecutor.execute(() -> uploadLocation(location));
    }

    private void uploadLocation(Location location) {
        try {
            SharedPreferences prefs = getPreferences();
            JSONObject payload = new JSONObject();
            payload.put("uid", prefs.getString("uid", ""));
            payload.put("deviceId", prefs.getString("deviceId", ""));
            payload.put("token", prefs.getString("token", ""));
            payload.put("lat", location.getLatitude());
            payload.put("lng", location.getLongitude());
            payload.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 0);
            payload.put("speedMph", location.hasSpeed() ? location.getSpeed() * 2.2369363d : 0);
            payload.put("heading", location.hasBearing() ? location.getBearing() : 0);
            payload.put("battery", getBatteryLevel());
            payload.put("signalQuality", "native-background");
            payload.put("displayName", prefs.getString("displayName", "You"));
            payload.put("photoURL", prefs.getString("photoURL", ""));
            payload.put("role", prefs.getString("role", "Member"));
            payload.put("circles", new JSONArray(prefs.getString("circles", "[]")));

            HttpURLConnection connection = (HttpURLConnection) new URL(prefs.getString("endpoint", "")).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (BufferedOutputStream stream = new BufferedOutputStream(connection.getOutputStream())) {
                stream.write(bytes);
            }
            int responseCode = connection.getResponseCode();
            connection.disconnect();
            if (responseCode == 401) getPreferences().edit().putBoolean(KEY_RUNNING, false).apply();
        } catch (Exception ignored) {
            // Android will deliver the next location update; avoid crashing a safety service for a transient network failure.
        }
    }

    private boolean hasConfiguration() {
        SharedPreferences prefs = getPreferences();
        return !prefs.getString("uid", "").isEmpty()
            && !prefs.getString("deviceId", "").isEmpty()
            && !prefs.getString("token", "").isEmpty()
            && !prefs.getString("endpoint", "").isEmpty();
    }

    private boolean hasLocationPermission() {
        return ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private SharedPreferences getPreferences() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private int getBatteryLevel() {
        BatteryManager manager = (BatteryManager) getSystemService(BATTERY_SERVICE);
        int level = manager == null ? 100 : manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return level >= 0 && level <= 100 ? level : 100;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Live location sharing", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("MyWay shares your location with your Circle while background tracking is enabled.");
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_myway)
            .setContentTitle("MyWay is sharing your location")
            .setContentText("Tap to return to MyWay. You can stop sharing from Settings.")
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // A swipe-away removes the activity but must not silently end approved Circle sharing.
        if (getPreferences().getBoolean(KEY_RUNNING, false)) start(this);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopTracking();
        uploadExecutor.shutdown();
        super.onDestroy();
    }

    @Nullable @Override
    public IBinder onBind(Intent intent) { return null; }
}
