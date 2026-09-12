package com.mywaygps.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Shared thread-safe repository holding navigation state, arrival flags,
 * and saved places synced between the MyWay Capacitor web application and Android Auto.
 */
public class CarStateRepository {
    private static volatile CarStateRepository instance;

    public interface Listener {
        void onNavigationStateChanged();
        void onSavedPlacesChanged();
    }

    public static class SavedPlaceItem {
        public final String id;
        public final String name;
        public final String address;
        public final double lat;
        public final double lng;

        public SavedPlaceItem(String id, String name, String address, double lat, double lng) {
            this.id = id != null ? id : "";
            this.name = name != null ? name : "Place";
            this.address = address != null ? address : "";
            this.lat = lat;
            this.lng = lng;
        }
    }

    public static class MapPoint {
        public final double lat;
        public final double lng;

        public MapPoint(double lat, double lng) {
            this.lat = lat;
            this.lng = lng;
        }
    }

    public static class RouteOptionItem {
        public final String id, summary, totalTime, totalDistance, tollLabel;

        public RouteOptionItem(String id, String summary, String totalTime, String totalDistance, String tollLabel) {
            this.id = id != null ? id : "";
            this.summary = summary != null ? summary : "Route option";
            this.totalTime = totalTime != null ? totalTime : "";
            this.totalDistance = totalDistance != null ? totalDistance : "";
            this.tollLabel = tollLabel != null ? tollLabel : "";
        }
    }

    private boolean isNavigating = false;
    private boolean isArrived = false;
    private String destinationName = "";
    private String eta = "";
    private String remainingDistance = "";
    private String currentInstruction = "";
    private int speedMph = 0;
    private int speedLimit = 0;
    private double currentLatitude = Double.NaN;
    private double currentLongitude = Double.NaN;
    private double destinationLatitude = Double.NaN;
    private double destinationLongitude = Double.NaN;
    private double fuelGallonsBurned = Double.NaN;
    private double fuelCostSoFar = Double.NaN;
    private double fuelGallonsRemaining = Double.NaN;
    private int fuelPercentRemaining = -1;
    private int fuelRangeMiles = -1;
    private long lastNavigationUpdateMillis = 0L;
    private final List<MapPoint> routePoints = new ArrayList<>();
    private String activeRouteId = "";
    private final List<RouteOptionItem> routeOptions = new ArrayList<>();
    private final List<SavedPlaceItem> savedPlaces = new ArrayList<>();
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    private CarStateRepository() {}

    public static CarStateRepository getInstance() {
        if (instance == null) {
            synchronized (CarStateRepository.class) {
                if (instance == null) {
                    instance = new CarStateRepository();
                }
            }
        }
        return instance;
    }

    public void addListener(Listener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    public void removeListener(Listener listener) {
        if (listener != null) {
            listeners.remove(listener);
        }
    }

    public synchronized void updateNavigation(
            String destinationName,
            String eta,
            String remainingDistance,
            String currentInstruction,
            int speedMph,
            int speedLimit,
            boolean isArrived,
            double currentLatitude,
            double currentLongitude,
            double destinationLatitude,
            double destinationLongitude,
            List<MapPoint> routePoints,
            double fuelGallonsBurned,
            double fuelCostSoFar,
            double fuelGallonsRemaining,
            int fuelPercentRemaining,
            int fuelRangeMiles
    ) {
        this.isNavigating = true;
        this.destinationName = (destinationName != null && !destinationName.trim().isEmpty())
                ? destinationName.trim()
                : "Destination";
        this.eta = eta != null ? eta.trim() : "";
        this.remainingDistance = remainingDistance != null ? remainingDistance.trim() : "";
        this.currentInstruction = (currentInstruction != null && !currentInstruction.trim().isEmpty())
                ? currentInstruction.trim()
                : "Follow highlighted route";
        this.speedMph = Math.max(0, speedMph);
        this.speedLimit = Math.max(0, speedLimit);
        this.isArrived = isArrived || "Arrived!".equalsIgnoreCase(this.currentInstruction);
        if (isValidCoordinate(currentLatitude, currentLongitude)) {
            this.currentLatitude = currentLatitude;
            this.currentLongitude = currentLongitude;
        }
        if (isValidCoordinate(destinationLatitude, destinationLongitude)) {
            this.destinationLatitude = destinationLatitude;
            this.destinationLongitude = destinationLongitude;
        }
        this.routePoints.clear();
        if (routePoints != null) this.routePoints.addAll(routePoints);
        this.fuelGallonsBurned = fuelGallonsBurned;
        this.fuelCostSoFar = fuelCostSoFar;
        this.fuelGallonsRemaining = fuelGallonsRemaining;
        this.fuelPercentRemaining = fuelPercentRemaining;
        this.fuelRangeMiles = fuelRangeMiles;
        this.lastNavigationUpdateMillis = System.currentTimeMillis();
        notifyNavigationChanged();
    }

    public synchronized void updateNavigation(
            String destinationName,
            String eta,
            String remainingDistance,
            String currentInstruction,
            int speedMph,
            int speedLimit
    ) {
        updateNavigation(destinationName, eta, remainingDistance, currentInstruction, speedMph, speedLimit, false,
                Double.NaN, Double.NaN, Double.NaN, Double.NaN, null,
                Double.NaN, Double.NaN, Double.NaN, -1, -1);
    }

    public synchronized void setArrived(boolean arrived) {
        this.isArrived = arrived;
        if (arrived) {
            this.currentInstruction = "Arrived!";
            this.remainingDistance = "0 ft";
            this.eta = "0 min";
        }
        notifyNavigationChanged();
    }

    public synchronized void stopNavigation() {
        this.isNavigating = false;
        this.isArrived = false;
        this.destinationName = "";
        this.eta = "";
        this.remainingDistance = "";
        this.currentInstruction = "";
        this.speedMph = 0;
        this.speedLimit = 0;
        this.currentLatitude = Double.NaN;
        this.currentLongitude = Double.NaN;
        this.destinationLatitude = Double.NaN;
        this.destinationLongitude = Double.NaN;
        this.routePoints.clear();
        this.activeRouteId = "";
        this.routeOptions.clear();
        this.fuelGallonsBurned = Double.NaN;
        this.fuelCostSoFar = Double.NaN;
        this.fuelGallonsRemaining = Double.NaN;
        this.fuelPercentRemaining = -1;
        this.fuelRangeMiles = -1;
        this.lastNavigationUpdateMillis = 0L;
        notifyNavigationChanged();
    }

    public synchronized void updateSavedPlaces(List<SavedPlaceItem> places) {
        this.savedPlaces.clear();
        if (places != null) {
            this.savedPlaces.addAll(places);
        }
        notifySavedPlacesChanged();
    }

    public synchronized void updateRouteOptions(String activeRouteId, List<RouteOptionItem> options) {
        this.activeRouteId = activeRouteId != null ? activeRouteId : "";
        this.routeOptions.clear();
        if (options != null) this.routeOptions.addAll(options);
        notifyNavigationChanged();
    }

    private void notifyNavigationChanged() {
        for (Listener l : listeners) {
            try {
                l.onNavigationStateChanged();
            } catch (Exception ignored) {}
        }
    }

    private void notifySavedPlacesChanged() {
        for (Listener l : listeners) {
            try {
                l.onSavedPlacesChanged();
            } catch (Exception ignored) {}
        }
    }

    public synchronized boolean isNavigating() { return isNavigating; }
    public synchronized boolean isArrived() { return isArrived; }
    public synchronized String getDestinationName() { return destinationName; }
    public synchronized String getEta() { return eta; }
    public synchronized String getRemainingDistance() { return remainingDistance; }
    public synchronized String getCurrentInstruction() { return currentInstruction; }
    public synchronized int getSpeedMph() { return speedMph; }
    public synchronized int getSpeedLimit() { return speedLimit; }
    public synchronized boolean hasCurrentLocation() { return isValidCoordinate(currentLatitude, currentLongitude); }
    public synchronized boolean hasDestinationLocation() { return isValidCoordinate(destinationLatitude, destinationLongitude); }
    public synchronized double getCurrentLatitude() { return currentLatitude; }
    public synchronized double getCurrentLongitude() { return currentLongitude; }
    public synchronized double getDestinationLatitude() { return destinationLatitude; }
    public synchronized double getDestinationLongitude() { return destinationLongitude; }
    public synchronized List<MapPoint> getRoutePoints() { return Collections.unmodifiableList(new ArrayList<>(routePoints)); }
    public synchronized boolean isNavigationTelemetryStale() { return isNavigating && (lastNavigationUpdateMillis == 0L || System.currentTimeMillis() - lastNavigationUpdateMillis > 15000L); }
    public synchronized double getFuelGallonsBurned() { return fuelGallonsBurned; }
    public synchronized double getFuelCostSoFar() { return fuelCostSoFar; }
    public synchronized double getFuelGallonsRemaining() { return fuelGallonsRemaining; }
    public synchronized int getFuelPercentRemaining() { return fuelPercentRemaining; }
    public synchronized int getFuelRangeMiles() { return fuelRangeMiles; }
    public synchronized String getActiveRouteId() { return activeRouteId; }
    public synchronized List<RouteOptionItem> getRouteOptions() { return Collections.unmodifiableList(new ArrayList<>(routeOptions)); }
    public synchronized List<SavedPlaceItem> getSavedPlaces() {
        return Collections.unmodifiableList(new ArrayList<>(savedPlaces));
    }

    private static boolean isValidCoordinate(double lat, double lng) {
        return !Double.isNaN(lat) && !Double.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }
}
