/*
 * Derived from Gnirehtet (Copyright 2017 Genymobile).
 * Modified by the RevBridge contributors in 2026.
 * Licensed under the Apache License, Version 2.0.
 */

package io.github.innocent254.revbridge;

import android.os.Handler;

/**
 * Convenient wrapper to dispatch events to the given {@link Handler}.
 */
public class RelayTunnelListener {

    static final int MSG_RELAY_TUNNEL_CONNECTED = 0;
    static final int MSG_RELAY_TUNNEL_DISCONNECTED = 1;

    private final Handler handler;

    public RelayTunnelListener(Handler handler) {
        this.handler = handler;
    }

    public void notifyRelayTunnelConnected() {
        handler.sendEmptyMessage(MSG_RELAY_TUNNEL_CONNECTED);
    }

    public void notifyRelayTunnelDisconnected() {
        handler.sendEmptyMessage(MSG_RELAY_TUNNEL_DISCONNECTED);
    }
}
