package com.mywaygps.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.view.Surface;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android Auto's geographic map surface renderer.
 *
 * Aligned with the mobile MapLibre3DView experience:
 * - OpenStreetMap raster tiles with no external map-provider API key requirement
 * - Seamless OpenStreetMap fallback
 * - Bearing-oriented chase camera during navigation with forward vehicle anchor (~62% screen height)
 * - Custom synchronized vector road alert markers (traffic queue, speed bump diamond, flooded road waves)
 * - Luminous route line with navy casing and halo matching mobile palette
 * - Sleek 3D vehicle puck with luminous forward vision cone and cyan chevron core
 */
public class CarMapSurfaceRenderer implements CarStateRepository.Listener {
    private static final String TAG = "MyWayCarMap";
    private static final int ZOOM = 15, TILE_SIZE = 256, MAX_CACHE = 100;

    private static final String OSM_URL = "https://tile.openstreetmap.org/%d/%d/%d.png";

    private final Map<String, Bitmap> tiles = new LinkedHashMap<String, Bitmap>(MAX_CACHE, .75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Bitmap> eldest) {
            return size() > MAX_CACHE;
        }
    };
    private final Set<String> pendingTiles = Collections.synchronizedSet(new java.util.HashSet<String>());
    private final ExecutorService tileExecutor = Executors.newFixedThreadPool(2);

    private final Paint fallbackDark = paint("#0F172A", Paint.Style.FILL, 1);
    private final Paint fallbackLight = paint("#F8F5F1", Paint.Style.FILL, 1);
    private final Paint darkTilePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);

    // Route paints
    private final Paint routeHalo = paint("#4000F2FE", Paint.Style.STROKE, 26);
    private final Paint routeCasing = paint("#082F49", Paint.Style.STROKE, 17);
    private final Paint route = paint("#00F2FE", Paint.Style.STROKE, 10);

    // Pins & markers
    private final Paint destination = paint("#6D3DF5", Paint.Style.FILL, 1);
    private final Paint destinationHalo = paint("#406D3DF5", Paint.Style.FILL, 1);
    private final Paint whiteStroke = paint("#FFFFFF", Paint.Style.STROKE, 3.5f);

    // Overlays
    private final Paint cardDark = paint("#F00A0F1D", Paint.Style.FILL, 1);
    private final Paint cardLight = paint("#F7FFFFFF", Paint.Style.FILL, 1);
    private final Paint text = paint("#FFFFFF", Paint.Style.FILL, 1);
    private final Paint detail = paint("#D7E1EF", Paint.Style.FILL, 1);
    private final Paint attribution = paint("#64748B", Paint.Style.FILL, 1);

    private Surface surface;
    private int width = 800, height = 480;
    private HandlerThread thread;
    private Handler handler;
    private volatile boolean running;
    private volatile int tileFetchAttempts;
    private volatile int tileFetchFailures;

    public CarMapSurfaceRenderer() {
        // Keep the no-key OSM basemap comfortable for night driving while the
        // route, traffic markers, and labels retain their high contrast.
        darkTilePaint.setColorFilter(new ColorMatrixColorFilter(new ColorMatrix(new float[] {
                .16f, .16f, .16f, 0, -20,
                .16f, .16f, .16f, 0, -20,
                .19f, .19f, .19f, 0, -12,
                0, 0, 0, 1, 0
        })));
        routeHalo.setStrokeCap(Paint.Cap.ROUND);
        routeCasing.setStrokeCap(Paint.Cap.ROUND);
        route.setStrokeCap(Paint.Cap.ROUND);
        whiteStroke.setStrokeJoin(Paint.Join.ROUND);
        text.setFakeBoldText(true);
        CarStateRepository.getInstance().addListener(this);
    }

    private static Paint paint(String color, Paint.Style style, float stroke) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        p.setColor(Color.parseColor(color));
        p.setStyle(style);
        p.setStrokeWidth(stroke);
        return p;
    }

    public synchronized void onSurfaceAvailable(Surface value, int w, int h) {
        surface = value;
        width = Math.max(600, w);
        height = Math.max(400, h);
        start();
    }

    public synchronized void onVisibleAreaChanged(Rect ignored) { trigger(); }
    public synchronized void onStableAreaChanged(Rect ignored) { trigger(); }
    public synchronized void onSurfaceDestroyed() { stop(); surface = null; }

    public synchronized void release() {
        stop();
        surface = null;
        tileExecutor.shutdownNow();
        CarStateRepository.getInstance().removeListener(this);
    }

    public void recenter() { trigger(); }

    @Override
    public void onNavigationStateChanged() { trigger(); }

    @Override
    public void onSavedPlacesChanged() { trigger(); }

    @Override
    public void onIncidentsChanged() { trigger(); }

    @Override
    public void onMapSkinChanged() {
        synchronized (tiles) {
            tiles.clear();
        }
        pendingTiles.clear();
        trigger();
    }

    private void start() {
        stop();
        thread = new HandlerThread("MyWayCarMapRenderer");
        thread.start();
        handler = new Handler(thread.getLooper());
        running = true;
        handler.post(frame);
    }

    private void stop() {
        running = false;
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        handler = null;
        thread = null;
    }

    private void trigger() {
        Handler h = handler;
        if (running && h != null) {
            h.removeCallbacks(frame);
            h.post(frame);
        }
    }

    private final Runnable frame = new Runnable() {
        @Override
        public void run() {
            Surface target = surface;
            if (!running || target == null || !target.isValid()) return;
            Canvas canvas = null;
            try {
                canvas = target.lockCanvas(null);
                if (canvas != null) render(canvas);
            } catch (Exception e) {
                Log.w(TAG, "Could not draw map", e);
            } finally {
                if (canvas != null && target.isValid()) {
                    try {
                        target.unlockCanvasAndPost(canvas);
                    } catch (Exception ignored) {}
                }
            }
        }
    };

    private boolean isDarkMode(CarStateRepository state) {
        String theme = state.getTheme() == null ? "dark" : state.getTheme();
        String skin = state.getMapSkin() == null ? "default" : state.getMapSkin().toLowerCase(Locale.US);
        // The MyWay default/warm skin is deliberately bright on both phone and
        // car. Carbon Amber remains the dedicated night skin.
        if ("default".equals(skin) || "warm_cream".equals(skin) || "voyager".equals(skin)) return false;
        if ("carbon-amber".equals(skin) || "los-santos".equals(skin)
                || "midnight-amber".equals(skin) || "midnight_amber".equals(skin)
                || "gta_radar".equals(skin)) return true;
        return "dark".equalsIgnoreCase(theme);
    }

    private void updateRoutePalette(boolean isDark) {
        if (isDark) {
            routeHalo.setColor(Color.parseColor("#4000F2FE"));
            routeCasing.setColor(Color.parseColor("#082F49"));
            route.setColor(Color.parseColor("#00F2FE"));
        } else {
            routeHalo.setColor(Color.parseColor("#402563EB"));
            routeCasing.setColor(Color.parseColor("#1E3A8A"));
            route.setColor(Color.parseColor("#2563EB"));
        }
    }

    private void render(Canvas canvas) {
        CarStateRepository state = CarStateRepository.getInstance();
        boolean isDark = isDarkMode(state);
        updateRoutePalette(isDark);

        // Clear background
        canvas.drawColor(isDark ? Color.parseColor("#0A0F1D") : Color.parseColor("#F8F5F1"));

        // When no current location is available yet:
        if (!state.hasCurrentLocation()) {
            List<CarStateRepository.SavedPlaceItem> savedPlaces = state.getSavedPlaces();
            if (!savedPlaces.isEmpty()) {
                CarStateRepository.SavedPlaceItem center = savedPlaces.get(0);
                double cx = worldX(center.lng), cy = worldY(center.lat);
                drawTiles(canvas, cx, cy, width / 2f, height / 2f, 0f, isDark);
                drawSavedPlacePins(canvas, savedPlaces, cx, cy, width / 2f, height / 2f);
                attribution.setColor(isDark ? Color.parseColor("#64748B") : Color.parseColor("#94A3B8"));
                canvas.drawText("© OpenStreetMap contributors, © CARTO", 18, height - 16, attribution);
                return;
            }
            return;
        }

        double cx = worldX(state.getCurrentLongitude());
        double cy = worldY(state.getCurrentLatitude());

        boolean navigating = state.isNavigating();
        // Forward camera perspective anchor matching mobile navTopPadding: '42%'
        float anchorX = width * 0.5f;
        float anchorY = navigating ? height * 0.62f : height * 0.5f;

        float bearing = (navigating && state.hasBearing()) ? (float) state.getCurrentBearing() : 0f;

        // --- MAP WORLD SPACE (Rotated when navigating) ---
        canvas.save();
        if (bearing != 0f) {
            canvas.rotate(-bearing, anchorX, anchorY);
        }

        // 1. Base Map Tiles
        drawTiles(canvas, cx, cy, anchorX, anchorY, bearing, isDark);

        // 2. Active Route Line
        List<CarStateRepository.MapPoint> points = state.getRoutePoints();
        if (points.size() > 1) {
            drawRoute(canvas, points, cx, cy, anchorX, anchorY);
        }

        // 3. Road Alerts and Permanent Features
        drawIncidents(canvas, state.getIncidents(), cx, cy, anchorX, anchorY, bearing);

        // 4. Destination Pin
        if (state.hasDestinationLocation()) {
            float destX = (float) (worldX(state.getDestinationLongitude()) - cx + anchorX);
            float destY = (float) (worldY(state.getDestinationLatitude()) - cy + anchorY);
            drawDestination(canvas, destX, destY);
        }

        canvas.restore();
        // --- END MAP WORLD SPACE ---

        // --- SCREEN SPACE UI OVERLAYS (Unrotated) ---
        // The route world rotates under the car. Keeping the puck in screen
        // space makes it point forward at all times instead of rotating with
        // the map (the cause of the north-locked looking navigation view).
        drawVehiclePuck(canvas, anchorX, anchorY, navigating);
        drawGuidance(canvas, state, isDark);

        if (state.isNavigationTelemetryStale()) {
            drawStalePhoneWarning(canvas, isDark);
        }

        if (tileFetchAttempts > 0 && tileFetchFailures >= tileFetchAttempts) {
            drawTileError(canvas, isDark);
        }

        attribution.setTextSize(11);
        attribution.setColor(isDark ? Color.parseColor("#64748B") : Color.parseColor("#94A3B8"));
        canvas.drawText("© OpenStreetMap contributors, © CARTO", 18, height - 16, attribution);
    }

    private void drawTiles(Canvas canvas, double cx, double cy, float anchorX, float anchorY, float bearing, boolean isDark) {
        // Compute radius to cover rotated diagonal so corners never tear during turns
        double radius = Math.hypot(Math.max(anchorX, width - anchorX), Math.max(anchorY, height - anchorY)) + 32;

        int minX = (int) Math.floor((cx - radius) / TILE_SIZE);
        int maxX = (int) Math.floor((cx + radius) / TILE_SIZE);
        int minY = (int) Math.floor((cy - radius) / TILE_SIZE);
        int maxY = (int) Math.floor((cy + radius) / TILE_SIZE);

        int count = 1 << ZOOM;
        Paint fallback = isDark ? fallbackDark : fallbackLight;

        for (int y = minY; y <= maxY; y++) {
            if (y < 0 || y >= count) continue;
            for (int x = minX; x <= maxX; x++) {
                int wrapped = ((x % count) + count) % count;
                String key = ZOOM + "/" + wrapped + "/" + y;

                Bitmap tile;
                synchronized (tiles) {
                    tile = tiles.get(key);
                }
                if (tile == null) {
                    scheduleTileFetch(key, wrapped, y);
                }

                int left = (int) (x * TILE_SIZE - cx + anchorX);
                int top = (int) (y * TILE_SIZE - cy + anchorY);

                if (tile == null) {
                    canvas.drawRect(left, top, left + TILE_SIZE, top + TILE_SIZE, fallback);
                } else {
                    canvas.drawBitmap(tile, null, new Rect(left, top, left + TILE_SIZE, top + TILE_SIZE), isDark ? darkTilePaint : null);
                }
            }
        }
    }

    private Bitmap fetchTile(int x, int y) {
        tileFetchAttempts++;

        // Carto now responds with a HTTP-200 image that says "API KEY REQUIRED".
        // Because it is still a decodable bitmap, the previous fallback never ran.
        // Android Auto must keep displaying an actual road map without a user API key.
        Bitmap bmp = downloadTile(String.format(Locale.US, OSM_URL, ZOOM, x, y));
        if (bmp != null) return bmp;

        tileFetchFailures++;
        return null;
    }

    private Bitmap downloadTile(String urlString) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(urlString).openConnection();
            c.setConnectTimeout(3500);
            c.setReadTimeout(4500);
            c.setRequestProperty("User-Agent", "MyWay-GPS Android Auto/1.0");
            c.setRequestProperty("Accept", "image/png,image/webp,image/*;q=0.8");
            if (c.getResponseCode() != HttpURLConnection.HTTP_OK) {
                return null;
            }
            try (InputStream input = c.getInputStream()) {
                return BitmapFactory.decodeStream(input);
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void scheduleTileFetch(final String key, final int x, final int y) {
        if (!pendingTiles.add(key)) return;
        tileExecutor.execute(() -> {
            try {
                Bitmap bitmap = fetchTile(x, y);
                if (bitmap != null) {
                    synchronized (tiles) {
                        tiles.put(key, bitmap);
                    }
                }
            } finally {
                pendingTiles.remove(key);
                trigger();
            }
        });
    }

    private void drawRoute(Canvas c, List<CarStateRepository.MapPoint> points, double cx, double cy, float anchorX, float anchorY) {
        Path path = new Path();
        boolean started = false;
        for (CarStateRepository.MapPoint point : points) {
            float x = (float) (worldX(point.lng) - cx + anchorX);
            float y = (float) (worldY(point.lat) - cy + anchorY);
            if (!started) {
                path.moveTo(x, y);
                started = true;
            } else {
                path.lineTo(x, y);
            }
        }
        c.drawPath(path, routeHalo);
        c.drawPath(path, routeCasing);
        c.drawPath(path, route);
    }

    private void drawIncidents(Canvas canvas, List<CarStateRepository.IncidentItem> incidents,
                               double cx, double cy, float anchorX, float anchorY, float mapRotation) {
        if (incidents == null || incidents.isEmpty()) return;

        Paint pillBg = paint("#EE0A0F1D", Paint.Style.FILL, 1);
        Paint pillBorder = paint("#33FFFFFF", Paint.Style.STROKE, 1.5f);
        pillBorder.setStrokeJoin(Paint.Join.ROUND);

        Paint titlePaint = paint("#FFFFFF", Paint.Style.FILL, 1);
        titlePaint.setTextSize(11);
        titlePaint.setFakeBoldText(true);

        Paint badgePaint = paint("#10B981", Paint.Style.FILL, 1);
        badgePaint.setTextSize(9);
        badgePaint.setFakeBoldText(true);

        float maxViewRadius = Math.max(width, height) * 1.6f;

        for (CarStateRepository.IncidentItem incident : incidents) {
            if (incident.lat == 0.0 && incident.lng == 0.0) continue;
            float ix = (float) (worldX(incident.lng) - cx + anchorX);
            float iy = (float) (worldY(incident.lat) - cy + anchorY);

            // Cull if offscreen
            if (Math.abs(ix - anchorX) > maxViewRadius || Math.abs(iy - anchorY) > maxViewRadius) continue;

            canvas.save();
            canvas.translate(ix, iy);
            if (mapRotation != 0f) {
                // Counter-rotate so badge and text remain upright to driver's eyes
                canvas.rotate(mapRotation);
            }

            // Pulsing halo
            try {
                Paint halo = paint(incident.color, Paint.Style.FILL, 1);
                halo.setAlpha(45);
                canvas.drawCircle(0, 0, 24, halo);
            } catch (Exception ignored) {}

            // Custom vector icon bitmap matching mobile styles
            Bitmap iconBmp = CarIncidentIconHelper.createIncidentIconBitmap(incident.type, 38);
            canvas.drawBitmap(iconBmp, -19, -19, null);

            // Pill tag label below icon
            String labelText = incident.title.toUpperCase(Locale.US);
            if (labelText.length() > 18) labelText = labelText.substring(0, 16) + "...";

            String statusBadge;
            int statusColor;
            if (incident.verified) {
                statusBadge = "VERIFIED";
                statusColor = Color.parseColor("#10B981");
            } else if (incident.isPermanent) {
                statusBadge = "NEEDS 1";
                statusColor = Color.parseColor("#F59E0B");
            } else {
                statusBadge = "+" + Math.max(1, incident.upvotes);
                statusColor = Color.parseColor("#38BDF8");
            }

            float textW = titlePaint.measureText(labelText);
            badgePaint.setColor(statusColor);
            float badgeW = badgePaint.measureText(statusBadge);
            float pillW = textW + badgeW + 20;
            float pillH = 18;
            float pillTop = 22;
            RectF pillRect = new RectF(-pillW / 2f, pillTop, pillW / 2f, pillTop + pillH);

            canvas.drawRoundRect(pillRect, 9, 9, pillBg);
            canvas.drawRoundRect(pillRect, 9, 9, pillBorder);

            canvas.drawText(labelText, -pillW / 2f + 7, pillTop + 13, titlePaint);
            canvas.drawText(statusBadge, -pillW / 2f + textW + 13, pillTop + 13, badgePaint);

            canvas.restore();
        }
    }

    private void drawVehiclePuck(Canvas c, float x, float y, boolean navigating) {
        // Soft drop shadow
        Paint shadow = paint("#50000000", Paint.Style.FILL, 1);
        c.drawCircle(x, y + 2, 22, shadow);

        if (navigating) {
            // Forward luminous vision cone
            Path cone = new Path();
            cone.moveTo(x - 14, y);
            cone.lineTo(x - 38, y - 75);
            cone.lineTo(x + 38, y - 75);
            cone.lineTo(x + 14, y);
            cone.close();
            Paint conePaint = paint("#1800F2FE", Paint.Style.FILL, 1);
            c.drawPath(cone, conePaint);
        }

        // Outer royal navy casing
        Paint casing = paint("#082F49", Paint.Style.FILL, 1);
        Path outerChevron = new Path();
        outerChevron.moveTo(x, y - 20);
        outerChevron.lineTo(x - 15, y + 14);
        outerChevron.lineTo(x, y + 7);
        outerChevron.lineTo(x + 15, y + 14);
        outerChevron.close();
        c.drawPath(outerChevron, casing);

        // Crisp white border
        Paint puckBorder = paint("#FFFFFF", Paint.Style.STROKE, 2.5f);
        puckBorder.setStrokeJoin(Paint.Join.ROUND);
        c.drawPath(outerChevron, puckBorder);

        // Electric cyan inner body
        Paint chevron = paint("#00F2FE", Paint.Style.FILL, 1);
        Path innerChevron = new Path();
        innerChevron.moveTo(x, y - 16);
        innerChevron.lineTo(x - 11, y + 10);
        innerChevron.lineTo(x, y + 5);
        innerChevron.lineTo(x + 11, y + 10);
        innerChevron.close();
        c.drawPath(innerChevron, chevron);

        // Center illuminated core
        Paint core = paint("#FFFFFF", Paint.Style.FILL, 1);
        c.drawCircle(x, y + 2, 3.5f, core);
    }

    private void drawDestination(Canvas c, float x, float y) {
        if (x < -100 || y < -100 || x > width + 100 || y > height + 100) return;
        c.drawCircle(x, y, 22, destinationHalo);
        c.drawCircle(x, y, 16, destination);
        c.drawCircle(x, y, 16, whiteStroke);
        c.drawCircle(x, y, 5, paint("#FFFFFF", Paint.Style.FILL, 1));
    }

    private void drawSavedPlacePins(Canvas c, List<CarStateRepository.SavedPlaceItem> places, double cx, double cy, float anchorX, float anchorY) {
        Paint label = paint("#17213E", Paint.Style.FILL, 1);
        label.setFakeBoldText(true);
        label.setTextSize(14);
        int count = Math.min(places.size(), 6);
        for (int i = 0; i < count; i++) {
            CarStateRepository.SavedPlaceItem place = places.get(i);
            float x = (float) (worldX(place.lng) - cx + anchorX);
            float y = (float) (worldY(place.lat) - cy + anchorY);
            if (x < -40 || y < -40 || x > width + 40 || y > height + 40) continue;
            c.drawCircle(x, y, 19, destination);
            c.drawCircle(x, y, 19, whiteStroke);
            c.drawCircle(x, y, 6, paint("#FFFFFF", Paint.Style.FILL, 1));
            String placeName = (place.name != null && !place.name.trim().isEmpty()) ? place.name.trim() : "Place";
            String fullLabel = placeName;
            if (place.address != null && !place.address.trim().isEmpty()) {
                String snippet = place.address.split(",")[0].trim();
                String cleanNameNorm = placeName.toLowerCase().replaceAll("[^a-z0-9]", "");
                String cleanSnippetNorm = snippet.toLowerCase().replaceAll("[^a-z0-9]", "");
                if (!cleanNameNorm.contains(cleanSnippetNorm) && !snippet.isEmpty()) {
                    fullLabel = placeName + " • " + snippet;
                }
            }
            String display = shorten(fullLabel, 28);
            float labelWidth = label.measureText(display) + 22;
            c.drawRoundRect(x + 18, y - 18, x + 18 + labelWidth, y + 12, 15, 15, paint("#F7F5FF", Paint.Style.FILL, 1));
            c.drawText(display, x + 29, y + 3, label);
        }
    }

    private void drawGuidance(Canvas c, CarStateRepository s, boolean isDark) {
        if (!s.isNavigating()) return;
        // Road-first layout: one clear next-maneuver card, rather than a
        // dashboard of destination and fuel details over the map.
        float left = 18, top = 18, right = width - 18, bottom = s.isArrived() ? 102 : 112;
        Paint card = isDark ? cardDark : cardLight;
        c.drawRoundRect(left, top, right, bottom, 22, 22, card);
        Paint accent = paint("#00F2FE", Paint.Style.FILL, 1);
        c.drawRoundRect(left, top, left + 7, bottom, 22, 22, accent);
        text.setTextSize(21);
        detail.setTextSize(15);
        if (s.isArrived()) {
            text.setColor(Color.parseColor("#5EEAD4"));
            c.drawText("MYWAY • ARRIVED", left + 24, top + 31, text);
            text.setColor(Color.WHITE);
            c.drawText(shorten(s.getDestinationName(), 38), left + 20, top + 65, text);
        } else {
            text.setColor(isDark ? Color.WHITE : Color.parseColor("#17213E"));
            drawManeuverGlyph(c, s.getCurrentInstruction(), left + 42, top + 59);
            String distance = s.getRemainingDistance().isEmpty() ? "Continue" : "In " + s.getRemainingDistance();
            detail.setColor(isDark ? Color.parseColor("#67E8F9") : Color.parseColor("#2563EB"));
            c.drawText(distance.toUpperCase(Locale.US), left + 80, top + 28, detail);
            text.setTextSize(23);
            c.drawText(shorten(s.getCurrentInstruction(), 38), left + 80, top + 63, text);
            detail.setColor(isDark ? Color.parseColor("#D7E1EF") : Color.parseColor("#475569"));
            String arrival = s.getEta().isEmpty() ? "" : "Arrive in " + s.getEta();
            if (!arrival.isEmpty()) c.drawText(arrival, left + 80, top + 88, detail);
        }
    }

    /** High-contrast maneuver symbol so a driver can scan the next action at a glance. */
    private void drawManeuverGlyph(Canvas canvas, String instruction, float x, float y) {
        String normalized = instruction == null ? "" : instruction.toLowerCase(Locale.US);
        Paint arrow = paint("#00B8D9", Paint.Style.STROKE, 5f);
        arrow.setStrokeCap(Paint.Cap.ROUND);
        arrow.setStrokeJoin(Paint.Join.ROUND);
        Path path = new Path();

        if (normalized.contains("u-turn") || normalized.contains("u turn")) {
            path.moveTo(x + 12, y + 22);
            path.lineTo(x + 12, y - 6);
            path.cubicTo(x + 12, y - 24, x - 16, y - 24, x - 16, y - 6);
            path.lineTo(x - 16, y + 3);
            path.moveTo(x - 16, y + 3);
            path.lineTo(x - 25, y - 6);
            path.moveTo(x - 16, y + 3);
            path.lineTo(x - 7, y - 6);
        } else if (normalized.contains("left")) {
            path.moveTo(x + 14, y + 22);
            path.lineTo(x + 14, y - 3);
            path.quadTo(x + 14, y - 14, x + 3, y - 14);
            path.lineTo(x - 16, y - 14);
            path.moveTo(x - 16, y - 14);
            path.lineTo(x - 7, y - 23);
            path.moveTo(x - 16, y - 14);
            path.lineTo(x - 7, y - 5);
        } else if (normalized.contains("right")) {
            path.moveTo(x - 14, y + 22);
            path.lineTo(x - 14, y - 3);
            path.quadTo(x - 14, y - 14, x - 3, y - 14);
            path.lineTo(x + 16, y - 14);
            path.moveTo(x + 16, y - 14);
            path.lineTo(x + 7, y - 23);
            path.moveTo(x + 16, y - 14);
            path.lineTo(x + 7, y - 5);
        } else {
            path.moveTo(x, y + 22);
            path.lineTo(x, y - 18);
            path.moveTo(x, y - 18);
            path.lineTo(x - 9, y - 9);
            path.moveTo(x, y - 18);
            path.lineTo(x + 9, y - 9);
        }
        canvas.drawPath(path, arrow);
    }

    private void drawStalePhoneWarning(Canvas c, boolean isDark) {
        float top = height - 76;
        Paint card = isDark ? cardDark : cardLight;
        c.drawRoundRect(18, top, width - 18, height - 30, 14, 14, card);
        text.setTextSize(15);
        detail.setTextSize(12);
        c.drawText("Waiting for phone update", 34, top + 23, text);
        c.drawText("Keep MyWay open on your phone to continue guidance.", 34, top + 40, detail);
    }


    private void drawTileError(Canvas c, boolean isDark) {
        float top = height - 76;
        Paint card = isDark ? cardDark : cardLight;
        c.drawRoundRect(18, top, width - 18, height - 30, 14, 14, card);
        text.setTextSize(15);
        detail.setTextSize(12);
        c.drawText("Map data unavailable", 34, top + 23, text);
        c.drawText("Check your phone data connection.", 34, top + 40, detail);
    }

    private static String shorten(String value, int maximum) {
        if (value == null || value.trim().isEmpty()) return "Follow highlighted route";
        String clean = value.trim();
        return clean.length() > maximum ? clean.substring(0, maximum - 3) + "..." : clean;
    }

    private static double worldX(double lng) {
        return ((lng + 180d) / 360d) * TILE_SIZE * (1 << ZOOM);
    }

    private static double worldY(double lat) {
        double value = Math.max(-85.05112878, Math.min(85.05112878, lat));
        double radians = Math.toRadians(value);
        return (1d - Math.log(Math.tan(radians) + 1d / Math.cos(radians)) / Math.PI) / 2d * TILE_SIZE * (1 << ZOOM);
    }
}
