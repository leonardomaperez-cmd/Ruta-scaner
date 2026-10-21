package ar.leo.rutaescaner;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PermisosPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
