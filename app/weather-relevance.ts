export type FlightLevelHazardImpact = {
  altitudeRelevant: boolean;
  temporallyRelevant: boolean;
  feature: {
    properties: {
      hazard: string;
    };
  };
};

export function isFlightLevelInHazardLayer(
  currentFlightLevel: number | null,
  baseFlightLevel: number | null,
  topFlightLevel: number | null,
) {
  if (currentFlightLevel == null || !Number.isFinite(currentFlightLevel)) return false;
  return (baseFlightLevel == null || currentFlightLevel >= baseFlightLevel)
    && (topFlightLevel == null || currentFlightLevel <= topFlightLevel);
}

export function isRelevantFlightLevelTurbulence(impact: FlightLevelHazardImpact) {
  return impact.altitudeRelevant
    && impact.temporallyRelevant
    && impact.feature.properties.hazard.trim().toLocaleLowerCase("hu-HU") === "turbulencia";
}

export function isPreflightRouteTurbulence(impact: FlightLevelHazardImpact) {
  return impact.temporallyRelevant
    && impact.feature.properties.hazard.trim().toLocaleLowerCase("hu-HU") === "turbulencia";
}
