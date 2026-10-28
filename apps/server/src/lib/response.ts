/**
 * Every API response uses one envelope so clients handle them in one place:
 *   success → { success: true,  message, data }
 *   failure → { success: false, message, error: { code } }
 */
export type SuccessBody<T> = { success: true; message: string; data: T };
export type FailureBody = { success: false; message: string; error: { code: string } };

export const success = <T>(data: T, message = "OK"): SuccessBody<T> => ({
  success: true,
  message,
  data,
});

export const failure = (code: string, message: string): FailureBody => ({
  success: false,
  message,
  error: { code },
});

/** Throw from a handler or hook; the error handler turns it into a failure body. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
