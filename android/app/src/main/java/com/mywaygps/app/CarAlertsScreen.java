package com.mywaygps.app;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Android Auto screen presenting active road alerts and permanent features
 * (traffic queues, speed bumps, flooded roads, hazards) sorted by proximity.
 */
public class CarAlertsScreen extends Screen implements CarStateRepository.Listener {

    public CarAlertsScreen(@NonNull CarContext carContext) {
        super(carContext);
        CarStateRepository.getInstance().addListener(this);
        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override
            public void onDestroy(@NonNull LifecycleOwner owner) {
                CarStateRepository.getInstance().removeListener(CarAlertsScreen.this);
            }
        });
    }

    @Override
    public void onNavigationStateChanged() {
        invalidate();
    }

    @Override
    public void onSavedPlacesChanged() {}

    @Override
    public void onIncidentsChanged() {
        getCarContext().getMainExecutor().execute(this::invalidate);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        CarStateRepository repo = CarStateRepository.getInstance();
        List<CarStateRepository.IncidentItem> items = new ArrayList<>(repo.getIncidents());
        boolean hasLoc = repo.hasCurrentLocation();
        double myLat = repo.getCurrentLatitude();
        double myLng = repo.getCurrentLongitude();

        if (hasLoc && items.size() > 1) {
            Collections.sort(items, new Comparator<CarStateRepository.IncidentItem>() {
                @Override
                public int compare(CarStateRepository.IncidentItem a, CarStateRepository.IncidentItem b) {
                    double distA = distanceMiles(myLat, myLng, a.lat, a.lng);
                    double distB = distanceMiles(myLat, myLng, b.lat, b.lng);
                    return Double.compare(distA, distB);
                }
            });
        }

        ItemList.Builder listBuilder = new ItemList.Builder();

        for (CarStateRepository.IncidentItem item : items) {
            String distStr = "";
            if (hasLoc && item.lat != 0.0 && item.lng != 0.0) {
                double dist = distanceMiles(myLat, myLng, item.lat, item.lng);
                if (dist < 0.1) {
                    distStr = "Just ahead";
                } else if (dist < 10) {
                    distStr = String.format(Locale.US, "%.1f mi", dist);
                } else {
                    distStr = String.format(Locale.US, "%.0f mi", dist);
                }
            }

            String statusStr = item.verified ? "Verified" : (item.upvotes + (item.upvotes == 1 ? " confirmation" : " confirmations"));
            String subtitle = distStr.isEmpty() ? statusStr : (distStr + " • " + statusStr);

            if (item.badge != null && !item.badge.trim().isEmpty()) {
                subtitle += " • " + item.badge.trim();
            }

            CarIcon icon = CarIncidentIconHelper.getCarIcon(item.type);

            Row.Builder row = new Row.Builder()
                    .setTitle(item.title)
                    .addText(subtitle)
                    .setImage(icon, Row.IMAGE_TYPE_ICON)
                    .setOnClickListener(() -> {
                        getScreenManager().push(new CarIncidentDetailScreen(getCarContext(), item));
                    });

            listBuilder.addItem(row.build());
        }

        if (items.isEmpty()) {
            listBuilder.addItem(new Row.Builder()
                    .setTitle("No active alerts")
                    .addText("Roads and routes are currently all clear.")
                    .build());
        }

        return new ListTemplate.Builder()
                .setTitle("Road Alerts & Features")
                .setHeaderAction(Action.BACK)
                .setSingleList(listBuilder.build())
                .build();
    }

    private static double distanceMiles(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return 3958.8 * c;
    }
}
