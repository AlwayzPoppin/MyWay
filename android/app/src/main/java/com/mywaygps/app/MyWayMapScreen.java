package com.mywaygps.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.DateTimeWithZone;
import androidx.car.app.model.Distance;
import androidx.car.app.model.Template;
import androidx.car.app.navigation.model.Destination;
import androidx.car.app.navigation.NavigationManager;
import androidx.car.app.navigation.NavigationManagerCallback;
import androidx.car.app.navigation.model.NavigationTemplate;
import androidx.car.app.navigation.model.RoutingInfo;
import androidx.car.app.navigation.model.Step;
import androidx.car.app.navigation.model.TravelEstimate;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import java.util.TimeZone;

/**
 * Android Auto Native Navigation Screen.
 *
 * Renders a NavigationTemplate projecting the active route, turn-by-turn instruction,
 * distance remaining, and hardware map surface directly to the vehicle's infotainment display.
 *
 * Configured with:
 * 1. Action Strip: Red "X" button to cancel or stop navigation.
 * 2. Routing Info: Turn-by-turn guidance and distance remaining.
 * 3. Arrival State: Dynamically switches text and cues to "Arrived!" upon reaching the 150m geofence.
 * 4. Hardware Map Surface: Rendered in background via MyWayCarSession SurfaceCallback.
 */
public class MyWayMapScreen extends Screen implements CarStateRepository.Listener {
    private boolean navigationLifecycleActive = false;

    public MyWayMapScreen(@NonNull CarContext carContext) {
        super(carContext);
        CarStateRepository.getInstance().addListener(this);
        NavigationManager navigationManager = getCarContext().getCarService(NavigationManager.class);
        navigationManager.setNavigationManagerCallback(new NavigationManagerCallback() {
            @Override
            public void onStopNavigation() {
                // Keep the phone route and Android Auto navigation focus in sync.
                NativeAndroidAutoPlugin.notifyNavigationCancelledFromCar();
            }
        });

        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override
            public void onDestroy(@NonNull LifecycleOwner owner) {
                endNavigationLifecycle();
                try {
                    getCarContext().getCarService(NavigationManager.class)
                            .clearNavigationManagerCallback();
                } catch (Exception ignored) {
                    // The car host may already be disconnected during teardown.
                }
                CarStateRepository.getInstance().removeListener(MyWayMapScreen.this);
            }
        });
    }

    @Override
    public void onNavigationStateChanged() {
        // Android Auto must be told that this is an active navigation session.
        // Updating a NavigationTemplate alone leaves the host in an idle state,
        // which is why a phone-started My Way trip did not take over the car UI.
        getCarContext().getMainExecutor().execute(() -> {
            updateNavigationLifecycle(CarStateRepository.getInstance().isNavigating());
            invalidate();
        });
    }

    @Override
    public void onSavedPlacesChanged() {
        invalidate();
    }

    @Override
    public void onIncidentsChanged() {
        getCarContext().getMainExecutor().execute(this::invalidate);
    }

    @Override
    public void onMapSkinChanged() {
        getCarContext().getMainExecutor().execute(this::invalidate);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        CarStateRepository repo = CarStateRepository.getInstance();
        updateNavigationLifecycle(repo.isNavigating());
        NavigationTemplate.Builder navBuilder = new NavigationTemplate.Builder();

        // 1. Action Strip: Navigation & Alert controls
        ActionStrip.Builder actionStripBuilder = new ActionStrip.Builder();

        if (repo.isNavigating()) {
            actionStripBuilder.addAction(
                    new Action.Builder()
                            .setTitle("Add stop")
                            .setIcon(createSearchIcon(getCarContext()))
                            .setOnClickListener(() -> getScreenManager().push(new CarSearchScreen(getCarContext(), true)))
                            .build()
            );
            if (repo.getRouteOptions().size() > 1) {
                actionStripBuilder.addAction(
                        new Action.Builder()
                                .setTitle("Routes")
                                .setIcon(createRoutesIcon(getCarContext()))
                                .setOnClickListener(() -> getScreenManager().push(new CarRouteOptionsScreen(getCarContext())))
                                .build()
                );
            }
            if (!repo.getIncidents().isEmpty()) {
                actionStripBuilder.addAction(
                        new Action.Builder()
                                .setTitle("Alerts (" + repo.getIncidents().size() + ")")
                                .setIcon(createAlertsIcon(getCarContext()))
                                .setOnClickListener(() -> getScreenManager().push(new CarAlertsScreen(getCarContext())))
                                .build()
                );
            }
            Action cancelAction = new Action.Builder()
                    .setTitle("Cancel")
                    .setIcon(createRedXIcon(getCarContext()))
                    .setOnClickListener(() -> {
                        // User pressed red "X" button on the vehicle screen:
                        // Stop car navigation and notify React/Capacitor app to terminate active route
                        NativeAndroidAutoPlugin.notifyNavigationCancelledFromCar();
                        invalidate();
                    })
                    .build();
            actionStripBuilder.addAction(cancelAction);
        } else {
            // Idle state: Explore saved places & recent trips
            actionStripBuilder.addAction(
                    new Action.Builder()
                            .setTitle("Explore")
                            .setIcon(CarIcon.APP_ICON)
                            .setOnClickListener(() -> {
                                getScreenManager().push(new CarIdleScreen(getCarContext()));
                            })
                            .build()
            );
            // Search for a destination from the car
            actionStripBuilder.addAction(
                    new Action.Builder()
                            .setTitle("Search")
                            .setIcon(createSearchIcon(getCarContext()))
                            .setOnClickListener(() -> {
                                getScreenManager().push(new CarSearchScreen(getCarContext()));
                            })
                            .build()
            );
            if (!repo.getIncidents().isEmpty()) {
                actionStripBuilder.addAction(
                        new Action.Builder()
                                .setTitle("Alerts (" + repo.getIncidents().size() + ")")
                                .setIcon(createAlertsIcon(getCarContext()))
                                .setOnClickListener(() -> getScreenManager().push(new CarAlertsScreen(getCarContext())))
                                .build()
                );
            }
        }
        navBuilder.setActionStrip(actionStripBuilder.build());

        // Map Action Strip: Recenter Camera / Compass button
        ActionStrip mapActionStrip = new ActionStrip.Builder()
                .addAction(
                        new Action.Builder()
                                .setIcon(createRecenterIcon(getCarContext()))
                                .setOnClickListener(() -> {
                                    MyWayCarSession.recenterMap();
                                })
                                .build()
                )
                .build();
        navBuilder.setMapActionStrip(mapActionStrip);

        // 2. Routing Info & Arrival Geofence State
        if (repo.isNavigating()) {
            boolean isArrived = repo.isArrived() || "Arrived!".equalsIgnoreCase(repo.getCurrentInstruction());

            if (isArrived) {
                // User has reached the 150-meter arrival geofence:
                // Project celebratory "Arrived!" step and destination confirmation
                Step arrivalStep = new Step.Builder("Arrived!")
                        .setCue("Arrived at " + repo.getDestinationName())
                        .build();

                RoutingInfo arrivalRouting = new RoutingInfo.Builder()
                        .setCurrentStep(arrivalStep, Distance.create(0, Distance.UNIT_METERS))
                        .build();

                navBuilder.setNavigationInfo(arrivalRouting);

                // Zeroed out travel estimate for arrival
                navBuilder.setDestinationTravelEstimate(
                        new TravelEstimate.Builder(
                                Distance.create(0, Distance.UNIT_METERS),
                                DateTimeWithZone.create(System.currentTimeMillis(), TimeZone.getDefault())
                        ).build()
                );
            } else {
                // Actively navigating: Display current step instruction and distance remaining
                String instruction = repo.getCurrentInstruction();
                if (instruction.isEmpty()) {
                    instruction = "Follow highlighted route";
                }

                String remainingDistStr = repo.getRemainingDistance();
                Distance distance = parseDistanceFromString(remainingDistStr);

                Step currentStep = new Step.Builder(instruction)
                        .setCue("Destination: " + repo.getDestinationName())
                        .build();

                RoutingInfo routingInfo = new RoutingInfo.Builder()
                        .setCurrentStep(currentStep, distance)
                        .build();

                navBuilder.setNavigationInfo(routingInfo);

                // Travel Estimate (Remaining Distance + Arrival Clock Time)
                long etaMillis = parseEtaToMillis(repo.getEta());
                navBuilder.setDestinationTravelEstimate(
                        new TravelEstimate.Builder(
                                distance,
                                DateTimeWithZone.create(
                                        System.currentTimeMillis() + Math.max(0, etaMillis),
                                        TimeZone.getDefault()
                                )
                        ).build()
                );
            }
        }

        return navBuilder.build();
    }

    /**
     * Keeps Android Auto's navigation focus in step with the route owned by the
     * phone app. This is intentionally idempotent because telemetry arrives on
     * every GPS tick while a trip is active.
     */
    private void updateNavigationLifecycle(boolean shouldNavigate) {
        if (shouldNavigate == navigationLifecycleActive) {
            return;
        }
        try {
            NavigationManager navigationManager = getCarContext().getCarService(NavigationManager.class);
            if (shouldNavigate) {
                navigationManager.navigationStarted();
            } else {
                navigationManager.navigationEnded();
            }
            navigationLifecycleActive = shouldNavigate;
        } catch (Exception exception) {
            // A host can briefly be unavailable while ZPlus/Android Auto is
            // connecting. The next telemetry refresh retries safely.
            android.util.Log.w("MyWayMapScreen", "Unable to update Android Auto navigation lifecycle", exception);
        }
    }

    private void endNavigationLifecycle() {
        if (!navigationLifecycleActive) {
            return;
        }
        try {
            getCarContext().getCarService(NavigationManager.class).navigationEnded();
        } catch (Exception ignored) {
            // The host may already be disconnected during session teardown.
        }
        navigationLifecycleActive = false;
    }

    /**
     * Creates a crisp red circular "X" cancel icon for the vehicle action strip.
     */
    private static CarIcon createRedXIcon(Context context) {
        try {
            int size = 96;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);

            // Red circular background
            Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            bgPaint.setColor(Color.parseColor("#EF4444")); // Tailwind Red-500
            canvas.drawCircle(size / 2.0f, size / 2.0f, (size / 2.0f) - 4, bgPaint);

            // Crisp White "X" crosslines
            Paint xPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            xPaint.setColor(Color.WHITE);
            xPaint.setStrokeWidth(9.0f);
            xPaint.setStrokeCap(Paint.Cap.ROUND);

            float inset = 30.0f;
            canvas.drawLine(inset, inset, size - inset, size - inset, xPaint);
            canvas.drawLine(size - inset, inset, inset, size - inset, xPaint);

            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.ERROR;
        }
    }

    /**
     * Creates a high-contrast crosshair / recenter camera icon for the map strip.
     */
    private static CarIcon createRecenterIcon(Context context) {
        try {
            int size = 72;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);

            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.parseColor("#00F0FF"));
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(4.0f);

            float center = size / 2.0f;
            canvas.drawCircle(center, center, 20.0f, paint);

            paint.setStrokeWidth(3.0f);
            canvas.drawLine(center, 4, center, 14, paint);
            canvas.drawLine(center, size - 14, center, size - 4, paint);
            canvas.drawLine(4, center, 14, center, paint);
            canvas.drawLine(size - 14, center, size - 4, center, paint);

            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.APP_ICON;
        }
    }

    /** Creates a high-contrast route-choice glyph for the car action strip. */
    private static CarIcon createRoutesIcon(Context context) {
        try {
            int size = 72;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.parseColor("#A78BFA"));
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(6.0f);
            paint.setStrokeCap(Paint.Cap.ROUND);
            canvas.drawLine(18, 18, 54, 18, paint);
            canvas.drawLine(18, 18, 18, 54, paint);
            canvas.drawLine(18, 54, 54, 54, paint);
            canvas.drawLine(54, 18, 54, 54, paint);
            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.APP_ICON;
        }
    }

    /** Creates a teal magnifying-glass search icon for the idle action strip. */
    private static CarIcon createSearchIcon(Context context) {
        try {
            int size = 72;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.parseColor("#00F0FF"));
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(5.0f);
            canvas.drawCircle(30, 30, 16, paint);
            paint.setStrokeCap(Paint.Cap.ROUND);
            canvas.drawLine(42, 42, 58, 58, paint);
            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.APP_ICON;
        }
    }

    /** Creates an amber alert badge icon for the road alerts action. */
    private static CarIcon createAlertsIcon(Context context) {
        try {
            int size = 72;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);

            Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
            bg.setColor(Color.parseColor("#f59e0b"));
            canvas.drawRoundRect(new android.graphics.RectF(4, 4, size - 4, size - 4), 16, 16, bg);

            Paint iconPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            iconPaint.setColor(Color.WHITE);
            iconPaint.setStyle(Paint.Style.STROKE);
            iconPaint.setStrokeWidth(5.0f);
            iconPaint.setStrokeCap(Paint.Cap.ROUND);

            // Warning triangle
            android.graphics.Path path = new android.graphics.Path();
            path.moveTo(size * 0.5f, 16);
            path.lineTo(size - 16, size - 16);
            path.lineTo(16, size - 16);
            path.close();
            canvas.drawPath(path, iconPaint);

            // Exclamation mark
            canvas.drawLine(size * 0.5f, 29, size * 0.5f, 41, iconPaint);
            iconPaint.setStyle(Paint.Style.FILL);
            canvas.drawCircle(size * 0.5f, 48, 3.0f, iconPaint);

            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.APP_ICON;
        }
    }

    /**
     * Parse human-readable distance strings (e.g. "2.5 mi", "800 ft", "1.2 km") into
     * Android Auto Distance instances.
     */
    private Distance parseDistanceFromString(String distStr) {
        if (distStr == null || distStr.trim().isEmpty()) {
            return Distance.create(0, Distance.UNIT_METERS);
        }

        String lower = distStr.toLowerCase().trim();
        try {
            if (lower.contains("mi")) {
                double miles = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                return Distance.create(miles, Distance.UNIT_MILES);
            } else if (lower.contains("km")) {
                double km = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                return Distance.create(km, Distance.UNIT_KILOMETERS);
            } else if (lower.contains("ft")) {
                double feet = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                return Distance.create(feet * 0.3048, Distance.UNIT_METERS);
            } else if (lower.contains("m")) {
                double meters = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                return Distance.create(meters, Distance.UNIT_METERS);
            } else {
                double val = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                return Distance.create(val, Distance.UNIT_METERS);
            }
        } catch (NumberFormatException e) {
            return Distance.create(0, Distance.UNIT_METERS);
        }
    }

    /**
     * Parse ETA duration strings (e.g. "15 min", "1 hr 20 min") into milliseconds.
     */
    private long parseEtaToMillis(String eta) {
        if (eta == null || eta.trim().isEmpty()) return 0;

        long totalMs = 0;
        String lower = eta.toLowerCase().trim();

        try {
            java.util.regex.Matcher hrMatcher = java.util.regex.Pattern.compile("(\\d+)\\s*h").matcher(lower);
            if (hrMatcher.find()) {
                totalMs += Long.parseLong(hrMatcher.group(1)) * 3600000L;
            }
            java.util.regex.Matcher minMatcher = java.util.regex.Pattern.compile("(\\d+)\\s*m").matcher(lower);
            if (minMatcher.find()) {
                totalMs += Long.parseLong(minMatcher.group(1)) * 60000L;
            }
            if (totalMs == 0) {
                double val = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                totalMs = (long) (val * 60000L);
            }
        } catch (Exception ignored) {}

        return totalMs;
    }
}
