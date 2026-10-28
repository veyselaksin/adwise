import Type, { type Static } from "typebox";

/** Every non-2xx response uses this shape, so clients handle errors in one place. */
export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String({ description: "Stable, machine-readable error code", examples: ["NOT_FOUND"] }),
      message: Type.String({ description: "Human-readable explanation", examples: ["Route GET /nope not found"] }),
    }),
  },
  { $id: "ErrorResponse", title: "ErrorResponse", description: "Standard error envelope" },
);

export type ErrorResponse = Static<typeof ErrorResponse>;

/** Reference for route schemas: `response: { 401: ErrorRef }`. */
export const ErrorRef = Type.Unsafe<ErrorResponse>(Type.Ref("ErrorResponse"));
