import type { Metadata } from "next";
import { Footer } from "@/components/consumer/Footer";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "Terms of use for the Lokl hyperlocal fashion marketplace.",
};

export default function TermsPage() {
  return (
    <div className="h-full flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Legal</p>
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight mb-2">Terms &amp; Conditions</h1>
        <p className="text-sm text-[#64748B] mb-10">Last updated: June 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">About Lokl</h2>
            <p className="text-[#595959]">Lokl is a hyperlocal fashion marketplace operating in Bhilai, Chhattisgarh. We connect customers with local merchants for fast, same-day delivery — typically within 30 minutes. By using Lokl you agree to these terms.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Orders &amp; cancellations</h2>
            <p className="text-[#595959]">Once an order is placed and accepted by the merchant, cancellation is not guaranteed. If you need to cancel, contact us at <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a> as soon as possible. We will try our best to cancel before dispatch, but cannot guarantee it once a rider has been assigned.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Delivery</h2>
            <p className="text-[#595959]">We aim to deliver within 30 minutes of merchant acceptance. Actual delivery times may vary based on distance, traffic and store availability. Lokl does not guarantee exact delivery times. Delivery is currently available only within Bhilai (pincodes starting with 490).</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Payments</h2>
            <p className="text-[#595959]">We currently only support <strong>Pay at Delivery</strong>. Payment is made directly to the delivery rider via cash or UPI at the time of delivery. Lokl does not collect payments in advance.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Returns</h2>
            <p className="text-[#595959]">For genuine product issues (wrong item, damaged goods), contact us at <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a> within 24 hours of delivery. Return eligibility is determined on a case-by-case basis by the merchant. Size exchanges are subject to availability.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">For merchants</h2>
            <p className="text-[#595959]">Listing on Lokl is free. A platform commission applies on each completed and delivered order. Merchants are responsible for accurate product listings, stock availability and timely fulfilment. Merchants must not list counterfeit, prohibited or misleading products.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Account suspension</h2>
            <p className="text-[#595959]">Lokl reserves the right to suspend or terminate accounts — customer or merchant — for misuse of the platform, fraudulent activity, repeated cancellations or any behaviour that harms the platform or its users.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Limitation of liability</h2>
            <p className="text-[#595959]">Lokl acts as a marketplace connecting customers and merchants. We are not responsible for the quality, authenticity or safety of products listed by merchants. Our liability in any dispute is limited to the value of the relevant order.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Governing law</h2>
            <p className="text-[#595959]">These terms are governed by the laws of Chhattisgarh, India. Any disputes shall be subject to the exclusive jurisdiction of courts in Bhilai / Durg, Chhattisgarh.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-[#0A1F5C] mb-3">Contact</h2>
            <p className="text-[#595959]">For questions about these terms:</p>
            <ul className="mt-2 space-y-1.5 text-[#595959]">
              <li>Email: <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a></li>
              <li>Phone: <a href="tel:+917719052107" className="text-[#0A1F5C] font-semibold hover:underline">+91 7719052107</a></li>
            </ul>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}
