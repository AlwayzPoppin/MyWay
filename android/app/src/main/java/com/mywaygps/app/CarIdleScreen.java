package com.mywaygps.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.SectionedItemList;
import androidx.car.app.model.Template;
import androidx.core.graphics.drawable.IconCompat;

import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import java.util.List;

/**
 * Android Auto idle screen showing saved places and recent trips.
 * The driver can tap any destination to start navigation from the car.
 * Pushed from MyWayMapScreen's action strip when idle.
 */
public class CarIdleScreen extends Screen implements CarStateRepository.Listener {

    public CarIdleScreen(@NonNull CarContext carContext) {
        super(carContext);
        CarStateRepository.getInstance().addListener(this);
        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override
            public void onDestroy(@NonNull LifecycleOwner owner) {
                CarStateRepository.getInstance().removeListener(CarIdleScreen.this);
            }
        });
    }

    @Override
    public void onNavigationStateChanged() {
        if (CarStateRepository.getInstance().isNavigating()) {
            getCarContext().getMainExecutor().execute(() -> getScreenManager().pop());
        }
    }

    @Override
    public void onSavedPlacesChanged() {
        getCarContext().getMainExecutor().execute(this::invalidate);
    }

    @Override
    public void onRecentTripsChanged() {
        getCarContext().getMainExecutor().execute(this::invalidate);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        CarStateRepository repo = CarStateRepository.getInstance();

        // If navigation started while this screen is open, pop back to map
        if (repo.isNavigating()) {
            getScreenManager().pop();
        }

        ListTemplate.Builder builder = new ListTemplate.Builder();

        // --- Saved Places Section ---
        List<CarStateRepository.SavedPlaceItem> places = repo.getSavedPlaces();
        ItemList.Builder savedList = new ItemList.Builder();

        if (places.isEmpty()) {
            savedList.addItem(new Row.Builder()
                    .setTitle("No saved places yet")
                    .addText("Save places in MyWay on your phone")
                    .build());
        } else {
            int count = Math.min(places.size(), 6);
            for (int i = 0; i < count; i++) {
                CarStateRepository.SavedPlaceItem place = places.get(i);
                savedList.addItem(new Row.Builder()
                        .setTitle(place.name)
                        .addText(place.address.isEmpty() ? "Saved place" : place.address)
                        .setImage(createPlaceIcon(getCarContext()))
                        .setOnClickListener(() -> {
                            NativeAndroidAutoPlugin.notifyDestinationSelectedFromCar(
                                    place.name, place.lat, place.lng, false);
                            getScreenManager().pop();
                        })
                        .build());
            }
        }
        builder.addSectionedList(SectionedItemList.create(
                savedList.build(), "Saved Places"));

        // --- Recent Trips Section ---
        List<CarStateRepository.RecentTripItem> trips = repo.getRecentTrips();
        ItemList.Builder recentList = new ItemList.Builder();

        if (trips.isEmpty()) {
            recentList.addItem(new Row.Builder()
                    .setTitle("No recent trips yet")
                    .build());
        } else {
            int count = Math.min(trips.size(), 4);
            for (int i = 0; i < count; i++) {
                CarStateRepository.RecentTripItem trip = trips.get(i);
                recentList.addItem(new Row.Builder()
                        .setTitle(trip.name)
                        .addText(trip.address.isEmpty() ? "Recent destination" : trip.address)
                        .setImage(createRecentIcon(getCarContext()))
                        .setOnClickListener(() -> {
                            NativeAndroidAutoPlugin.notifyDestinationSelectedFromCar(
                                    trip.name, trip.lat, trip.lng, false);
                            getScreenManager().pop();
                        })
                        .build());
            }
        }
        builder.addSectionedList(SectionedItemList.create(
                recentList.build(), "Recent Trips"));

        builder.setTitle("MyWay — Explore");
        builder.setHeaderAction(Action.BACK);

        return builder.build();
    }

    /** Teal pin icon for saved places. */
    private static CarIcon createPlaceIcon(Context context) {
        try {
            int size = 48;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.parseColor("#00F0FF"));
            canvas.drawCircle(size / 2f, size / 2f, 18, paint);
            paint.setColor(Color.WHITE);
            canvas.drawCircle(size / 2f, size / 2f, 7, paint);
            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.APP_ICON;
        }
    }

    /** Purple clock icon for recent trips. */
    private static CarIcon createRecentIcon(Context context) {
        try {
            int size = 48;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.parseColor("#7C3AED"));
            canvas.drawCircle(size / 2f, size / 2f, 18, paint);
            paint.setColor(Color.WHITE);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2.5f);
            canvas.drawCircle(size / 2f, size / 2f, 10, paint);
            paint.setStrokeWidth(2f);
            canvas.drawLine(size / 2f, size / 2f - 7, size / 2f, size / 2f, paint);
            canvas.drawLine(size / 2f, size / 2f, size / 2f + 5, size / 2f + 3, paint);
            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.APP_ICON;
        }
    }
}
