package com.mywaygps.app;

import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeContact")
public class NativeContactPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String phone = call.getString("phone", "");
        String action = call.getString("action", "");
        if (!phone.matches("\\+[1-9][0-9]{6,14}") || !(action.equals("text") || action.equals("call"))) {
            call.reject("Invalid contact action or phone number.");
            return;
        }
        Intent intent = action.equals("text")
            ? new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + phone))
            : new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone));
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("No app is available for this action. You can copy the number instead.");
        } catch (SecurityException error) {
            call.reject("Could not open the phone app. You can copy the number instead.");
        }
    }
}
