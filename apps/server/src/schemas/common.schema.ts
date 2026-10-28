import Type, { type Static, type TSchema, type TSchemaOptions } from "typebox";
import { DATE_PATTERN } from "../constants/dates.constant.js";

/** Response envelope for successful requests; `data` is route-specific. */
export const SuccessResponse = <T extends TSchema>(data: T, opts: { title: string; message?: string }) =>
  Type.Object(
    {
      success: Type.Literal(true),
      message: Type.String({ description: "Human-readable summary", examples: [opts.message ?? "OK"] }),
      data,
    },
    { title: opts.title },
  );

/** Every non-2xx response uses this shape, so clients handle errors in one place. */
export const ErrorResponse = Type.Object(
  {
    success: Type.Literal(false),
    message: Type.String({ description: "Human-readable explanation", examples: ["Route GET /nope not found"] }),
    error: Type.Object({
      code: Type.String({ description: "Stable, machine-readable error code", examples: ["NOT_FOUND"] }),
    }),
  },
  { $id: "ErrorResponse", title: "ErrorResponse", description: "Standard error envelope" },
);

export type ErrorResponse = Static<typeof ErrorResponse>;

/** Reference for route schemas: `response: { 401: ErrorRef }`. */
export const ErrorRef = Type.Unsafe<ErrorResponse>(Type.Ref("ErrorResponse"));

/** A string enum, shown as a list of values in the docs. */
export const literals = <const T extends string[]>(values: readonly [...T], opts: TSchemaOptions = {}) =>
  Type.Enum(values, opts);

export const IsoDate = Type.String({ pattern: DATE_PATTERN, examples: ["2026-10-05"] });

export const DateRange = Type.Object(
  {
    from: { ...IsoDate, description: "First install day, inclusive" },
    to: { ...IsoDate, description: "Last install day, inclusive", examples: ["2026-10-11"] },
  },
  { title: "DateRange" },
);
