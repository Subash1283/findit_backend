import * as crypto from 'crypto';
import * as fs from 'fs';
import * as util from 'util';


export async function decryptFileInPlace(filePath: string): Promise<void> {
  const ENCRYPTION_KEY = process.env.DOCUMENT_ENCRYPTION_KEY || '12345678901234567890123456789012'; // 32 bytes
  const readFile = util.promisify(fs.readFile);
  const writeFile = util.promisify(fs.writeFile);

  try {
    const encryptedData = await readFile(filePath);
    
    // Check if the file is large enough to contain an IV and AuthTag
    if (encryptedData.length < 28) return;

    // Web Crypto API AES-GCM output is IV (12 bytes) + Ciphertext + AuthTag (16 bytes appended by SubtleCrypto)
    const iv = encryptedData.subarray(0, 12);
    const ciphertextWithTag = encryptedData.subarray(12);
    
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
    const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(ENCRYPTION_KEY, 'utf-8'),
      iv
    );
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    await writeFile(filePath, decrypted);
  } catch (error) {
    console.error(`Failed to decrypt file at ${filePath}:`, error);
    // If it fails, we keep the original file in place in case it wasn't encrypted
  }
}

export async function encryptFileInPlace(filePath: string): Promise<void> {
  const ENCRYPTION_KEY = process.env.DOCUMENT_ENCRYPTION_KEY || '12345678901234567890123456789012'; // 32 bytes
  const readFile = util.promisify(fs.readFile);
  const writeFile = util.promisify(fs.writeFile);

  try {
    const data = await readFile(filePath);
    
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(ENCRYPTION_KEY, 'utf-8'),
      iv
    );

    const ciphertext = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    const encryptedFileBuffer = Buffer.concat([iv, ciphertext, authTag]);

    await writeFile(filePath, encryptedFileBuffer);
  } catch (error) {
    console.error(`Failed to encrypt file at ${filePath}:`, error);
  }
}

export async function decryptFileToBuffer(filePath: string): Promise<Buffer> {
  const ENCRYPTION_KEY = process.env.DOCUMENT_ENCRYPTION_KEY || '12345678901234567890123456789012'; // 32 bytes
  const readFile = util.promisify(fs.readFile);

  const data = await readFile(filePath);
  
  if (data.length < 28) return data; // Unencrypted fallback

  const iv = data.subarray(0, 12);
  const ciphertextWithTag = data.subarray(12);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(ENCRYPTION_KEY, 'utf-8'),
      iv
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
  } catch(error) {
     return data; // Not encrypted or decryption failed, return raw
  }
}
