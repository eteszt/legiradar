export const operatorIcaoOverrides: Record<string, string> = {
  W6: "WZZ",
  W4: "WMT",
  FR: "RYR",
  FH: "FHY",
  LH: "DLH",
  BA: "BAW",
  KL: "KLM",
  AF: "AFR",
  U2: "EZY",
  LX: "SWR",
  OS: "AUA",
  EW: "EWG",
  QR: "QTR",
  EK: "UAE",
  TK: "THY",
  IB: "IBE",
  AY: "FIN",
  LO: "LOT",
  SK: "SAS",
  DY: "NOZ",
};

export function staticCallsignCandidates(flight: string, dynamicIcao?: string | null) {
  const normalized = flight.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = normalized.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
  if (!match) return [normalized];
  const [, iata, suffix] = match;
  const unpadded = suffix.replace(/^0+/, "") || "0";
  const icao = dynamicIcao || operatorIcaoOverrides[iata];
  const numericSuffix = /^\d+$/.test(unpadded) ? unpadded : null;
  return Array.from(
    new Set(
      [
        icao ? `${icao}${suffix}` : "",
        icao ? `${icao}${unpadded}` : "",
        icao && numericSuffix ? `${icao}${numericSuffix.padStart(3, "0")}` : "",
        icao && numericSuffix ? `${icao}${numericSuffix.padStart(4, "0")}` : "",
        normalized,
      ].filter(Boolean),
    ),
  );
}
