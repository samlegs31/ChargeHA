/**
 * ENCRYPTION_KEY validation and startup check utilities.
 * The key must be a valid base64-encoded 256-bit (32-byte) value.
 * Generate with: openssl rand -base64 32
 */

import type { AppDatabase } from "../db/AppDatabase.ts";

function decodeBase64(base64: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export type EncryptionKeyResult =
  | { valid: true; key: string; error?: undefined }
  | { valid: false; error: string; key?: undefined };

type ReadTextFile = (path: string) => string;

/**
 * Validate an encryption key string.
 * Returns { valid: true, key } if valid, { valid: false, error } if not.
 */
export function validateEncryptionKey(
  keyBase64: string | undefined | null,
): EncryptionKeyResult {
  if (keyBase64 === undefined || keyBase64 === null) {
    return { valid: false, error: "ENCRYPTION_KEY is not set" };
  }

  if (keyBase64.trim() === "") {
    return { valid: false, error: "ENCRYPTION_KEY is empty" };
  }

  const raw = decodeBase64(keyBase64);
  if (!raw) {
    return {
      valid: false,
      error:
        "ENCRYPTION_KEY is not valid base64. Generate one with: openssl rand -base64 32",
    };
  }

  if (raw.length !== 32) {
    return {
      valid: false,
      error:
        `ENCRYPTION_KEY must be 32 bytes (256-bit), got ${raw.length} bytes. Generate one with: openssl rand -base64 32`,
    };
  }

  return { valid: true, key: keyBase64 };
}

/**
 * Resolve the configured key without exposing it in process metadata.
 * ENCRYPTION_KEY_FILE takes precedence when configured; ENCRYPTION_KEY remains
 * available as a backwards-compatible fallback.
 */
export function loadEncryptionKey(
  keyBase64: string | undefined,
  keyFile: string | undefined,
  readTextFile: ReadTextFile = Deno.readTextFileSync,
): EncryptionKeyResult {
  if (!keyFile) return validateEncryptionKey(keyBase64);

  try {
    return validateEncryptionKey(readTextFile(keyFile).trim());
  } catch {
    return {
      valid: false,
      error: "ENCRYPTION_KEY_FILE could not be read",
    };
  }
}

/**
 * Preserve the legacy optional-key behaviour only when no secret file was
 * configured. An explicit file is an operator security choice, so a missing
 * or invalid file must stop startup instead of silently disabling encryption.
 */
export function selectEncryptionKeyForStartup(
  result: EncryptionKeyResult,
  keyFile: string | undefined,
): string | null {
  if (result.valid) return result.key;
  if (keyFile) {
    throw new Error(
      `${result.error}; refusing to start with ENCRYPTION_KEY_FILE configured`,
    );
  }
  return null;
}

/**
 * Read and validate the ENCRYPTION_KEY env var without touching the DB.
 * Used at startup before the DB is constructed, so the key can be passed
 * into the AppDatabase constructor. Returns null on missing/invalid key.
 */
export function resolveEncryptionKeyFromEnv(): string | null {
  const keyFile = Deno.env.get("ENCRYPTION_KEY_FILE");
  const result = loadEncryptionKey(
    Deno.env.get("ENCRYPTION_KEY"),
    keyFile,
  );
  if (result.valid) {
    console.log(
      `[Security] Encryption key validated successfully (${
        keyFile ? "secret file" : "environment"
      })`,
    );
    return result.key;
  }
  const key = selectEncryptionKeyForStartup(result, keyFile);
  console.info(
    `[Security] ${result.error}. Secrets will be stored in plain text until a valid key is provided.`,
  );
  return key;
}

/**
 * Post-init warning: if no encryption key is configured but the DB contains
 * encrypted rows, surface a loud error. Decryption of those rows will fail
 * on read until a valid key is provided.
 */
export async function warnIfEncryptedRowsButNoKey(
  db: AppDatabase,
  encryptionKey: string | null,
): Promise<void> {
  if (encryptionKey) return;
  const hasEncryptedData = await db.hasEncryptedRows();
  if (!hasEncryptedData) return;
  console.error(
    `[Security] ENCRYPTION_KEY is missing, but encrypted data exists in the database.`,
  );
  console.error(
    "[Security] Decryption of stored secrets will fail until a valid key is provided.",
  );
  console.error(
    "[Security] Configure ENCRYPTION_KEY_FILE (recommended) or ENCRYPTION_KEY. Generate with: openssl rand -base64 32",
  );
}
