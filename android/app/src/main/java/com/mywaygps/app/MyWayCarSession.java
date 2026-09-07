package com.mywaygps.app;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

/**
 * Car session representing a single connection lifecycle between
 * MyWay and an Android Auto head unit or Automotive OS display.
 */
public class MyWayCarSession extends Session {

    public MyWayCarSession() {
        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override
            public void onDestroy(@NonNull LifecycleOwner owner) {
                NativeAndroidAutoPlugin.setCarSessionActive(false);
            }
        });
    }

    @Override
    public void onCarConfigurationChanged(@NonNull android.content.res.Configuration newConfiguration) {
        super.onCarConfigurationChanged(newConfiguration);
    }

    @NonNull
    @Override
    public Screen onCreateScreen(@NonNull Intent intent) {
        NativeAndroidAutoPlugin.setCarSessionActive(true);
        return new MyWayCarNavigationScreen(getCarContext());
    }
}
