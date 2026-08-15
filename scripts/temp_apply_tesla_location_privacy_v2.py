from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


adapter = Path("packages/plugins/vehicles/tesla/server/TeslaAdapter.ts")
middleware = Path("packages/plugins/vehicles/tesla/server/TeslaVehicleMiddleware.ts")
mock = Path("packages/plugins/vehicles/tesla/server/test-helpers/MockTeslaAdapter.ts")
adapter_test = Path("packages/plugins/vehicles/tesla/server/TeslaAdapter.test.ts")
middleware_test = Path("packages/plugins/vehicles/tesla/server/TeslaVehicleMiddleware.test.ts")

# TeslaAdapter: make location_data optional and surface odometer privately.
text = adapter.read_text()
if 'options: { includeLocation?: boolean } = {}' not in text:
    replace_once(
        adapter,
        '''type TeslaAdapterChargeState = AdapterVehicleChargeState & {
  /** Tesla charger_actual_current: measured draw, not the control target. */
  chargeAmpsActual: number;
};
''',
        '''type TeslaAdapterChargeState = AdapterVehicleChargeState & {
  /** Tesla charger_actual_current: measured draw, not the control target. */
  chargeAmpsActual: number;
  /** Odometer is used internally to validate cached home coordinates. */
  odometerMiles?: number;
};
''',
    )
    replace_once(
        adapter,
        '''interface TeslaVehicleState {
  vehicle_name?: string;
  car_type?: string;
}
''',
        '''interface TeslaVehicleState {
  vehicle_name?: string;
  car_type?: string;
  odometer?: number;
}
''',
    )
    replace_once(
        adapter,
        '''  async getChargeState(ctx: CallContext): Promise<AdapterVehicleChargeState> {
    // `;` must be percent-encoded — Tesla's gateway treats raw `;` as a
    // query-param separator and silently drops everything after the
    // first endpoint, leaving drive_state / vehicle_state missing.
    const endpoints = encodeURIComponent(
      "charge_state;vehicle_state;location_data",
    );
''',
        '''  async getChargeState(
    ctx: CallContext,
    options: { includeLocation?: boolean } = {},
  ): Promise<AdapterVehicleChargeState> {
    // `;` must be percent-encoded — Tesla's gateway treats raw `;` as a
    // query-param separator. Routine polling excludes location_data because
    // Tesla shows a location-sharing indicator in the vehicle when it is read.
    const endpointNames = ["charge_state", "vehicle_state"];
    if (options.includeLocation ?? true) endpointNames.push("location_data");
    const endpoints = encodeURIComponent(endpointNames.join(";"));
''',
    )
    replace_once(
        adapter,
        '''      vehicleName: vehicle?.vehicle_name ?? "Tesla",
      lastUpdated: new Date().toISOString(),
''',
        '''      vehicleName: vehicle?.vehicle_name ?? "Tesla",
      odometerMiles: vehicle?.odometer,
      lastUpdated: new Date().toISOString(),
''',
    )

# Middleware: no location while driving/unplugged; one safe home check on plug-in.
text = middleware.read_text()
if 'interface TrustedLocation' not in text:
    replace_once(
        middleware,
        '''type TeslaCachedState = Omit<AdapterVehicleChargeState, "isOnline"> & {
  /** Sensed Tesla AC input current. chargeAmps remains the control target. */
  chargeAmpsActual?: number;
};
''',
        '''type TeslaAdapterState = AdapterVehicleChargeState & {
  /** Sensed Tesla AC input current. chargeAmps remains the control target. */
  chargeAmpsActual?: number;
  /** Odometer is internal metadata used to validate cached coordinates. */
  odometerMiles?: number;
};

type TeslaCachedState = Omit<TeslaAdapterState, "isOnline">;

type TeslaLocationAwareAdapter = VehicleAdapter & {
  getChargeState(
    ctx: CallContext,
    options?: { includeLocation?: boolean },
  ): Promise<TeslaAdapterState>;
};

interface TrustedLocation {
  latitude: number;
  longitude: number;
  odometerMiles: number;
}

const LOCATION_ODOMETER_TOLERANCE_MILES = 0.01;
''',
    )
    replace_once(
        middleware,
        '  private readonly adapter: VehicleAdapter;\n',
        '  private readonly adapter: TeslaLocationAwareAdapter;\n',
    )
    replace_once(
        middleware,
        '''  private lastWakeAtMs = 0;
  private lastOnlineCheckAtMs = 0;
''',
        '''  private lastWakeAtMs = 0;
  private lastOnlineCheckAtMs = 0;
  private trustedLocation: TrustedLocation | null = null;
''',
    )
    replace_once(
        middleware,
        '    this.adapter = adapter;\n',
        '    this.adapter = adapter as TeslaLocationAwareAdapter;\n',
    )
    replace_once(
        middleware,
        '      return this.fetchAndCache(withSuffix(context, "transition"));\n',
        '''      return this.fetchAndCache(
        withSuffix(context, "transition"),
        !!context.forceRefresh,
      );
''',
    )
    replace_once(
        middleware,
        '      return this.fetchAndCache(withSuffix(context, "request_vehicle_data"));\n',
        '''      return this.fetchAndCache(
        withSuffix(context, "request_vehicle_data"),
        !!context.forceRefresh,
      );
''',
    )
    replace_once(
        middleware,
        '      return this.wakeAndFetch(withSuffix(context, `wake:${wakeReason}`));\n',
        '''      return this.wakeAndFetch(
        withSuffix(context, `wake:${wakeReason}`),
        !!context.forceRefresh,
      );
''',
    )
    replace_once(
        middleware,
        '      await this.fetchAndCache(ctx);\n',
        '      await this.fetchAndCache(ctx, false);\n',
    )
    replace_once(
        middleware,
        '''  /** Fetch vehicle data from the adapter and update the cache ($0.002). */
  private async fetchAndCache(
    ctx: CallContext,
  ): Promise<AdapterVehicleChargeState | null> {
    const state = await this.adapter.getChargeState(ctx);
    state.lastUpdated = new Date().toISOString();

    this.lastKnownOnline = state.isOnline;
    this.lastFetchAtMs = Date.now();
    const { isOnline: _isOnline, ...rest } = state;
    this.cachedState = rest;

    return this.getCachedState();
  }

  /** Wake the vehicle ($0.02), then fetch fresh state. */
  private async wakeAndFetch(
    ctx: CallContext,
  ): Promise<AdapterVehicleChargeState | null> {
    this.logger.info("Waking vehicle");
    this.lastWakeAtMs = Date.now();

    const woke = await this.adapter.wakeVehicle(ctx);
    if (!woke) {
      this.logger.warn("Wake failed");
      return null;
    }

    this.lastKnownOnline = true;
    return this.fetchAndCache(withSuffix(ctx, "request_vehicle_data"));
  }
''',
        '''  /** Fetch vehicle data and update the cache. Routine telemetry excludes
   *  location_data so EV Solar does not request location while the car is
   *  driving. A plugged vehicle gets one location check when needed. */
  private async fetchAndCache(
    ctx: CallContext,
    includeLocation: boolean,
  ): Promise<AdapterVehicleChargeState | null> {
    const fetchedState = await this.adapter.getChargeState(ctx, {
      includeLocation,
    });
    const state = await this.withRequiredLocation(
      fetchedState,
      ctx,
      includeLocation,
    );
    state.lastUpdated = new Date().toISOString();

    if (!state.isPluggedIn) {
      this.trustedLocation = null;
    } else if (
      state.latitude != null &&
      state.longitude != null &&
      state.odometerMiles != null
    ) {
      this.trustedLocation = {
        latitude: state.latitude,
        longitude: state.longitude,
        odometerMiles: state.odometerMiles,
      };
    }

    this.lastKnownOnline = state.isOnline;
    this.lastFetchAtMs = Date.now();
    const { isOnline: _isOnline, ...rest } = state;
    this.cachedState = rest;

    return this.getCachedState();
  }

  private canReuseTrustedLocation(state: TeslaAdapterState): boolean {
    if (!this.trustedLocation || state.odometerMiles == null) return false;
    return Math.abs(
      state.odometerMiles - this.trustedLocation.odometerMiles,
    ) <= LOCATION_ODOMETER_TOLERANCE_MILES;
  }

  private async withRequiredLocation(
    state: TeslaAdapterState,
    ctx: CallContext,
    includeLocation: boolean,
  ): Promise<TeslaAdapterState> {
    if (includeLocation || !state.isPluggedIn) return state;

    if (this.canReuseTrustedLocation(state)) {
      return {
        ...state,
        latitude: this.trustedLocation?.latitude ?? null,
        longitude: this.trustedLocation?.longitude ?? null,
      };
    }

    this.logger.info(
      "Plugged vehicle location unknown or odometer changed — fetching location for home check",
    );
    return await this.adapter.getChargeState(withSuffix(ctx, "location"), {
      includeLocation: true,
    });
  }

  /** Wake the vehicle ($0.02), then fetch fresh state. */
  private async wakeAndFetch(
    ctx: CallContext,
    includeLocation: boolean,
  ): Promise<AdapterVehicleChargeState | null> {
    this.logger.info("Waking vehicle");
    this.lastWakeAtMs = Date.now();

    const woke = await this.adapter.wakeVehicle(ctx);
    if (!woke) {
      this.logger.warn("Wake failed");
      return null;
    }

    this.lastKnownOnline = true;
    return this.fetchAndCache(
      withSuffix(ctx, "request_vehicle_data"),
      includeLocation,
    );
  }
''',
    )

# Mock adapter: expose odometer and record location endpoint intent.
text = mock.read_text()
if 'getChargeStateIncludeLocation' not in text:
    replace_once(
        mock,
        '''export class MockTeslaAdapter {
  state: VehicleChargeState = buildVehicleChargeState();
''',
        '''type MockTeslaState = VehicleChargeState & { odometerMiles?: number };

export class MockTeslaAdapter {
  state: MockTeslaState = {
    ...buildVehicleChargeState({ latitude: 43.6, longitude: 1.4 }),
    odometerMiles: 1000,
  };
''',
    )
    replace_once(
        mock,
        '  getChargeStateCalls = 0;\n',
        '  getChargeStateCalls = 0;\n  getChargeStateIncludeLocation: Array<boolean | undefined> = [];\n',
    )
    replace_once(
        mock,
        '''  getChargeState(_ctx: unknown): Promise<VehicleChargeState> {
    this.getChargeStateCalls++;
    return Promise.resolve({ ...this.state });
  }
''',
        '''  getChargeState(
    _ctx: unknown,
    options?: { includeLocation?: boolean },
  ): Promise<MockTeslaState> {
    this.getChargeStateCalls++;
    this.getChargeStateIncludeLocation.push(options?.includeLocation);
    const state = { ...this.state };
    if (options?.includeLocation === false) {
      state.latitude = null;
      state.longitude = null;
    }
    return Promise.resolve(state);
  }
''',
    )

# Adapter tests: assert endpoint selection and odometer mapping.
text = adapter_test.read_text()
if 'omits location_data when explicitly disabled' not in text:
    replace_once(
        adapter_test,
        '''  let requestLog: Array<
    { method: string; url: string; body?: string; authorization: string | null }
  >;
''',
        '''  let requestLog: Array<{
    method: string;
    url: string;
    body?: string;
    authorization: string | null;
    endpoints: string | null;
  }>;
''',
    )
    replace_once(
        adapter_test,
        '''      vehicle_state: {
        vehicle_name: "My Model 3",
      },
''',
        '''      vehicle_state: {
        vehicle_name: "My Model 3",
        odometer: 12345.6,
      },
''',
    )
    replace_once(
        adapter_test,
        '''      requestLog.push({
        method: req.method,
        url: url.pathname,
        body,
        authorization: req.headers.get("Authorization"),
      });
''',
        '''      requestLog.push({
        method: req.method,
        url: url.pathname,
        body,
        authorization: req.headers.get("Authorization"),
        endpoints: url.searchParams.get("endpoints"),
      });
''',
    )
    replace_once(
        adapter_test,
        '''      expect(state.vehicleName).toBe("My Model 3");
    });
''',
        '''      expect(state.vehicleName).toBe("My Model 3");
      expect((state as { odometerMiles?: number }).odometerMiles).toBe(12345.6);
    });
''',
    )
    replace_once(
        adapter_test,
        '''    it("sends authorization header", async () => {
      await adapter.getChargeState(c("test:charge-state"));
      const req = requestLog.find((r) => r.url.includes("vehicle_data"));
      assertExists(req);
      expect(req.authorization).toBe("Bearer mock-token");
    });
''',
        '''    it("includes location_data by default", async () => {
      await adapter.getChargeState(c("test:with-location"));
      const req = requestLog.find((r) => r.url.includes("vehicle_data"));
      assertExists(req);
      expect(req.endpoints).toBe(
        "charge_state;vehicle_state;location_data",
      );
    });

    it("omits location_data when explicitly disabled", async () => {
      await adapter.getChargeState(c("test:no-location"), {
        includeLocation: false,
      });
      const req = requestLog.find((r) => r.url.includes("vehicle_data"));
      assertExists(req);
      expect(req.endpoints).toBe("charge_state;vehicle_state");
    });

    it("sends authorization header", async () => {
      await adapter.getChargeState(c("test:charge-state"));
      const req = requestLog.find((r) => r.url.includes("vehicle_data"));
      assertExists(req);
      expect(req.authorization).toBe("Bearer mock-token");
    });
''',
    )

# Middleware tests: update call counts and add privacy/safety regression cases.
text = middleware_test.read_text()
if 'does not request location while vehicle is unplugged' not in text:
    replace_once(
        middleware_test,
        '''    it("fetches on first call (no cache)", async () => {
      await middleware.requestState(ctx());
      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(1);
    });
''',
        '''    it("fetches on first call (no cache)", async () => {
      await middleware.requestState(ctx());
      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(2);
      expect(adapter.getChargeStateIncludeLocation).toEqual([false, true]);
    });

    it("does not request location while vehicle is unplugged", async () => {
      adapter.state = {
        ...buildVehicleChargeState({
          isPluggedIn: false,
          latitude: 43.6,
          longitude: 1.4,
        }),
        odometerMiles: 1000,
      };

      const state = await middleware.requestState(ctx());

      expect(adapter.getChargeStateIncludeLocation).toEqual([false]);
      expect(state?.latitude).toBeNull();
      expect(state?.longitude).toBeNull();
    });

    it("fetches location once when plugged, then reuses it if odometer is unchanged", async () => {
      const first = await middleware.requestState(ctx({ hasSolar: true }));
      expect(adapter.getChargeStateIncludeLocation).toEqual([false, true]);
      expect(first?.latitude).toBe(43.6);
      expect(first?.longitude).toBe(1.4);

      adapter.getChargeStateCalls = 0;
      adapter.getChargeStateIncludeLocation = [];
      time.tick(11 * 60 * 1000);

      const second = await middleware.requestState(ctx({ hasSolar: true }));
      expect(adapter.getChargeStateCalls).toBe(1);
      expect(adapter.getChargeStateIncludeLocation).toEqual([false]);
      expect(second?.latitude).toBe(43.6);
      expect(second?.longitude).toBe(1.4);
    });

    it("refetches location if odometer changed before a plugged poll", async () => {
      await middleware.requestState(ctx({ hasSolar: true }));
      adapter.getChargeStateCalls = 0;
      adapter.getChargeStateIncludeLocation = [];

      adapter.state = {
        ...adapter.state,
        latitude: 44.0,
        longitude: 2.0,
        odometerMiles: 1001,
      };
      time.tick(11 * 60 * 1000);

      const state = await middleware.requestState(ctx({ hasSolar: true }));
      expect(adapter.getChargeStateIncludeLocation).toEqual([false, true]);
      expect(state?.latitude).toBe(44.0);
      expect(state?.longitude).toBe(2.0);
    });

    it("clears trusted location after observing unplug", async () => {
      await middleware.requestState(ctx({ hasSolar: true }));
      adapter.getChargeStateIncludeLocation = [];

      adapter.state = {
        ...adapter.state,
        isPluggedIn: false,
      };
      time.tick(11 * 60 * 1000);
      await middleware.requestState(ctx({ hasSolar: true }));
      expect(adapter.getChargeStateIncludeLocation).toEqual([false]);

      adapter.getChargeStateIncludeLocation = [];
      adapter.state = {
        ...adapter.state,
        isPluggedIn: true,
      };
      time.tick(6 * 60 * 1000);
      await middleware.requestState(ctx({ hasSolar: true }));
      expect(adapter.getChargeStateIncludeLocation).toEqual([false, true]);
    });

    it("allows a manual force refresh to request location while unplugged", async () => {
      adapter.state = {
        ...buildVehicleChargeState({
          isPluggedIn: false,
          latitude: 43.6,
          longitude: 1.4,
        }),
        odometerMiles: 1000,
      };

      const state = await middleware.requestState(ctx({ forceRefresh: true }));

      expect(adapter.getChargeStateIncludeLocation).toEqual([true]);
      expect(state?.latitude).toBe(43.6);
      expect(state?.longitude).toBe(1.4);
    });
''',
    )
    replace_once(
        middleware_test,
        '''          expect(adapter.wakeVehicleCalls).toBe(1);
          expect(adapter.getChargeStateCalls).toBe(1);
''',
        '''          expect(adapter.wakeVehicleCalls).toBe(1);
          expect(adapter.getChargeStateCalls).toBe(2);
''',
    )
    replace_once(
        middleware_test,
        '''      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(1);
      expect(state?.isPluggedIn).toBe(true);
''',
        '''      expect(adapter.isVehicleOnlineCalls).toBe(1);
      expect(adapter.getChargeStateCalls).toBe(2);
      expect(state?.isPluggedIn).toBe(true);
''',
    )
    replace_once(
        middleware_test,
        '''      expect(adapter.getChargeStateCalls).toBe(1);
      expect(state?.isPluggedIn).toBe(true);
    });
''',
        '''      expect(adapter.getChargeStateCalls).toBe(2);
      expect(adapter.getChargeStateIncludeLocation).toEqual([false, true]);
      expect(state?.isPluggedIn).toBe(true);
    });
''',
    )
