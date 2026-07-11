import 'react-native-get-random-values';
import { Platform } from 'react-native';

// Polyfill for crypto-js
// crypto-js (v3.x) checks for global.crypto or window.crypto
// react-native-get-random-values polyfills global.crypto.getRandomValues

if (Platform.OS !== 'web') {
  // Ensure global.crypto exists
  if (!global.crypto) {
    // @ts-ignore
    global.crypto = {};
  }
  
  // Some versions of crypto-js might look for window.crypto
  if (typeof window === 'undefined') {
    // @ts-ignore
    global.window = {};
  }
  
  if (!global.window.crypto) {
     // @ts-ignore
    global.window.crypto = global.crypto;
  }
}

// Streaming-safe TextDecoder — installed ONLY if the engine lacks one, so SSE token streaming
// (which decodes byte chunks) never silently dies into the non-streamed fallback.
import { installTextDecoderPolyfill } from './textDecoderPolyfill';
if (Platform.OS !== 'web') installTextDecoderPolyfill();

console.log('Crypto polyfill loaded');
