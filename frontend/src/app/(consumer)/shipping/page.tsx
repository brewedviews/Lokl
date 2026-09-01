import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shipping Policy",
  description: "How delivery works on Lokl — service area, delivery time, fees, and what happens when a store is closed.",
};

export default function ShippingPolicyPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Legal</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">Shipping Policy</h1>
        <p className="text-sm text-[#64748B] mb-10">Last updated: August 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Where we deliver</h2>
            <p className="text-[#595959]">
              Lokl currently operates in Bhilai, Chhattisgarh — but not every address in the city is serviceable yet.
              Delivery availability depends on whether your specific location is currently covered on Lokl. We check
              your delivery address at checkout; if it falls outside our service area, you&apos;ll see this clearly
              before placing the order.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Delivery time</h2>
            <p className="text-[#595959]">
              We target 45 minutes from a store accepting your order to it arriving at your door. This depends on
              distance, traffic and store readiness — 45 minutes is our benchmark, not a guarantee, and we&apos;ll
              never claim an exact time we can&apos;t back up.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Delivery fee</h2>
            <p className="text-[#595959]">
              Orders above ₹499 deliver free. Below that, a small distance-based fee applies — shown clearly at
              checkout, before you place the order, so there&apos;s never a surprise.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">If a store is closed</h2>
            <p className="text-[#595959]">
              You can still browse the store and add items to your bag. We&apos;ll show you the store&apos;s opening
              time, and you can complete checkout once they&apos;re accepting orders again.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Tracking your delivery</h2>
            <p className="text-[#595959]">
              Every order can be tracked live from Account → Orders — placed, accepted, out for delivery, delivered.
              While an order is active, a tracker also floats above the bottom navigation on every page for a
              one-tap check.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Questions</h2>
            <p className="text-[#595959]">
              Reach us at <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a> or see our <a href="/faq" className="text-[#0A1F5C] font-semibold hover:underline">FAQs</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
