import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker,
  Polygon,
} from 'react-native-maps';

import {
  type CrowdLevel,
  type CrowdRegion,
} from '@/services/crowd-api';

import {
  getCrowdWarning,
  type Coordinate,
} from '@/services/crowd-safety';
import { connectCrowdWebSocket, sendLocation } from '../services/crowd-websocket';


// ============================================================
// MAP CONFIGURATION
// ============================================================

const initialRegion = {
  latitude: 20.29545,
  longitude: 85.83645,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};


// ============================================================
// CROWD REGION COLORS
// ============================================================

const regionColours: Record<
  CrowdLevel,
  {
    fill: string;
    stroke: string;
  }
> = {
  low: {
    fill: 'rgba(34, 197, 94, 0.22)',
    stroke: '#16A34A',
  },

  moderate: {
    fill: 'rgba(245, 158, 11, 0.26)',
    stroke: '#D97706',
  },

  extreme: {
    fill: 'rgba(239, 68, 68, 0.28)',
    stroke: '#DC2626',
  },
};


// ============================================================
// WARNING COLORS
// ============================================================

const warningColours: Record<
  CrowdLevel,
  string
> = {
  low: '#15803D',
  moderate: '#B45309',
  extreme: '#B91C1C',
};


// ============================================================
// COMPONENT
// ============================================================

export default function CrowdMapScreen() {

  // ----------------------------------------------------------
  // Refs
  // ----------------------------------------------------------

  const mapRef =
    useRef<MapView | null>(null);

  /*
   * Stores the latest GPS location.
   *
   * We use a ref because the 60-second interval should
   * not be recreated every time the GPS location changes.
   */
  const locationRef =
    useRef<Coordinate | null>(null);


  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------

  const [regions, setRegions] =
    useState<CrowdRegion[]>([]);

  const [location, setLocation] =
    useState<Coordinate | null>(null);

  const [locationError, setLocationError] =
    useState<string | null>(null);

  const [socketConnected, setSocketConnected] =
    useState(false);

  const [warning, setWarning] = useState<{
    level: CrowdLevel;
    message: string;
  }>({
    level: 'low',
    message: 'Connecting to crowd service…',
  });


  // ============================================================
  // 1. CONNECT TO WEBSOCKET
  // ============================================================

  useEffect(() => {

    console.log(
      '[CrowdMap] Connecting to WebSocket...',
    );


    const disconnect =
      connectCrowdWebSocket(

        // ------------------------------------------------------
        // Crowd data received
        // ------------------------------------------------------

        (updatedRegions) => {

          console.log(
            '[CrowdMap] Received crowd update:',
            updatedRegions.length,
            'regions',
          );

          setRegions(updatedRegions);
        },


        // ------------------------------------------------------
        // Connected
        // ------------------------------------------------------

        () => {

          console.log(
            '[CrowdMap] WebSocket connected',
          );

          setSocketConnected(true);
        },


        // ------------------------------------------------------
        // Disconnected
        // ------------------------------------------------------

        () => {

          console.log(
            '[CrowdMap] WebSocket disconnected',
          );

          setSocketConnected(false);
        },


        // ------------------------------------------------------
        // Error
        // ------------------------------------------------------

        () => {

          console.log(
            '[CrowdMap] WebSocket error',
          );

          setSocketConnected(false);
        },
      );


    // ----------------------------------------------------------
    // Cleanup
    // ----------------------------------------------------------

    return () => {

      console.log(
        '[CrowdMap] Closing WebSocket',
      );

      disconnect();
    };

  }, []);


  // ============================================================
  // 2. GET AND TRACK USER LOCATION
  // ============================================================

  useEffect(() => {

    let subscription:
      Location.LocationSubscription | null = null;


    async function startLocationTracking() {

      // --------------------------------------------------------
      // Request permission
      // --------------------------------------------------------

      console.log(
        '[Location] Requesting permission...',
      );

      const {
        status,
      } =
        await Location.requestForegroundPermissionsAsync();


      if (status !== 'granted') {

        console.log(
          '[Location] Permission denied',
        );

        setLocationError(
          'Location access is needed for nearby crowd warnings.',
        );

        setWarning({
          level: 'low',
          message:
            'Enable location to receive nearby crowd warnings.',
        });

        return;
      }


      console.log(
        '[Location] Permission granted',
      );


      // --------------------------------------------------------
      // Get initial location
      // --------------------------------------------------------

      const current =
        await Location.getCurrentPositionAsync({
          accuracy:
            Location.Accuracy.Balanced,
        });


      const initialLocation: Coordinate = {
        latitude:
          current.coords.latitude,

        longitude:
          current.coords.longitude,
      };


      console.log(
        '[Location] Initial location:',
        initialLocation,
      );


      setLocation(initialLocation);

      locationRef.current =
        initialLocation;


      // --------------------------------------------------------
      // Send initial location immediately
      // --------------------------------------------------------

      sendLocation(
        initialLocation.latitude,
        initialLocation.longitude,
      );


      // --------------------------------------------------------
      // Watch location
      //
      // This updates the location displayed by the app.
      //
      // It does NOT send every GPS update to the server.
      // --------------------------------------------------------

      subscription =
        await Location.watchPositionAsync(

          {
            accuracy:
              Location.Accuracy.Balanced,

            distanceInterval: 10,
          },

          ({ coords }) => {

            const newLocation: Coordinate = {
              latitude:
                coords.latitude,

              longitude:
                coords.longitude,
            };


            console.log(
              '[Location] Local update:',
              newLocation,
            );


            setLocation(newLocation);

            locationRef.current =
              newLocation;
          },
        );
    }


    // ----------------------------------------------------------
    // Start tracking
    // ----------------------------------------------------------

    void startLocationTracking()
      .catch((error) => {

        console.error(
          '[Location] Failed:',
          error,
        );

        setLocationError(
          'Unable to retrieve your current location.',
        );

      });


    // ----------------------------------------------------------
    // Cleanup
    // ----------------------------------------------------------

    return () => {

      console.log(
        '[Location] Stopping tracking',
      );

      subscription?.remove();
    };

  }, []);


  // ============================================================
  // 3. SEND LOCATION EVERY 60 SECONDS
  // ============================================================

  useEffect(() => {

    console.log(
      '[Location] Starting 60-second location timer',
    );


    const interval =
      setInterval(() => {

        const currentLocation =
          locationRef.current;


        if (!currentLocation) {

          console.log(
            '[Location] No location available',
          );

          return;
        }


        console.log(
          '[Location] Sending location to server:',
          currentLocation,
        );


        sendLocation(
          currentLocation.latitude,
          currentLocation.longitude,
        );

      }, 60 * 1000);


    // ----------------------------------------------------------
    // Cleanup timer
    // ----------------------------------------------------------

    return () => {

      console.log(
        '[Location] Clearing location timer',
      );

      clearInterval(interval);
    };

  }, []);


  // ============================================================
  // 4. CALCULATE CROWD WARNING
  // ============================================================

  useEffect(() => {

    if (
      !location ||
      regions.length === 0
    ) {
      return;
    }


    const newWarning =
      getCrowdWarning(
        location,
        regions,
      );


    console.log(
      '[Crowd] Warning:',
      newWarning,
    );


    setWarning(newWarning);

  }, [
    location,
    regions,
  ]);


  // ============================================================
  // 5. MOVE MAP TO USER LOCATION
  // ============================================================

  useEffect(() => {

    if (!location) {
      return;
    }


    mapRef.current?.animateToRegion(

      {
        latitude:
          location.latitude,

        longitude:
          location.longitude,

        latitudeDelta:
          0.01,

        longitudeDelta:
          0.01,
      },

      700,
    );

  }, [location]);


  // ============================================================
  // 6. RENDER
  // ============================================================

  return (
    <View style={styles.container}>

      {/* ======================================================
          MAP
          ====================================================== */}

      <MapView
        ref={mapRef}

        style={styles.map}

        initialRegion={initialRegion}

        showsUserLocation

        showsMyLocationButton

        mapType="standard"
      >

        {/* ====================================================
            CROWD REGIONS
            ==================================================== */}

        {regions.map((region) => {

          const colours =
            regionColours[region.level];


          return (
            <Polygon
              key={region.id}

              coordinates={[

                // North-West
                {
                  latitude:
                    region.north,

                  longitude:
                    region.west,
                },

                // North-East
                {
                  latitude:
                    region.north,

                  longitude:
                    region.east,
                },

                // South-East
                {
                  latitude:
                    region.south,

                  longitude:
                    region.east,
                },

                // South-West
                {
                  latitude:
                    region.south,

                  longitude:
                    region.west,
                },

              ]}

              fillColor={
                colours.fill
              }

              strokeColor={
                colours.stroke
              }

              strokeWidth={2}
            />
          );

        })}


        {/* ====================================================
            USER MARKER
            ==================================================== */}

        {location && (

          <Marker
            coordinate={location}

            title="Your Location"

            description="Your current location"
          />

        )}

      </MapView>


      {/* ======================================================
          CONNECTION STATUS
          ====================================================== */}

      <View
        style={styles.statusCard}
      >

        <View
          style={[
            styles.statusDot,

            {
              backgroundColor:
                socketConnected
                  ? '#16A34A'
                  : '#DC2626',
            },
          ]}
        />


        <Text
          style={styles.statusText}
        >

          {socketConnected
            ? 'Live crowd data'
            : 'Crowd service disconnected'}

        </Text>

      </View>


      {/* ======================================================
          WARNING CARD
          ====================================================== */}

      <View
        style={[
          styles.warningCard,

          {
            borderLeftColor:
              warningColours[
                warning.level
              ],
          },
        ]}
      >

        {/* ----------------------------------------------------
            Warning level
            ---------------------------------------------------- */}

        <Text
          style={[
            styles.warningLevel,

            {
              color:
                warningColours[
                  warning.level
                ],
            },
          ]}
        >

          {warning.level.toUpperCase()}

        </Text>


        {/* ----------------------------------------------------
            Warning message
            ---------------------------------------------------- */}

        <Text
          style={styles.warningMessage}
        >

          {warning.message}

        </Text>


        {/* ----------------------------------------------------
            Location error
            ---------------------------------------------------- */}

        {locationError && (

          <Text
            style={styles.dataNote}
          >

            {locationError}

          </Text>

        )}


        {/* ----------------------------------------------------
            Number of monitored regions
            ---------------------------------------------------- */}

        {regions.length > 0 && (

          <Text
            style={styles.dataNote}
          >

            Monitoring {regions.length} nearby areas

          </Text>

        )}

      </View>


      {/* ======================================================
          LOADING
          ====================================================== */}

      {regions.length === 0 && (

        <View
          style={styles.loading}
        >

          <ActivityIndicator
            size="large"
            color="#2563EB"
          />


          <Text
            style={styles.loadingText}
          >

            Waiting for crowd data…

          </Text>

        </View>

      )}

    </View>
  );
}


// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
  },


  // ==========================================================
  // MAP
  // ==========================================================

  map: {
    flex: 1,
  },


  // ==========================================================
  // CONNECTION STATUS
  // ==========================================================

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

    shadowOffset: {
      width: 0,
      height: 2,
    },
  },


  statusDot: {
    width: 9,
    height: 9,

    borderRadius: 5,

    marginRight: 7,
  },


  statusText: {
    fontSize: 12,

    fontWeight: '600',

    color: '#374151',
  },


  // ==========================================================
  // WARNING CARD
  // ==========================================================

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

    shadowOffset: {
      width: 0,
      height: 3,
    },
  },


  warningLevel: {
    fontSize: 14,

    fontWeight: '800',
  },


  warningMessage: {
    marginTop: 5,

    fontSize: 14,

    color: '#374151',
  },


  dataNote: {
    marginTop: 6,

    fontSize: 12,

    color: '#6B7280',
  },


  // ==========================================================
  // LOADING
  // ==========================================================

  loading: {
    position: 'absolute',

    top: '45%',

    left: 0,
    right: 0,

    alignItems: 'center',
  },


  loadingText: {
    marginTop: 8,

    color: '#374151',

    fontSize: 14,
  },

});