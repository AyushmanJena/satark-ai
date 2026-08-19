// Same backend host as the WebSocket services (crowd-websocket.ts,
// exit-service.ts) but for plain HTTP REST calls like SOS.
//
// Keep this in sync with the WS_URL host in those two files - if you
// change your dev machine's LAN IP, update it here too.
export const API_BASE_URL = 'http://192.168.29.208:8000';
