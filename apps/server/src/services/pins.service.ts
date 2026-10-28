import { randomUUID } from "node:crypto";
import Value from "typebox/value";
import { METRIC_KEYS } from "../constants/metrics.constant.js";
import { PIN_MAX_ROWS, PIN_TITLE_MAX_CHARS, PINS_MAX } from "../constants/pins.constant.js";
import { JsonList } from "../lib/json-list.js";
import { AppError } from "../lib/response.js";
import type { Pin, PinResult } from "../types/pins.type.js";
import { metricsRequestFrom, QueryMetricsParams, toolLabel } from "./agent.tools.js";
import type { MetricsService } from "./metrics.service.js";

/**
 * Agent answers pinned to the overview as live tiles. A pin keeps the agent's
 * query_metrics call (validated like a tool call), so a tile re-runs it on the
 * metric layer each visit: no model call, and a named period like "last 7
 * days" stays current. Saved in a JSON file (PINS_PATH), like the team rules.
 */
export class PinsService {
  private constructor(
    private readonly store: JsonList<Pin>,
    private readonly metrics: MetricsService,
  ) {}

  static async load(path: string, metrics: MetricsService): Promise<PinsService> {
    return new PinsService(await JsonList.load<Pin>(path, "PINS_PATH"), metrics);
  }

  list(): Pin[] {
    return this.store.items;
  }

  add(input: { title: string; query: unknown }): Promise<Pin> {
    const { query } = input;
    if (!Value.Check(QueryMetricsParams, query)) {
      const first = Value.Errors(QueryMetricsParams, query)[0];
      throw new AppError(400, "INVALID_QUERY", `Not a query_metrics call${first ? `: ${first.instancePath || "query"} ${first.message}` : ""}`);
    }
    metricsRequestFrom(query); // Throws MISSING_RANGE for a call without a period.
    const title = input.title.trim().replace(/\s+/g, " ");
    if (!title) throw new AppError(400, "EMPTY_TITLE", "Give the tile a title");

    return this.store.write((pins) => {
      if (pins.length >= PINS_MAX) {
        throw new AppError(409, "TOO_MANY_PINS", `Keep it to ${PINS_MAX} tiles; remove one first`);
      }
      const pin: Pin = {
        id: randomUUID(),
        title: title.length > PIN_TITLE_MAX_CHARS ? `${title.slice(0, PIN_TITLE_MAX_CHARS - 1)}…` : title,
        label: toolLabel("query_metrics", query),
        query,
        createdAt: new Date().toISOString(),
      };
      return { items: [...pins, pin], result: pin };
    });
  }

  remove(id: string): Promise<Pin> {
    return this.store.write((pins) => {
      const pin = find(pins, id);
      return { items: pins.filter((p) => p.id !== id), result: pin };
    });
  }

  /** Runs the pinned call now, on the same metric layer as the dashboard. */
  async result(id: string): Promise<PinResult> {
    const pin = find(this.store.items, id);
    const result = await this.metrics.run(metricsRequestFrom(pin.query));
    const limit = Math.min(pin.query.limit ?? PIN_MAX_ROWS, PIN_MAX_ROWS);
    return {
      pin,
      metrics: pin.query.metrics?.length ? pin.query.metrics : METRIC_KEYS,
      result: { ...result, rows: result.rows.slice(0, limit) },
      rowsOmitted: Math.max(0, result.rows.length - limit),
    };
  }
}

function find(pins: Pin[], id: string): Pin {
  const pin = pins.find((p) => p.id === id);
  if (!pin) throw new AppError(404, "PIN_NOT_FOUND", "No pinned tile with that id");
  return pin;
}
