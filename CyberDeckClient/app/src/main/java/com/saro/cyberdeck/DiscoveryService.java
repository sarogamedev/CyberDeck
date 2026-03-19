package com.saro.cyberdeck;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Background service that discovers CyberDeck nodes via:
 * 1. NSD (mDNS) — service type _cyberdtn._tcp
 * 2. UDP broadcast beacons on port 8887
 */
public class DiscoveryService extends Service {

    private static final String TAG = "DiscoveryService";
    private static final String CHANNEL_ID = "cyberdeck_discovery";
    private static final int NOTIFICATION_ID = 1001;
    private static final String NSD_SERVICE_TYPE = "_cyberdtn._tcp.";
    private static final int UDP_PORT = 8887;
    private static final int CYBERDECK_HTTP_PORT = 8888;
    private static final int STALE_THRESHOLD_MS = 30000;
    private static final int PURGE_INTERVAL_MS = 5000;

    private final IBinder binder = new LocalBinder();
    private final CopyOnWriteArrayList<CyberDeckNode> discoveredNodes = new CopyOnWriteArrayList<>();
    private final List<DiscoveryListener> listeners = new CopyOnWriteArrayList<>();

    private NsdManager nsdManager;
    private NsdManager.DiscoveryListener nsdDiscoveryListener;
    private ExecutorService executor;
    private DatagramSocket udpSocket;
    private volatile boolean isRunning = false;
    private Handler handler;

    public class LocalBinder extends Binder {
        public DiscoveryService getService() {
            return DiscoveryService.this;
        }
    }

    public interface DiscoveryListener {
        void onNodesUpdated(List<CyberDeckNode> nodes);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        executor = Executors.newFixedThreadPool(3);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
        startDiscovery();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        stopDiscovery();
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    // ── Public API ──

    public void addListener(DiscoveryListener listener) {
        listeners.add(listener);
        notifyListeners();
    }

    public void removeListener(DiscoveryListener listener) {
        listeners.remove(listener);
    }

    public List<CyberDeckNode> getDiscoveredNodes() {
        return new ArrayList<>(discoveredNodes);
    }

    public void restartDiscovery() {
        stopDiscovery();
        discoveredNodes.clear();
        notifyListeners();
        startDiscovery();
    }

    // ── Discovery Logic ──

    private void startDiscovery() {
        if (isRunning) return;
        isRunning = true;
        Log.i(TAG, "Starting CyberDeck discovery...");

        startNsdDiscovery();
        startUdpListener();
        startUdpBroadcaster();
        startStalePurger();
    }

    private void stopDiscovery() {
        isRunning = false;

        // Stop NSD
        if (nsdManager != null && nsdDiscoveryListener != null) {
            try {
                nsdManager.stopServiceDiscovery(nsdDiscoveryListener);
            } catch (Exception e) {
                Log.w(TAG, "Error stopping NSD: " + e.getMessage());
            }
        }

        // Close UDP socket
        if (udpSocket != null && !udpSocket.isClosed()) {
            udpSocket.close();
        }
    }

    // ═══ NSD (mDNS) Discovery ═══

    private void startNsdDiscovery() {
        nsdManager = (NsdManager) getSystemService(Context.NSD_SERVICE);
        if (nsdManager == null) {
            Log.e(TAG, "NsdManager not available");
            return;
        }

        nsdDiscoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
                Log.i(TAG, "mDNS discovery started for " + serviceType);
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                Log.i(TAG, "mDNS: Found service " + serviceInfo.getServiceName());
                nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo si, int errorCode) {
                        Log.w(TAG, "mDNS resolve failed: " + errorCode);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo si) {
                        InetAddress host = si.getHost();
                        if (host != null) {
                            String ip = host.getHostAddress();
                            if (ip != null && !isOwnIp(ip)) {
                                int port = si.getPort() > 0 ? si.getPort() : CYBERDECK_HTTP_PORT;
                                addOrUpdateNode(ip, port, "mDNS", si.getServiceName());
                            }
                        }
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                Log.i(TAG, "mDNS: Service lost " + serviceInfo.getServiceName());
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                Log.i(TAG, "mDNS discovery stopped");
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "mDNS discovery start failed: " + errorCode);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "mDNS discovery stop failed: " + errorCode);
            }
        };

        try {
            nsdManager.discoverServices(NSD_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, nsdDiscoveryListener);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start NSD discovery: " + e.getMessage());
        }
    }

    // ═══ UDP Beacon Listener ═══

    private void startUdpListener() {
        executor.execute(() -> {
            try {
                udpSocket = new DatagramSocket(UDP_PORT);
                udpSocket.setBroadcast(true);
                udpSocket.setSoTimeout(0); // Block indefinitely

                byte[] buffer = new byte[1024];
                Log.i(TAG, "UDP listener active on port " + UDP_PORT);

                while (isRunning && !udpSocket.isClosed()) {
                    try {
                        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                        udpSocket.receive(packet);

                        String message = new String(packet.getData(), 0, packet.getLength()).trim();
                        String senderIp = packet.getAddress().getHostAddress();

                        if (message.contains("\"cyberdtn\"") && message.contains("true") && !isOwnIp(senderIp)) {
                            addOrUpdateNode(senderIp, CYBERDECK_HTTP_PORT, "UDP", "");
                        }
                    } catch (Exception e) {
                        if (isRunning) {
                            Log.w(TAG, "UDP receive error: " + e.getMessage());
                        }
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "UDP listener failed to start: " + e.getMessage());
            }
        });
    }

    // ═══ UDP Beacon Broadcaster ═══

    private void startUdpBroadcaster() {
        executor.execute(() -> {
            try {
                DatagramSocket broadcastSocket = new DatagramSocket();
                broadcastSocket.setBroadcast(true);
                String beacon = "{\"cyberdtn\":true}";
                byte[] data = beacon.getBytes();

                while (isRunning) {
                    try {
                        // Broadcast to 255.255.255.255
                        DatagramPacket packet = new DatagramPacket(
                                data, data.length,
                                InetAddress.getByName("255.255.255.255"), UDP_PORT
                        );
                        broadcastSocket.send(packet);

                        // Also broadcast to subnet-specific addresses
                        List<String> broadcastAddresses = getBroadcastAddresses();
                        for (String addr : broadcastAddresses) {
                            try {
                                DatagramPacket subnetPacket = new DatagramPacket(
                                        data, data.length,
                                        InetAddress.getByName(addr), UDP_PORT
                                );
                                broadcastSocket.send(subnetPacket);
                            } catch (Exception ignored) {}
                        }

                        Thread.sleep(10000); // Every 10 seconds, matching the server
                    } catch (InterruptedException e) {
                        break;
                    } catch (Exception e) {
                        Log.w(TAG, "UDP broadcast error: " + e.getMessage());
                        Thread.sleep(10000);
                    }
                }
                broadcastSocket.close();
            } catch (Exception e) {
                Log.e(TAG, "UDP broadcaster failed: " + e.getMessage());
            }
        });
    }

    // ═══ Node Management ═══

    private void addOrUpdateNode(String ip, int port, String method, String hostname) {
        boolean isNew = true;
        for (CyberDeckNode node : discoveredNodes) {
            if (node.getIpAddress().equals(ip)) {
                node.setLastSeen(System.currentTimeMillis());
                node.setDiscoveryMethod(method);
                if (hostname != null && !hostname.isEmpty()) {
                    node.setHostname(hostname);
                }
                isNew = false;
                break;
            }
        }

        if (isNew) {
            CyberDeckNode node = new CyberDeckNode(ip, port, method);
            if (hostname != null && !hostname.isEmpty()) {
                node.setHostname(hostname);
            }
            discoveredNodes.add(node);
            Log.i(TAG, "NEW CyberDeck found: " + ip + " via " + method);
        }

        handler.post(this::notifyListeners);
    }

    private void startStalePurger() {
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!isRunning) return;
                boolean changed = false;
                Iterator<CyberDeckNode> it = discoveredNodes.iterator();
                while (it.hasNext()) {
                    if (it.next().isStale()) {
                        it.remove();
                        changed = true;
                    }
                }
                if (changed) notifyListeners();
                handler.postDelayed(this, PURGE_INTERVAL_MS);
            }
        }, PURGE_INTERVAL_MS);
    }

    private void notifyListeners() {
        List<CyberDeckNode> snapshot = new ArrayList<>(discoveredNodes);
        for (DiscoveryListener listener : listeners) {
            listener.onNodesUpdated(snapshot);
        }
    }

    // ═══ Helpers ═══

    private boolean isOwnIp(String ip) {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface iface = interfaces.nextElement();
                Enumeration<InetAddress> addresses = iface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress addr = addresses.nextElement();
                    if (addr.getHostAddress() != null && addr.getHostAddress().equals(ip)) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error checking own IP: " + e.getMessage());
        }
        return false;
    }

    private List<String> getBroadcastAddresses() {
        List<String> result = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface iface = interfaces.nextElement();
                if (iface.isLoopback() || !iface.isUp()) continue;
                Enumeration<InetAddress> addresses = iface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress addr = addresses.nextElement();
                    if (addr.getHostAddress() != null && addr.getHostAddress().contains(".")) {
                        String[] parts = addr.getHostAddress().split("\\.");
                        if (parts.length == 4) {
                            parts[3] = "255";
                            result.add(String.join(".", parts));
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error getting broadcast addresses: " + e.getMessage());
        }
        return result;
    }

    // ═══ Notification ═══

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "CyberDeck Discovery",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Scanning for nearby CyberDeck nodes");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("CyberDeck Scanner")
                .setContentText("Scanning for nearby CyberDecks...")
                .setSmallIcon(android.R.drawable.ic_menu_search)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .build();
    }
}
