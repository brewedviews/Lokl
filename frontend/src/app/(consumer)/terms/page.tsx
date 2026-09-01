import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "Terms of use for the Lokl hyperlocal marketplace.",
};

export default function TermsPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Legal</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">Terms &amp; Conditions</h1>
        <p className="text-sm text-[#64748B] mb-10">Last updated: September 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">About Lokl</h2>
            <p className="text-[#595959]">
              Lokl is a hyperlocal marketplace platform operating in Bhilai, Chhattisgarh — we help you discover and order
              from independent local stores near you, with fast delivery typically within 45 minutes. Lokl is the technology
              connecting you to those stores; it is not itself a retailer of the products shown. By using Lokl you agree to
              these terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Orders &amp; cancellations</h2>
            <p className="text-[#595959]">Once an order is placed and accepted by the merchant, cancellation is not guaranteed. If you need to cancel, contact us at <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a> as soon as possible. We will try our best to cancel before dispatch, but cannot guarantee it once a rider has been assigned.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Delivery</h2>
            <p className="text-[#595959]">We aim to deliver within 45 minutes of merchant acceptance. Actual delivery times may vary based on distance, traffic and store availability. Lokl does not guarantee exact delivery times. Delivery is currently available only within Bhilai (pincodes starting with 490).</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Payments</h2>
            <p className="text-[#595959]">We currently only support <strong>Pay at Delivery</strong>. Payment is made directly to the delivery rider via cash or UPI at the time of delivery. Lokl does not collect payments in advance.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Returns</h2>
            <p className="text-[#595959]">For genuine product issues (wrong item, damaged goods), contact us at <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a> within 24 hours of delivery. Return eligibility is determined on a case-by-case basis by the merchant. Size exchanges are subject to availability.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Products are listed and supplied by merchants, not Lokl</h2>
            <p className="text-[#595959] mb-3">
              Every product shown on Lokl is listed and supplied by the independent local store you&apos;re ordering from —
              not by Lokl. Unless a listing says otherwise, Lokl does not own, stock, manufacture, or brand the products you
              see. The merchant is responsible for the accuracy of their product descriptions, images, pricing, stock, and any
              claims they make about a product — including brand or origin claims. If a store says a product is a genuine
              branded item, that representation is the merchant&apos;s, not Lokl&apos;s.
            </p>
            <p className="text-[#595959]">
              Lokl reviews listings and acts on reports, but does not independently authenticate the genuineness, trademark
              status, or brand claims of every product every merchant lists. As a customer, it&apos;s worth knowing that Lokl
              is not the manufacturer, brand owner, or seller of record for most products on the platform — the store is.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Reporting a fake, counterfeit, or misleading product</h2>
            <p className="text-[#595959] mb-3">
              If you believe a listing is counterfeit, fake, a &quot;first copy&quot;, or misleadingly described, tell us —
              we take this seriously and investigate every report:
            </p>
            <ul className="space-y-1.5 text-[#595959] list-disc pl-5 mb-3">
              <li>In the app: <Link href="/account/support?category=Fake+%2F+counterfeit+product" className="text-[#0A1F5C] font-semibold hover:underline">report it from Help &amp; Support</Link> — this opens a tracked request our team responds to directly.</li>
              <li>By email: <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a>, with the product/store link and what looks wrong. Brand owners and rights-holders can use this channel too.</li>
            </ul>
            <p className="text-[#595959]">
              Once reported, we investigate and, where warranted, remove or pause the listing, require the merchant to prove
              authenticity or sourcing, suspend the merchant&apos;s store, withhold related payouts, or terminate their access
              to the platform — see our <Link href="/merchant/terms" className="text-[#0A1F5C] font-semibold hover:underline">Merchant Terms &amp; Agreement</Link> for the full set of actions we can take against a merchant.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">For merchants</h2>
            <p className="text-[#595959]">
              Listing on Lokl is free, with zero commission on completed orders — merchants keep what they earn. Merchants
              are responsible for accurate product listings, stock availability and timely fulfilment, and must not list
              counterfeit, prohibited, or misleading products. Merchants agree to a separate{" "}
              <Link href="/merchant/terms" className="text-[#0A1F5C] font-semibold hover:underline">Merchant Terms &amp; Agreement</Link> when they open a store on Lokl.shop, which sets out these obligations in full.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Account suspension</h2>
            <p className="text-[#595959]">Lokl reserves the right to suspend or terminate accounts — customer or merchant — for misuse of the platform, fraudulent activity, repeated cancellations or any behaviour that harms the platform or its users.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Limitation of liability</h2>
            <p className="text-[#595959]">
              Lokl acts as a marketplace connecting customers and independent merchants — we don&apos;t manufacture, stock, or
              take title to the products listed, and we don&apos;t independently guarantee the quality, authenticity, or
              safety of every merchant&apos;s product. That said, we don&apos;t look away from problems: we review reports of
              counterfeit or misleading listings and act on merchants who breach these terms (see above). For genuine order
              issues — wrong item, damaged goods, non-delivery — our <Link href="/returns-policy" className="text-[#0A1F5C] font-semibold hover:underline">Return &amp; Exchange Policy</Link> and support team
              remain the first point of contact, and our liability in any dispute is limited to the value of the relevant order.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Governing law</h2>
            <p className="text-[#595959]">These terms are governed by the laws of Chhattisgarh, India. Any disputes shall be subject to the exclusive jurisdiction of courts in Bhilai / Durg, Chhattisgarh.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Contact</h2>
            <p className="text-[#595959]">For questions about these terms:</p>
            <ul className="mt-2 space-y-1.5 text-[#595959]">
              <li>Email: <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a></li>
              <li>Phone: <a href="tel:+917719052107" className="text-[#0A1F5C] font-semibold hover:underline">+91 7719052107</a></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
