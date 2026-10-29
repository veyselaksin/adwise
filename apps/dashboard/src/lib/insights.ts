// Links from a saved insight back to the live dashboard, built from the scope the
// server read out of the evidence (not from the answer's text).

import { CHANNELS, COUNTRIES } from "@constants/filters";
import type { InsightScope } from "@typings/insights";

export const insightPath = (id: string) => `/insights/${encodeURIComponent(id)}`;

/**
 * The overview with the insight's period and, when the lookups used exactly
 * one, its channel and country. Null without a period. The overview shows the
 * data as it is now, so it can differ from the frozen report.
 */
export function overviewHref(scope: InsightScope): string | null {
  if (!scope.period) return null;
  const params = new URLSearchParams({ range: "custom", from: scope.period.from, to: scope.period.to });
  const [channel] = scope.channels;
  const [country] = scope.countries;
  if (scope.channels.length === 1 && CHANNELS.some((c) => c.value === channel)) params.set("channel", channel!);
  if (scope.countries.length === 1 && COUNTRIES.some((c) => c.value === country)) params.set("country", country!);
  return `/?${params}`;
}

/** The investigation page for one campaign over the insight's period. */
export function campaignHref(campaignId: string, scope: InsightScope): string {
  const params = new URLSearchParams({ campaign: campaignId });
  if (scope.period) {
    params.set("from", scope.period.from);
    params.set("to", scope.period.to);
  }
  return `/investigate?${params}`;
}

const saved = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const savedTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** "Oct 29, 2026"; fixed to UTC so server and browser render the same text. */
export const formatSavedDate = (iso: string) => saved.format(new Date(iso));
export const formatSavedTime = (iso: string) => savedTime.format(new Date(iso));

export const channelLabel = (value: string) => CHANNELS.find((c) => c.value === value)?.label ?? value;
export const countryLabel = (value: string) => COUNTRIES.find((c) => c.value === value)?.label ?? value;
