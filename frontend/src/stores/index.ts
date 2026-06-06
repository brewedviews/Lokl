/**
 * Stores barrel. Pull `useXStore` hooks from one place + re-export the
 * persistence keys + event names so consumers can wire effects without
 * importing the individual store modules.
 */
export {
  useCustomerAuthStore,
  CUSTOMER_TOKEN_KEY,
  CUSTOMER_PHONE_KEY,
  CUSTOMER_AUTH_EVENT,
} from "./customer-auth.store";

export {
  useMerchantAuthStore,
  MERCHANT_TOKEN_KEY,
  MERCHANT_AUTH_EVENT,
} from "./merchant-auth.store";
export type { MerchantStoreState } from "./merchant-auth.store";

export {
  useAdminAuthStore,
  ADMIN_TOKEN_KEY,
  ADMIN_AUTH_EVENT,
} from "./admin-auth.store";

export {
  useCartStore,
  CART_KEY,
} from "./cart.store";

export {
  useLocationStore,
  LOCATION_KEY,
  LOCATION_EVENT,
} from "./location.store";

export {
  useWishlistStore,
  WISHLIST_EVENT,
} from "./wishlist.store";
