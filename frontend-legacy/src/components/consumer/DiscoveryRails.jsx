import React, { useEffect, useState } from "react";
import OffersStrip from "./v2/OffersStrip";
import HCarousel from "./v2/HCarousel";
import ProductCardV2 from "./v2/ProductCardV2";
import api from "../../lib/api";

// Reusable "keep shopping" rails — used by the empty Wishlist and empty Cart
// pages so both fall back to the same friendly discovery experience.
// Pass an optional `testidPrefix` to tag the rails for QA.
export default function DiscoveryRails({ testidPrefix = "discovery" }) {
  const [offers, setOffers] = useState([]);
  const [trending, setTrending] = useState([]);
  const [sellingFast, setSellingFast] = useState([]);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get("/offers").then((r) => setOffers(r.data || [])).catch(() => {}),
      api.get("/feed/popular-in-city?limit=10").then((r) => setTrending(r.data || [])).catch(() => {}),
      api.get("/feed/selling-fast?limit=10").then((r) => setSellingFast(r.data || [])).catch(() => {}),
      api.get("/feed/new-arrivals?limit=10").then((r) => setRecent(r.data || [])).catch(() => {}),
    ]);
  }, []);

  return (
    <>
      {offers.length > 0 && <OffersStrip offers={offers} />}
      {trending.length > 0 && (
        <HCarousel title="Trending now" subtitle="Most ordered products nearby this week" testid={`${testidPrefix}-trending`} link="/products?sort=trending" linkLabel="See all">
          {trending.map((p) => <ProductCardV2 key={p.id} p={p} />)}
        </HCarousel>
      )}
      {sellingFast.length > 0 && (
        <HCarousel title="Selling fast" subtitle="Don't miss out — limited stock" testid={`${testidPrefix}-selling-fast`} link="/products?sort=trending">
          {sellingFast.map((p) => <ProductCardV2 key={p.id} p={p} />)}
        </HCarousel>
      )}
      {recent.length > 0 && (
        <HCarousel title="Recently added" subtitle="Fresh drops from Bhilai stores" testid={`${testidPrefix}-recent`} link="/products?sort=new" linkLabel="See all">
          {recent.map((p) => <ProductCardV2 key={p.id} p={p} />)}
        </HCarousel>
      )}
    </>
  );
}
