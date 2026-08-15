from pathlib import Path

path = Path("packages/plugins/vehicles/tesla/server/TeslaVehicleMiddleware.ts")
text = path.read_text()
old = '''  /** Fetch vehicle data and update the cache. Routine telemetry deliberately
   *  excludes location_data so driving never causes Tesla's location-sharing
   *  indicator. When a plug-in is detected, location is fetched once for the
   *  home check and then reused while the cable remains connected. */
  private async fetchAndCache(
    ctx: CallContext,
    includeLocation: boolean,
  ): Promise<AdapterVehicleChargeState | null> {
    const previous = this.cachedState;
    let state = await this.adapter.getChargeState(ctx, { includeLocation });

    if (!includeLocation && state.isPluggedIn) {
      const canReuseLocation = previous?.isPluggedIn === true &&
        previous.latitude != null && previous.longitude != null;

      if (canReuseLocation) {
        state = {
          ...state,
          latitude: previous.latitude,
          longitude: previous.longitude,
        };
      } else {
        this.logger.info(
          "Plug-in detected — fetching location once for home check",
        );
        state = await this.adapter.getChargeState(withSuffix(ctx, "location"), {
          includeLocation: true,
        });
      }
    }

    state.lastUpdated = new Date().toISOString();

    this.lastKnownOnline = state.isOnline;
    this.lastFetchAtMs = Date.now();
    const { isOnline: _isOnline, ...rest } = state;
    this.cachedState = rest;

    return this.getCachedState();
  }
'''
new = '''  /** Fetch vehicle data and update the cache. Routine telemetry deliberately
   *  excludes location_data so driving never causes Tesla's location-sharing
   *  indicator. When a plug-in is detected, location is fetched once for the
   *  home check and then reused while the cable remains connected. */
  private async fetchAndCache(
    ctx: CallContext,
    includeLocation: boolean,
  ): Promise<AdapterVehicleChargeState | null> {
    const previous = this.cachedState;
    const fetchedState = await this.adapter.getChargeState(ctx, {
      includeLocation,
    });
    const state = await this.withRequiredLocation(
      fetchedState,
      previous,
      ctx,
      includeLocation,
    );
    state.lastUpdated = new Date().toISOString();

    this.lastKnownOnline = state.isOnline;
    this.lastFetchAtMs = Date.now();
    const { isOnline: _isOnline, ...rest } = state;
    this.cachedState = rest;

    return this.getCachedState();
  }

  private async withRequiredLocation(
    state: AdapterVehicleChargeState,
    previous: TeslaCachedState | null,
    ctx: CallContext,
    includeLocation: boolean,
  ): Promise<AdapterVehicleChargeState> {
    if (includeLocation || !state.isPluggedIn) return state;

    if (
      previous?.isPluggedIn === true &&
      previous.latitude != null &&
      previous.longitude != null
    ) {
      return {
        ...state,
        latitude: previous.latitude,
        longitude: previous.longitude,
      };
    }

    this.logger.info(
      "Plug-in detected — fetching location once for home check",
    );
    return await this.adapter.getChargeState(withSuffix(ctx, "location"), {
      includeLocation: true,
    });
  }
'''
if old not in text:
    raise SystemExit("Expected middleware privacy block not found")
path.write_text(text.replace(old, new, 1))
