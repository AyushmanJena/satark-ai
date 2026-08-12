import * as Location from 'expo-location';
import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { connectExitWebSocket, ExitGate, requestBestExit } from '../services/exit-service';




// ============================================================
// TYPES
// ============================================================

type UserLocation =
  Location.LocationObjectCoords;


// ============================================================
// SAFE EXIT SCREEN
// ============================================================

export default function SafeExitScreen() {

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------

  const [heading, setHeading] =
    useState<number | null>(null);

  const [userLocation, setUserLocation] =
    useState<UserLocation | null>(null);

  const [selectedExit, setSelectedExit] =
    useState<ExitGate | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [socketConnected, setSocketConnected] =
    useState(false);


  // ----------------------------------------------------------
  // Refs
  // ----------------------------------------------------------

  /*
   * Stores the latest location so we can send it to the
   * backend without recreating subscriptions.
   */

  const locationRef =
    useRef<UserLocation | null>(null);


  /*
   * Stores the last location at which we requested an exit.
   *
   * This prevents requesting a new exit on every GPS update.
   */

  const lastExitRequestLocation =
    useRef<UserLocation | null>(null);


  // ==========================================================
  // WEBSOCKET
  // ==========================================================

  useEffect(() => {

    const disconnect =
      connectExitWebSocket(

        // ----------------------------------------------------
        // Exit received from backend
        // ----------------------------------------------------

        (exit) => {

          console.log(
            '[Safe Exit] Selected exit:',
            exit
          );

          setSelectedExit(exit);

        },


        // ----------------------------------------------------
        // Connected
        // ----------------------------------------------------

        () => {

          console.log(
            '[Safe Exit] WebSocket connected'
          );

          setSocketConnected(true);

        },


        // ----------------------------------------------------
        // Disconnected
        // ----------------------------------------------------

        () => {

          console.log(
            '[Safe Exit] WebSocket disconnected'
          );

          setSocketConnected(false);

        },


        // ----------------------------------------------------
        // Error
        // ----------------------------------------------------

        () => {

          console.log(
            '[Safe Exit] WebSocket error'
          );

          setSocketConnected(false);

        },
      );


    return () => {

      disconnect();

    };

  }, []);


  // ==========================================================
  // LOCATION + COMPASS
  // ==========================================================

  useEffect(() => {

    let locationSubscription:
      Location.LocationSubscription | null = null;

    let headingSubscription:
      Location.LocationSubscription | null = null;


    async function start() {

      try {

        // ----------------------------------------------------
        // Request location permission
        // ----------------------------------------------------

        const {
          status,
        } =
          await Location.requestForegroundPermissionsAsync();


        if (status !== 'granted') {

          setError(
            'Location permission is required.'
          );

          return;
        }


        // ----------------------------------------------------
        // Get initial location
        // ----------------------------------------------------

        const location =
          await Location.getCurrentPositionAsync({

            accuracy:
              Location.Accuracy.High,

          });


        setUserLocation(
          location.coords
        );

        locationRef.current =
          location.coords;


        // ----------------------------------------------------
        // Watch location
        // ----------------------------------------------------

        locationSubscription =
          await Location.watchPositionAsync(

            {
              accuracy:
                Location.Accuracy.High,

              /*
               * We can receive local GPS updates fairly
               * frequently, but we don't request a new exit
               * every time.
               */

              distanceInterval: 2,
            },

            (newLocation) => {

              const coords =
                newLocation.coords;


              setUserLocation(
                coords
              );

              locationRef.current =
                coords;


              // ------------------------------------------------
              // Determine whether we moved far enough to
              // request a new exit.
              // ------------------------------------------------

              const previous =
                lastExitRequestLocation.current;


              if (!previous) {

                if (socketConnected) {

                  requestBestExit(
                    coords.latitude,
                    coords.longitude,
                  );

                  lastExitRequestLocation.current =
                    coords;
                }

                return;
              }


              const distance =
                calculateDistance(

                  previous.latitude,
                  previous.longitude,

                  coords.latitude,
                  coords.longitude,

                );


              /*
               * Request a new exit after moving 20 metres.
               */

              if (
                distance >= 20 &&
                socketConnected
              ) {

                console.log(
                  '[Safe Exit] User moved',
                  Math.round(distance),
                  'm - requesting new exit'
                );


                requestBestExit(
                  coords.latitude,
                  coords.longitude,
                );


                lastExitRequestLocation.current =
                  coords;
              }

            },
          );


        // ----------------------------------------------------
        // Watch compass
        // ----------------------------------------------------

        headingSubscription =
          await Location.watchHeadingAsync(
            (headingData) => {

              /*
               * trueHeading can be -1 when unavailable.
               *
               * In that case use magnetic heading.
               */

              const currentHeading =
                headingData.trueHeading >= 0
                  ? headingData.trueHeading
                  : headingData.magHeading;


              setHeading(
                currentHeading
              );

            }
          );


      } catch (e) {

        console.error(
          '[Safe Exit] Error:',
          e
        );

        setError(
          'Unable to access location or compass.'
        );

      }

    }


    void start();


    return () => {

      headingSubscription?.remove();

      locationSubscription?.remove();

    };

  }, [socketConnected]);


  // ==========================================================
  // REQUEST EXIT WHEN BOTH LOCATION AND SOCKET ARE READY
  // ==========================================================

  useEffect(() => {

    if (
      !userLocation ||
      !socketConnected
    ) {
      return;
    }


    /*
     * If the location subscription already requested the exit,
     * don't send another request.
     */

    if (
      lastExitRequestLocation.current
    ) {
      return;
    }


    console.log(
      '[Safe Exit] Requesting initial exit'
    );


    const success =
      requestBestExit(

        userLocation.latitude,
        userLocation.longitude,

      );


    if (success) {

      lastExitRequestLocation.current =
        userLocation;

    }

  }, [
    userLocation,
    socketConnected,
  ]);


  // ==========================================================
  // ERROR STATE
  // ==========================================================

  if (error) {

    return (
      <View style={styles.container}>

        <Text style={styles.errorText}>
          {error}
        </Text>

      </View>
    );

  }


  // ==========================================================
  // LOADING STATE
  // ==========================================================

  if (
    !userLocation ||
    heading === null ||
    !selectedExit
  ) {

    return (
      <View style={styles.container}>

        <ActivityIndicator
          size="large"
          color="#2563EB"
        />

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


  // ==========================================================
  // CALCULATE DIRECTION
  // ==========================================================

  /*
   * Backend already calculated the bearing from the user's
   * location to the selected exit.
   *
   * Example:
   *
   *   bearing = 90°
   *   means the exit is East.
   */

  const targetHeading =
    selectedExit.bearing;


  /*
   * Calculate how much the arrow should rotate relative to
   * the phone's current compass heading.
   */

  const rotation =
    calculateRotation(
      targetHeading,
      heading,
    );


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <View style={styles.center}>

      {/* ====================================================
          TITLE
          ==================================================== */}

      <Text style={styles.title}>
        Safest Exit
      </Text>


      <Text style={styles.subtitle}>
        Follow the arrow to {selectedExit.name}
      </Text>


      {/* ====================================================
          COMPASS
          ==================================================== */}

      <View style={styles.compass}>

        {/* --------------------------------------------------
            Cardinal directions
            -------------------------------------------------- */}

        <Text
          style={[
            styles.direction,
            styles.north,
          ]}
        >
          N
        </Text>


        <Text
          style={[
            styles.direction,
            styles.east,
          ]}
        >
          E
        </Text>


        <Text
          style={[
            styles.direction,
            styles.south,
          ]}
        >
          S
        </Text>


        <Text
          style={[
            styles.direction,
            styles.west,
          ]}
        >
          W
        </Text>


        {/* --------------------------------------------------
            Exit arrow
            -------------------------------------------------- */}

        <View
          style={[
            styles.arrowContainer,

            {
              transform: [
                {
                  rotate:
                    `${rotation}deg`,
                },
              ],
            },
          ]}
        >

          <Text style={styles.arrow}>
            ↑
          </Text>

        </View>


        {/* --------------------------------------------------
            Center point
            -------------------------------------------------- */}

        <View
          style={styles.centerPoint}
        />

      </View>


      {/* ====================================================
          EXIT INFORMATION
          ==================================================== */}

      <View style={styles.info}>

        <Text style={styles.infoTitle}>
          Safest Exit
        </Text>


        <Text style={styles.exitName}>
          {selectedExit.name}
        </Text>


        <Text style={styles.distance}>
          {selectedExit.distance} m away
        </Text>


        <Text style={styles.headingText}>
          {targetHeading.toFixed(0)}°
        </Text>


        <Text style={styles.currentHeading}>
          Phone heading: {heading.toFixed(0)}°
        </Text>


        <Text style={styles.connectionStatus}>

          {socketConnected
            ? 'Live exit guidance'
            : 'Exit service disconnected'}

        </Text>

      </View>

    </View>
  );
}


// ============================================================
// CALCULATE DISTANCE
// ============================================================

/**
 * Calculate distance between two GPS coordinates.
 *
 * Result is returned in metres.
 */

function calculateDistance(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {

  const R = 6371000;


  const lat1 =
    (latitude1 * Math.PI) / 180;

  const lat2 =
    (latitude2 * Math.PI) / 180;


  const deltaLatitude =
    ((latitude2 - latitude1) *
      Math.PI) /
    180;


  const deltaLongitude =
    ((longitude2 - longitude1) *
      Math.PI) /
    180;


  const a =
    Math.sin(deltaLatitude / 2) ** 2 +

    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLongitude / 2) ** 2;


  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a),
    );


  return R * c;
}


// ============================================================
// CALCULATE BEARING
// ============================================================

/**
 * Calculate bearing from one GPS coordinate to another.
 *
 * Result:
 *
 * 0°   = North
 * 90°  = East
 * 180° = South
 * 270° = West
 */

function calculateBearing(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {

  const lat1 =
    (latitude1 * Math.PI) / 180;

  const lat2 =
    (latitude2 * Math.PI) / 180;


  const deltaLongitude =
    ((longitude2 - longitude1) *
      Math.PI) /
    180;


  const y =
    Math.sin(deltaLongitude) *
    Math.cos(lat2);


  const x =
    Math.cos(lat1) *
      Math.sin(lat2) -

    Math.sin(lat1) *
      Math.cos(lat2) *
      Math.cos(deltaLongitude);


  const bearing =
    (Math.atan2(y, x) * 180) /
    Math.PI;


  return (
    bearing + 360
  ) % 360;
}


// ============================================================
// CALCULATE SHORTEST ROTATION
// ============================================================

/**
 * Returns the shortest rotation from the current phone
 * heading toward the exit.
 *
 * Result:
 *
 * Positive → clockwise/right
 * Negative → counter-clockwise/left
 *
 * Example:
 *
 * Current = 350°
 * Target  = 10°
 *
 * Result = +20°
 *
 * Instead of rotating 340° counter-clockwise.
 */

function calculateRotation(
  targetHeading: number,
  currentHeading: number,
): number {

  return (
    (
      targetHeading -
      currentHeading +
      540
    ) % 360
  ) - 180;
}


// ============================================================
// STYLES
// ============================================================

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


  // ----------------------------------------------------------
  // Title
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // Loading
  // ----------------------------------------------------------

  loadingText: {
    marginTop: 15,

    fontSize: 16,

    color: '#666666',

    textAlign: 'center',
  },


  // ----------------------------------------------------------
  // Error
  // ----------------------------------------------------------

  errorText: {
    fontSize: 16,

    color: '#DC2626',

    textAlign: 'center',
  },


  // ----------------------------------------------------------
  // Compass
  // ----------------------------------------------------------

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


  north: {
    top: 12,
  },


  east: {
    right: 15,
  },


  south: {
    bottom: 12,
  },


  west: {
    left: 15,
  },


  // ----------------------------------------------------------
  // Arrow
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // Center
  // ----------------------------------------------------------

  centerPoint: {
    width: 14,

    height: 14,

    borderRadius: 7,

    backgroundColor: '#222222',

    position: 'absolute',
  },


  // ----------------------------------------------------------
  // Information
  // ----------------------------------------------------------

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
