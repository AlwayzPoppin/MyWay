package com.mywaygps.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Shared thread-safe repository holding navigation state, arrival flags,
 * and saved places synced between the MyWay Capacitor web application and Android Auto.
 */
public class CarStateRepository {
    private static volatile CarStateRepository instance;

    public interface Listener {
        void onNavigationStateChanged();
        void onSavedPlacesChanged();
    }

    public static class SavedPlaceItem {
        public final String id;
        public final String name;
        public final String address;
        public final double lat;
        public final double lng;

        public SavedPlaceItem(String id, String name, String address, double lat, double lng) {
            this.id = id != null ? id : "";
            this.name = name != null ? name : "Place";
            this.address = address != null ? address : "";
            this.lat = lat;
            this.lng = lng;
        }
    }

    private boolean isNavigating = false;
    private boolean isArrived = false;
    private String destinationName = "";
    private String eta = "";
    private String remainingDistance = "";
    private String currentInstruction = "";
    private int speedMph = 0;
    private int speedLimit = 0;
    private final List<SavedPlaceItem> savedPlaces = new ArrayList<>();
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    private CarStateRepository() {}

    public static CarStateRepository getInstance() {
        if (instance == null) {
            synchronized (CarStateRepository.class) {
                if (instance == null) {
                    instance = new CarStateRepository();
                }
            }
        }
        return instance;
    }

    public void addListener(Listener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    public void removeListener(Listener listener) {
        if (listener != null) {
            listeners.remove(listener);
        }
    }

    public synchronized void updateNavigation(
            String destinationName,
            String eta,
            String remainingDistance,
            String currentInstruction,
            int speedMph,
            int speedLimit,
            boolean isArrived
    ) {
        this.isNavigating = true;
        this.destinationName = (destinationName != null && !destinationName.trim().isEmpty())
                ? destinationName.trim()
                : "Destination";
        this.eta = eta != null ? eta.trim() : "";
        this.remainingDistance = remainingDistance != null ? remainingDistance.trim() : "";
        this.currentInstruction = (currentInstruction != null && !currentInstruction.trim().isEmpty())
                ? currentInstruction.trim()
                : "Follow highlighted route";
        this.speedMph = Math.max(0, speedMph);
        this.speedLimit = Math.max(0, speedLimit);
        this.isArrived = isArrived || "Arrived!".equalsIgnoreCase(this.currentInstruction);
        notifyNavigationChanged();
    }

    public synchronized void updateNavigation(
            String destinationName,
            String eta,
            String remainingDistance,
            String currentInstruction,
            int speedMph,
            int speedLimit
    ) {
        updateNavigation(destinationName, eta, remainingDistance, currentInstruction, speedMph, speedLimit, false);
    }

    public synchronized void setArrived(boolean arrived) {
        this.isArrived = arrived;
        if (arrived) {
            this.currentInstruction = "Arrived!";
            this.remainingDistance = "0 ft";
            this.eta = "0 min";
        }
        notifyNavigationChanged();
    }

    public synchronized void stopNavigation() {
        this.isNavigating = false;
        this.isArrived = false;
        this.destinationName = "";
        this.eta = "";
        this.remainingDistance = "";
        this.currentInstruction = "";
        this.speedMph = 0;
        this.speedLimit = 0;
        notifyNavigationChanged();
    }

    public synchronized void updateSavedPlaces(List<SavedPlaceItem> places) {
        this.savedPlaces.clear();
        if (places != null) {
            this.savedPlaces.addAll(places);
        }
        notifySavedPlacesChanged();
    }

    private void notifyNavigationChanged() {
        for (Listener l : listeners) {
            try {
                l.onNavigationStateChanged();
            } catch (Exception ignored) {}
        }
    }

    private void notifySavedPlacesChanged() {
        for (Listener l : listeners) {
            try {
                l.onSavedPlacesChanged();
            } catch (Exception ignored) {}
        }
    }

    public synchronized boolean isNavigating() { return isNavigating; }
    public synchronized boolean isArrived() { return isArrived; }
    public synchronized String getDestinationName() { return destinationName; }
    public synchronized String getEta() { return eta; }
    public synchronized String getRemainingDistance() { return remainingDistance; }
    public synchronized String getCurrentInstruction() { return currentInstruction; }
    public synchronized int getSpeedMph() { return speedMph; }
    public synchronized int getSpeedLimit() { return speedLimit; }
    public synchronized List<SavedPlaceItem> getSavedPlaces() {
        return Collections.unmodifiableList(new ArrayList<>(savedPlaces));
    }
}
