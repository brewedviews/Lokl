import React, { createContext, useContext, useEffect, useState } from "react";

const CartCtx = createContext(null);

export const CartProvider = ({ children }) => {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bf_cart") || "[]"); }
    catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem("bf_cart", JSON.stringify(items));
  }, [items]);

  const add = (product, size) => {
    setItems((prev) => {
      const key = `${product.id}-${size || "free"}`;
      const existing = prev.find((x) => x.key === key);
      if (existing) return prev.map((x) => x.key === key ? { ...x, qty: x.qty + 1 } : x);
      return [...prev, { key, id: product.id, name: product.name, price: product.price,
                         image: product.image, size: size || null, store_name: product.store_name,
                         store_eta_min: product.store_eta_min, qty: 1 }];
    });
  };

  const remove = (key) => setItems((prev) => prev.filter((x) => x.key !== key));
  const updateQty = (key, qty) => setItems((prev) => {
    if (qty <= 0) return prev.filter((x) => x.key !== key);
    return prev.map((x) => x.key === key ? { ...x, qty } : x);
  });
  const clear = () => setItems([]);

  const total = items.reduce((s, x) => s + x.price * x.qty, 0);
  const count = items.reduce((s, x) => s + x.qty, 0);

  return (
    <CartCtx.Provider value={{ items, add, remove, updateQty, clear, total, count }}>
      {children}
    </CartCtx.Provider>
  );
};

export const useCart = () => useContext(CartCtx);
