import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with the Lokl team — support, orders, and merchant enquiries.",
};

export default function ContactPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Support</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">Contact Us</h1>
        <p className="text-sm text-[#64748B] mb-10">We&apos;re a small local team — reach us directly.</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Reach us</h2>
            <ul className="space-y-1.5 text-[#595959]">
              <li>Email: <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a></li>
              <li>Phone / WhatsApp: <a href="tel:+917719052107" className="text-[#0A1F5C] font-semibold hover:underline">+91 7719052107</a></li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Support hours</h2>
            <p className="text-[#595959]">Our team is available 11:00 AM – 9:00 PM, every day. Messages sent outside these hours are answered the next morning.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Order help</h2>
            <p className="text-[#595959]">
              For anything about an existing order — damaged item, wrong item, delivery running late — the fastest path is
              raising a request from <strong>Account → Support</strong> in the app, with your order ID handy. It creates a
              tracked ticket our team responds to directly.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Want to sell on Lokl?</h2>
            <p className="text-[#595959]">
              Free to list, zero commission. WhatsApp us at the number above or head to our{" "}
              <a href="https://lokl.up.railway.app/merchant/register" className="text-[#0A1F5C] font-semibold hover:underline">
                merchant sign-up page
              </a>{" "}
              to get started.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Where we are</h2>
            <p className="text-[#595959]">Bhilai, Chhattisgarh — Lokl Technologies.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
