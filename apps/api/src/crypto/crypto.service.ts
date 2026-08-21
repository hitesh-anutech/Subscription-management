import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/**
 * AES-256-GCM encryption for sensitive fields at rest.
 *
 * Usage:
 *   const ciphertext = crypto.encrypt('zoho_oauth_refresh_token_value');
 *   const plaintext  = crypto.decrypt(ciphertext);
 *
 * Wire format (base64):
 *   <iv(12 bytes)> || <authTag(16 bytes)> || <ciphertext>
 *
 * Key derivation:
 *   ENCRYPTION_KEY env var → base64 decoded → 32 bytes raw key
 *
 * IMPORTANT: Rotating the key requires re-encrypting all rows.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // GCM standard
  private readonly tagLength = 16;
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {
    const rawKey = this.config.get<string>('ENCRYPTION_KEY');
    if (!rawKey) {
      throw new InternalServerErrorException('ENCRYPTION_KEY not set');
    }
    const decoded = Buffer.from(rawKey, 'base64');
    if (decoded.length !== 32) {
      throw new InternalServerErrorException(
        `ENCRYPTION_KEY must decode to 32 bytes; got ${decoded.length}`,
      );
    }
    this.key = decoded;
    this.logger.log('✓ CryptoService initialized (AES-256-GCM)');
  }

  /**
   * Encrypts plaintext → base64 string `iv||tag||ciphertext`.
   * Returns null if input is null/empty (passthrough for nullable columns).
   */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') {
      return null;
    }
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  /**
   * Decrypts a base64 string produced by `encrypt`.
   * Returns null if input is null. Throws on tampered/invalid input.
   */
  decrypt(ciphertext: string | null | undefined): string | null {
    if (ciphertext === null || ciphertext === undefined || ciphertext === '') {
      return null;
    }
    try {
      const buf = Buffer.from(ciphertext, 'base64');
      if (buf.length < this.ivLength + this.tagLength + 1) {
        throw new Error('Ciphertext too short');
      }
      const iv = buf.subarray(0, this.ivLength);
      const authTag = buf.subarray(this.ivLength, this.ivLength + this.tagLength);
      const encrypted = buf.subarray(this.ivLength + this.tagLength);
      const decipher = createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (err) {
      this.logger.error(
        'Failed to decrypt ciphertext — corrupted or wrong key',
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException('Decryption failed');
    }
  }

  /**
   * scrypt-based password hashing for user passwords.
   * Format: `scrypt:$<saltHex>:$<hashHex>`.
   */
  async hashPassword(plaintext: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scrypt(plaintext, salt, 64)) as Buffer;
    return `scrypt:$${salt.toString('hex')}:$${derived.toString('hex')}`;
  }

  async verifyPassword(plaintext: string, stored: string): Promise<boolean> {
    const match = stored.match(/^scrypt:\$([a-f0-9]+):\$([a-f0-9]+)$/i);
    if (!match) return false;
    const salt = Buffer.from(match[1], 'hex');
    const expected = Buffer.from(match[2], 'hex');
    const derived = (await scrypt(plaintext, salt, expected.length)) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  /**
   * Generate a cryptographically-strong random token (e.g. session token, public quote token).
   * Returns base64url encoded (URL-safe).
   */
  randomToken(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url');
  }
}
