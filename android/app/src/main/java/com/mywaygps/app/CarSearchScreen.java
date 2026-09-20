package com.mywaygps.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.Row;
import androidx.car.app.model.SearchTemplate;
import androidx.car.app.model.Template;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import java.util.List;

/**
 * Android Auto search screen using SearchTemplate.
 * Forwards the driver's text query to the phone for geocoding,
 * then displays returned results as tappable rows.
 */
public class CarSearchScreen extends Screen implements CarStateRepository.Listener {

    private String lastQuery = "";
    private final boolean addStop;

    public CarSearchScreen(@NonNull CarContext carContext) {
        this(carContext, false);
    }

    public CarSearchScreen(@NonNull CarContext carContext, boolean addStop) {
        super(carContext);
        this.addStop = addStop;
        CarStateRepository.getInstance().addListener(this);

        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override
            public void onDestroy(@NonNull LifecycleOwner owner) {
                CarStateRepository.getInstance().removeListener(CarSearchScreen.this);
            }
        });
    }

    @Override
    public void onSearchResultsChanged() {
        getCarContext().getMainExecutor().execute(this::invalidate);
    }

    // Required Listener methods (no-op for this screen)
    @Override public void onNavigationStateChanged() {}
    @Override public void onSavedPlacesChanged() {}

    @NonNull
    @Override
    public Template onGetTemplate() {
        CarStateRepository repo = CarStateRepository.getInstance();

        // If navigation started while this screen is open, pop back to map
        if (repo.isNavigating() && !addStop) {
            getScreenManager().pop();
        }

        List<CarStateRepository.SearchResultItem> results = repo.getSearchResults();
        ItemList.Builder listBuilder = new ItemList.Builder();

        if (!lastQuery.isEmpty() && repo.isSearchInProgress()) {
            listBuilder.addItem(new Row.Builder()
                    .setTitle("Searching MyWay…")
                    .addText("Finding places near your route")
                    .build());
        } else if (!lastQuery.isEmpty() && results.isEmpty()) {
            listBuilder.addItem(new Row.Builder()
                    .setTitle("No results found")
                    .addText("Try a different search term")
                    .build());
        } else {
            int count = Math.min(results.size(), 6);
            for (int i = 0; i < count; i++) {
                CarStateRepository.SearchResultItem result = results.get(i);
                listBuilder.addItem(new Row.Builder()
                        .setTitle(result.name)
                        .addText(result.address.isEmpty() ? "Search result" : result.address)
                        .setImage(createSearchResultIcon(getCarContext()))
                        .setOnClickListener(() -> {
                            NativeAndroidAutoPlugin.notifyDestinationSelectedFromCar(
                                    result.name, result.lat, result.lng, addStop);
                            getScreenManager().pop();
                        })
                        .build());
            }
        }

        return new SearchTemplate.Builder(new SearchTemplate.SearchCallback() {
            @Override
            public void onSearchTextChanged(@NonNull String searchText) {
                // Debounce: only search when the text is meaningful
                lastQuery = searchText.trim();
                if (lastQuery.length() >= 3) {
                    NativeAndroidAutoPlugin.notifySearchRequestedFromCar(lastQuery, addStop);
                }
            }

            @Override
            public void onSearchSubmitted(@NonNull String searchText) {
                lastQuery = searchText.trim();
                if (!lastQuery.isEmpty()) {
                    NativeAndroidAutoPlugin.notifySearchRequestedFromCar(lastQuery, addStop);
                }
            }
        })
                .setHeaderAction(Action.BACK)
                .setShowKeyboardByDefault(true)
                .setItemList(listBuilder.build())
                .build();
    }

    /** Blue pin icon for search results. */
    private static CarIcon createSearchResultIcon(Context context) {
        try {
            int size = 48;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.parseColor("#2563EB"));
            canvas.drawCircle(size / 2f, size / 2f, 18, paint);
            paint.setColor(Color.WHITE);
            canvas.drawCircle(size / 2f, size / 2f, 7, paint);
            return new CarIcon.Builder(IconCompat.createWithBitmap(bitmap)).build();
        } catch (Exception e) {
            return CarIcon.APP_ICON;
        }
    }
}
