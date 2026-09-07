package com.mywaygps.app;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

/**
 * Android Auto / Automotive OS entry point for MyWay.
 * Android Auto discovers this service via the manifest intent-filter
 * and creates a session to project navigation templates onto the vehicle display.
 */
public class MyWayCarAppService extends CarAppService {

    @NonNull
    @Override
    public HostValidator createHostValidator() {
        // Allow all hosts for development / testing with DHU emulator.
        // For production, restrict to known host signatures.
        return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new MyWayCarSession();
    }
}
