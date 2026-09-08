package com.mywaygps.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.Shader;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.view.Surface;

import androidx.annotation.Nullable;

/**
 * Native Hardware Map Surface Renderer for Android Auto.
 * Renders a 3D-perspective vector navigation corridor directly onto the vehicle's
 * hardware rendering canvas via SurfaceCallback.
 *
 * Visual Components:
 * 1. Deep Midnight Asphalt Ground & Horizon Sky Gradient
 * 2. 3D Perspective Road Grid & Lane Dividers
 * 3. Vibrant Cyan Route Polyline with Directional Chevrons
 * 4. Pulsing Vehicle Puck with Directional Heading Arrow
 * 5. Destination Beacon / Arrival Marker
 * 6. Speed Limit & Telemetry Badge
 */
public class CarMapSurfaceRenderer implements CarStateRepository.Listener {
    private static final String TAG = "CarMapSurfaceRenderer";

    private Surface surface;
    private int surfaceWidth = 800;
    private int surfaceHeight = 480;
    private Rect visibleArea = new Rect();
    private Rect stableArea = new Rect();

    private HandlerThread renderThread;
    private Handler renderHandler;
    private volatile boolean isRunning = false;
    private float animationPulse = 0.0f;
    private float routeOffset = 0.0f;

    // Drawing Paints
    private final Paint skyPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint groundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint roadPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint roadEdgePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint lanePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint routeGlowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint routeCorePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint vehiclePuckPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint vehiclePulsePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint vehicleArrowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint destPinPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint badgeBgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint badgeTextPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    public CarMapSurfaceRenderer() {
        initPaints();
        CarStateRepository.getInstance().addListener(this);
    }

    private void initPaints() {
        groundPaint.setColor(Color.parseColor("#0B1120")); // Deep slate/black
        groundPaint.setStyle(Paint.Style.FILL);

        roadPaint.setColor(Color.parseColor("#1E293B")); // Dark asphalt corridor
        roadPaint.setStyle(Paint.Style.FILL);

        roadEdgePaint.setColor(Color.parseColor("#334155"));
        roadEdgePaint.setStyle(Paint.Style.STROKE);
        roadEdgePaint.setStrokeWidth(4.0f);

        lanePaint.setColor(Color.parseColor("#FACC15")); // Yellow divider
        lanePaint.setStyle(Paint.Style.STROKE);
        lanePaint.setStrokeWidth(3.0f);

        routeGlowPaint.setColor(Color.parseColor("#4D06B6D4")); // Cyan glow
        routeGlowPaint.setStyle(Paint.Style.STROKE);
        routeGlowPaint.setStrokeWidth(28.0f);
        routeGlowPaint.setStrokeCap(Paint.Cap.ROUND);

        routeCorePaint.setColor(Color.parseColor("#00F0FF")); // Core cyan line
        routeCorePaint.setStyle(Paint.Style.STROKE);
        routeCorePaint.setStrokeWidth(12.0f);
        routeCorePaint.setStrokeCap(Paint.Cap.ROUND);

        vehiclePulsePaint.setColor(Color.parseColor("#6600F0FF"));
        vehiclePulsePaint.setStyle(Paint.Style.STROKE);
        vehiclePulsePaint.setStrokeWidth(4.0f);

        vehiclePuckPaint.setColor(Color.parseColor("#0284C7")); // Sky cyan
        vehiclePuckPaint.setStyle(Paint.Style.FILL);

        vehicleArrowPaint.setColor(Color.WHITE);
        vehicleArrowPaint.setStyle(Paint.Style.FILL_AND_STROKE);
        vehicleArrowPaint.setStrokeWidth(2.0f);

        destPinPaint.setColor(Color.parseColor("#EF4444")); // Red pin
        destPinPaint.setStyle(Paint.Style.FILL);

        textPaint.setColor(Color.parseColor("#94A3B8"));
        textPaint.setTextSize(22.0f);
        textPaint.setFakeBoldText(true);

        badgeBgPaint.setColor(Color.parseColor("#D90F172A"));
        badgeBgPaint.setStyle(Paint.Style.FILL);

        badgeTextPaint.setColor(Color.WHITE);
        badgeTextPaint.setTextSize(26.0f);
        badgeTextPaint.setFakeBoldText(true);
    }

    public synchronized void onSurfaceAvailable(Surface surface, int width, int height) {
        this.surface = surface;
        this.surfaceWidth = Math.max(width, 600);
        this.surfaceHeight = Math.max(height, 400);

        startRenderingLoop();
    }

    public synchronized void onVisibleAreaChanged(Rect visibleArea) {
        if (visibleArea != null) {
            this.visibleArea.set(visibleArea);
        }
        triggerFrame();
    }

    public synchronized void onStableAreaChanged(Rect stableArea) {
        if (stableArea != null) {
            this.stableArea.set(stableArea);
        }
        triggerFrame();
    }

    public synchronized void onSurfaceDestroyed() {
        stopRenderingLoop();
        this.surface = null;
    }

    public synchronized void release() {
        stopRenderingLoop();
        CarStateRepository.getInstance().removeListener(this);
        this.surface = null;
    }

    public void recenter() {
        triggerFrame();
    }

    @Override
    public void onNavigationStateChanged() {
        triggerFrame();
    }

    @Override
    public void onSavedPlacesChanged() {
        triggerFrame();
    }

    private void startRenderingLoop() {
        stopRenderingLoop();

        renderThread = new HandlerThread("CarMapSurfaceRenderThread");
        renderThread.start();
        renderHandler = new Handler(renderThread.getLooper());
        isRunning = true;

        renderHandler.post(renderRunnable);
    }

    private void stopRenderingLoop() {
        isRunning = false;
        if (renderHandler != null) {
            renderHandler.removeCallbacksAndMessages(null);
        }
        if (renderThread != null) {
            renderThread.quitSafely();
            renderThread = null;
        }
    }

    private void triggerFrame() {
        if (isRunning && renderHandler != null) {
            renderHandler.removeCallbacks(renderRunnable);
            renderHandler.post(renderRunnable);
        }
    }

    private final Runnable renderRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isRunning || surface == null || !surface.isValid()) {
                return;
            }

            drawFrame();

            // Animate continuous pulse & route animation at ~30 FPS
            if (isRunning) {
                animationPulse = (animationPulse + 0.05f) % 1.0f;
                routeOffset = (routeOffset + 2.0f) % 40.0f;
                renderHandler.postDelayed(this, 33);
            }
        }
    };

    private void drawFrame() {
        Surface s = surface;
        if (s == null || !s.isValid()) return;

        Canvas canvas = null;
        try {
            canvas = s.lockCanvas(null);
            if (canvas == null) return;

            renderScene(canvas);
        } catch (Exception e) {
            Log.w(TAG, "Error drawing onto hardware surface: " + e.getMessage());
        } finally {
            if (canvas != null && s.isValid()) {
                try {
                    s.unlockCanvasAndPost(canvas);
                } catch (Exception ignored) {}
            }
        }
    }

    private void renderScene(Canvas canvas) {
        int w = surfaceWidth;
        int h = surfaceHeight;
        float horizonY = h * 0.32f;

        // 1. Sky / Horizon
        skyPaint.setShader(new LinearGradient(
                0, 0, 0, horizonY,
                Color.parseColor("#030712"), Color.parseColor("#0F172A"),
                Shader.TileMode.CLAMP
        ));
        canvas.drawRect(0, 0, w, horizonY, skyPaint);

        // 2. Ground plane
        canvas.drawRect(0, horizonY, w, h, groundPaint);

        // 3. 3D Perspective Road Mesh
        float roadTopWidth = w * 0.22f;
        float roadBottomWidth = w * 0.76f;
        float centerX = w * 0.5f;

        Path roadPath = new Path();
        roadPath.moveTo(centerX - roadTopWidth / 2, horizonY);
        roadPath.lineTo(centerX + roadTopWidth / 2, horizonY);
        roadPath.lineTo(centerX + roadBottomWidth / 2, h);
        roadPath.lineTo(centerX - roadBottomWidth / 2, h);
        roadPath.close();

        canvas.drawPath(roadPath, roadPaint);
        canvas.drawPath(roadPath, roadEdgePaint);

        // 4. Dashed Center Lane Dividers
        int dashCount = 8;
        for (int i = 0; i < dashCount; i++) {
            float progress = (float) i / dashCount;
            // Perspective easing
            float y1 = horizonY + (h - horizonY) * (progress * progress);
            float nextProg = (float) (i + 0.5f) / dashCount;
            float y2 = horizonY + (h - horizonY) * (nextProg * nextProg);

            lanePaint.setStrokeWidth(2.0f + (progress * 5.0f));
            canvas.drawLine(centerX, y1, centerX, y2, lanePaint);
        }

        CarStateRepository repo = CarStateRepository.getInstance();
        boolean isNav = repo.isNavigating();
        boolean isArrived = repo.isArrived();

        // 5. Active Route Polyline (When Navigating)
        if (isNav) {
            Path routePath = new Path();
            routePath.moveTo(centerX, h * 0.82f);

            if (isArrived) {
                // Short destination target line
                routePath.lineTo(centerX, h * 0.48f);
            } else {
                // Extended navigation line into perspective horizon
                routePath.cubicTo(
                        centerX, h * 0.65f,
                        centerX + (float) Math.sin(routeOffset * 0.05f) * 40.0f, h * 0.50f,
                        centerX, horizonY + 20
                );
            }

            canvas.drawPath(routePath, routeGlowPaint);
            canvas.drawPath(routePath, routeCorePaint);
        }

        // 6. Vehicle Puck (Near bottom center of road)
        float vehicleX = centerX;
        float vehicleY = h * 0.78f;

        // Pulsing ring
        float pulseRadius = 24.0f + (animationPulse * 28.0f);
        vehiclePulsePaint.setAlpha((int) ((1.0f - animationPulse) * 180));
        canvas.drawCircle(vehicleX, vehicleY, pulseRadius, vehiclePulsePaint);

        // Vehicle Base Circle
        canvas.drawCircle(vehicleX, vehicleY, 20.0f, vehiclePuckPaint);
        Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        borderPaint.setColor(Color.WHITE);
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(3.5f);
        canvas.drawCircle(vehicleX, vehicleY, 20.0f, borderPaint);

        // Vehicle Heading Triangle
        Path arrowPath = new Path();
        arrowPath.moveTo(vehicleX, vehicleY - 14.0f);
        arrowPath.lineTo(vehicleX - 8.0f, vehicleY + 8.0f);
        arrowPath.lineTo(vehicleX, vehicleY + 3.0f);
        arrowPath.lineTo(vehicleX + 8.0f, vehicleY + 8.0f);
        arrowPath.close();
        canvas.drawPath(arrowPath, vehicleArrowPaint);

        // 7. Destination / Arrival Pin
        if (isNav) {
            float destX = centerX;
            float destY = isArrived ? (h * 0.46f) : (horizonY + 30);

            if (isArrived) {
                // Green arrival target
                Paint greenPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                greenPaint.setColor(Color.parseColor("#10B981"));
                greenPaint.setStyle(Paint.Style.FILL);
                canvas.drawCircle(destX, destY, 28.0f, greenPaint);

                Paint checkPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                checkPaint.setColor(Color.WHITE);
                checkPaint.setStyle(Paint.Style.STROKE);
                checkPaint.setStrokeWidth(4.5f);
                checkPaint.setStrokeCap(Paint.Cap.ROUND);

                Path checkPath = new Path();
                checkPath.moveTo(destX - 10.0f, destY);
                checkPath.lineTo(destX - 3.0f, destY + 7.0f);
                checkPath.lineTo(destX + 11.0f, destY - 7.0f);
                canvas.drawPath(checkPath, checkPaint);
            } else {
                // Glowing destination pin
                canvas.drawCircle(destX, destY, 14.0f, destPinPaint);
                Paint pinGlow = new Paint(Paint.ANTI_ALIAS_FLAG);
                pinGlow.setColor(Color.parseColor("#4DEF4444"));
                canvas.drawCircle(destX, destY, 24.0f, pinGlow);
            }
        }

        // 8. Surface Telemetry / Speed Badge (Bottom Right)
        if (isNav) {
            int speed = repo.getSpeedMph();
            int limit = repo.getSpeedLimit();

            float badgeWidth = 140.0f;
            float badgeHeight = 70.0f;
            float badgeX = w - badgeWidth - 24.0f;
            float badgeY = h - badgeHeight - 24.0f;

            canvas.drawRoundRect(badgeX, badgeY, badgeX + badgeWidth, badgeY + badgeHeight, 16.0f, 16.0f, badgeBgPaint);

            badgeTextPaint.setColor(Color.WHITE);
            badgeTextPaint.setTextSize(28.0f);
            canvas.drawText(speed + " MPH", badgeX + 16.0f, badgeY + 34.0f, badgeTextPaint);

            badgeTextPaint.setTextSize(14.0f);
            badgeTextPaint.setColor(Color.parseColor("#94A3B8"));
            String limitStr = limit > 0 ? ("LIMIT " + limit) : "MYWAY 3D";
            canvas.drawText(limitStr, badgeX + 16.0f, badgeY + 56.0f, badgeTextPaint);
        }

        // 9. Watermark
        textPaint.setTextSize(14.0f);
        canvas.drawText("MyWay 3D Native GPS Surface", 24.0f, h - 24.0f, textPaint);
    }
}
