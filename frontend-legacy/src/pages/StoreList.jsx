import React, { useEffect, useState } from "react";
import api from "../lib/api";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import StoreCard from "../components/consumer/StoreCard";

export default function StoreList() {
  const [stores, setStores] = useState([]);
  useEffect(() => { api.get("/stores").then((r) => setStores(r.data)); }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10">
        <h1 data-testid="stores-title" className="display text-4xl md:text-5xl font-bold text-[#1A2B4C]">Stores near you</h1>
        <p className="text-[#595959] mt-2">{stores.length} trusted local store{stores.length !== 1 ? "s" : ""} · sorted by distance</p>
        {stores.length === 0 ? (
          <div className="mt-8 bg-white border border-dashed border-[#E5E2DC] rounded-2xl p-12 text-center">
            <h3 className="display text-2xl font-bold text-[#1A2B4C]">No stores live yet</h3>
            <p className="text-sm text-[#595959] mt-2 max-w-md mx-auto">
              We're piloting in <strong>Bhilai</strong> and <strong>Raipur</strong>. Stores will appear here as our partner stores complete KYC and publish their first products.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
            {stores.map((s) => <StoreCard key={s.id} s={s} />)}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
