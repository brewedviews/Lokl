import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Merchant Terms & Agreement",
  description: "The agreement between Lokl and stores selling on Lokl.shop — responsibilities, listing rules, and what happens if a merchant lists fake or counterfeit products.",
};

export default function MerchantTermsPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Merchant Legal</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">Merchant Terms &amp; Agreement</h1>
        <p className="text-sm text-[#64748B] mb-1">Version {"2026-09-01"} · Last updated: September 2026</p>
        <p className="text-sm text-[#64748B] mb-10">This is the agreement between you (the store owner) and Lokl — operated by Ujjwal Deshlahare, Founder &amp; Sole Proprietor — for selling on Lokl.shop.</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">1. What Lokl is, and what it isn&apos;t</h2>
            <p className="text-[#595959]">
              Lokl.shop is a technology and marketplace platform. It gives your store a way to be discovered and ordered from
              online — it does not buy your stock, does not own your inventory, and does not manufacture or brand the products
              you sell. Every product listed under your store is your product, sold by you, under your responsibility. Lokl&apos;s
              role is to connect your store with nearby customers, take the order, and arrange delivery — not to inspect, test,
              or vouch for every item you list.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">2. Your responsibilities as a merchant</h2>
            <p className="text-[#595959] mb-3">By listing on Lokl.shop, you confirm and agree that:</p>
            <ul className="space-y-2 text-[#595959] list-disc pl-5">
              <li>You have the legal right to sell every product you list — you own the stock, or are authorised by whoever does.</li>
              <li>Your product titles, descriptions, images, prices, stock counts, and any brand or origin claims are accurate and kept up to date.</li>
              <li>You will not misrepresent a product — its condition, material, size, brand, or origin — to a customer.</li>
              <li>You will not falsely claim affiliation with, authorisation from, or endorsement by any brand you don&apos;t genuinely represent.</li>
              <li>Your listings and your store comply with applicable Indian law, including consumer protection and intellectual property law.</li>
              <li>You are responsible for what you tell customers about a product&apos;s authenticity — if you say it&apos;s an original branded product, that claim is yours, not Lokl&apos;s.</li>
              <li>You fulfil accepted orders promptly and keep your stock counts honest, so customers aren&apos;t sold something you don&apos;t actually have.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">3. Counterfeit, fake, and imitation products</h2>
            <p className="text-[#595959] mb-3">
              You must not list counterfeit, fake, duplicate, imitation, &quot;first copy&quot;, replica, or otherwise
              infringing products — on Lokl or anywhere your Lokl storefront links to. This applies whether or not the listing
              says so explicitly; disguising a copy as genuine is a breach of this agreement either way.
            </p>
            <p className="text-[#595959] mb-3">
              Lokl does not own or control your inventory and does not manufacture what you sell, so we cannot personally
              inspect every item in every store. Responsibility for a fake, counterfeit, or falsely branded listing — legal and
              otherwise — sits with the merchant who listed and sold it, not with Lokl.
            </p>
            <p className="text-[#595959]">That said, we do not look away from it. If a listing is reported or we find reason to believe it&apos;s counterfeit or misleading, Lokl reserves the right to, at its discretion and without prior notice where warranted:</p>
            <ul className="mt-2 space-y-1.5 text-[#595959] list-disc pl-5">
              <li>Remove or pause the specific listing while it&apos;s investigated</li>
              <li>Request proof of authenticity, sourcing, or authorisation from the merchant</li>
              <li>Suspend the merchant&apos;s store, temporarily or permanently</li>
              <li>Withhold pending payouts connected to the listing while the matter is investigated</li>
              <li>Terminate the merchant&apos;s access to the platform for repeat or serious violations</li>
              <li>Share relevant records with brand owners, rights-holders, or law enforcement where legally required</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">4. Indemnity</h2>
            <p className="text-[#595959]">
              You agree to be responsible for, and to cover Lokl&apos;s reasonable costs arising from, any third-party claim,
              fine, or legal action against Lokl that results directly from a product you listed — including counterfeit,
              infringement, mis-description, or safety claims — except where the claim arises from something Lokl itself did
              (for example, an error in how Lokl displayed or promoted your listing). This is subject to applicable Indian law.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">5. Pricing, orders &amp; commission</h2>
            <p className="text-[#595959]">Listing on Lokl is free, with zero commission on completed orders — you keep what you earn. You set your own prices and stock. You&apos;re responsible for honouring the price and availability shown to a customer at the time they order.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">6. Suspension &amp; termination</h2>
            <p className="text-[#595959]">
              Beyond counterfeit-related action (Section 3), Lokl may suspend or terminate a merchant account for repeated
              order cancellations, fraudulent activity, abusive behaviour toward customers or riders, or any conduct that
              harms the platform or the people using it. Where practical, we&apos;ll tell you why. Fraud or safety issues may
              warrant immediate suspension without advance notice.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">7. Governing law</h2>
            <p className="text-[#595959]">This agreement is governed by the laws of Chhattisgarh, India. Any disputes are subject to the exclusive jurisdiction of courts in Bhilai / Durg, Chhattisgarh.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">8. Contact</h2>
            <p className="text-[#595959]">Questions about this agreement, or reporting a concern about another merchant&apos;s listing:</p>
            <ul className="mt-2 space-y-1.5 text-[#595959]">
              <li>Email: <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a></li>
              <li>Phone: <a href="tel:+917719052107" className="text-[#0A1F5C] font-semibold hover:underline">+91 7719052107</a></li>
            </ul>
          </section>

          <section className="pt-2 border-t border-[#E5E2DC]">
            <p className="text-sm text-[#64748B]">
              See also the customer-facing <Link href="/terms" className="text-[#0A1F5C] font-semibold hover:underline">Terms &amp; Conditions</Link>, which explains the marketplace model to shoppers and how they can report a suspected fake or misleading product.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
