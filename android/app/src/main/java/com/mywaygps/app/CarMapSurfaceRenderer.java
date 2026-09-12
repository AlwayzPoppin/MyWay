package com.mywaygps.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.view.Surface;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android Auto's geographic map surface. The surrounding navigation controls
 * remain owned by the Car App Library; this draws actual road tiles plus the
 * route and vehicle position supplied by the phone.
 */
public class CarMapSurfaceRenderer implements CarStateRepository.Listener {
    private static final String TAG = "MyWayCarMap";
    private static final int ZOOM = 15, TILE_SIZE = 256, MAX_CACHE = 72;
    // CARTO now rejects anonymous Android Auto tile requests with an API-key
    // splash screen. Use the keyless OpenStreetMap raster source for the
    // renderer's small, cached navigation viewport.
    private static final String TILE_URL = "https://tile.openstreetmap.org/%d/%d/%d.png";
    private final Map<String, Bitmap> tiles = new LinkedHashMap<String, Bitmap>(MAX_CACHE, .75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Bitmap> eldest) { return size() > MAX_CACHE; }
    };
    private final Set<String> pendingTiles = Collections.synchronizedSet(new java.util.HashSet<String>());
    private final ExecutorService tileExecutor = Executors.newSingleThreadExecutor();
    private final Paint fallback = paint("#EEF2F7", Paint.Style.FILL, 1);
    private final Paint routeHalo = paint("#663B82F6", Paint.Style.STROKE, 22);
    private final Paint route = paint("#2563EB", Paint.Style.STROKE, 10);
    private final Paint puck = paint("#0EA5E9", Paint.Style.FILL, 1);
    private final Paint whiteStroke = paint("#FFFFFF", Paint.Style.STROKE, 4);
    private final Paint destination = paint("#7C3AED", Paint.Style.FILL, 1);
    private final Paint card = paint("#E8111C2E", Paint.Style.FILL, 1);
    private final Paint text = paint("#FFFFFF", Paint.Style.FILL, 1);
    private final Paint detail = paint("#D7E1EF", Paint.Style.FILL, 1);
    private final Paint attribution = paint("#334155", Paint.Style.FILL, 1);
    private Surface surface;
    private int width = 800, height = 480;
    private HandlerThread thread;
    private Handler handler;
    private volatile boolean running;
    private volatile int tileFetchAttempts;
    private volatile int tileFetchFailures;

    public CarMapSurfaceRenderer() {
        routeHalo.setStrokeCap(Paint.Cap.ROUND);
        route.setStrokeCap(Paint.Cap.ROUND);
        text.setFakeBoldText(true);
        CarStateRepository.getInstance().addListener(this);
    }
    private static Paint paint(String color, Paint.Style style, float stroke) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        p.setColor(Color.parseColor(color)); p.setStyle(style); p.setStrokeWidth(stroke); return p;
    }
    public synchronized void onSurfaceAvailable(Surface value, int w, int h) {
        surface = value; width = Math.max(600, w); height = Math.max(400, h); start();
    }
    public synchronized void onVisibleAreaChanged(Rect ignored) { trigger(); }
    public synchronized void onStableAreaChanged(Rect ignored) { trigger(); }
    public synchronized void onSurfaceDestroyed() { stop(); surface = null; }
    public synchronized void release() { stop(); surface = null; tileExecutor.shutdownNow(); CarStateRepository.getInstance().removeListener(this); }
    public void recenter() { trigger(); }
    @Override public void onNavigationStateChanged() { trigger(); }
    @Override public void onSavedPlacesChanged() { trigger(); }

    private void start() {
        stop(); thread = new HandlerThread("MyWayCarMapRenderer"); thread.start();
        handler = new Handler(thread.getLooper()); running = true; handler.post(frame);
    }
    private void stop() {
        running = false;
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        handler = null; thread = null;
    }
    private void trigger() {
        Handler h = handler;
        if (running && h != null) { h.removeCallbacks(frame); h.post(frame); }
    }
    private final Runnable frame = new Runnable() {
        @Override public void run() {
            Surface target = surface;
            if (!running || target == null || !target.isValid()) return;
            Canvas canvas = null;
            try {
                canvas = target.lockCanvas(null);
                if (canvas != null) render(canvas);
            } catch (Exception e) {
                Log.w(TAG, "Could not draw map", e);
            } finally {
                if (canvas != null && target.isValid()) try { target.unlockCanvasAndPost(canvas); } catch (Exception ignored) { }
            }
        }
    };

    private void render(Canvas canvas) {
        canvas.drawColor(Color.parseColor("#EEF2F7"));
        CarStateRepository state = CarStateRepository.getInstance();
        if (!state.hasCurrentLocation()) { drawWaiting(canvas); return; }
        double cx = worldX(state.getCurrentLongitude()), cy = worldY(state.getCurrentLatitude());
        drawTiles(canvas, cx, cy);
        List<CarStateRepository.MapPoint> points = state.getRoutePoints();
        if (points.size() > 1) drawRoute(canvas, points, cx, cy);
        if (state.hasDestinationLocation()) {
            drawDestination(canvas, screenX(worldX(state.getDestinationLongitude()), cx), screenY(worldY(state.getDestinationLatitude()), cy));
        }
        drawPuck(canvas, width / 2f, height / 2f);
        drawGuidance(canvas, state);
        if (state.isNavigationTelemetryStale()) {
            drawStalePhoneWarning(canvas);
        }
        if (tileFetchAttempts > 0 && tileFetchFailures >= tileFetchAttempts) {
            drawTileError(canvas);
        }
        attribution.setTextSize(12); canvas.drawText("(c) OpenStreetMap contributors", 18, height - 16, attribution);
    }
    private void drawTiles(Canvas canvas, double cx, double cy) {
        int minX = (int)Math.floor((cx - width / 2d) / TILE_SIZE), maxX = (int)Math.floor((cx + width / 2d) / TILE_SIZE);
        int minY = (int)Math.floor((cy - height / 2d) / TILE_SIZE), maxY = (int)Math.floor((cy + height / 2d) / TILE_SIZE);
        int count = 1 << ZOOM;
        for (int y = minY; y <= maxY; y++) {
            if (y < 0 || y >= count) continue;
            for (int x = minX; x <= maxX; x++) {
                int wrapped = ((x % count) + count) % count;
                String key = ZOOM + "/" + wrapped + "/" + y;
                Bitmap tile;
                synchronized (tiles) { tile = tiles.get(key); }
                if (tile == null) scheduleTileFetch(key, wrapped, y);
                int left = (int)(x * TILE_SIZE - cx + width / 2d), top = (int)(y * TILE_SIZE - cy + height / 2d);
                if (tile == null) canvas.drawRect(left, top, left + TILE_SIZE, top + TILE_SIZE, fallback);
                else canvas.drawBitmap(tile, null, new Rect(left, top, left + TILE_SIZE, top + TILE_SIZE), null);
            }
        }
    }
    private Bitmap fetchTile(String key, int x, int y) {
        HttpURLConnection c = null;
        tileFetchAttempts++;
        try {
            c = (HttpURLConnection)new URL(String.format(Locale.US, TILE_URL, ZOOM, x, y)).openConnection();
            c.setConnectTimeout(3500); c.setReadTimeout(4500);
            c.setRequestProperty("User-Agent", "MyWay-GPS Android Auto/1.0");
            c.setRequestProperty("Accept", "image/avif,image/webp,image/png,image/*;q=0.8");
            if (c.getResponseCode() != HttpURLConnection.HTTP_OK) {
                tileFetchFailures++;
                Log.d(TAG, "Tile request failed " + key + ": HTTP " + c.getResponseCode());
                return null;
            }
            try (InputStream input = c.getInputStream()) {
                Bitmap bitmap = BitmapFactory.decodeStream(input);
                if (bitmap == null) tileFetchFailures++;
                return bitmap;
            }
        } catch (Exception e) {
            tileFetchFailures++;
            Log.d(TAG, "Tile unavailable " + key + ": " + e.getMessage()); return null;
        } finally { if (c != null) c.disconnect(); }
    }
    private void drawRoute(Canvas c, List<CarStateRepository.MapPoint> points, double cx, double cy) {
        Path path = new Path(); boolean started = false;
        for (CarStateRepository.MapPoint point : points) {
            float x = screenX(worldX(point.lng), cx), y = screenY(worldY(point.lat), cy);
            if (!started) { path.moveTo(x, y); started = true; } else path.lineTo(x, y);
        }
        c.drawPath(path, routeHalo); c.drawPath(path, route);
    }
    private void drawPuck(Canvas c, float x, float y) {
        c.drawCircle(x, y, 20, puck); c.drawCircle(x, y, 20, whiteStroke);
        Path arrow = new Path(); arrow.moveTo(x, y - 12); arrow.lineTo(x - 8, y + 9); arrow.lineTo(x, y + 4); arrow.lineTo(x + 8, y + 9); arrow.close();
        c.drawPath(arrow, paint("#FFFFFF", Paint.Style.FILL, 1));
    }
    private void drawDestination(Canvas c, float x, float y) {
        if (x < -50 || y < -50 || x > width + 50 || y > height + 50) return;
        c.drawCircle(x, y, 16, destination); c.drawCircle(x, y, 16, whiteStroke); c.drawCircle(x, y, 5, paint("#FFFFFF", Paint.Style.FILL, 1));
    }
    private void drawGuidance(Canvas c, CarStateRepository s) {
        if (!s.isNavigating()) return;
        float left = 18, top = 18, right = width - 18, bottom = s.isArrived() ? 102 : 148;
        c.drawRoundRect(left, top, right, bottom, 18, 18, card);
        text.setTextSize(21); detail.setTextSize(15);
        if (s.isArrived()) {
            text.setColor(Color.parseColor("#86EFAC")); c.drawText("ARRIVED", left + 20, top + 31, text);
            text.setColor(Color.WHITE); c.drawText(shorten(s.getDestinationName(), 38), left + 20, top + 65, text);
        } else {
            c.drawText(shorten(s.getCurrentInstruction(), 48), left + 20, top + 35, text);
            String line = s.getRemainingDistance().isEmpty() ? "Following route" : "In " + s.getRemainingDistance();
            if (!s.getEta().isEmpty()) line += "  /  " + s.getEta();
            c.drawText(line, left + 20, top + 64, detail);
            c.drawText("To " + shorten(s.getDestinationName(), 36), left + 20, top + 91, detail);
            String fuelLine = buildFuelLine(s);
            if (!fuelLine.isEmpty()) {
                c.drawText(fuelLine, left + 20, top + 118, detail);
            }
        }
    }
    /** Downloads tiles off the surface-render thread so weak data never freezes the Drive HUD. */
    private void scheduleTileFetch(final String key, final int x, final int y) {
        if (!pendingTiles.add(key)) return;
        tileExecutor.execute(() -> {
            try {
                Bitmap bitmap = fetchTile(key, x, y);
                if (bitmap != null) synchronized (tiles) { tiles.put(key, bitmap); }
            } finally {
                pendingTiles.remove(key);
                trigger();
            }
        });
    }

    /** Keeps the car HUD honest when the phone stops sending route telemetry. */
    private void drawStalePhoneWarning(Canvas c) {
        float top = height - 76;
        c.drawRoundRect(18, top, width - 18, height - 30, 14, 14, card);
        text.setTextSize(15); detail.setTextSize(12);
        c.drawText("Waiting for phone update", 34, top + 23, text);
        c.drawText("Keep MyWay open on your phone to continue guidance.", 34, top + 40, detail);
    }

    /** Compact fuel-consumption line for the Android Auto Drive HUD. */
    private static String buildFuelLine(CarStateRepository s) {
        if (Double.isNaN(s.getFuelGallonsBurned()) && Double.isNaN(s.getFuelGallonsRemaining())) return "";
        StringBuilder line = new StringBuilder("Fuel ");
        if (!Double.isNaN(s.getFuelGallonsBurned())) {
            if (!Double.isNaN(s.getFuelCostSoFar())) {
                line.append(String.format(Locale.US, "$%.2f / %.2f gal used", s.getFuelCostSoFar(), s.getFuelGallonsBurned()));
            } else {
                line.append(String.format(Locale.US, "%.2f gal used", s.getFuelGallonsBurned()));
            }
        }
        if (!Double.isNaN(s.getFuelGallonsRemaining())) {
            if (line.length() > 5) line.append(" / ");
            line.append(String.format(Locale.US, "%.2f gal left", s.getFuelGallonsRemaining()));
            if (s.getFuelRangeMiles() >= 0) line.append(" / ").append(s.getFuelRangeMiles()).append(" mi range");
        }
        return line.toString();
    }
    private void drawWaiting(Canvas c) {
        c.drawRoundRect(28, height * .35f, width - 28, height * .65f, 22, 22, card);
        text.setTextSize(26); detail.setTextSize(18);
        c.drawText("Waiting for phone location", 56, height * .35f + 65, text);
        c.drawText("Open MyWay on your phone and start a trip.", 56, height * .35f + 104, detail);
    }
    private void drawTileError(Canvas c) {
        float top = height - 76;
        c.drawRoundRect(18, top, width - 18, height - 30, 14, 14, card);
        text.setTextSize(15); detail.setTextSize(12);
        c.drawText("Map data unavailable", 34, top + 23, text);
        c.drawText("Check your phone data connection.", 34, top + 40, detail);
    }
    private static String shorten(String value, int maximum) {
        if (value == null || value.trim().isEmpty()) return "Follow highlighted route";
        String clean = value.trim(); return clean.length() > maximum ? clean.substring(0, maximum - 3) + "..." : clean;
    }
    private static double worldX(double lng) { return ((lng + 180d) / 360d) * TILE_SIZE * (1 << ZOOM); }
    private static double worldY(double lat) {
        double value = Math.max(-85.05112878, Math.min(85.05112878, lat)), radians = Math.toRadians(value);
        return (1d - Math.log(Math.tan(radians) + 1d / Math.cos(radians)) / Math.PI) / 2d * TILE_SIZE * (1 << ZOOM);
    }
    private float screenX(double x, double center) { return (float)(x - center + width / 2d); }
    private float screenY(double y, double center) { return (float)(y - center + height / 2d); }
}
