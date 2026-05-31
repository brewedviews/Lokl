// Shared primitives.

/** ISO-8601 datetime string (FastAPI default response shape). */
export type IsoDateTime = string;

/** Mongo ObjectId as serialized by the BaseDocument.from_mongo helper.
 * Backend maps `_id -> id` so every document has `id: string`, never `_id`. */
export type Id = string;

/** Indian-rupee monetary amount in whole rupees (no paise). */
export type RupeeAmount = number;

/** Phone number — backend canonicalizes to 12-digit E.164 without "+",
 *  e.g. "919876543210". Always assume this shape post Iter-32. */
export type CanonicalPhone = string;

/** lat/lng pair (NOT a GeoJSON Point — backend stores flat floats on stores). */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Per-domain status badge variants used by the UI. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
