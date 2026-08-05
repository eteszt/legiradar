export const operatorIcaoOverrides: Record<string, string> = {
  W6: "WZZ",
  W4: "WMT",
  FR: "RYR",
  FH: "FHY",
  BF: "FBU",
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

export function exactCommercialFromFlightAwarePage(html: string, callsign: string) {
  const normalizedCallsign = callsign.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const callsignPrefix = normalizedCallsign.match(/^([A-Z]{3})/)?.[1];
  const encodedFlight = html.match(/\"iataIdent\":\"([A-Z0-9]+)\"/i)?.[1];
  const flight = encodedFlight?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  const iataPrefix = flight?.match(/^([A-Z0-9]{2})\d{1,4}[A-Z]?$/)?.[1];
  if (!flight || !iataPrefix || !callsignPrefix) return null;
  return operatorIcaoOverrides[iataPrefix] === callsignPrefix ? flight : null;
}

export function trustedCommercialAlias(providerAlias: string | null, curatedFlight: string | null) {
  const provider = providerAlias?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  const curated = curatedFlight?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  if (!provider) return null;
  return !curated || provider === curated ? provider : null;
}

export function commercialFlightFromCallsign(callsign: string) {
  const normalized = callsign.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = normalized.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (!match) return null;
  const [, icao, suffix] = match;
  // A French bee napi alfanumerikus operatív hívójelei (például FBU74E)
  // nem a kereskedelmi járatszám suffixét őrzik, ezért ezekből nem képezhető
  // mechanikusan BF74E. A tisztán numerikus FBU704 ↔ BF704 pár továbbra is biztos.
  if (icao === "FBU" && /[A-Z]/.test(suffix)) return null;
  const iata = Object.entries(operatorIcaoOverrides)
    .find(([, currentIcao]) => currentIcao === icao)?.[0];
  return iata ? `${iata}${suffix}` : null;
}

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
