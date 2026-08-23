/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

function gtag(...args: any[]) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    window.gtag(...args);
  }
}

// ── Page view ────────────────────────────────────────────────────────────────
export function trackPageView(path: string, title?: string) {
  gtag("event", "page_view", { page_path: path, page_title: title });
}

// ── Section impressions ──────────────────────────────────────────────────────
export function trackSectionImpression(section_id: string) {
  gtag("event", "section_impression", { section_id });
}

// ── Category tile ────────────────────────────────────────────────────────────
export function trackCategoryTileClick(category_name: string, position: number) {
  gtag("event", "category_tile_click", { category_name, position });
  gtag("event", "select_content", {
    content_type: "category",
    content_id: category_name,
  });
}

export function trackCategoryTileImpression(category_name: string, position: number) {
  gtag("event", "category_tile_impression", { category_name, position });
}

// ── Price filter bentos ───────────────────────────────────────────────────────
export function trackPriceFilterClick(filter: "under_499" | "under_999" | "under_1499") {
  gtag("event", "price_filter_click", { filter });
}

// ── Product ───────────────────────────────────────────────────────────────────
export function trackProductImpression(params: {
  product_id: string;
  product_name: string;
  price: number;
  rail_name: string;
  position: number;
}) {
  gtag("event", "view_item_list", {
    item_list_id: params.rail_name,
    item_list_name: params.rail_name,
    items: [{
      item_id: params.product_id,
      item_name: params.product_name,
      price: params.price,
      index: params.position,
    }],
  });
}

export function trackProductClick(params: {
  product_id: string;
  product_name: string;
  price: number;
  rail_name: string;
  position: number;
}) {
  gtag("event", "select_item", {
    item_list_id: params.rail_name,
    item_list_name: params.rail_name,
    items: [{
      item_id: params.product_id,
      item_name: params.product_name,
      price: params.price,
      index: params.position,
    }],
  });
}

export function trackProductView(params: {
  product_id: string;
  product_name: string;
  price: number;
  mrp?: number;
  category?: string;
}) {
  gtag("event", "view_item", {
    currency: "INR",
    value: params.price,
    items: [{
      item_id: params.product_id,
      item_name: params.product_name,
      price: params.price,
      discount: params.mrp ? params.mrp - params.price : 0,
      item_category: params.category,
    }],
  });
}

// ── Cart ──────────────────────────────────────────────────────────────────────
export function trackAddToCart(params: {
  product_id: string;
  product_name: string;
  price: number;
  size: string;
  source: "product_page" | "quick_add" | "wishlist";
}) {
  gtag("event", "add_to_cart", {
    currency: "INR",
    value: params.price,
    items: [{
      item_id: params.product_id,
      item_name: params.product_name,
      price: params.price,
      item_variant: params.size,
    }],
    source: params.source,
  });
}

export function trackRemoveFromCart(product_id: string, product_name: string, price: number) {
  gtag("event", "remove_from_cart", {
    currency: "INR",
    value: price,
    items: [{ item_id: product_id, item_name: product_name, price }],
  });
}

// ── Wishlist ──────────────────────────────────────────────────────────────────
export function trackAddToWishlist(params: {
  product_id: string;
  product_name: string;
  price: number;
  source: string;
}) {
  gtag("event", "add_to_wishlist", {
    currency: "INR",
    value: params.price,
    items: [{
      item_id: params.product_id,
      item_name: params.product_name,
      price: params.price,
    }],
    source: params.source,
  });
}

// ── Checkout funnel ───────────────────────────────────────────────────────────
export function trackCheckoutStart(params: {
  cart_value: number;
  item_count: number;
  items: Array<{ product_id: string; product_name: string; price: number; quantity: number }>;
}) {
  gtag("event", "begin_checkout", {
    currency: "INR",
    value: params.cart_value,
    items: params.items.map(i => ({
      item_id: i.product_id,
      item_name: i.product_name,
      price: i.price,
      quantity: i.quantity,
    })),
  });
}

export function trackAddShippingInfo(cart_value: number, delivery_type: "delivery" | "pickup") {
  gtag("event", "add_shipping_info", {
    currency: "INR",
    value: cart_value,
    shipping_tier: delivery_type,
  });
}

export function trackPurchase(params: {
  order_id: string;
  value: number;
  delivery_fee: number;
  payment_method: string;
  items: Array<{ product_id: string; product_name: string; price: number; quantity: number }>;
}) {
  gtag("event", "purchase", {
    transaction_id: params.order_id,
    currency: "INR",
    value: params.value,
    shipping: params.delivery_fee,
    payment_type: params.payment_method,
    items: params.items.map(i => ({
      item_id: i.product_id,
      item_name: i.product_name,
      price: i.price,
      quantity: i.quantity,
    })),
  });
}

// ── Store pickup ──────────────────────────────────────────────────────────────
export function trackPickupStart(product_id: string, store_id: string) {
  gtag("event", "reserve_pickup_start", { product_id, store_id });
}

export function trackPickupComplete(product_id: string, order_id: string, store_id: string) {
  gtag("event", "reserve_pickup_complete", { product_id, order_id, store_id });
}

// ── Store & offers ────────────────────────────────────────────────────────────
export function trackStoreClick(store_id: string, store_name: string, source: string) {
  gtag("event", "store_click", { store_id, store_name, source });
}

export function trackOfferClick(offer_id: string, offer_code: string) {
  gtag("event", "offer_click", { offer_id, offer_code });
}

// ── Merchant CTA ──────────────────────────────────────────────────────────────
export function trackMerchantCTAClick(source: "homepage" | "footer" | "account") {
  gtag("event", "merchant_cta_click", { source });
}

// ── Nav ───────────────────────────────────────────────────────────────────────
export function trackNavClick(tab: string) {
  gtag("event", "nav_click", { tab });
}

// ── Search ────────────────────────────────────────────────────────────────────
export function trackSearch(query: string, results_count: number) {
  gtag("event", "search", { search_term: query, results_count });
}

// ── Intersection Observer helper for impressions ─────────────────────────────
export function observeImpression(
  element: Element,
  onImpression: () => void,
  options?: IntersectionObserverInit
): () => void {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    return () => {};
  }
  let fired = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!fired && entries[0]?.isIntersecting) {
        fired = true;
        onImpression();
        observer.disconnect();
      }
    },
    { threshold: 0.5, ...options }
  );
  observer.observe(element);
  return () => observer.disconnect();
}
