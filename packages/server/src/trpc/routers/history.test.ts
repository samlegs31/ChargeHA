import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";

const SOLARWEB_EMAIL_KEY = "solarweb.history.email";
const SOLARWEB_PASSWORD_KEY = "solarweb.history.password";
const SOLARWEB_PV_SYSTEM_ID_KEY = "solarweb.history.pv_system_id";
const ENCRYPTION_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("History tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);
  let db: AppDatabase;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:", ENCRYPTION_KEY);
    await db.init();
    caller = createCaller(throwingMock<TrpcContext>("TrpcContext", { db }));
  });

  afterEach(() => {
    db.close();
  });

  describe("history.getSolarWebImportCredentials", () => {
    it("returns empty saved credentials by default", async () => {
      const result = await caller.history.getSolarWebImportCredentials();
      expect(result).toEqual({
        email: "",
        pvSystemId: "",
        hasPassword: false,
      });
    });

    it("returns saved identity without exposing the encrypted password", async () => {
      await Promise.all([
        db.storeSecret(SOLARWEB_EMAIL_KEY, "solar@example.com"),
        db.storeSecret(SOLARWEB_PASSWORD_KEY, "super-secret-password"),
        db.storeSecret(SOLARWEB_PV_SYSTEM_ID_KEY, "pv-system-id"),
      ]);

      const storedPassword = await db.getSecret(SOLARWEB_PASSWORD_KEY);
      expect(storedPassword?.isEncrypted).toBe(true);
      expect(storedPassword?.value).not.toBe("super-secret-password");

      const result = await caller.history.getSolarWebImportCredentials();
      expect(result).toEqual({
        email: "solar@example.com",
        pvSystemId: "pv-system-id",
        hasPassword: true,
      });
      expect("password" in result).toBe(false);
    });
  });
});
