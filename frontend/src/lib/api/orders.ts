/**
 * Order endpoints — customer side. Order placement and the customer-mutation
 * actions (cancel / return / complaint) all require a customer JWT; the
 * api-client routes them through the `customer` scope automatically.
 *
 * Read endpoints (GET /api/orders/{id}, GET /api/returns/{id}) are
 * intentionally public-by-non-guessable-id so tracking links in WhatsApp
 * messages work without a session.
 */
import { apiClient } from "@/lib/api-client";
import type {
  Order, Return, Complaint, ComplaintType, OrderAddress, OrderCustomer,
  OrderItem, PaymentMethod, RupeeAmount,
} from "@/types";

// ============================================================================
// Order create
// ============================================================================

export interface OrderCreatePayload {
  items: OrderItem[];
  address: OrderAddress;
  total: RupeeAmount;
  payment_method: PaymentMethod;
  customer: OrderCustomer;
}

export const ordersApi = {
  create: async (payload: OrderCreatePayload): Promise<Order> => {
    const r = await apiClient.post<Order>("/api/orders", payload);
    return r.data;
  },

  /** GET /api/orders/{id} — public-by-id (used by /orders/:id tracking page). */
  getById: async (id: string): Promise<Order> => {
    const r = await apiClient.get<Order>(`/api/orders/${id}`);
    return r.data;
  },

  // ---------------- customer-mutation actions ----------------

  customerCancel: async (
    orderId: string,
    payload: { reason?: string } = {},
  ): Promise<{ ok: boolean }> => {
    const r = await apiClient.post<{ ok: boolean }>(
      `/api/orders/${orderId}/customer-cancel`,
      payload,
    );
    return r.data;
  },

  createReturn: async (
    orderId: string,
    payload: { reason: string; item_ids?: string[] },
  ): Promise<Return> => {
    const r = await apiClient.post<Return>(`/api/orders/${orderId}/returns`, payload);
    return r.data;
  },

  createComplaint: async (
    orderId: string,
    payload: { type: ComplaintType; message: string },
  ): Promise<Complaint> => {
    const r = await apiClient.post<Complaint>(
      `/api/orders/${orderId}/complaints`,
      payload,
    );
    return r.data;
  },

  /** GET /api/returns/{id} — return tracking lookup. */
  getReturn: async (returnId: string): Promise<Return> => {
    const r = await apiClient.get<Return>(`/api/returns/${returnId}`);
    return r.data;
  },
};
