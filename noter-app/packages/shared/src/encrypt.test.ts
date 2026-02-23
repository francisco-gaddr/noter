import { encrypt, decrypt } from './encrypt';

describe('Encryption/Decryption Tests', () => {
  describe('encrypt', () => {
    it('should encrypt text correctly', () => {
      const text = 'Hello World';
      const encrypted = encrypt(text);
      
      expect(encrypted).not.toBe(text);
      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
    });

    it('should return empty string for empty input', () => {
      expect(encrypt('')).toBe('');
    });

    it('should handle null/undefined input', () => {
      expect(encrypt(null as any)).toBe('');
      expect(encrypt(undefined as any)).toBe('');
    });

    it('should produce different encrypted values for same input', () => {
      const text = 'Test';
      const encrypted1 = encrypt(text);
      const encrypted2 = encrypt(text);
      
      // Due to randomness in encryption, results should be different
      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted text correctly', () => {
      const originalText = 'Hello World';
      const encrypted = encrypt(originalText);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(originalText);
    });

    it('should return original text for non-encrypted input', () => {
      const plainText = 'Plain text';
      const result = decrypt(plainText);
      
      expect(result).toBe(plainText);
    });

    it('should handle empty string', () => {
      expect(decrypt('')).toBe('');
    });

    it('should handle null/undefined input', () => {
      expect(decrypt(null as any)).toBe(null);
      expect(decrypt(undefined as any)).toBe(undefined);
    });

    it('should handle malformed encrypted data', () => {
      const malformed = 'U2FsdGVkX1+invalid_base64';
      const result = decrypt(malformed);
      
      // Should return original malformed data when decryption fails
      expect(result).toBe(malformed);
    });

    it('should handle special characters', () => {
      const specialText = 'Hello!@#$%^&*()_+{}[]|\:;"\'<>?,./';
      const encrypted = encrypt(specialText);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(specialText);
    });

    it('should handle Unicode characters', () => {
      const unicodeText = 'Hello 世界 🌍 Ñoël';
      const encrypted = encrypt(unicodeText);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(unicodeText);
    });

    it('should handle long text', () => {
      const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100);
      const encrypted = encrypt(longText);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(longText);
    });
  });

  describe('Round-trip encryption/decryption', () => {
    it('should maintain data integrity through encryption and decryption', () => {
      const testCases = [
        'Simple text',
        'Text with numbers 123',
        'Text with symbols !@#$%^&*()',
        'Multi\nline\ntext',
        'Unicode: 你好世界 🌍',
        '',
        '   ',
        'Very long text that should be encrypted and decrypted correctly without any data loss or corruption'.repeat(10),
      ];

      testCases.forEach(originalText => {
        const encrypted = encrypt(originalText);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(originalText);
      });
    });
  });

  describe('Security considerations', () => {
    it('should not reveal original text in encrypted output', () => {
      const sensitiveText = 'password123';
      const encrypted = encrypt(sensitiveText);
      
      expect(encrypted).not.toContain(sensitiveText);
      expect(encrypted).not.toContain('password');
      expect(encrypted).not.toContain('123');
    });

    it('should produce consistent decryption results', () => {
      const encrypted = encrypt('Test text');
      const decrypted1 = decrypt(encrypted);
      const decrypted2 = decrypt(encrypted);
      
      expect(decrypted1).toBe(decrypted2);
    });
  });
});