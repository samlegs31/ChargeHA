export interface VehicleColorPalette {
  label: string;
  light: string;
  base: string;
  dark: string;
  strong: string;
}

const PALETTES: Record<string, VehicleColorPalette> = {
  red: {
    label: "Red",
    light: "#ef938d",
    base: "#d6534d",
    dark: "#a43835",
    strong: "#762323",
  },
  blue: {
    label: "Blue",
    light: "#8eb8e8",
    base: "#4f86c6",
    dark: "#315f98",
    strong: "#203f68",
  },
  black: {
    label: "Black",
    light: "#8a929c",
    base: "#5c636d",
    dark: "#383e47",
    strong: "#20242a",
  },
  white: {
    label: "White",
    light: "#e7eaee",
    base: "#c3c9d1",
    dark: "#8d96a2",
    strong: "#59616d",
  },
  silver: {
    label: "Silver",
    light: "#d2d8df",
    base: "#a6afb9",
    dark: "#747f8b",
    strong: "#4c5661",
  },
  grey: {
    label: "Grey",
    light: "#bdc4cb",
    base: "#87919b",
    dark: "#5d6771",
    strong: "#3c444c",
  },
  orange: {
    label: "Orange",
    light: "#f0ae75",
    base: "#d47a36",
    dark: "#a65320",
    strong: "#713817",
  },
  green: {
    label: "Green",
    light: "#8fc8a1",
    base: "#58a56f",
    dark: "#37774c",
    strong: "#255035",
  },
  yellow: {
    label: "Yellow",
    light: "#f1d77d",
    base: "#d7ae35",
    dark: "#a47e20",
    strong: "#705516",
  },
  purple: {
    label: "Purple",
    light: "#ba9ddb",
    base: "#8a62b8",
    dark: "#624287",
    strong: "#432d5e",
  },
  brown: {
    label: "Brown",
    light: "#c3a088",
    base: "#936b51",
    dark: "#684937",
    strong: "#493226",
  },
  default: {
    label: "Vehicle",
    light: "#85d6d3",
    base: "#40aaa8",
    dark: "#287b7a",
    strong: "#195554",
  },
};

function colorFamily(exteriorColor: string | null | undefined): string {
  const color = exteriorColor?.toLowerCase() ?? "";
  if (color.includes("red")) return "red";
  if (color.includes("blue")) return "blue";
  if (color.includes("black")) return "black";
  if (color.includes("white") || color.includes("pearl")) return "white";
  if (color.includes("silver") || color.includes("quick")) return "silver";
  if (
    color.includes("grey") || color.includes("gray") ||
    color.includes("stealth")
  ) {
    return "grey";
  }
  if (color.includes("orange")) return "orange";
  if (color.includes("green")) return "green";
  if (color.includes("yellow") || color.includes("gold")) return "yellow";
  if (color.includes("purple")) return "purple";
  if (color.includes("brown")) return "brown";
  return "default";
}

export function vehicleColorPalette(
  exteriorColor: string | null | undefined,
): VehicleColorPalette {
  return PALETTES[colorFamily(exteriorColor)] ?? PALETTES.default;
}
