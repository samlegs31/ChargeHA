import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  FRONIUS_CLOUD_SECRET_MASK,
  resolveFroniusCloudTestPassword,
} from "./resolveTestPassword.ts";

describe("resolveFroniusCloudTestPassword", () => {
  it("uses a newly entered password from the setup wizard", async () => {
    let storedSecretRead = false;
    const password = await resolveFroniusCloudTestPassword(
      "new-password",
      () => {
        storedSecretRead = true;
        return Promise.resolve("stored-password");
      },
    );

    expect(password).toBe("new-password");
    expect(storedSecretRead).toBe(false);
  });

  it("reuses the encrypted stored password when Settings sends the secret mask", async () => {
    const password = await resolveFroniusCloudTestPassword(
      FRONIUS_CLOUD_SECRET_MASK,
      () => Promise.resolve("stored-password"),
    );

    expect(password).toBe("stored-password");
  });

  it("fails clearly when no password is available", async () => {
    await expect(
      resolveFroniusCloudTestPassword(
        FRONIUS_CLOUD_SECRET_MASK,
        () => Promise.resolve(null),
      ),
    ).rejects.toThrow("Solar.web password is not configured");
  });
});
