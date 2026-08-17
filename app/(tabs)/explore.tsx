import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';

import { type CrowdLevel, type CrowdRegion } from '@/services/crowd-api';
import { getCrowdWarning, type Coordinate } from '@/services/crowd-safety';
import { connectCrowdWebSocket, sendLocation } from '../services/crowd-websocket';

const initialRegion = {
  latitude: 20.29545,
  longitude: 85.83645,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const regionColours: Record<CrowdLevel, { fill: string; stroke: string }> = {
  low: { fill: 'rgba(34, 197, 94, 0.22)', stroke: '#16A34A' },
  moderate: { fill: 'rgba(245, 158, 11, 0.26)', stroke: '#D97706' },
  extreme: { fill: 'rgba(239, 68, 68, 0.28)', stroke: '#DC2626' },
};

const warningColours: Record<CrowdLevel, string> = {
  low: '#15803D',
  moderate: '#B45309',
  extreme: '#B91C1C',
};

export default function CrowdMapScreen() {
  const mapRef = useRef<MapView | null>(null);

  // Ref (not state) because the 60s send-interval shouldn't restart on every GPS update.
  const locationRef = useRef<Coordinate | null>(null);

  const [regions, setRegions] = useState<CrowdRegion[]>([]);
  const [location, setLocation] = useState<Coordinate | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [warning, setWarning] = useState<{ level: CrowdLevel; message: string }>({
    level: 'low',
    message: 'Connecting to crowd service…',
  });

  // 1. Connect to WebSocket for live crowd region data
  useEffect(() => {
    const disconnect = connectCrowdWebSocket(
      (updatedRegions) => setRegions(updatedRegions),
      () => setSocketConnected(true),
      () => setSocketConnected(false),
      () => setSocketConnected(false),
    );

    return () => disconnect();
  }, []);

  // 2. Get and track user location
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    async function startLocationTracking() {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setLocationError('Location access is needed for nearby crowd warnings.');
        setWarning({
          level: 'low',
          message: 'Enable location to receive nearby crowd warnings.',
        });
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const initialLocation: Coordinate = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      };

      setLocation(initialLocation);
      locationRef.current = initialLocation;

      // Send initial location immediately
      sendLocation(initialLocation.latitude, initialLocation.longitude);

      // Watch location — updates the local display only, does NOT send every update to the server
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        ({ coords }) => {
          const newLocation: Coordinate = {
            latitude: coords.latitude,
            longitude: coords.longitude,
          };
          setLocation(newLocation);
          locationRef.current = newLocation;
        },
      );
    }

    void startLocationTracking().catch(() => {
      setLocationError('Unable to retrieve your current location.');
    });

    return () => subscription?.remove();
  }, []);

  // 3. Send location to server every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const currentLocation = locationRef.current;
      if (!currentLocation) return;
      sendLocation(currentLocation.latitude, currentLocation.longitude);
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // 4. Recalculate crowd warning whenever location or regions change
  useEffect(() => {
    if (!location || regions.length === 0) return;
    setWarning(getCrowdWarning(location, regions));
  }, [location, regions]);

  // 5. Recenter map on user location
  useEffect(() => {
    if (!location) return;
    mapRef.current?.animateToRegion(
      {
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      700,
    );
  }, [location]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
        mapType="standard"
      >
        {regions.map((region) => {
          const colours = regionColours[region.level];
          return (
            <Polygon
              key={region.id}
              coordinates={[
                { latitude: region.north, longitude: region.west }, // NW
                { latitude: region.north, longitude: region.east }, // NE
                { latitude: region.south, longitude: region.east }, // SE
                { latitude: region.south, longitude: region.west }, // SW
              ]}
              fillColor={colours.fill}
              strokeColor={colours.stroke}
              strokeWidth={2}
            />
          );
        })}

        {location && (
          <Marker coordinate={location} title="Your Location" description="Your current location" />
        )}
      </MapView>

      {/* Connection status */}
      <View style={styles.statusCard}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: socketConnected ? '#16A34A' : '#DC2626' },
          ]}
        />
        <Text style={styles.statusText}>
          {socketConnected ? 'Live crowd data' : 'Crowd service disconnected'}
        </Text>
      </View>

      {/* Warning card */}
      <View style={[styles.warningCard, { borderLeftColor: warningColours[warning.level] }]}>
        <Text style={[styles.warningLevel, { color: warningColours[warning.level] }]}>
          {warning.level.toUpperCase()}
        </Text>
        <Text style={styles.warningMessage}>{warning.message}</Text>

        {locationError && <Text style={styles.dataNote}>{locationError}</Text>}

        {regions.length > 0 && (
          <Text style={styles.dataNote}>Monitoring {regions.length} nearby areas</Text>
        )}
      </View>

      {/* Loading state */}
      {regions.length === 0 && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>Waiting for crowd data…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  statusCard: {
    position: 'absolute',
    top: 55,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  statusText: { fontSize: 12, fontWeight: '600', color: '#374151' },

  warningCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 5,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  warningLevel: { fontSize: 14, fontWeight: '800' },
  warningMessage: { marginTop: 5, fontSize: 14, color: '#374151' },
  dataNote: { marginTop: 6, fontSize: 12, color: '#6B7280' },

  loading: {
    position: 'absolute',
    top: '45%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loadingText: { marginTop: 8, color: '#374151', fontSize: 14 },
});