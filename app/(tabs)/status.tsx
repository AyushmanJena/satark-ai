import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export default function StatusScreen() {
  const [isSending, setIsSending] = useState(false);

  async function handleSendSOS() {
    const requestBody = {
      type: 'sos_request',
      source: 'mobile_app',
      timestamp: new Date().toISOString(),
      location: {
        latitude: null,
        longitude: null,
      },
    };

    console.log('[SOS] Sending request to backend:', requestBody);

    setIsSending(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      console.log('[SOS] Backend response (dummy):', {
        ok: true,
        message: 'SOS request queued successfully.',
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SOS</Text>
      <Text style={styles.description}>
        Tap the button below to send an emergency request. For now this logs a dummy backend call.
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
      <Text style={styles.helperText}>
        This will later call the emergency endpoint and notify responders.
      </Text>
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
});
