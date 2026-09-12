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
                    routePoints,
                    fuelGallonsBurned,
                    fuelCostSoFar,
                    fuelGallonsRemaining,
                    fuelPercentRemaining,
                    fuelRangeMiles
            );

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("isCarConnected", isCarSessionActive);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to update car navigation state: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void notifyArrival(PluginCall call) {
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
    public void isCarConnected(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", isCarSessionActive);
        call.resolve(ret);
    }
}
