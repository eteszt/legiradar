export function statusLabel(status: string) {
  const normalized = status.trim().toLocaleLowerCase("en-US");
  const labels: Record<string, string> = {
    scheduled: "INDULÁSRA VÁR",
    active: "AKTÍV",
    cancelled: "TÖRÖLVE",
    estimated: "VÁRHATÓ",
    delayed: "KÉSIK",
    incident: "ESEMÉNY",
    diverted: "ÁTIRÁNYÍTVA",
    landed: "LESZÁLLT",
  };
  if (normalized.startsWith("estimated departure")) return "VÁRHATÓ INDULÁS";
  if (normalized.startsWith("estimated arrival")) return "VÁRHATÓ ÉRKEZÉS";
  if (normalized.startsWith("scheduled departure")) return "MENETREND SZERINTI INDULÁS";
  if (normalized.startsWith("delayed")) return "KÉSIK";
  return labels[normalized] || status.toLocaleUpperCase("hu-HU");
}

export function scheduledPhaseLabel(status: string) {
  const label = statusLabel(status);
  return label === "VÁRHATÓ INDULÁS" ? "MENETRENDI ADAT" : label;
}
