// API envelope shapes & error types.

// ============================================================================
// FastAPI error responses
// ============================================================================

export interface ValidationError {
  loc: string[];
  msg: string;
  type: string;
}

/** Shape of any non-2xx FastAPI response body. `detail` is `str` for our
 *  HTTPException raises and `ValidationError[]` for pydantic 422s. */
export interface ApiError {
  detail: string | ValidationError[];
  status_code?: number;
}

// ============================================================================
// Pagination (NOT used by the current backend — included so the FE can adopt
//             it later without another types-pass. Most endpoints today return
//             a bare `T[]` capped server-side, e.g. `?limit=10`.)
// ============================================================================

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
