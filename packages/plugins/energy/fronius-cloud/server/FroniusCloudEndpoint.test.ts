import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  type FetchMock,
  makeAdapter,
  setupFetchMock,
} from "./test-helpers/froniusCloudHarness.ts";

describe("FroniusCloudAdapter Solar.web endpoints", () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = setupFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  it("uses the Solar.web SWQAPI IAM endpoint used by the account client", async () => {
    await makeAdapter().connect();

    const loginCall = mock.fetchCalls.find(
      (call) => call.method === "POST" && call.url.includes("/iam/jwt"),
    );
    assertExists(loginCall);

    expect(loginCall.url).toBe(
      "https://api.solarweb.com/swqapi/iam/jwt",
    );
    expect(loginCall.headers["AccessKeyId"]).toBe(
      "FKIAB4CDA71C0763413DA942DC756742318B",
    );
    expect(loginCall.headers["AccessKeyValue"]).toBe(
      "67315e19-6805-479e-994d-7193ee5f6125",
    );
    expect(loginCall.headers["Content-Type"]).toBe(
      "application/json-patch+json",
    );
    expect(loginCall.headers["Accept"]).toBe("application/json");
    expect(loginCall.headers["User-Agent"]).toBe(
      "Solar.web/921 CFNetwork/1410.0.3 Darwin/22.6.0",
    );

    const systemCall = mock.fetchCalls.find((call) =>
      call.url.includes("/pvsystems/pv-system-1")
    );
    assertExists(systemCall);
    expect(
      systemCall.url.startsWith("https://api.solarweb.com/swqapi/"),
    ).toBe(true);
  });

  it("refreshes the JWT on the same SWQAPI base without a scope query", async () => {
    mock.setLoginTokenExpiresIn(30_000);
    await makeAdapter().connect();

    const refreshCall = mock.fetchCalls.find((call) =>
      call.method === "PATCH" && call.url.includes("/iam/jwt/")
    );
    assertExists(refreshCall);

    expect(refreshCall.url).toBe(
      "https://api.solarweb.com/swqapi/iam/jwt/test-refresh-token",
    );
  });
});
