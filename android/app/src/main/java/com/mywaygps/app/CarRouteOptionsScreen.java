package com.mywaygps.app;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;

import java.util.List;

/** A car-safe list of the current route and up to two distinct alternatives. */
public class CarRouteOptionsScreen extends Screen {
    public CarRouteOptionsScreen(@NonNull CarContext carContext) {
        super(carContext);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        CarStateRepository repository = CarStateRepository.getInstance();
        List<CarStateRepository.RouteOptionItem> options = repository.getRouteOptions();
        ItemList.Builder list = new ItemList.Builder();

        for (CarStateRepository.RouteOptionItem option : options) {
            boolean active = option.id.equals(repository.getActiveRouteId());
            String detail = join(option.totalTime, option.totalDistance, option.tollLabel);
            Row.Builder row = new Row.Builder()
                    .setTitle((active ? "Current • " : "") + option.summary)
                    .addText(detail.isEmpty() ? "Route option" : detail);
            if (!active) {
                row.setOnClickListener(() -> {
                    NativeAndroidAutoPlugin.notifyRouteSelectedFromCar(option.id);
                    getScreenManager().pop();
                });
            }
            list.addItem(row.build());
        }

        if (options.size() <= 1) {
            list.addItem(new Row.Builder()
                    .setTitle("No other route right now")
                    .addText("MyWay will show an alternate when one is meaningfully different.")
                    .build());
        }

        return new ListTemplate.Builder()
                .setTitle("Choose route")
                .setHeaderAction(Action.BACK)
                .setSingleList(list.build())
                .build();
    }

    private static String join(String... values) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            if (value == null || value.trim().isEmpty()) continue;
            if (builder.length() > 0) builder.append(" • ");
            builder.append(value.trim());
        }
        return builder.toString();
    }
}
