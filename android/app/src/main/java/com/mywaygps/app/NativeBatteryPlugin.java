package com.mywaygps.app;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native Android Battery Plugin
 * Accurately reads real-time battery capacity percentage and charging status
 * from Android BatteryManager and system battery broadcast receivers.
 */
@CapacitorPlugin(name = "NativeBattery")
public class NativeBatteryPlugin extends Plugin {

    @PluginMethod
    public void getBatteryInfo(PluginCall call) {
        try {
            Context context = getContext();
            int level = -1;
            boolean isCharging = false;

            // 1. Direct BatteryManager API (Android 5.0+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                BatteryManager bm = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) {
                    level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        isCharging = bm.isCharging();
                    }
                }
            }

            // 2. Sticky Intent Broadcast Fallback
            if (level <= 0 || level > 100) {
                IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent batteryStatus = context.registerReceiver(null, ifilter);
                if (batteryStatus != null) {
                    int rawLevel = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                    if (rawLevel >= 0 && scale > 0) {
                        level = Math.round((rawLevel / (float) scale) * 100f);
                    }
                    int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                    isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
                }
            }

            JSObject ret = new JSObject();
            ret.put("level", Math.max(0, Math.min(100, level >= 0 ? level : 100)));
            ret.put("isCharging", isCharging);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("level", 100);
            ret.put("isCharging", false);
            call.resolve(ret);
        }
    }
}
