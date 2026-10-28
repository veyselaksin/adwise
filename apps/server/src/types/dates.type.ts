import type { RANGE_PRESETS } from "../constants/dates.constant.js";

export type DateRange = { from: string; to: string };

export type RangePreset = (typeof RANGE_PRESETS)[number];
