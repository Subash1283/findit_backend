import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { error } from 'console';
import * as crypto from 'crypto';
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const hexKey = this.configService.get<string>('CHAT_ENCRYPTION_KEY');
    if (!hexKey || hexKey.length !== 64) {
      this.logger.error(
        'CHAT_ENCRYPTION_KEY is missing or not 64 hex chars (32 bytes). Messages will NOT be encrypted.',
      );
      this.key = null;
    } else {
      this.key = Buffer.from(hexKey, 'hex');
    }
  }

  encrypt(plaintext: string): string {
    if (!this.key || !plaintext) return plaintext;

    try {
      const iv = crypto.randomBytes(12); // 96-bit IV for GCM
      const cipher = crypto.createCipheriv(
        this.algorithm,
        this.key,
        iv,
      ) as crypto.CipherGCM;
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('base64')}`;
    } catch (err) {
      const error = err as Error;
      this.logger.error('Encryption failed:', error.message);
      return plaintext;
    }
  }

  decrypt(payload: string): string {
    if (!this.key || !payload) return payload;

    const parts = payload.split(':');
    if (parts.length !== 3) return payload;

    try {
      const [ivHex, authTagHex, ciphertextBase64] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const ciphertext = Buffer.from(ciphertextBase64, 'base64');

      const decipher = crypto.createDecipheriv(
        this.algorithm,
        this.key,
        iv,
      ) as crypto.DecipherGCM;
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Decryption failed (may be legacy plaintext), returning raw: ${error.message}`,
      );
      return payload;
    }
  }

  get isEncryptionEnabled(): boolean {
    return !!this.key;
  }
}
