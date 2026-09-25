package com.lucas.todotree;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(NativeWorkspacePlugin.class);
        super.onCreate(state);
    }
}
