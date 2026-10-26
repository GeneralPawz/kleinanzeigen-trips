package de.generalpawz.troedeltour;

import android.view.Window;
import androidx.core.graphics.ColorUtils;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** System bar icon contrast (the activity is edge-to-edge). */
@CapacitorPlugin(name = "BarColor")
public class BarColorPlugin extends Plugin {

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
