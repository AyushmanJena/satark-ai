const WS_URL = 'ws://192.168.29.208:8082';

export type ExitGate = {
  id: string;
  name: string;

  latitude: number;
  longitude: number;

  distance: number;

  /**
   * Bearing from the user to the exit.
   *
   * 0   = North
   * 90  = East
   * 180 = South
   * 270 = West
   */
  bearing: number;
};


type ExitResponse = {
  type: 'EXIT_RESPONSE';
  success: boolean;
  exit?: ExitGate;
  message?: string;
  timestamp?: string;
};


// ============================================================
// WEBSOCKET
// ============================================================

let socket: WebSocket | null = null;


// ============================================================
// CONNECT
// ============================================================

export function connectExitWebSocket(
  onExitReceived: (exit: ExitGate) => void,
  onConnected?: () => void,
  onDisconnected?: () => void,
  onError?: () => void,
): () => void {

  console.log(
    '[Exit WebSocket] Connecting...'
  );


  socket = new WebSocket(WS_URL);


  // ----------------------------------------------------------
  // Connected
  // ----------------------------------------------------------

  socket.onopen = () => {

    console.log(
      '[Exit WebSocket] Connected'
    );

    onConnected?.();
  };


  // ----------------------------------------------------------
  // Message received
  // ----------------------------------------------------------

  socket.onmessage = (event) => {
    try {
      const data: ExitResponse =
        JSON.parse(event.data);
      console.log(
        '[Exit WebSocket] Received:',
        data
      );

      if (
        data.type === 'EXIT_RESPONSE'
      ) {
        if (
          data.success &&
          data.exit
        ) {
          onExitReceived(
            data.exit
          );
        } else {
          console.warn(
            '[Exit WebSocket] No exit available:',
            data.message
          );
        }

      }

    } catch (error) {
      console.error(
        '[Exit WebSocket] Invalid response:',
        error
      );
    }
  };


  // ----------------------------------------------------------
  // Error
  // ----------------------------------------------------------

  socket.onerror = (error) => {
    console.error(
      '[Exit WebSocket] Error:',
      error
    );
    onError?.();
  };


  // ----------------------------------------------------------
  // Disconnected
  // ----------------------------------------------------------

  socket.onclose = () => {
    console.log(
      '[Exit WebSocket] Disconnected'
    );
    socket = null;
    onDisconnected?.();
  };

  // ----------------------------------------------------------
  // Cleanup function
  // ----------------------------------------------------------

  return () => {
    console.log(
      '[Exit WebSocket] Closing connection'
    );
    socket?.close();
    socket = null;
  };
}


// ============================================================
// REQUEST BEST EXIT
// ============================================================

export function requestBestExit(
  latitude: number,
  longitude: number,
): boolean {

  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    console.warn(
      '[Exit WebSocket] Cannot request exit - not connected'
    );
    return false;
  }


  const message = {

    type: 'EXIT_REQUEST',

    latitude,
    longitude,

    timestamp:
      new Date().toISOString(),

  };


  socket.send(
    JSON.stringify(message)
  );


  console.log(
    '[Exit WebSocket] Exit requested:',
    message
  );


  return true;
}


// ============================================================
// DISCONNECT
// ============================================================

export function disconnectExitWebSocket(): void {

  socket?.close();

  socket = null;
}
