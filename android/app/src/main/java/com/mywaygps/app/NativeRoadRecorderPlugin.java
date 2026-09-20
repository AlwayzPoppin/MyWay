package com.mywaygps.app;

import android.Manifest;
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
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.File;
import java.util.concurrent.ExecutionException;

/** Local-only rear-camera recording for an active MyWay trip. */
@CapacitorPlugin(
    name = "NativeRoadRecorder",
    permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) }
)
public class NativeRoadRecorderPlugin extends Plugin {
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
            if (!success) outputPath = "";
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
