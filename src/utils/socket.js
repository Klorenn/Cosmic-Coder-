// WebSocket connection to XP Server (optional). In deploy mode use config URL only — never localhost.

let socket = null;
let reconnectTimer = null;
let connected = false;
let connecting = false;
let offlineLoggedOnce = false;

function isLocalhost() {
  if (typeof window === 'undefined' || !window.location?.hostname) return false;
  return /^localhost$|^127\.0\.0\.1$/i.test(window.location.hostname);
}

function getXPWebSocketUrl() {
  if (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_XP_WS_URL) {
    const url = String(window.__VITE_CONFIG__.VITE_XP_WS_URL).trim();
    if (url && (url.startsWith('ws://') || url.startsWith('wss://'))) return url;
  }
  if (!isLocalhost()) return null;
  return 'ws://localhost:3001';
}

export function connectToXPServer() {
  const wsUrl = getXPWebSocketUrl();
  if (!wsUrl) return;

  // Guard against concurrent connection attempts
  if (connecting) return;
  if (socket && socket.readyState === WebSocket.OPEN) {
    return; // Already connected
  }

  // Clear stale socket reference (CLOSING/CLOSED state)
  if (socket && socket.readyState !== WebSocket.CONNECTING) {
    socket = null;
  }

  connecting = true;

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      connected = true;
      connecting = false;
      offlineLoggedOnce = false; // Reset so next offline we can log once
      console.log('✅ Connected to XP server!');

      // Dispatch connection event
      window.dispatchEvent(new CustomEvent('xpserver-connected'));

      // Clear any reconnect timer
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const sourceName = data.sourceName || 'CODE';
        console.log(`📥 XP Event: ${data.type} +${data.amount} [${sourceName}]`);

        // Add XP through the game state
        if (window.VIBE_CODER) {
          // Pass source to addXP so isCodingActive() works for auto-move
          const source = {
            name: data.sourceName || 'CODE',
            color: data.sourceColor || '#ffffff'
          };
          window.VIBE_CODER.addXP(data.amount, source);
        }
      } catch (e) {
        console.error('Failed to parse XP event:', e);
      }
    };

    socket.onclose = () => {
      connected = false;
      connecting = false;
      // Dispatch disconnection event (UI can react); no console spam
      window.dispatchEvent(new CustomEvent('xpserver-disconnected'));

      // Schedule reconnect
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectToXPServer();
        }, 3000);
      }
    };

    socket.onerror = () => {
      // Log only once per session when server is not available (avoid console spam)
      if (!offlineLoggedOnce) {
        offlineLoggedOnce = true;
        console.log('💤 XP server offline (optional: run `npm run server` for live XP)');
      }
      // onclose will fire after onerror, which handles reconnection
    };
  } catch (e) {
    connecting = false;
    if (!offlineLoggedOnce) {
      offlineLoggedOnce = true;
      console.log('💤 XP server offline (optional: run `npm run server` for live XP)');
    }
  }
}

export function isConnected() {
  return connected;
}

export function disconnect() {
  connecting = false;
  if (socket) {
    socket.close();
    socket = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}
