import Type, { type Static, type TSchema } from "typebox";

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
