# Home vehicle illustrations

The Home uses local raster illustrations selected only when all three adapter
fields match: model, paint and wheel configuration. A neutral silhouette is used
for missing/unsupported configuration or an image load failure. No VIN, vehicle
name or third-party image service is used to select a render.

| Tesla configuration                      | Local asset                                                          |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `model3 / DeepBlue / StilettoRefresh19`  | `packages/client/public/vehicles/model-3-deepblue-sport19.png`       |
| `modely / PearlWhite / Induction20Black` | `packages/client/public/vehicles/model-y-pearlwhite-induction20.png` |

These configurations were read from the existing authenticated E.V. Solar
`vehicleVisualConfig` diagnostic on 2026-09-09. The Home itself makes no
additional Tesla requests: the adapter exposes the fields from its existing
`vehicle_data` response. Other adapters remain compatible because the shared
fields are optional.

The images are illustrative AI-generated studio renders, not official Tesla
assets, exact CAD geometry or an interactive WebGL model. The existing WebGL
prototype remains separate. Logo assets are unchanged.

## Asset generation

Generated with the built-in imagegen tool. Final prompts:

### Model 3

Create a production automotive UI asset: a photorealistic studio CGI render of a
Tesla Model 3 2023 pre-Highland sedan, DEEP BLUE METALLIC paint Tesla DeepBlue,
with OEM 19-inch SILVER SPORT V2 wheels (Tesla StilettoRefresh19): 10 slender
curved silver alloy spokes, five pairs split spokes with dark open gaps. NOT
black aero covers. Black glass roof. Entire car front three-quarter view, nose
pointing left, eye level slightly elevated showing hood and roof. Realistic
clean automotive proportions, soft premium studio reflections, no text, no
badges or logos, no environment, no floor. Genuinely transparent background
using actual alpha channel and subtle translucent contact shadow only. Car
centered filling 90% width in landscape 3:2 canvas. Isolated vehicle asset for
premium charging dashboard, not a mockup. No checkerboard pattern.

### Model Y

Create a production automotive UI asset: a photorealistic studio CGI render of a
pearl white Tesla Model Y (2023 body style) with OEM 20-inch BLACK INDUCTION
wheels (Tesla code Induction20Black): ten curved turbine black spokes, large 20
inch black rims, low profile tires, NOT aero disc covers. Black glass roof.
Entire car front three-quarter view, nose pointing left, eye level slightly
elevated showing hood and roof. Realistic exact clean automotive proportions,
soft premium studio reflections, no text, no badges or logos, no environment, no
floor. Genuinely transparent background using actual alpha channel and a subtle
translucent contact shadow only. Car centered filling 90% width in a landscape
3:2 canvas. Isolated vehicle asset for premium charging dashboard, not a mockup.
No checkerboard pattern.
