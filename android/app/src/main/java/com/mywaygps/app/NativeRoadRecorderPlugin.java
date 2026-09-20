package com.mywaygps.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.camera.video.FileOutputOptions;
import androidx.camera.video.Quality;
import androidx.camera.video.QualitySelector;
import androidx.camera.video.Recorder;
import androidx.camera.video.Recording;
import androidx.camera.video.VideoCapture;
import androidx.camera.video.VideoRecordEvent;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.File;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ExecutionException;

/** Local-only rear-camera recording for an active MyWay trip. */
@CapacitorPlugin(
    name = "NativeRoadRecorder",
    permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) }
)
public class NativeRoadRecorderPlugin extends Plugin {
    private static final int MAX_CLIPS = 20;
    private static final long DEFAULT_MAX_TOTAL_BYTES = 2L * 1024L * 1024L * 1024L;
    private ProcessCameraProvider cameraProvider;
    private Recording recording;
    private VideoCapture<Recorder> videoCapture;
    private Preview cameraPreview;
    private FrameLayout previewOverlay;
    private final Handler previewHandler = new Handler(Looper.getMainLooper());
    private boolean starting = false;
    private String outputPath = "";
    private long maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES;
    private String lastCameraError = "";

    @PluginMethod
    public void start(PluginCall call) {
        if (recording != null || starting) {
            resolveState(call, true);
            return;
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback");
            return;
        }
        configureStorageLimit(call);
        beginRecording(call, call.getString("quality", "hd"));
    }

    public void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            call.reject("Camera permission is required to record trips.");
            return;
        }
        configureStorageLimit(call);
        beginRecording(call, call.getString("quality", "hd"));
    }

    private void beginRecording(PluginCall call, String quality) {
        starting = true;
        ProcessCameraProvider.getInstance(getContext()).addListener(() -> {
            try {
                cameraProvider = ProcessCameraProvider.getInstance(getContext()).get();
                Recorder recorder = new Recorder.Builder()
                    .setQualitySelector(QualitySelector.from("standard".equals(quality) ? Quality.SD : Quality.HD))
                    .build();
                videoCapture = VideoCapture.withOutput(recorder);
                cameraPreview = new Preview.Builder().build();
                cameraProvider.unbindAll();
                cameraProvider.bindToLifecycle(getActivity(), CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, videoCapture);

                File movies = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                if (movies == null) throw new IllegalStateException("Video storage is unavailable.");
                if (!movies.exists() && !movies.mkdirs()) throw new IllegalStateException("Could not create video storage.");
                File output = new File(movies, "MyWay-" + System.currentTimeMillis() + ".mp4");
                outputPath = output.getAbsolutePath();
                FileOutputOptions options = new FileOutputOptions.Builder(output).build();
                recording = recorder.prepareRecording(getContext(), options)
                    .start(ContextCompat.getMainExecutor(getContext()), event -> onVideoEvent(event));
                starting = false;
                lastCameraError = "";
                resolveState(call, true);
                notifyStatus(true, null);
            } catch (ExecutionException | InterruptedException error) {
                Thread.currentThread().interrupt();
                starting = false;
                lastCameraError = error.getMessage() == null ? "Camera unavailable" : error.getMessage();
                call.reject("Could not start the road recorder.", error);
                notifyStatus(false, error.getMessage());
            } catch (Exception error) {
                starting = false;
                lastCameraError = error.getMessage() == null ? "Camera unavailable" : error.getMessage();
                call.reject("Could not start the road recorder.", error);
                notifyStatus(false, error.getMessage());
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private void onVideoEvent(@NonNull VideoRecordEvent event) {
        if (event instanceof VideoRecordEvent.Finalize) {
            VideoRecordEvent.Finalize finalized = (VideoRecordEvent.Finalize) event;
            boolean success = !finalized.hasError();
            recording = null;
            if (!success) {
                File failedOutput = new File(outputPath);
                if (failedOutput.exists()) failedOutput.delete();
                outputPath = "";
            } else {
                enforceStorageLimit();
            }
            notifyStatus(false, success ? null : "Recording stopped unexpectedly.");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        hidePreviewOverlay();
        if (recording != null) recording.stop();
        if (cameraProvider != null) cameraProvider.unbindAll();
        recording = null;
        videoCapture = null;
        cameraPreview = null;
        starting = false;
        resolveState(call, false);
        notifyStatus(false, null);
    }

    @PluginMethod
    public void getStatus(PluginCall call) { resolveState(call, recording != null || starting); }

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        boolean hasCamera = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
        boolean hasPermission = getPermissionState("camera") == PermissionState.GRANTED;
        String status;
        if (!hasCamera) {
            status = "unsupported";
        } else if (!hasPermission) {
            status = "permission_required";
        } else if (recording != null || starting) {
            status = "recording";
        } else if (lastCameraError.toLowerCase().contains("busy") || lastCameraError.toLowerCase().contains("in use")) {
            status = "camera_busy";
        } else if (!lastCameraError.isEmpty()) {
            status = "camera_unavailable";
        } else {
            status = "ready";
        }
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("message", lastCameraError);
        call.resolve(result);
    }

    @PluginMethod
    public void showPreview(PluginCall call) {
        if (recording == null || cameraPreview == null) {
            call.reject("Start recording before opening the camera preview.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                showPreviewOverlay();
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not show the camera preview.", error);
            }
        });
    }

    @PluginMethod
    public void listClips(PluginCall call) {
        JSArray clips = new JSArray();
        long totalBytes = 0;
        for (File clip : getClips()) {
            totalBytes += clip.length();
            JSObject item = new JSObject();
            item.put("path", clip.getAbsolutePath());
            item.put("name", clip.getName());
            item.put("createdAt", clip.lastModified());
            item.put("sizeBytes", clip.length());
            item.put("durationMs", getDurationMs(clip));
            item.put("protected", isProtectedClip(clip));
            clips.put(item);
        }
        JSObject result = new JSObject();
        result.put("clips", clips);
        result.put("totalBytes", totalBytes);
        result.put("maxBytes", maxTotalBytes);
        call.resolve(result);
    }

    @PluginMethod
    public void deleteClip(PluginCall call) {
        String path = call.getString("path");
        if (!isManagedClip(path)) {
            call.reject("That recording is not in the MyWay Road Recorder library.");
            return;
        }
        File clip = new File(path);
        if (clip.exists() && !clip.delete()) {
            call.reject("Could not delete this recording.");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void openClip(PluginCall call) {
        String path = call.getString("path");
        if (!isManagedClip(path) || !new File(path).exists()) {
            call.reject("This recording is unavailable.");
            return;
        }
        try {
            File clip = new File(path);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", clip);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "video/mp4")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(intent, "Open road recording"));
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open this recording.", error);
        }
    }

    @PluginMethod
    public void setClipProtected(PluginCall call) {
        String path = call.getString("path");
        Boolean shouldProtect = call.getBoolean("protected");
        if (!isManagedClip(path) || shouldProtect == null) {
            call.reject("This recording cannot be updated.");
            return;
        }
        File clip = new File(path);
        if (!clip.exists()) {
            call.reject("This recording is unavailable.");
            return;
        }
        boolean isProtected = isProtectedClip(clip);
        if (isProtected == shouldProtect) {
            JSObject result = new JSObject();
            result.put("path", clip.getAbsolutePath());
            result.put("protected", isProtected);
            call.resolve(result);
            return;
        }
        String filename = shouldProtect
            ? "MyWay-Protected-" + clip.getName().substring("MyWay-".length())
            : "MyWay-" + clip.getName().substring("MyWay-Protected-".length());
        File renamed = new File(clip.getParentFile(), filename);
        if (!clip.renameTo(renamed)) {
            call.reject("Could not update this recording.");
            return;
        }
        JSObject result = new JSObject();
        result.put("path", renamed.getAbsolutePath());
        result.put("protected", shouldProtect);
        call.resolve(result);
    }

    private File[] getClips() {
        File movies = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (movies == null) return new File[0];
        File[] clips = movies.listFiles(file -> file.isFile() && file.getName().startsWith("MyWay-") && file.getName().endsWith(".mp4"));
        if (clips == null) return new File[0];
        Arrays.sort(clips, Comparator.comparingLong(File::lastModified).reversed());
        return clips;
    }

    private boolean isManagedClip(String path) {
        if (path == null || path.isEmpty()) return false;
        try {
            File movies = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            if (movies == null) return false;
            File clip = new File(path).getCanonicalFile();
            String libraryPath = movies.getCanonicalPath() + File.separator;
            return clip.getPath().startsWith(libraryPath)
                && clip.getName().startsWith("MyWay-")
                && clip.getName().endsWith(".mp4");
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isProtectedClip(File clip) {
        return clip.getName().startsWith("MyWay-Protected-");
    }

    private void configureStorageLimit(PluginCall call) {
        Integer storageGb = call.getInt("storageGb", 2);
        int selectedGb = storageGb != null && (storageGb == 1 || storageGb == 2 || storageGb == 5) ? storageGb : 2;
        maxTotalBytes = selectedGb * 1024L * 1024L * 1024L;
    }

    private void showPreviewOverlay() {
        hidePreviewOverlay();
        if (cameraPreview == null) throw new IllegalStateException("Camera preview is unavailable.");

        FrameLayout root = getActivity().findViewById(android.R.id.content);
        PreviewView previewView = new PreviewView(getContext());
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        previewView.setBackgroundColor(0xFF111827);
        cameraPreview.setSurfaceProvider(previewView.getSurfaceProvider());

        previewOverlay = new FrameLayout(getContext());
        previewOverlay.setBackgroundColor(0xFF111827);
        previewOverlay.setOnClickListener(view -> hidePreviewOverlay());
        previewOverlay.addView(previewView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView badge = new TextView(getContext());
        badge.setText("  ● LIVE CAMERA  ");
        badge.setTextColor(0xFFFFFFFF);
        badge.setTextSize(10);
        badge.setGravity(Gravity.CENTER);
        badge.setBackgroundColor(0xCCDC2626);
        FrameLayout.LayoutParams badgeParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(24), Gravity.TOP | Gravity.LEFT);
        previewOverlay.addView(badge, badgeParams);

        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(dp(176), dp(118), Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        overlayParams.setMargins(dp(12), 0, dp(12), 0);
        root.addView(previewOverlay, overlayParams);
        previewHandler.postDelayed(this::hidePreviewOverlay, 5000);
    }

    private void hidePreviewOverlay() {
        previewHandler.removeCallbacksAndMessages(null);
        if (cameraPreview != null) cameraPreview.setSurfaceProvider(null);
        if (previewOverlay != null) {
            ViewGroup parent = (ViewGroup) previewOverlay.getParent();
            if (parent != null) parent.removeView(previewOverlay);
            previewOverlay = null;
        }
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    private long getDurationMs(File clip) {
        MediaMetadataRetriever metadata = new MediaMetadataRetriever();
        try {
            metadata.setDataSource(clip.getAbsolutePath());
            String duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return duration == null ? 0 : Long.parseLong(duration);
        } catch (Exception ignored) {
            return 0;
        } finally {
            try {
                metadata.release();
            } catch (Exception ignored) {
                // Some device codecs can fail while releasing metadata.
            }
        }
    }

    private void enforceStorageLimit() {
        File[] clips = getClips();
        long totalBytes = 0;
        for (File clip : clips) totalBytes += clip.length();
        int remainingClips = clips.length;
        for (int index = clips.length - 1; index >= 0 && (remainingClips > MAX_CLIPS || totalBytes > maxTotalBytes); index--) {
            File oldest = clips[index];
            if (isProtectedClip(oldest)) continue;
            long size = oldest.length();
            if (oldest.delete()) {
                totalBytes -= size;
                remainingClips--;
            }
        }
    }

    private void resolveState(PluginCall call, boolean active) {
        JSObject result = new JSObject();
        result.put("recording", active);
        result.put("path", outputPath);
        call.resolve(result);
    }

    private void notifyStatus(boolean active, String error) {
        JSObject event = new JSObject();
        event.put("recording", active);
        event.put("path", outputPath);
        if (error != null) event.put("error", error);
        notifyListeners("roadRecorderStatus", event);
    }
}
