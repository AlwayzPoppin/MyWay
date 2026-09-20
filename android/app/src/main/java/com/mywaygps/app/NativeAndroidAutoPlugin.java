package com.mywaygps.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Capacitor plugin bridging MyWay's JavaScript navigation engine
 * to the native Android Auto CarAppService templates.
 */
@CapacitorPlugin(name = "NativeAndroidAuto")
public class NativeAndroidAutoPlugin extends Plugin {
    private static volatile boolean isCarSessionActive = false;
    private static volatile NativeAndroidAutoPlugin activeInstance;

    @Override
    public void load() {
        super.load();
        activeInstance = this;
        CarStateRepository.getInstance().initialize(getContext());
    }

    public static void setCarSessionActive(boolean active) {
        isCarSessionActive = active;
        if (activeInstance != null) {
            JSObject ret = new JSObject();
            ret.put("connected", active);
            activeInstance.notifyListeners("carSessionStateChanged", ret);
        }
    }

    public static boolean isCarSessionActive() {
        return isCarSessionActive;
    }

    /**
     * Called when the driver presses the red "X" cancel action on the car's NavigationTemplate.
     * Emits event back to React so useNavigation stops active routing on the phone.
     */
    public static void notifyNavigationCancelledFromCar() {
        CarStateRepository.getInstance().stopNavigation();
        if (activeInstance != null) {
            JSObject data = new JSObject();
            data.put("source", "car_action_strip");
            data.put("timestamp", System.currentTimeMillis());
            activeInstance.notifyListeners("carNavigationCancelled", data);
        }
    }

    /** Emits a driver-selected alternate route back to the phone navigation state. */
    public static void notifyRouteSelectedFromCar(String routeId) {
        if (activeInstance != null && routeId != null && !routeId.isEmpty()) {
            JSObject data = new JSObject();
            data.put("routeId", routeId);
            data.put("timestamp", System.currentTimeMillis());
            activeInstance.notifyListeners("carRouteSelected", data);
        }
    }

    /**
     * Called when the driver taps a saved place, recent trip, or search result
     * on the car head unit. Emits event to React so useNavigation starts routing.
     */
    public static void notifyDestinationSelectedFromCar(String name, double lat, double lng, boolean addStop) {
        if (activeInstance != null) {
            JSObject data = new JSObject();
            data.put("name", name != null ? name : "Destination");
            data.put("lat", lat);
            data.put("lng", lng);
            data.put("intent", addStop ? "add_stop" : "start_trip");
            data.put("timestamp", System.currentTimeMillis());
            activeInstance.notifyListeners("carDestinationSelected", data);
        }
    }

    /**
     * Called when the driver submits or types a search query on the car head unit.
     * Emits event to React so App.tsx can geocode and return results.
     */
    public static void notifySearchRequestedFromCar(String query, boolean addStop) {
        if (activeInstance != null && query != null && !query.isEmpty()) {
            CarStateRepository.getInstance().beginSearch();
            JSObject data = new JSObject();
            data.put("query", query);
            data.put("intent", addStop ? "add_stop" : "start_trip");
            data.put("timestamp", System.currentTimeMillis());
            activeInstance.notifyListeners("carSearchRequested", data);
        }
    }

    /** Emits incident confirmation ("Still There" / "Confirm feature") from car back to phone. */
    public static void notifyIncidentConfirmedFromCar(String incidentId) {
        if (activeInstance != null && incidentId != null && !incidentId.isEmpty()) {
            JSObject data = new JSObject();
            data.put("incidentId", incidentId);
            data.put("timestamp", System.currentTimeMillis());
            activeInstance.notifyListeners("carIncidentConfirmed", data);
        }
    }

    /** Emits incident cleared ("Cleared" / "Feature removed") from car back to phone. */
    public static void notifyIncidentClearedFromCar(String incidentId) {
        if (activeInstance != null && incidentId != null && !incidentId.isEmpty()) {
            JSObject data = new JSObject();
            data.put("incidentId", incidentId);
            data.put("timestamp", System.currentTimeMillis());
            activeInstance.notifyListeners("carIncidentCleared", data);
        }
    }

    /** Emits incident removal ("Remove feature I added") from car back to phone. */
    public static void notifyIncidentRemovedFromCar(String incidentId) {
        if (activeInstance != null && incidentId != null && !incidentId.isEmpty()) {
            JSObject data = new JSObject();
            data.put("incidentId", incidentId);
            data.put("timestamp", System.currentTimeMillis());
            activeInstance.notifyListeners("carIncidentRemoved", data);
        }
    }

    @PluginMethod
    public void updateNavigationState(PluginCall call) {
        try {
            String destinationName = call.getString("destinationName", "Destination");
            String eta = call.getString("eta", "");
            String remainingDistance = call.getString("remainingDistance", "");
            String currentInstruction = call.getString("currentInstruction", "");
            int speedMph = call.getInt("speedMph", 0);
            int speedLimit = call.getInt("speedLimit", 0);
            boolean isArrived = call.getBoolean("isArrived", false);
            double currentLatitude = call.getDouble("currentLatitude", Double.NaN);
            double currentLongitude = call.getDouble("currentLongitude", Double.NaN);
            double destinationLatitude = call.getDouble("destinationLatitude", Double.NaN);
            double destinationLongitude = call.getDouble("destinationLongitude", Double.NaN);
            double bearing = call.getDouble("bearing", Double.NaN);
            double fuelGallonsBurned = call.getDouble("fuelGallonsBurned", Double.NaN);
            double fuelCostSoFar = call.getDouble("fuelCostSoFar", Double.NaN);
            double fuelGallonsRemaining = call.getDouble("fuelGallonsRemaining", Double.NaN);
            int fuelPercentRemaining = call.getInt("fuelPercentRemaining", -1);
            int fuelRangeMiles = call.getInt("fuelRangeMiles", -1);
            JSArray routeCoordinates = call.getArray("routeCoordinates");
            List<CarStateRepository.MapPoint> routePoints = new ArrayList<>();
            if (routeCoordinates != null) {
                for (int i = 0; i < routeCoordinates.length(); i++) {
                    try {
                        JSONObject point = routeCoordinates.getJSONObject(i);
                        double lat = point.optDouble("lat", Double.NaN);
                        double lng = point.optDouble("lng", Double.NaN);
                        if (!Double.isNaN(lat) && !Double.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                            routePoints.add(new CarStateRepository.MapPoint(lat, lng));
                        }
                    } catch (JSONException ignored) { }
                }
            }

            if ("Arrived!".equalsIgnoreCase(currentInstruction)) {
                isArrived = true;
            }

            CarStateRepository.getInstance().updateNavigation(
                    destinationName,
                    eta,
                    remainingDistance,
                    currentInstruction,
                    speedMph,
                    speedLimit,
                    isArrived,
                    currentLatitude,
                    currentLongitude,
                    destinationLatitude,
                    destinationLongitude,
                    bearing,
                    routePoints,
                    fuelGallonsBurned,
                    fuelCostSoFar,
                    fuelGallonsRemaining,
                    fuelPercentRemaining,
                    fuelRangeMiles
            );
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to update car navigation state: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void setArrived(PluginCall call) {
        try {
            CarStateRepository.getInstance().setArrived(true);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to set arrival state: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopNavigation(PluginCall call) {
        try {
            CarStateRepository.getInstance().stopNavigation();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to stop car navigation: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateSavedPlaces(PluginCall call) {
        try {
            JSArray placesArray = call.getArray("places");
            List<CarStateRepository.SavedPlaceItem> placeList = new ArrayList<>();

            if (placesArray != null) {
                for (int i = 0; i < placesArray.length(); i++) {
                    try {
                        JSONObject obj = placesArray.getJSONObject(i);
                        String id = obj.optString("id", "");
                        String name = obj.optString("name", "Place");
                        String address = obj.optString("address", "");
                        double lat = obj.optDouble("lat", 0.0);
                        double lng = obj.optDouble("lng", 0.0);

                        placeList.add(new CarStateRepository.SavedPlaceItem(id, name, address, lat, lng));
                    } catch (JSONException ignored) {}
                }
            }

            CarStateRepository.getInstance().updateSavedPlaces(placeList);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("count", placeList.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to update car saved places: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateRouteOptions(PluginCall call) {
        try {
            String activeRouteId = call.getString("activeRouteId", "");
            JSArray routes = call.getArray("routes");
            List<CarStateRepository.RouteOptionItem> options = new ArrayList<>();
            if (routes != null) {
                for (int i = 0; i < routes.length() && i < 3; i++) {
                    try {
                        JSONObject route = routes.getJSONObject(i);
                        String id = route.optString("id", "");
                        if (!id.isEmpty()) {
                            options.add(new CarStateRepository.RouteOptionItem(id,
                                    route.optString("summary", "Route option"),
                                    route.optString("totalTime", ""),
                                    route.optString("totalDistance", ""),
                                    route.optString("tollLabel", "")));
                        }
                    } catch (JSONException ignored) { }
                }
            }
            CarStateRepository.getInstance().updateRouteOptions(activeRouteId, options);
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("count", options.size());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to update car route options: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateSearchResults(PluginCall call) {
        try {
            JSArray resultsArray = call.getArray("results");
            List<CarStateRepository.SearchResultItem> resultList = new ArrayList<>();
            if (resultsArray != null) {
                for (int i = 0; i < resultsArray.length() && i < 6; i++) {
                    try {
                        JSONObject obj = resultsArray.getJSONObject(i);
                        resultList.add(new CarStateRepository.SearchResultItem(
                                obj.optString("name", "Place"),
                                obj.optString("address", ""),
                                obj.optDouble("lat", 0.0),
                                obj.optDouble("lng", 0.0)));
                    } catch (JSONException ignored) {}
                }
            }
            CarStateRepository.getInstance().updateSearchResults(resultList);
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("count", resultList.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to update car search results: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateRecentTrips(PluginCall call) {
        try {
            JSArray tripsArray = call.getArray("trips");
            List<CarStateRepository.RecentTripItem> tripList = new ArrayList<>();
            if (tripsArray != null) {
                for (int i = 0; i < tripsArray.length() && i < 10; i++) {
                    try {
                        JSONObject obj = tripsArray.getJSONObject(i);
                        tripList.add(new CarStateRepository.RecentTripItem(
                                obj.optString("name", "Destination"),
                                obj.optString("address", ""),
                                obj.optDouble("lat", 0.0),
                                obj.optDouble("lng", 0.0),
                                obj.optLong("timestamp", 0L)));
                    } catch (JSONException ignored) {}
                }
            }
            CarStateRepository.getInstance().updateRecentTrips(tripList);
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("count", tripList.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to update car recent trips: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateIncidents(PluginCall call) {
        try {
            JSArray array = call.getArray("incidents");
            List<CarStateRepository.IncidentItem> list = new ArrayList<>();
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    try {
                        JSONObject obj = array.getJSONObject(i);
                        String id = obj.optString("id", "");
                        String type = obj.optString("type", "hazard");
                        double lat = obj.optDouble("lat", 0.0);
                        double lng = obj.optDouble("lng", 0.0);
                        String title = obj.optString("title", "Road Alert");
                        String badge = obj.optString("badge", "");
                        String color = obj.optString("color", "#f59e0b");
                        String reporterName = obj.optString("reporterName", "Driver");
                        boolean isReporter = obj.optBoolean("isReporter", false);
                        int upvotes = obj.optInt("upvotes", 1);
                        boolean verified = obj.optBoolean("verified", false);
                        boolean isPermanent = obj.optBoolean("isPermanent", false);
                        String details = obj.optString("details", "");
                        String timestamp = obj.optString("timestamp", "");

                        if (lat != 0.0 && lng != 0.0) {
                            list.add(new CarStateRepository.IncidentItem(id, type, lat, lng, title, badge, color,
                                    reporterName, isReporter, upvotes, verified, isPermanent, details, timestamp));
                        }
                    } catch (JSONException ignored) {}
                }
            }
            CarStateRepository.getInstance().updateIncidents(list);
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("count", list.size());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to update car incidents: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void updateMapSkin(PluginCall call) {
        try {
            String skin = call.getString("skin", "default");
            String theme = call.getString("theme", "dark");
            boolean is3DMode = call.getBoolean("is3DMode", true);
            CarStateRepository.getInstance().updateMapSkin(skin, theme, is3DMode);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to update car map skin: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void isCarConnected(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", isCarSessionActive);
        call.resolve(ret);
    }
}
