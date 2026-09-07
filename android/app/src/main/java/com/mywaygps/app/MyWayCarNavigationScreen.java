package com.mywaygps.app;

import android.text.SpannableString;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.CarText;
import androidx.car.app.model.Distance;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.Pane;
import androidx.car.app.model.PaneTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.car.app.navigation.model.Destination;
import androidx.car.app.navigation.model.MessageInfo;
import androidx.car.app.navigation.model.NavigationTemplate;
import androidx.car.app.navigation.model.RoutingInfo;
import androidx.car.app.navigation.model.Step;
import androidx.core.graphics.drawable.IconCompat;

import java.util.List;

/**
 * The primary screen displayed on the Android Auto head unit.
 *
 * When navigating: Shows a NavigationTemplate with destination, ETA,
 * remaining distance, and current maneuver instruction.
 *
 * When idle: Shows a PaneTemplate with quick-access saved destinations
 * (Home, Work, etc.) and a "Open Phone" action.
 */
public class MyWayCarNavigationScreen extends Screen implements CarStateRepository.Listener {

    public MyWayCarNavigationScreen(@NonNull CarContext carContext) {
        super(carContext);
        CarStateRepository.getInstance().addListener(this);
    }

    @Override
    public void onNavigationStateChanged() {
        // Re-render the template when navigation telemetry updates
        invalidate();
    }

    @Override
    public void onSavedPlacesChanged() {
        // Re-render when saved places list changes
        invalidate();
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        CarStateRepository repo = CarStateRepository.getInstance();

        if (repo.isNavigating()) {
            return buildNavigationTemplate(repo);
        } else {
            return buildIdleTemplate(repo);
        }
    }

    /**
     * Builds the active navigation template projected onto the car display.
     */
    private Template buildNavigationTemplate(CarStateRepository repo) {
        String destName = repo.getDestinationName();
        String eta = repo.getEta();
        String remainDist = repo.getRemainingDistance();
        String instruction = repo.getCurrentInstruction();
        int speed = repo.getSpeedMph();

        // Build the current navigation step
        Step.Builder stepBuilder = new Step.Builder(instruction);

        // Build routing info with destination and step
        RoutingInfo.Builder routingBuilder = new RoutingInfo.Builder()
                .setCurrentStep(stepBuilder.build(), parseDistanceFromString(remainDist));

        // Build the navigation template
        NavigationTemplate.Builder navBuilder = new NavigationTemplate.Builder()
                .setNavigationInfo(routingBuilder.build())
                .setDestinationTravelEstimate(
                        new androidx.car.app.navigation.model.TravelEstimate.Builder(
                                parseDistanceFromString(remainDist),
                                androidx.car.app.model.DateTimeWithZone.create(
                                        System.currentTimeMillis() + parseEtaToMillis(eta),
                                        java.util.TimeZone.getDefault()
                                )
                        ).build()
                );

        // Action strip with stop navigation button
        navBuilder.setActionStrip(
                new ActionStrip.Builder()
                        .addAction(
                                new Action.Builder()
                                        .setTitle("Stop")
                                        .setOnClickListener(() -> {
                                            CarStateRepository.getInstance().stopNavigation();
                                        })
                                        .build()
                        )
                        .build()
        );

        return navBuilder.build();
    }

    /**
     * Builds the idle (non-navigating) template showing saved destinations.
     */
    private Template buildIdleTemplate(CarStateRepository repo) {
        List<CarStateRepository.SavedPlaceItem> places = repo.getSavedPlaces();

        Pane.Builder paneBuilder = new Pane.Builder();

        if (places.isEmpty()) {
            paneBuilder.addRow(
                    new Row.Builder()
                            .setTitle("MyWay GPS")
                            .addText("Open MyWay on your phone to start navigating.")
                            .build()
            );
        } else {
            // Show up to 4 saved places (Android Auto template row limit)
            int limit = Math.min(places.size(), 4);
            for (int i = 0; i < limit; i++) {
                CarStateRepository.SavedPlaceItem place = places.get(i);
                String subtitle = place.address.isEmpty()
                        ? String.format("%.4f, %.4f", place.lat, place.lng)
                        : place.address;

                paneBuilder.addRow(
                        new Row.Builder()
                                .setTitle(place.name)
                                .addText(subtitle)
                                .build()
                );
            }
        }

        // Add "Open Phone" action
        paneBuilder.addAction(
                new Action.Builder()
                        .setTitle("Open Phone")
                        .setOnClickListener(() -> {
                            // No-op on car; user opens phone manually
                        })
                        .build()
        );

        return new PaneTemplate.Builder(paneBuilder.build())
                .setTitle("MyWay")
                .setHeaderAction(Action.APP_ICON)
                .build();
    }

    /**
     * Parse a human-readable distance string like "2.5 mi" or "800 ft" into
     * an Android Auto Distance object. Falls back to 0 meters if unparseable.
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
                // Default: assume meters
                double val = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                return Distance.create(val, Distance.UNIT_METERS);
            }
        } catch (NumberFormatException e) {
            return Distance.create(0, Distance.UNIT_METERS);
        }
    }

    /**
     * Parse an ETA string like "12 min" or "1 hr 30 min" into milliseconds offset.
     */
    private long parseEtaToMillis(String eta) {
        if (eta == null || eta.trim().isEmpty()) return 0;

        long totalMs = 0;
        String lower = eta.toLowerCase().trim();

        try {
            // Extract hours
            java.util.regex.Matcher hrMatcher = java.util.regex.Pattern.compile("(\\d+)\\s*h").matcher(lower);
            if (hrMatcher.find()) {
                totalMs += Long.parseLong(hrMatcher.group(1)) * 3600000;
            }
            // Extract minutes
            java.util.regex.Matcher minMatcher = java.util.regex.Pattern.compile("(\\d+)\\s*m").matcher(lower);
            if (minMatcher.find()) {
                totalMs += Long.parseLong(minMatcher.group(1)) * 60000;
            }
            if (totalMs == 0) {
                // Try pure number (assume minutes)
                double val = Double.parseDouble(lower.replaceAll("[^0-9.]", ""));
                totalMs = (long) (val * 60000);
            }
        } catch (NumberFormatException ignored) {}

        return totalMs;
    }
}
