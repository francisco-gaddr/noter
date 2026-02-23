import CryptoJS from 'crypto-js';

// TODO: Move this to environment variable in production
const DEMO_SECRET_KEY = 'demo-secret-key-123';

export const encrypt = (text: string): string => {
  if (!text) return text;
  return CryptoJS.AES.encrypt(text, DEMO_SECRET_KEY).toString();
};

export const decrypt = (ciphertext: string): string => {
  if (!ciphertext) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, DEMO_SECRET_KEY);
    // Use try-catch specifically for the UTF-8 conversion which throws on malformed data
    try {
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        if (!originalText && ciphertext.length > 0) {
            return 'invalid-encrypted-data';
        }
        return originalText;
    } catch (e) {
        return 'invalid-encrypted-data';
    }
  } catch (error) {
    console.error('Decryption failed:', error);
    return 'invalid-encrypted-data'; // Return error indicator if decryption fails
  }
};
