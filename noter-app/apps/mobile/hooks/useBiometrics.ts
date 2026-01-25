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

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      setIsSupported(compatible);
      
      if (compatible) {
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setIsEnrolled(enrolled);
        
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        setAuthType(types);
      }
    })();
  }, []);

  const authenticate = async (promptMessage: string = 'Verifiera din identitet'): Promise<BiometricAuthResult> => {
    if (!isSupported) {
      return { success: false, error: 'Biometri stöds ej på denna enhet.' };
    }
    if (!isEnrolled) {
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
