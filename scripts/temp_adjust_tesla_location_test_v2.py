from pathlib import Path

path = Path("packages/plugins/vehicles/tesla/server/TeslaVehicleMiddleware.test.ts")
text = path.read_text()
old = '''      await middleware.requestState(ctx());
      adapter.getChargeStateCalls = 0;

      // 4 min later — within 5 min staleness window, no refetch.
'''
new = '''      await middleware.requestState(ctx());
      adapter.getChargeStateCalls = 0;
      adapter.getChargeStateIncludeLocation = [];

      // 4 min later — within 5 min staleness window, no refetch.
'''
if old not in text:
    raise SystemExit("Expected online-unplugged regression setup not found")
path.write_text(text.replace(old, new, 1))
