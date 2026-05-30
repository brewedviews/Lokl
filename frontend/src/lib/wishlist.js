// Lightweight wishlist persistence, keyed by customer phone (or "guest").
// Stores minimal product snapshot {id, name, image, price, mrp, store_name}
// so the wishlist tab can render cards without re-fetching every product.
// Dispatches a `wishlist:change` window event so listening components can react.

const KEY = (phone) => `bf_wishlist_${phone || "guest"}`;

function _read(phone) {
  try { return JSON.parse(localStorage.getItem(KEY(phone)) || "[]"); }
  catch { return []; }
}

function _write(phone, list) {
  localStorage.setItem(KEY(phone), JSON.stringify(list));
  try { window.dispatchEvent(new CustomEvent("wishlist:change", { detail: { phone, list } })); } catch {}
}

function _phone() {
  return localStorage.getItem("bf_customer_phone") || "";
}

export function getWishlist(phone = _phone()) { return _read(phone); }

export function isInWishlist(productId, phone = _phone()) {
  return _read(phone).some((x) => x.id === productId);
}

export function toggleWishlist(product, phone = _phone()) {
  const list = _read(phone);
  const idx = list.findIndex((x) => x.id === product.id);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.unshift({
      id: product.id,
      name: product.name,
      image: product.image,
      price: product.price,
      mrp: product.mrp,
      store_name: product.store_name || "",
    });
  }
  _write(phone, list);
  return idx < 0; // returns true if just-added
}

export function removeFromWishlist(productId, phone = _phone()) {
  const list = _read(phone).filter((x) => x.id !== productId);
  _write(phone, list);
}

export function wishlistCount(phone = _phone()) { return _read(phone).length; }
