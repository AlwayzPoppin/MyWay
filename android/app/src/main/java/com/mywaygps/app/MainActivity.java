package com.mywaygps.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.Gravity;
import android.widget.FrameLayout;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private View statusBarBackground;
    private int statusBarColor = Color.rgb(23, 33, 62);
    private boolean statusBarUsesDarkIcons = false;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAudioFocusPlugin.class);
        registerPlugin(NativeBatteryPlugin.class);
        registerPlugin(NativeSettingsPlugin.class);
        registerPlugin(NativeBackgroundTrackingPlugin.class);
        registerPlugin(NativeAndroidAutoPlugin.class);
        registerPlugin(NativeCameraPermissionPlugin.class);
        registerPlugin(NativeRoadRecorderPlugin.class);
        registerPlugin(NativeStatusBarPlugin.class);
        registerPlugin(NativeContactPlugin.class);
        registerPlugin(NativeSharePlugin.class);
        super.onCreate(savedInstanceState);
        installStatusBarBackground();
        applyReadableSystemBars();
    }

    private void installStatusBarBackground() {
        // Draw our own protection behind system icons, including edge-to-edge
        // Android versions where Window.setStatusBarColor is ignored.
        FrameLayout decor = (FrameLayout) getWindow().getDecorView();
        statusBarBackground = new View(this);
        statusBarBackground.setBackgroundColor(statusBarColor);
        statusBarBackground.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        decor.addView(statusBarBackground, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        ViewCompat.setOnApplyWindowInsetsListener(statusBarBackground, (view, insets) -> {
            int height = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
            FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) view.getLayoutParams();
            if (params.height != height) {
                params.height = height;
                view.setLayoutParams(params);
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(statusBarBackground);
    }

    /**
     * Maps and bright map skins sit behind the Android status bar. Keep the system
     * clock, connectivity, and battery indicators readable in every driving state.
     */
    private void applyReadableSystemBars() {
        Window window = getWindow();
        new WindowInsetsControllerCompat(window, window.getDecorView())
                .setAppearanceLightStatusBars(statusBarUsesDarkIcons);
        window.setStatusBarColor(statusBarColor);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = window.getDecorView().getSystemUiVisibility();
            window.getDecorView().setSystemUiVisibility(statusBarUsesDarkIcons
                    ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    /** Applies the web-selected map skin while preserving readable Android system icons. */
    public void setStatusBarAppearance(String colorHex, boolean useDarkIcons) {
        int parsedColor;
        try {
            parsedColor = Color.parseColor(colorHex);
        } catch (IllegalArgumentException ignored) {
            parsedColor = Color.rgb(23, 33, 62);
            useDarkIcons = false;
        }

        statusBarColor = parsedColor;
        statusBarUsesDarkIcons = useDarkIcons;
        if (statusBarBackground != null) {
            statusBarBackground.setBackgroundColor(statusBarColor);
        }
        applyReadableSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyReadableSystemBars();
        if (statusBarBackground != null) {
            statusBarBackground.bringToFront();
            ViewCompat.requestApplyInsets(statusBarBackground);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // WebView already dispatches one real resize after Android completes this
        // layout pass. MapLibre observes its own container and performs the one
        // debounced canvas resize it needs. Synthetic resize/orientation events here
        // caused competing camera reflows during a portrait-landscape-portrait turn.
    }
}
