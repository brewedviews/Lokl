/**
 * Delivery estimate + city lookup endpoints (FastAPI `routes/geo.py`).
 *
 * The estimate is called from the checkout page BEFORE the customer pays,
 * so the displayed total reflects the same fee the backend will charge.
 */
import { apiClient } from "@/lib/api-client";

export interface DeliveryEstimateRequest {
  customer_lat: number;
  customer_lng: number;
  store_id: string;
  order_subtotal: number;
  city_slug?: string;
}

export interface DeliveryEstimateResponse {
  deliverable: boolean;
  reason?: string;
  distance_km: number;
  /** Final fee after free-delivery discount (rupees). */
  fee: number;
  fee_before_discount?: number;
  is_free_delivery?: boolean;
  free_delivery_threshold?: number;
  amount_for_free_delivery?: number;
  currency?: string;
  eta_minutes?: number;
  eta_range?: string;
  eta_min?: number;
  eta_max?: number;
  is_peak_hour?: boolean;
  tier?: string;
}

export interface CheckServiceabilityRequest {
  /** MUST be a delivery address's own pin coordinates (the point the
   *  customer dropped on a map for THAT address) — never the shopper's
   *  live device GPS. Pass `pincode` instead when there's no pin. */
  lat?: number | null;
  lng?: number | null;
  pincode?: string | null;
}

export interface CheckServiceabilityResponse {
  serviceable: boolean;
  message: string;
  zone: string | null;
}

export const deliveryApi = {
  estimate: async (
    payload: DeliveryEstimateRequest,
  ): Promise<DeliveryEstimateResponse> => {
    const r = await apiClient.post<DeliveryEstimateResponse>(
      "/api/v1/delivery/estimate",
      { city_slug: "bhilai", ...payload },
    );
    return r.data;
  },

  /** GET /api/delivery/check-serviceability — polygon-with-pincode-fallback
   *  (backend Group C1: _address_is_serviceable). Used by the address
   *  pin-picker (Group C2) to give live feedback on a dropped pin. */
  checkServiceability: async (
    payload: CheckServiceabilityRequest,
  ): Promise<CheckServiceabilityResponse> => {
    const params: Record<string, string | number> = {};
    if (payload.lat != null) params.lat = payload.lat;
    if (payload.lng != null) params.lng = payload.lng;
    if (payload.pincode) params.pincode = payload.pincode;
    const r = await apiClient.get<CheckServiceabilityResponse>(
      "/api/delivery/check-serviceability",
      { params },
    );
    return r.data;
  },
};
