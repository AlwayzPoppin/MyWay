package com.mywaygps.app;

import android.Manifest;
import android.content.Intent;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Environment;
import androidx.annotation.NonNull;
import androidx.camera.core.CameraSelector;
import androidx.camera.lifecycle.ProcessCameraProvider;
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
    private static final long MAX_TOTAL_BYTES = 2L * 1024L * 1024L * 1024L;
    private ProcessCameraProvider cameraProvider;
    private Recording recording;
    private boolean starting = false;
    private String outputPath = "";

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
        beginRecording(call);
    }

    public void cameraPermissionCallback(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            call.reject("Camera permission is required to record trips.");
            return;
        }
        beginRecording(call);
    }

    private void beginRecording(PluginCall call) {
        starting = true;
        ProcessCameraProvider.getInstance(getContext()).addListener(() -> {
            try {
                cameraProvider = ProcessCameraProvider.getInstance(getContext()).get();
                Recorder recorder = new Recorder.Builder()
                    .setQualitySelector(QualitySelector.from(Quality.HD))
                    .build();
                VideoCapture<Recorder> videoCapture = VideoCapture.withOutput(recorder);
                cameraProvider.unbindAll();
                cameraProvider.bindToLifecycle(getActivity(), CameraSelector.DEFAULT_BACK_CAMERA, videoCapture);

                File movies = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                if (movies == null) throw new IllegalStateException("Video storage is unavailable.");
                if (!movies.exists() && !movies.mkdirs()) throw new IllegalStateException("Could not create video storage.");
                File output = new File(movies, "MyWay-" + System.currentTimeMillis() + ".mp4");
                outputPath = output.getAbsolutePath();
                FileOutputOptions options = new FileOutputOptions.Builder(output).build();
                recording = recorder.prepareRecording(getContext(), options)
                    .start(ContextCompat.getMainExecutor(getContext()), event -> onVideoEvent(event));
                starting = false;
                resolveState(call, true);
                notifyStatus(true, null);
            } catch (ExecutionException | InterruptedException error) {
                Thread.currentThread().interrupt();
                starting = false;
                call.reject("Could not start the road recorder.", error);
                notifyStatus(false, error.getMessage());
            } catch (Exception error) {
                starting = false;
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
        if (recording != null) recording.stop();
        if (cameraProvider != null) cameraProvider.unbindAll();
        recording = null;
        starting = false;
        resolveState(call, false);
        notifyStatus(false, null);
    }

    @PluginMethod
    public void getStatus(PluginCall call) { resolveState(call, recording != null || starting); }

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
        result.put("maxBytes", MAX_TOTAL_BYTES);
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
        for (int index = clips.length - 1; index >= 0 && (remainingClips > MAX_CLIPS || totalBytes > MAX_TOTAL_BYTES); index--) {
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
