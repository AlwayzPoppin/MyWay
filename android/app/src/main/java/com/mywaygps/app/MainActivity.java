package com.mywaygps.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAudioFocusPlugin.class);
        registerPlugin(NativeBatteryPlugin.class);
        registerPlugin(NativeSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
