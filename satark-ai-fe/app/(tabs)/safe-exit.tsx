import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { connectExitWebSocket, ExitGate, requestBestExit } from '../services/exit-service';

type UserLocation = Location.LocationObjectCoords;

export default function SafeExitScreen() {
  const [heading, setHeading] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [selectedExit, setSelectedExit] = useState<ExitGate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const locationRef = useRef<UserLocation | null>(null);
  const lastExitRequestLocation = useRef<UserLocation | null>(null);

  // Connect to the exit-selection WebSocket
  useEffect(() => {
    const disconnect = connectExitWebSocket(
      (exit) => {
        console.log('[Safe Exit] Selected exit:', exit);
        setSelectedExit(exit);
      },
      () => {
        console.log('[Safe Exit] WebSocket connected');
        setSocketConnected(true);
      },
      () => {
        console.log('[Safe Exit] WebSocket disconnected');
        setSocketConnected(false);
      },
      () => {
        console.log('[Safe Exit] WebSocket error');
        setSocketConnected(false);
      },
    );

    return () => disconnect();
  }, []);

  // Track location + heading, and request a new exit whenever the user
  // moves more than 20m from the last request point
  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;
    let headingSubscription: Location.LocationSubscription | null = null;

    async function start() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission is required.');
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        setUserLocation(location.coords);
        locationRef.current = location.coords;

        locationSubscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 2 },
          (newLocation) => {
            const coords = newLocation.coords;
            setUserLocation(coords);
            locationRef.current = coords;

            const previous = lastExitRequestLocation.current;

            // No previous request yet — fire the first one
            if (!previous) {
              if (socketConnected) {
                requestBestExit(coords.latitude, coords.longitude);
                lastExitRequestLocation.current = coords;
              }
              return;
            }

            // Re-request only if the user has moved far enough
            const distance = calculateDistance(
              previous.latitude,
              previous.longitude,
              coords.latitude,
              coords.longitude,
            );

            if (distance >= 20 && socketConnected) {
              console.log('[Safe Exit] User moved', Math.round(distance), 'm - requesting new exit');
              requestBestExit(coords.latitude, coords.longitude);
              lastExitRequestLocation.current = coords;
            }
          },
        );

        headingSubscription = await Location.watchHeadingAsync((headingData) => {
          const currentHeading =
            headingData.trueHeading >= 0 ? headingData.trueHeading : headingData.magHeading;
          setHeading(currentHeading);
        });
      } catch (e) {
        console.error('[Safe Exit] Error:', e);
        setError('Unable to access location or compass.');
      }
    }

    void start();

    return () => {
      headingSubscription?.remove();
      locationSubscription?.remove();
    };
  }, [socketConnected]);

  // Fire the initial exit request once we have both a location and a live socket
  useEffect(() => {
    if (!userLocation || !socketConnected) return;
    if (lastExitRequestLocation.current) return;

    console.log('[Safe Exit] Requesting initial exit');
    const success = requestBestExit(userLocation.latitude, userLocation.longitude);

    if (success) {
      lastExitRequestLocation.current = userLocation;
    }
  }, [userLocation, socketConnected]);

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!userLocation || heading === null || !selectedExit) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>
          {!socketConnected
            ? 'Connecting to exit service...'
            : !userLocation
              ? 'Finding your location...'
              : !selectedExit
                ? 'Finding safest exit...'
                : 'Calibrating compass...'}
        </Text>
      </View>
    );
  }

  const targetHeading = selectedExit.bearing;
  const rotation = calculateRotation(targetHeading, heading);

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Safest Exit</Text>
      <Text style={styles.subtitle}>Follow the arrow to {selectedExit.name}</Text>

      <View style={styles.compass}>
        <Text style={[styles.direction, styles.north]}>N</Text>
        <Text style={[styles.direction, styles.east]}>E</Text>
        <Text style={[styles.direction, styles.south]}>S</Text>
        <Text style={[styles.direction, styles.west]}>W</Text>

        <View style={[styles.arrowContainer, { transform: [{ rotate: `${rotation}deg` }] }]}>
          <Text style={styles.arrow}>↑</Text>
        </View>

        <View style={styles.centerPoint} />
      </View>

      <View style={styles.info}>
        <Text style={styles.infoTitle}>Safest Exit</Text>
        <Text style={styles.exitName}>{selectedExit.name}</Text>
        <Text style={styles.distance}>{selectedExit.distance} m away</Text>
        <Text style={styles.headingText}>{targetHeading.toFixed(0)}°</Text>
        <Text style={styles.currentHeading}>Phone heading: {heading.toFixed(0)}°</Text>
        <Text style={styles.connectionStatus}>
          {socketConnected ? 'Live exit guidance' : 'Exit service disconnected'}
        </Text>
      </View>
    </View>
  );
}

// Haversine distance between two coordinates, in meters
function calculateDistance(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const R = 6371000;
  const lat1 = (latitude1 * Math.PI) / 180;
  const lat2 = (latitude2 * Math.PI) / 180;
  const deltaLatitude = ((latitude2 - latitude1) * Math.PI) / 180;
  const deltaLongitude = ((longitude2 - longitude1) * Math.PI) / 180;

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Returns the shortest rotation from the current phone heading toward the
 * exit. Positive = clockwise/right, negative = counter-clockwise/left.
 *
 * e.g. current = 350°, target = 10° -> +20° (not 340° the long way around).
 */
function calculateRotation(targetHeading: number, currentHeading: number): number {
  return ((targetHeading - currentHeading + 540) % 360) - 180;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginBottom: 40,
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#DC2626',
    textAlign: 'center',
  },
  compass: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 3,
    borderColor: '#222222',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  direction: {
    position: 'absolute',
    fontSize: 22,
    fontWeight: '700',
    color: '#222222',
  },
  north: { top: 12 },
  east: { right: 15 },
  south: { bottom: 12 },
  west: { left: 15 },
  arrowContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 110,
    fontWeight: '300',
    color: '#DC2626',
  },
  centerPoint: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#222222',
    position: 'absolute',
  },
  info: {
    marginTop: 40,
    alignItems: 'center',
  },
  infoTitle: {
    fontSize: 16,
    color: '#666666',
  },
  exitName: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  distance: {
    fontSize: 15,
    color: '#555555',
    marginTop: 4,
  },
  headingText: {
    fontSize: 32,
    fontWeight: '700',
    marginTop: 10,
  },
  currentHeading: {
    marginTop: 8,
    fontSize: 14,
    color: '#888888',
  },
  connectionStatus: {
    marginTop: 12,
    fontSize: 12,
    color: '#16A34A',
  },
});