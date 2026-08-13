/**
 * Customer-scoped endpoints: profile, addresses, returns, complaints.
 * All require the customer JWT and enforce `URL.phone === JWT.sub`
 * (see backend `_ensure_customer_phone_match` in server.py).
 *
 * `customers.upsert` is the legacy profile-save endpoint — Iter-32 now also
 * requires the JWT and refuses to upsert a phone that isn't the caller's.
 */
import { apiClient } from "@/lib/api-client";
import type {
  CanonicalPhone, Customer, CustomerAddress, Order, Return, Complaint,
} from "@/types";

export interface CustomerProfileResponse {
  customer: Customer;
  orders: Order[];
}

export interface CustomerAddressDraft {
  name?: string;
  phone?: string;
  line1: string;
  landmark?: string;
  city?: string;
  pincode: string;
  label?: string;
  /** Group C1/C2 — the delivery pin, if the customer dropped one. Omit or
   *  leave undefined/null to save the address without a pin (pincode
   *  fallback still applies server-side). */
  lat?: number | null;
  lng?: number | null;
}

export interface CustomerUpsertPayload {
  phone: string;
  name?: string;
  age?: number;
  gender?: string;
  date_of_birth?: string;
  email?: string;
  address?: CustomerAddressDraft | null;
}

export const customersApi = {
  /** GET /api/customer/{phone} — profile + recent 50 orders. */
  get: async (phone: CanonicalPhone): Promise<CustomerProfileResponse> => {
    const r = await apiClient.get<CustomerProfileResponse>(
      `/api/customer/${phone}`,
    );
    return r.data;
  },

  upsert: async (payload: CustomerUpsertPayload): Promise<Customer> => {
    const r = await apiClient.post<Customer>("/api/customer/upsert", payload);
    return r.data;
  },

  addAddress: async (
    phone: CanonicalPhone,
    draft: CustomerAddressDraft,
  ): Promise<CustomerAddress> => {
    const r = await apiClient.post<CustomerAddress>(
      `/api/customer/${phone}/addresses`,
      draft,
    );
    return r.data;
  },

  removeAddress: async (
    phone: CanonicalPhone,
    addressId: string,
  ): Promise<{ ok: boolean }> => {
    const r = await apiClient.delete<{ ok: boolean }>(
      `/api/customer/${phone}/addresses/${addressId}`,
    );
    return r.data;
  },

  listReturns: async (phone: CanonicalPhone): Promise<Return[]> => {
    const r = await apiClient.get<Return[]>(`/api/customer/${phone}/returns`);
    return r.data;
  },

  listComplaints: async (phone: CanonicalPhone): Promise<Complaint[]> => {
    const r = await apiClient.get<Complaint[]>(
      `/api/customer/${phone}/complaints`,
    );
    return r.data;
  },
};
