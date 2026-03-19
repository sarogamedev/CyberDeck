package com.saro.cyberdeck;

/**
 * Represents a discovered CyberDeck node on the network.
 */
public class CyberDeckNode {
    private final String ipAddress;
    private final int port;
    private long lastSeen;
    private String discoveryMethod; // "mDNS" or "UDP"
    private String hostname;

    public CyberDeckNode(String ipAddress, int port, String discoveryMethod) {
        this.ipAddress = ipAddress;
        this.port = port;
        this.discoveryMethod = discoveryMethod;
        this.lastSeen = System.currentTimeMillis();
        this.hostname = "";
    }

    public String getIpAddress() { return ipAddress; }
    public int getPort() { return port; }
    public long getLastSeen() { return lastSeen; }
    public String getDiscoveryMethod() { return discoveryMethod; }
    public String getHostname() { return hostname; }

    public void setLastSeen(long lastSeen) { this.lastSeen = lastSeen; }
    public void setDiscoveryMethod(String method) { this.discoveryMethod = method; }
    public void setHostname(String hostname) { this.hostname = hostname; }

    public boolean isStale() {
        return System.currentTimeMillis() - lastSeen > 30000; // 30 seconds
    }

    public String getDisplayName() {
        if (hostname != null && !hostname.isEmpty()) {
            return hostname;
        }
        return ipAddress;
    }

    public String getUrl() {
        return "http://" + ipAddress + ":" + port;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        CyberDeckNode that = (CyberDeckNode) o;
        return ipAddress.equals(that.ipAddress);
    }

    @Override
    public int hashCode() {
        return ipAddress.hashCode();
    }
}
