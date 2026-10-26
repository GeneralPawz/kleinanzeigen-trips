package de.generalpawz.troedeltour;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import androidx.core.content.FileProvider;
import androidx.core.graphics.ColorUtils;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/** APK installer for the in-app updater, plus system bar colours (the activity is edge-to-edge). */
@CapacitorPlugin(name = "Installer")
public class InstallerPlugin extends Plugin {

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", canInstall());
        call.resolve(r);
    }

    /** Opens "Install unknown apps" for this app. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Starts the system package installer for a downloaded APK (absolute path inside the app cache dir). */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path fehlt");
            return;
        }
        if (path.startsWith("file://")) path = Uri.parse(path).getPath();
        File file = new File(path);
        if (!file.isFile()) {
            call.reject("APK nicht gefunden");
            return;
        }
        if (!canInstall()) {
            call.reject("PERMISSION");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Installer konnte nicht gestartet werden: " + e.getMessage());
        }
    }

    /**
     * Icon contrast of the transparent system bars (the page draws under them): "color" is what the page shows
     * under the status bar (header), "navColor" what it shows under the navigation bar (tab bar). Both #RRGGBB.
     */
    @PluginMethod
    public void setBarColor(PluginCall call) {
        String top = call.getString("color", "#1D4B00");
        String bottom = call.getString("navColor", top);
        getActivity().runOnUiThread(() -> {
            try {
                int t = android.graphics.Color.parseColor(top);
                int b = android.graphics.Color.parseColor(bottom);
                Window w = getActivity().getWindow();
                w.getDecorView().setBackgroundColor(b);
                WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(w, w.getDecorView());
                ctl.setAppearanceLightStatusBars(ColorUtils.calculateLuminance(t) > 0.5);
                ctl.setAppearanceLightNavigationBars(ColorUtils.calculateLuminance(b) > 0.5);
                call.resolve();
            } catch (IllegalArgumentException e) {
                call.reject("ungültige Farbe");
            }
        });
    }
}
