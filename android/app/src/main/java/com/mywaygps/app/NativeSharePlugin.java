package com.mywaygps.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeShare")
public class NativeSharePlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "Share place").trim();
        String text = call.getString("text", "").trim();
        String url = call.getString("url", "").trim();
        if (text.isEmpty() && url.isEmpty()) {
            call.reject("A place name or link is required to share.");
            return;
        }

        String payload = text.isEmpty() ? url : (url.isEmpty() ? text : text + "\n" + url);
        Intent sendIntent = new Intent(Intent.ACTION_SEND);
        sendIntent.setType("text/plain");
        sendIntent.putExtra(Intent.EXTRA_TEXT, payload);
        sendIntent.putExtra(Intent.EXTRA_TITLE, title);
        try {
            getActivity().startActivity(Intent.createChooser(sendIntent, title));
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("No app is available to share this place.");
        }
    }
}
