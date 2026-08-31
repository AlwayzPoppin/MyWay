package com.mywaygps.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native Android Audio Focus Plugin
 * Requests and abandons audio focus with transient ducking for navigation chimes,
 * turn-by-turn spoken guidance, and critical SOS alerts.
 */
@CapacitorPlugin(name = "NativeAudioFocus")
public class NativeAudioFocusPlugin extends Plugin {
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private AudioManager.OnAudioFocusChangeListener focusChangeListener;

    @Override
    public void load() {
        super.load();
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        focusChangeListener = focusChange -> {
            // Automatically handled by Android OS audio mixer
        };
    }

    @PluginMethod
    public void requestFocus(PluginCall call) {
        try {
            if (audioManager == null) {
                audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            }

            if (audioManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AudioAttributes playbackAttributes = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build();

                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                            .setAudioAttributes(playbackAttributes)
                            .setAcceptsDelayedFocusGain(false)
                            .setOnAudioFocusChangeListener(focusChangeListener)
                            .build();

                    audioManager.requestAudioFocus(focusRequest);
                } else {
                    audioManager.requestAudioFocus(
                            focusChangeListener,
                            AudioManager.STREAM_MUSIC,
                            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                    );
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to request audio focus: " + e.getMessage());
        }
    }

    @PluginMethod
    public void abandonFocus(PluginCall call) {
        try {
            if (audioManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                    audioManager.abandonAudioFocusRequest(focusRequest);
                } else if (focusChangeListener != null) {
                    audioManager.abandonAudioFocus(focusChangeListener);
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to abandon audio focus: " + e.getMessage());
        }
    }
}
