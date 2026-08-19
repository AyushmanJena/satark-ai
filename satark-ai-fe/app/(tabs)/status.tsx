import * as Location from 'expo-location';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL } from '../services/app-config';


type SosState = 'idle' | 'sending' | 'sent' | 'error';

export default function StatusScreen() {
  const [sosState, setSosState] = useState<SosState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSendSOS() {
    setSosState('sending');
    setErrorMessage(null);

    try {
      // --------------------------------------------------------
      // Get current location. This is the whole point of the SOS
      // button - the admin dashboard needs a real position, not a
      // null one.
      // --------------------------------------------------------

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setSosState('error');
        setErrorMessage('Location permission is required to send an SOS.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const requestBody = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      console.log('[SOS] Sending request to backend:', requestBody);

      // --------------------------------------------------------
      // POST to the backend. This is a plain HTTP call, not the
      // crowd/exit WebSockets - SOS needs to work even if those
      // sockets happen to be reconnecting at the moment.
      // --------------------------------------------------------

      const response = await fetch(`${API_BASE_URL}/api/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Backend responded with ${response.status}`);
      }

      const data = await response.json();
      console.log('[SOS] Backend response:', data);

      setSosState('sent');
    } catch (error) {
      console.error('[SOS] Failed to send:', error);
      setSosState('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to send SOS. Check your connection.',
      );
    }
  }

  const isSending = sosState === 'sending';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SOS</Text>
      <Text style={styles.description}>
        Tap the button below to send an emergency request with your current location.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send SOS request"
        onPress={handleSendSOS}
        disabled={isSending}
        style={({ pressed }) => [
          styles.button,
          pressed && !isSending && styles.buttonPressed,
          isSending && styles.buttonDisabled,
        ]}>
        {isSending ? (
          <View style={styles.buttonContent}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.buttonText}>Sending SOS...</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Send SOS</Text>
        )}
      </Pressable>

      {sosState === 'sent' && (
        <Text style={styles.successText}>
          SOS sent. Your location has been shared with responders.
        </Text>
      )}

      {sosState === 'error' && errorMessage && (
        <Text style={styles.errorText}>{errorMessage}</Text>
      )}

      {sosState === 'idle' && (
        <Text style={styles.helperText}>
          This shares your live location with the emergency response dashboard.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F7FAFC',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#102A43',
    marginBottom: 12,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: '#486581',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#D64545',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    shadowColor: '#7F1D1D',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: '#C73A3A',
  },
  buttonDisabled: {
    opacity: 0.8,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  helperText: {
    marginTop: 16,
    fontSize: 13,
    lineHeight: 18,
    color: '#627D98',
    textAlign: 'center',
  },
  successText: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
    color: '#15803D',
    textAlign: 'center',
    fontWeight: '600',
  },
  errorText: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
    color: '#DC2626',
    textAlign: 'center',
    fontWeight: '600',
  },
});