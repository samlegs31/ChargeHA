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

  it("uses the Solar.web SWQAPI IAM host and required scope", async () => {
    await makeAdapter().connect();

    const loginCall = mock.fetchCalls.find(
      (call) => call.method === "POST" && call.url.includes("/iam/jwt"),
    );
    assertExists(loginCall);

    expect(loginCall.url).toBe(
      "https://swqapi.solarweb.com/iam/jwt?scope=b454e75844",
    );
    expect(loginCall.headers["AccessKeyId"]).toBe(
      "FKIAB4CDA71C0763413DA942DC756742318B",
    );
    expect(loginCall.headers["AccessKeyValue"]).toBe(
      "67315e19-6805-479e-994d-7193ee5f6125",
    );
    expect(loginCall.headers["User-Agent"]).toBe("okhttp/4.12.0");

    const systemCall = mock.fetchCalls.find((call) =>
      call.url.includes("/pvsystems/pv-system-1")
    );
    assertExists(systemCall);
    expect(systemCall.url.startsWith("https://swqapi.solarweb.com/")).toBe(
      true,
    );
  });

  it("keeps the IAM scope when refreshing the JWT", async () => {
    mock.setLoginTokenExpiresIn(30_000);
    await makeAdapter().connect();

    const refreshCall = mock.fetchCalls.find((call) =>
      call.method === "PATCH" && call.url.includes("/iam/jwt/")
    );
    assertExists(refreshCall);

    expect(refreshCall.url).toBe(
      "https://swqapi.solarweb.com/iam/jwt/test-refresh-token?scope=b454e75844",
    );
  });
});
