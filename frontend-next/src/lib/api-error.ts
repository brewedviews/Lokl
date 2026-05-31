/**
 * Single place to convert any thrown error into copy the UI can show.
 * Mirrors FastAPI's `{detail: str | ValidationError[]}` shape.
 */
import { AxiosError } from "axios";
import type { ApiError, ValidationError } from "@/types";

export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiError | undefined;
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return (data.detail as ValidationError[]).map((e) => e.msg).join(", ");
    }
    const status = error.response?.status;
    if (status === 401) return "Please log in to continue";
    if (status === 403) return "You do not have permission to do this";
    if (status === 404) return "Not found";
    if (status === 423) return "Account temporarily locked — try again shortly";
    if (status === 429) return "Too many requests. Please wait a moment.";
    if (status != null && status >= 500) {
      return "Server error. Please try again in a moment.";
    }
    if (error.code === "ECONNABORTED") return "Request timed out. Please retry.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

export function getErrorStatus(error: unknown): number | null {
  if (error instanceof AxiosError) return error.response?.status ?? null;
  return null;
}
