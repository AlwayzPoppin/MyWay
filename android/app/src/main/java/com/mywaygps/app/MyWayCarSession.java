package com.mywaygps.app;

import android.content.Intent;
import android.graphics.Rect;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.car.app.AppManager;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.SurfaceCallback;
import androidx.car.app.SurfaceContainer;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

/**
 * Car session representing a single connection lifecycle between
 * MyWay and an Android Auto head unit or Automotive OS display.
 *
 * Implements SurfaceCallback to receive the hardware rendering canvas from the car,
 * driving native 3D street geometry, route polyline rendering, and vehicle positioning.
 */
public class MyWayCarSession extends Session implements SurfaceCallback {
    private static final String TAG = "MyWayCarSession";
    private static volatile MyWayCarSession activeSession;

    private CarMapSurfaceRenderer mapRenderer;

    public MyWayCarSession() {
        activeSession = this;
        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override
            public void onDestroy(@NonNull LifecycleOwner owner) {
                if (mapRenderer != null) {
                    mapRenderer.release();
                    mapRenderer = null;
                }
                NativeAndroidAutoPlugin.setCarSessionActive(false);
                if (activeSession == MyWayCarSession.this) {
                    activeSession = null;
                }
            }
        });
    }

    @NonNull
    @Override
    public Screen onCreateScreen(@NonNull Intent intent) {
        NativeAndroidAutoPlugin.setCarSessionActive(true);

        // Register SurfaceCallback with the Car AppManager to receive hardware rendering surface
        try {
            getCarContext().getCarService(AppManager.class).setSurfaceCallback(this);
            Log.d(TAG, "Successfully registered SurfaceCallback with AppManager");
        } catch (Exception e) {
            Log.e(TAG, "Failed to register SurfaceCallback with AppManager: " + e.getMessage(), e);
        }

        // Return the NavigationTemplate-based MyWayMapScreen
        return new MyWayMapScreen(getCarContext());
    }

    @Override
    public void onSurfaceAvailable(@NonNull SurfaceContainer surfaceContainer) {
        Log.d(TAG, "Car hardware surface available: " + surfaceContainer.getWidth() + "x" + surfaceContainer.getHeight());
        if (mapRenderer == null) {
            mapRenderer = new CarMapSurfaceRenderer();
        }
        mapRenderer.onSurfaceAvailable(
                surfaceContainer.getSurface(),
                surfaceContainer.getWidth(),
                surfaceContainer.getHeight()
        );
    }

    @Override
    public void onVisibleAreaChanged(@NonNull Rect visibleArea) {
        if (mapRenderer != null) {
            mapRenderer.onVisibleAreaChanged(visibleArea);
        }
    }

    @Override
    public void onStableAreaChanged(@NonNull Rect stableArea) {
        if (mapRenderer != null) {
            mapRenderer.onStableAreaChanged(stableArea);
        }
    }

    @Override
    public void onSurfaceDestroyed(@NonNull SurfaceContainer surfaceContainer) {
        Log.d(TAG, "Car hardware surface destroyed");
        if (mapRenderer != null) {
            mapRenderer.onSurfaceDestroyed();
        }
    }

    /**
     * Trigger camera recenter on the native map surface.
     */
    public static void recenterMap() {
        if (activeSession != null && activeSession.mapRenderer != null) {
            activeSession.mapRenderer.recenter();
        }
    }
}
