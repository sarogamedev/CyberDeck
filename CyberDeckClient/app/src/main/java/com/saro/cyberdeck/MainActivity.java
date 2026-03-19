package com.saro.cyberdeck;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.view.View;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.util.ArrayList;
import java.util.List;

/**
 * Main activity showing discovered CyberDeck nodes on the network.
 * Features a radar-like scanning UI with pull-to-refresh.
 */
public class MainActivity extends AppCompatActivity implements DiscoveryService.DiscoveryListener {

    private static final int PERMISSION_REQUEST_CODE = 100;

    private RecyclerView recyclerView;
    private NodeAdapter adapter;
    private SwipeRefreshLayout swipeRefresh;
    private TextView emptyText;
    private TextView scanningText;
    private View radarPulse;

    private DiscoveryService discoveryService;
    private boolean serviceBound = false;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            DiscoveryService.LocalBinder localBinder = (DiscoveryService.LocalBinder) binder;
            discoveryService = localBinder.getService();
            discoveryService.addListener(MainActivity.this);
            serviceBound = true;
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            serviceBound = false;
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Setup views
        recyclerView = findViewById(R.id.nodeList);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        emptyText = findViewById(R.id.emptyText);
        scanningText = findViewById(R.id.scanningText);
        radarPulse = findViewById(R.id.radarPulse);

        // RecyclerView setup
        adapter = new NodeAdapter();
        recyclerView.setLayoutManager(new LinearLayoutManager(this));
        recyclerView.setAdapter(adapter);

        adapter.setOnNodeClickListener(node -> {
            Intent intent = new Intent(MainActivity.this, ConnectActivity.class);
            intent.putExtra("ip", node.getIpAddress());
            intent.putExtra("port", node.getPort());
            intent.putExtra("name", node.getDisplayName());
            startActivity(intent);
        });

        // Pull-to-refresh
        swipeRefresh.setColorSchemeColors(0xFFFFA500); // Amber
        swipeRefresh.setProgressBackgroundColorSchemeColor(0xFF1A1A1A);
        swipeRefresh.setOnRefreshListener(() -> {
            if (serviceBound) {
                discoveryService.restartDiscovery();
            }
            swipeRefresh.setRefreshing(false);
        });

        // Check and request permissions
        checkPermissions();
    }

    @Override
    protected void onStart() {
        super.onStart();
        // Start and bind to the discovery service
        Intent serviceIntent = new Intent(this, DiscoveryService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (serviceBound) {
            discoveryService.removeListener(this);
            unbindService(serviceConnection);
            serviceBound = false;
        }
    }

    // ── DiscoveryListener ──

    @Override
    public void onNodesUpdated(List<CyberDeckNode> nodes) {
        runOnUiThread(() -> {
            adapter.updateNodes(nodes);
            if (nodes.isEmpty()) {
                emptyText.setVisibility(View.VISIBLE);
                recyclerView.setVisibility(View.GONE);
                scanningText.setText("Scanning your network...");
                radarPulse.setVisibility(View.VISIBLE);
            } else {
                emptyText.setVisibility(View.GONE);
                recyclerView.setVisibility(View.VISIBLE);
                scanningText.setText(nodes.size() + " CyberDeck" + (nodes.size() > 1 ? "s" : "") + " found");
                radarPulse.setVisibility(View.VISIBLE);
            }
        });
    }

    // ── Permissions ──

    private void checkPermissions() {
        List<String> needed = new ArrayList<>();

        // Location is required for NSD on Android 12+
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }

        // Notification permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Discovery will still work via UDP even without location permission (mDNS may be limited)
    }
}
