import { useMemo, useState } from "react";

export type DatePreset = "mtd" | "7d" | "30d" | "ytd" | "all" | "custom";

export const PRESET_LABELS: Record<DatePreset, string> = {
  mtd: "Month to Date",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  ytd: "Year to Date",
  all: "All Time",
  custom: "Custom",
};

export const PRESET_KEYS: DatePreset[] = ["mtd", "7d", "30d", "ytd", "all", "custom"];

// note: computeRange calls new Date() at evaluation time. for sliding presets (7d, 30d, etc.)
// the window is computed once at render time and can be up to ~1 minute stale between re-renders.
// this is acceptable for a cost dashboard but means the displayed range may lag wall clock time
// slightly between poll ticks.
function computeRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  // floor `to` to the nearest minute so the query key is stable across 30s refetch ticks
  // (prevents a new cache entry being created on every poll cycle)
  const toFloored = new Date(now);
  toFloored.setSeconds(0, 0);
  const to = toFloored.toISOString();
  switch (preset) {
    case "mtd": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: d.toISOString(), to };
    }
    case "7d": {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
      return { from: d.toISOString(), to };
    }
    case "30d": {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0);
      return { from: d.toISOString(), to };
    }
    case "ytd": {
      const d = new Date(now.getFullYear(), 0, 1);
      return { from: d.toISOString(), to };
    }
    case "all":
    case "custom":
      return { from: "", to: "" };
  }
}

export interface UseDateRangeResult {
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  /** resolved iso strings ready to pass to api calls; empty string means unbounded */
  from: string;
  to: string;
  /** false when preset=custom but both dates are not yet selected */
  customReady: boolean;
}

export function useDateRange(): UseDateRangeResult {
  const [preset, setPreset] = useState<DatePreset>("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to } = useMemo(() => {
    if (preset !== "custom") return computeRange(preset);
    // treat custom date strings as local-date boundaries so the full day is included
    // regardless of the user's timezone. "from" starts at local midnight, "to" at 23:59:59.999.
    const fromDate = customFrom ? new Date(customFrom + "T00:00:00") : null;
    const toDate = customTo ? new Date(customTo + "T23:59:59.999") : null;
    return {
      from: fromDate ? fromDate.toISOString() : "",
      to: toDate ? toDate.toISOString() : "",
    };
  }, [preset, customFrom, customTo]);

  const customReady = preset !== "custom" || (!!customFrom && !!customTo);

  return {
    preset,
    setPreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    from,
    to,
    customReady,
  };
}
