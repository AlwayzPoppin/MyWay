package com.mywaygps.app;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.Pane;
import androidx.car.app.model.PaneTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;

/**
 * Android Auto screen that replicates the mobile IncidentDetailModal.tsx layout,
 * verification logic, permanent feature messaging, and action controls.
 */
public class CarIncidentDetailScreen extends Screen {
    private final CarStateRepository.IncidentItem incident;

    public CarIncidentDetailScreen(@NonNull CarContext carContext, @NonNull CarStateRepository.IncidentItem incident) {
        super(carContext);
        this.incident = incident;
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        Pane.Builder paneBuilder = new Pane.Builder();

        // Verification status text matching mobile IncidentDetailModal
        int confirmations = Math.max(1, incident.upvotes);
        String verificationText;
        if (incident.verified) {
            verificationText = "Verified by the community";
        } else if (incident.isPermanent) {
            verificationText = "Needs 1 more confirmation";
        } else {
            verificationText = confirmations + (confirmations == 1 ? " confirmation" : " confirmations");
        }

        String badgeText = incident.badge != null && !incident.badge.trim().isEmpty()
                ? incident.badge.trim().toUpperCase()
                : (incident.isPermanent ? "ROAD FEATURE" : "COMMUNITY ALERT");

        CarIcon icon = CarIncidentIconHelper.getCarIcon(incident.type);

        // Row 1: Verification status and badge with custom icon
        Row.Builder statusRow = new Row.Builder()
                .setTitle(verificationText)
                .addText(badgeText)
                .setImage(icon, Row.IMAGE_TYPE_ICON);
        paneBuilder.addRow(statusRow.build());

        // Row 2: Reporter and time info
        String reporter = incident.reporterName != null && !incident.reporterName.trim().isEmpty()
                ? incident.reporterName.trim()
                : "Driver";
        String reporterTitle = "Reported by: " + reporter + (incident.isReporter ? " (You)" : "");
        String timeText = incident.timestamp != null && !incident.timestamp.trim().isEmpty()
                ? incident.timestamp.trim()
                : "Active alert";

        Row.Builder reporterRow = new Row.Builder()
                .setTitle(reporterTitle)
                .addText(timeText);
        paneBuilder.addRow(reporterRow.build());

        // Row 3: Notes and permanent road feature explanation
        String communityNote = incident.isPermanent
                ? "Road features remain visible until the community confirms removal."
                : "Alerts are shared live with all circle members and nearby drivers.";

        Row.Builder infoRow = new Row.Builder();
        if (incident.details != null && !incident.details.trim().isEmpty()) {
            infoRow.setTitle("Note: " + incident.details.trim())
                    .addText(communityNote);
        } else {
            infoRow.setTitle(incident.isPermanent ? "Permanent Road Feature" : "Community Live Alert")
                    .addText(communityNote);
        }
        paneBuilder.addRow(infoRow.build());

        // Actions: Max 2 actions per Car App Library PaneTemplate
        String confirmTitle = incident.isPermanent ? "Confirm feature" : "Still There";
        Action confirmAction = new Action.Builder()
                .setTitle(confirmTitle)
                .setOnClickListener(() -> {
                    NativeAndroidAutoPlugin.notifyIncidentConfirmedFromCar(incident.id);
                    CarToast.makeText(getCarContext(), "Confirmed: " + incident.title, CarToast.LENGTH_SHORT).show();
                    getScreenManager().pop();
                })
                .build();
        paneBuilder.addAction(confirmAction);

        if (incident.isReporter) {
            String removeTitle = incident.isPermanent ? "Remove feature" : "Remove alert";
            Action removeAction = new Action.Builder()
                    .setTitle(removeTitle)
                    .setOnClickListener(() -> {
                        NativeAndroidAutoPlugin.notifyIncidentRemovedFromCar(incident.id);
                        CarToast.makeText(getCarContext(), "Removed: " + incident.title, CarToast.LENGTH_SHORT).show();
                        getScreenManager().pop();
                    })
                    .build();
            paneBuilder.addAction(removeAction);
        } else {
            String clearTitle = incident.isPermanent ? "Feature removed" : "Cleared";
            Action clearAction = new Action.Builder()
                    .setTitle(clearTitle)
                    .setOnClickListener(() -> {
                        NativeAndroidAutoPlugin.notifyIncidentClearedFromCar(incident.id);
                        CarToast.makeText(getCarContext(), "Marked cleared: " + incident.title, CarToast.LENGTH_SHORT).show();
                        getScreenManager().pop();
                    })
                    .build();
            paneBuilder.addAction(clearAction);
        }

        return new PaneTemplate.Builder(paneBuilder.build())
                .setTitle(incident.title)
                .setHeaderAction(Action.BACK)
                .build();
    }
}
