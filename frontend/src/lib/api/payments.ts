/**
 * Payment endpoints — Razorpay order creation only. The actual Lokl order is
 * created afterward via ordersApi.create() (payment_method: "razorpay"),
 * which is also where the payment signature gets verified server-side — see
 * that endpoint's own docstring in backend/server.py.
 */
import { apiClient } from "@/lib/api-client";

export interface RazorpayOrderResponse {
  razorpay_order_id: string;
  amount_paise: number;
  currency: string;
  key_id: string;
}

export const paymentsApi = {
  createRazorpayOrder: async (payload: {
    amount: number;
    customer_name?: string;
    customer_phone?: string;
  }): Promise<RazorpayOrderResponse> => {
    const r = await apiClient.post<RazorpayOrderResponse>(
      "/api/payments/razorpay/create-order",
      payload,
    );
    return r.data;
  },
};
