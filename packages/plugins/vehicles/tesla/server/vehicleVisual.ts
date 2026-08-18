type TeslaVisualConfig = {
  carType: string | null;
  exteriorColor: string | null;
};

type PaintMapping = {
  id: string;
  description: string;
};

const MODEL_FAMILIES: Record<string, string> = {
  models: "model-s",
  model3: "model-3",
  modelx: "model-x",
  modely: "model-y",
  cybertruck: "cybertruck",
};

const PAINTS: Record<string, PaintMapping> = {
  deepblue: { id: "PPSB", description: "Deep Blue Metallic" },
  deepbluemetallic: { id: "PPSB", description: "Deep Blue Metallic" },
  midnightcherryred: { id: "PR00", description: "Midnight Cherry Red" },
  midnightsilver: { id: "PMNG", description: "Midnight Silver Metallic" },
  midnightsilvermetallic: { id: "PMNG", description: "Midnight Silver Metallic" },
  pearlwhite: { id: "PPSW", description: "Pearl White Multi-Coat" },
  pearlwhitemulticoat: { id: "PPSW", description: "Pearl White Multi-Coat" },
  quicksilver: { id: "PN00", description: "Quicksilver" },
  redmulticoat: { id: "PPMR", description: "Red Multi-Coat" },
  solidblack: { id: "PBSB", description: "Solid Black" },
  stealthgray: { id: "PN01", description: "Stealth Gray" },
  stealthgrey: { id: "PN01", description: "Stealth Gray" },
  ultrared: { id: "PR01", description: "Ultra Red" },
};

const VIN_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY";

function normalize(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function modelFamily(carType?: string | null): string | null {
  return MODEL_FAMILIES[normalize(carType)] ?? null;
}

function paintMapping(exteriorColor?: string | null): PaintMapping | null {
  return PAINTS[normalize(exteriorColor)] ?? null;
}

function vinModelYear(vin: string): number | null {
  if (vin.length < 10) return null;
  const index = VIN_YEAR_CODES.indexOf(vin[9].toUpperCase());
  if (index < 0) return null;
  const year = 2010 + index;
  return year <= 2030 ? year : null;
}

function imageWidth(): string {
  const configured = Deno.env.get("IMAGIN_IMAGE_WIDTH")?.trim();
  return configured && /^\d+$/.test(configured) ? configured : "400";
}

function buildImageUrl(
  customer: string,
  family: string,
  vin: string,
  paint: PaintMapping | null,
): string {
  const params = new URLSearchParams({
    customer,
    make: "tesla",
    modelFamily: family,
    powerTrain: "electric",
    angle: "23",
    width: imageWidth(),
    zoomType: "fullscreen",
    position: "bottom",
  });
  const year = vinModelYear(vin);
  if (year) params.set("modelYear", String(year));
  if (paint) {
    params.set("paintId", paint.id);
    params.set("paintDescription", paint.description);
  }
  return `https://cdn.imagin.studio/getImage?${params.toString()}`;
}

export function buildTeslaVehicleVisual(config: TeslaVisualConfig, vin: string) {
  const customer = Deno.env.get("IMAGIN_CUSTOMER_ID")?.trim() ?? "";
  const family = modelFamily(config.carType);
  const paint = paintMapping(config.exteriorColor);
  const year = vinModelYear(vin);

  if (!customer || !family) {
    return {
      provider: null,
      imageUrl: null,
      paintCode: paint?.id ?? null,
      modelYear: year,
      note: !customer
        ? "IMAGIN_CUSTOMER_ID is not configured"
        : "Vehicle model is not mapped to the render provider",
    };
  }

  return {
    provider: "IMAGIN.studio",
    imageUrl: buildImageUrl(customer, family, vin, paint),
    paintCode: paint?.id ?? null,
    modelYear: year,
    note: paint
      ? "Model and official Tesla paint code are mapped; exact wheel rendering depends on provider coverage"
      : "Model is mapped; exact paint and wheel rendering depend on provider coverage",
  };
}
