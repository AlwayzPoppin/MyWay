package com.mywaygps.app;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAudioFocusPlugin.class);
        registerPlugin(NativeBatteryPlugin.class);
        registerPlugin(NativeSettingsPlugin.class);
        registerPlugin(NativeAndroidAutoPlugin.class);
        registerPlugin(NativeCameraPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        refreshWebViewport();
    }

    /**
     * The activity handles orientation changes in place. Prompt the embedded WebView to
     * complete its layout pass and notify the navigation UI after Android has settled.
     */
    private void refreshWebViewport() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        Runnable refresh = () -> {
            webView.requestLayout();
            webView.invalidate();
            webView.evaluateJavascript(
                "window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('orientationchange'));",
                null
            );
        };

        webView.post(refresh);
        webView.postDelayed(refresh, 180);
        webView.postDelayed(refresh, 420);
    }
}
