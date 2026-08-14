import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  loadEncryptionKey,
  selectEncryptionKeyForStartup,
  validateEncryptionKey,
} from "./EncryptionKey.ts";

describe("validateEncryptionKey", () => {
  it("accepts a valid base64-encoded 32-byte key", () => {
    // Simulate: openssl rand -base64 32
    const rawKey = new Uint8Array(32).map((_, i) => i);
    const keyBase64 = btoa(String.fromCharCode(...rawKey));

    const result = validateEncryptionKey(keyBase64);
    expect(result.valid).toBe(true);
    expect(result.key).toBe(keyBase64);
    expect(result.error).toBeUndefined();
  });

  it("rejects an invalid base64 string with clear error", () => {
    const result = validateEncryptionKey("not-valid-base64!!!");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not valid base64");
    expect(result.error).toContain("openssl rand -base64 32");
    expect(result.key).toBeUndefined();
  });

  it("rejects a key of wrong length (not 32 bytes)", () => {
    // 16-byte key (128-bit) — wrong size
    const shortKey = btoa(
      String.fromCharCode(...new Uint8Array(16).map((_, i) => i)),
    );
    const result = validateEncryptionKey(shortKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("32 bytes");
    expect(result.error).toContain("got 16 bytes");
    expect(result.key).toBeUndefined();

    // 64-byte key — also wrong size
    const longKey = btoa(
      String.fromCharCode(...new Uint8Array(64).map((_, i) => i % 256)),
    );
    const longResult = validateEncryptionKey(longKey);
    expect(longResult.valid).toBe(false);
    expect(longResult.error).toContain("got 64 bytes");
  });

  it("rejects an empty string", () => {
    const result = validateEncryptionKey("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
    expect(result.key).toBeUndefined();

    // Whitespace-only
    const wsResult = validateEncryptionKey("   ");
    expect(wsResult.valid).toBe(false);
    expect(wsResult.error).toContain("empty");
  });

  it("detects undefined as missing", () => {
    const result = validateEncryptionKey(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not set");
    expect(result.key).toBeUndefined();
  });

  it("detects null as missing", () => {
    const result = validateEncryptionKey(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not set");
    expect(result.key).toBeUndefined();
  });
});

describe("loadEncryptionKey", () => {
  const validKey = btoa(String.fromCharCode(...new Uint8Array(32)));

  it("loads and trims a key from a secret file", () => {
    const result = loadEncryptionKey(
      undefined,
      "/run/secrets/evsolar_encryption_key",
      () => `${validKey}\n`,
    );

    expect(result).toEqual({ valid: true, key: validKey });
  });

  it("prefers the secret file over the legacy environment value", () => {
    const result = loadEncryptionKey(
      "invalid-env-value",
      "/run/secrets/evsolar_encryption_key",
      () => validKey,
    );

    expect(result).toEqual({ valid: true, key: validKey });
  });

  it("fails closed when a configured secret file cannot be read", () => {
    const result = loadEncryptionKey(
      validKey,
      "/run/secrets/missing",
      () => {
        throw new Error("missing");
      },
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe("ENCRYPTION_KEY_FILE could not be read");
  });
});

describe("selectEncryptionKeyForStartup", () => {
  it("refuses startup when an explicitly configured secret file is invalid", () => {
    expect(() =>
      selectEncryptionKeyForStartup(
        { valid: false, error: "ENCRYPTION_KEY_FILE could not be read" },
        "/run/secrets/evsolar_encryption_key",
      )
    ).toThrow("refusing to start");
  });

  it("preserves legacy optional encryption when no secret file is configured", () => {
    expect(
      selectEncryptionKeyForStartup(
        { valid: false, error: "ENCRYPTION_KEY is not set" },
        undefined,
      ),
    ).toBeNull();
  });
});
