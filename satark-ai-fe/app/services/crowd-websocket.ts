import type { CrowdRegion } from '@/services/crowd-api';

const WS_URL = 'ws://192.168.29.208:8000/ws/crowd';

export type CrowdWebSocketMessage = {
  type: 'CROWD_UPDATE';
  latitude: number;
  longitude: number;
  regions: CrowdRegion[];
  timestamp: string;
};

let socket: WebSocket | null = null;

export function connectCrowdWebSocket(
  onRegionsUpdate: (regions: CrowdRegion[]) => void,
  onConnected?: () => void,
  onDisconnected?: () => void,
  onError?: () => void,
) {

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {

    console.log('[WebSocket] Connected');

    onConnected?.();
  };

  socket.onmessage = (event) => {

    try {

      const data: CrowdWebSocketMessage =
        JSON.parse(event.data);

      console.log(
        '[WebSocket] Crowd update received'
      );

      if (data.type === 'CROWD_UPDATE') {

        onRegionsUpdate(data.regions);
      }

    } catch (error) {

      console.error(
        '[WebSocket] Invalid message:',
        error
      );

    }

  };

  socket.onerror = (error) => {

    console.error(
      '[WebSocket] Error:',
      error
    );

    onError?.();
  };

  socket.onclose = () => {

    console.log(
      '[WebSocket] Disconnected'
    );

    onDisconnected?.();
  };

  return () => {

    socket?.close();

    socket = null;
  };
}


// ----------------------------------------------
// Send user's location to server
// ----------------------------------------------

export function sendLocation(
  latitude: number,
  longitude: number,
) {

  if (
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {

    socket.send(
      JSON.stringify({
        type: 'LOCATION_UPDATE',

        latitude,
        longitude,

        timestamp: new Date().toISOString(),
      })
    );

    console.log(
      '[WebSocket] Location sent:',
      latitude,
      longitude
    );

  } else {

    console.log(
      '[WebSocket] Cannot send location: not connected'
    );

  }

}