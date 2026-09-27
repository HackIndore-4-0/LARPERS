import type { ErrorRequestHandler, Response } from "express";
import type { ApiErrorBody } from "@campus-access/shared";

type ErrorCode = ApiErrorBody["error"]["code"];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function sendError(
  response: Response,
  status: number,
  code: ErrorCode,
  message: string,
): void {
  response
    .status(status)
    .json({ error: { code, message } } satisfies ApiErrorBody);
}

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof ApiError) {
    sendError(response, error.status, error.code, error.message);
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "LIMIT_FILE_SIZE"
  ) {
    sendError(
      response,
      400,
      "invalid_input",
      "Evidence images must be 5 MiB or smaller.",
    );
    return;
  }
  console.error(
    "Unhandled API error",
    error instanceof Error ? error.message : "unknown error",
  );
  sendError(
    response,
    503,
    "service_unavailable",
    "The service is temporarily unavailable.",
  );
};
