import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import {
  type FetchMock,
  GUEST_ID,
  makeAdapter,
  RESOLVED_ID,
  setupFetchMock,
} from "./test-helpers/froniusCloudHarness.ts";

describe("FroniusCloudAdapter Solar.web Guest endpoints", () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = setupFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  it("uses GuestLogOn plus the same-origin ActualData endpoint", async () => {
    await makeAdapter().connect();

    const guestCall = mock.fetchCalls.find((call) =>
      call.url.includes("/Home/GuestLogOn")
    );
    assertExists(guestCall);
    expect(guestCall.url).toBe(
      `https://www.solarweb.com/Home/GuestLogOn?pvSystemId=${GUEST_ID}`,
    );

    const actualDataCall = mock.fetchCalls.find((call) =>
      call.url.includes("/ActualData/GetCompareDataForPvSystem")
    );
    assertExists(actualDataCall);
    expect(actualDataCall.url).toBe(
      `https://www.solarweb.com/ActualData/GetCompareDataForPvSystem?pvSystemId=${RESOLVED_ID}`,
    );
    expect(actualDataCall.headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(actualDataCall.headers.referer).toContain(
      `/PvSystems/PvSystem?pvSystemId=${RESOLVED_ID}`,
    );
  });

  it("does not call the Solar.web Query API", async () => {
    await makeAdapter().connect();

    expect(
      mock.fetchCalls.some((call) =>
        call.url.includes("swqapi") || call.url.includes("/iam/jwt")
      ),
    ).toBe(false);
  });

  it("can use the guest-link UUID directly when Solar.web does not reveal another ID", async () => {
    mock.setGuestResponse({
      status: 200,
      text: "<html><body>Guest dashboard</body></html>",
      headers: {
        "Set-Cookie": ".AspNet.Auth=guest-auth; Path=/; HttpOnly",
      },
    });

    await makeAdapter().connect();

    const actualDataCall = mock.fetchCalls.find((call) =>
      call.url.includes("/ActualData/GetCompareDataForPvSystem")
    );
    assertExists(actualDataCall);
    expect(actualDataCall.url).toContain(`pvSystemId=${GUEST_ID}`);
  });
});
