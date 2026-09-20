package com.mywaygps.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Bridges the active map skin to Android's edge-to-edge status bar. */
@CapacitorPlugin(name = "NativeStatusBar")
public class NativeStatusBarPlugin extends Plugin {
    @PluginMethod
    public void setAppearance(PluginCall call) {
        String color = call.getString("color", "#17213E");
        boolean useDarkIcons = call.getBoolean("useDarkIcons", false);

        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).runOnUiThread(() -> {
                ((MainActivity) getActivity()).setStatusBarAppearance(color, useDarkIcons);
                call.resolve();
            });
            return;
        }
        call.reject("Main activity unavailable");
    }
}
