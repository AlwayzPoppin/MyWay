package com.mywaygps.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
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
    private static final String PREFS = "myway_car_state";
    private static final String SAVED_PLACES_KEY = "saved_places";
    private Context appContext;

    public interface Listener {
        void onNavigationStateChanged();
        void onSavedPlacesChanged();
        /** Called when recent trips list is updated from the phone. */
        default void onRecentTripsChanged() {}
        /** Called when search results are returned from the phone. */
        default void onSearchResultsChanged() {}
        /** Called when incidents or permanent features are updated. */
        default void onIncidentsChanged() {}
        /** Called when map skin or visual theme is updated. */
        default void onMapSkinChanged() {}
    }

    public static class IncidentItem {
        public final String id;
        public final String type;
        public final double lat;
        public final double lng;
        public final String title;
        public final String badge;
        public final String color;
        public final String reporterName;
        public final boolean isReporter;
        public final int upvotes;
        public final boolean verified;
        public final boolean isPermanent;
        public final String details;
        public final String timestamp;

        public IncidentItem(String id, String type, double lat, double lng, String title,
                            String badge, String color, String reporterName, boolean isReporter,
                            int upvotes, boolean verified, boolean isPermanent, String details, String timestamp) {
            this.id = id != null ? id : "";
            this.type = type != null ? type : "hazard";
            this.lat = lat;
            this.lng = lng;
            this.title = title != null ? title : "Road Alert";
            this.badge = badge != null ? badge : "";
            this.color = color != null ? color : "#f59e0b";
            this.reporterName = reporterName != null ? reporterName : "Driver";
            this.isReporter = isReporter;
            this.upvotes = upvotes;
            this.verified = verified;
            this.isPermanent = isPermanent;
            this.details = details != null ? details : "";
            this.timestamp = timestamp != null ? timestamp : "";
        }
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

    /** A recently searched or navigated destination, synced from the phone's search history. */
    public static class RecentTripItem {
        public final String name;
        public final String address;
        public final double lat;
        public final double lng;
        public final long timestamp;

        public RecentTripItem(String name, String address, double lat, double lng, long timestamp) {
            this.name = name != null ? name : "Destination";
            this.address = address != null ? address : "";
            this.lat = lat;
            this.lng = lng;
            this.timestamp = timestamp;
        }
    }

    /** A geocoded search result returned by the phone in response to a car search query. */
    public static class SearchResultItem {
        public final String name;
        public final String address;
        public final double lat;
        public final double lng;

        public SearchResultItem(String name, String address, double lat, double lng) {
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
    private final List<RecentTripItem> recentTrips = new ArrayList<>();
    private final List<SearchResultItem> searchResults = new ArrayList<>();
    private double currentBearing = Double.NaN;
    private boolean searchInProgress = false;
    private String mapSkin = "default";
    private String theme = "dark";
    private boolean is3DMode = true;
    private final List<IncidentItem> incidents = new ArrayList<>();
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

    /** Restores car-safe saved places after Android Auto starts without the web view alive. */
    public synchronized void initialize(Context context) {
        if (context == null) return;
        appContext = context.getApplicationContext();
        if (!savedPlaces.isEmpty()) return;
        try {
            String raw = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SAVED_PLACES_KEY, "");
            if (raw == null || raw.isEmpty()) return;
            JSONArray values = new JSONArray(raw);
            for (int i = 0; i < values.length(); i++) {
                JSONObject item = values.getJSONObject(i);
                savedPlaces.add(new SavedPlaceItem(item.optString("id"), item.optString("name"), item.optString("address"), item.optDouble("lat"), item.optDouble("lng")));
            }
        } catch (Exception ignored) { }
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
            double bearing,
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
        if (!Double.isNaN(bearing)) {
            this.currentBearing = bearing;
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
        updateNavigation(destinationName, eta, remainingDistance, currentInstruction, speedMph, speedLimit, isArrived,
                currentLatitude, currentLongitude, destinationLatitude, destinationLongitude, Double.NaN, routePoints,
                fuelGallonsBurned, fuelCostSoFar, fuelGallonsRemaining, fuelPercentRemaining, fuelRangeMiles);
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
        this.currentBearing = Double.NaN;
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
        persistSavedPlaces();
        notifySavedPlacesChanged();
    }

    private void persistSavedPlaces() {
        if (appContext == null) return;
        try {
            JSONArray values = new JSONArray();
            for (SavedPlaceItem place : savedPlaces) {
                values.put(new JSONObject().put("id", place.id).put("name", place.name).put("address", place.address).put("lat", place.lat).put("lng", place.lng));
            }
            appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(SAVED_PLACES_KEY, values.toString()).apply();
        } catch (Exception ignored) { }
    }

    public synchronized void updateRecentTrips(List<RecentTripItem> trips) {
        this.recentTrips.clear();
        if (trips != null) {
            this.recentTrips.addAll(trips);
        }
        notifyRecentTripsChanged();
    }

    public synchronized void updateSearchResults(List<SearchResultItem> results) {
        this.searchResults.clear();
        if (results != null) {
            this.searchResults.addAll(results);
        }
        this.searchInProgress = false;
        notifySearchResultsChanged();
    }

    public synchronized void beginSearch() {
        this.searchResults.clear();
        this.searchInProgress = true;
        notifySearchResultsChanged();
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

    private void notifyRecentTripsChanged() {
        for (Listener l : listeners) {
            try {
                l.onRecentTripsChanged();
            } catch (Exception ignored) {}
        }
    }

    private void notifySearchResultsChanged() {
        for (Listener l : listeners) {
            try {
                l.onSearchResultsChanged();
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
    public synchronized List<RecentTripItem> getRecentTrips() {
        return Collections.unmodifiableList(new ArrayList<>(recentTrips));
    }
    public synchronized List<SearchResultItem> getSearchResults() {
        return Collections.unmodifiableList(new ArrayList<>(searchResults));
    }
    public synchronized boolean isSearchInProgress() { return searchInProgress; }

    public synchronized void updateIncidents(List<IncidentItem> items) {
        this.incidents.clear();
        if (items != null) {
            this.incidents.addAll(items);
        }
        notifyIncidentsChanged();
    }

    public synchronized void updateMapSkin(String skin, String theme, boolean is3DMode) {
        this.mapSkin = skin != null ? skin : "default";
        this.theme = theme != null ? theme : "dark";
        this.is3DMode = is3DMode;
        notifyMapSkinChanged();
    }

    private void notifyIncidentsChanged() {
        for (Listener l : listeners) {
            try {
                l.onIncidentsChanged();
            } catch (Exception ignored) {}
        }
    }

    private void notifyMapSkinChanged() {
        for (Listener l : listeners) {
            try {
                l.onMapSkinChanged();
            } catch (Exception ignored) {}
        }
    }

    public synchronized List<IncidentItem> getIncidents() {
        return Collections.unmodifiableList(new ArrayList<>(incidents));
    }

    public synchronized IncidentItem getIncidentById(String id) {
        if (id == null || id.isEmpty()) return null;
        for (IncidentItem item : incidents) {
            if (id.equals(item.id)) return item;
        }
        return null;
    }

    public synchronized double getCurrentBearing() { return currentBearing; }
    public synchronized boolean hasBearing() { return !Double.isNaN(currentBearing); }
    public synchronized String getMapSkin() { return mapSkin; }
    public synchronized String getTheme() { return theme; }
    public synchronized boolean is3DMode() { return is3DMode; }

    private static boolean isValidCoordinate(double lat, double lng) {
        return !Double.isNaN(lat) && !Double.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }
}
