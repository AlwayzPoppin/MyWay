package com.mywaygps.app;

import android.content.SharedPreferences;
import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Bridge used only to configure and control the independent foreground service. */
@CapacitorPlugin(name = "NativeBackgroundTracking")
public class NativeBackgroundTrackingPlugin extends Plugin {
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(BackgroundTrackingService.PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String uid = call.getString("uid", "");
        String deviceId = call.getString("deviceId", "");
        String token = call.getString("token", "");
        String endpoint = call.getString("endpoint", "");
        String circles = call.getString("circles", "[]");
        if (uid.isEmpty() || deviceId.isEmpty() || token.isEmpty() || endpoint.isEmpty()) {
            call.reject("Background tracking configuration is incomplete.");
            return;
        }
        preferences().edit()
            .putString("uid", uid).putString("deviceId", deviceId).putString("token", token)
            .putString("endpoint", endpoint).putString("circles", circles)
            .putString("displayName", call.getString("displayName", "You"))
            .putString("photoURL", call.getString("photoURL", ""))
            .putString("role", call.getString("role", "Member"))
            .apply();
        BackgroundTrackingService.start(getContext());
        JSObject result = new JSObject(); result.put("running", true); call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        preferences().edit().clear().putBoolean(BackgroundTrackingService.KEY_RUNNING, false).apply();
        BackgroundTrackingService.stop(getContext());
        JSObject result = new JSObject(); result.put("running", false); call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", preferences().getBoolean(BackgroundTrackingService.KEY_RUNNING, false));
        call.resolve(result);
    }
}
