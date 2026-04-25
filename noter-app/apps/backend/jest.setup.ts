import { setEncryptionKey } from '@repo/shared';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ALLOW_DEMO_TOKEN = process.env.ALLOW_DEMO_TOKEN || 'true';
setEncryptionKey('a'.repeat(64));
