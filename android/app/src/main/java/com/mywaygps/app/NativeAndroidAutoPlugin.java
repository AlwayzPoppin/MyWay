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

    public static void setCarSessionActive(boolean active) {
        isCarSessionActive = active;
    }

    public static boolean isCarSessionActive() {
        return isCarSessionActive;
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

            CarStateRepository.getInstance().updateNavigation(
                    destinationName,
                    eta,
                    remainingDistance,
                    currentInstruction,
                    speedMph,
                    speedLimit
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
    public void isCarConnected(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", isCarSessionActive);
        call.resolve(ret);
    }
}
