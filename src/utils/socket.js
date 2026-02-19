// WebSocket connection to Vibe Coder XP Server
// Port 3001 is used by the Electron built-in server
// Port 3333 was the old standalone server port

const WS_URL = 'ws://localhost:3001';

let socket = null;
let reconnectTimer = null;
let connected = false;
let connecting = false;
let offlineLoggedOnce = false;

export function connectToXPServer() {
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
    socket = new WebSocket(WS_URL);

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
