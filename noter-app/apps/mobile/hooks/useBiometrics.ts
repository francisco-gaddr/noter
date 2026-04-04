import * as LocalAuthentication from 'expo-local-authentication';
import { useState, useEffect } from 'react';
import { Alert, Platform } from 'react-native';

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
}

export const useBiometrics = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [authType, setAuthType] = useState<LocalAuthentication.AuthenticationType[]>([]);

  const refreshAvailability = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = compatible ? await LocalAuthentication.isEnrolledAsync() : false;
    const types = compatible ? await LocalAuthentication.supportedAuthenticationTypesAsync() : [];
    setIsSupported(compatible);
    setIsEnrolled(enrolled);
    setAuthType(types);
    return {
      compatible,
      enrolled,
    };
  };

  useEffect(() => {
    (async () => {
      await refreshAvailability();
    })();
  }, []);

  const authenticate = async (promptMessage: string = 'Verifiera din identitet'): Promise<BiometricAuthResult> => {
    const availability = await refreshAvailability();
    if (!availability.compatible) {
      return { success: false, error: 'Biometri stöds ej på denna enhet.' };
    }
    if (!availability.enrolled) {
      return { success: false, error: 'Ingen biometri konfigurerad.' };
    }

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        fallbackLabel: 'Använd lösenord',
        cancelLabel: 'Avbryt',
        disableDeviceFallback: false, // Allow fallback to device PIN/Pattern if biometrics fail
      });

      if (result.success) {
        return { success: true };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const getBiometryLabel = () => {
    if (authType.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'Face ID';
    }
    if (authType.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === 'ios' ? 'Touch ID' : 'Fingeravtryck';
    }
    return 'Biometri';
  };

  return {
    isSupported,
    isEnrolled,
    authenticate,
    getBiometryLabel,
  };
};
