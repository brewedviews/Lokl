import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Return & Exchange Policy",
  description: "How returns and exchanges work on Lokl, including Try & Buy on-the-spot returns.",
};

export default function ReturnsPolicyPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Legal</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">Return &amp; Exchange Policy</h1>
        <p className="text-sm text-[#64748B] mb-10">Last updated: August 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Try &amp; Buy — return on the spot</h2>
            <p className="text-[#595959]">
              Most returns on Lokl happen before you even pay. When your rider arrives, try items on at your door.
              Hand back anything that doesn&apos;t work — no box, no courier, no waiting. You only pay for what you
              keep. This is the easiest and fastest way to return something on Lokl.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">After the rider leaves</h2>
            <p className="text-[#595959]">
              If you find a genuine issue after the order is complete — wrong item, damaged goods, missing item —
              contact us within <strong>24 hours of delivery</strong> via Account → Support with your order ID and,
              where possible, a photo. Return eligibility is confirmed case-by-case with the store.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Condition of items</h2>
            <p className="text-[#595959]">
              Items should be unworn (beyond trying them on), unwashed, and with original tags attached to qualify
              for a return or exchange. For hygiene reasons, innerwear and lingerie can only be returned if
              defective or incorrect.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">How refunds work</h2>
            <p className="text-[#595959]">
              Since Lokl is Pay at Delivery, most returns simply mean you never pay for the item — there&apos;s
              nothing to refund. For a post-delivery issue that&apos;s confirmed as a genuine problem, our support
              team coordinates the refund or replacement directly with the store.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Exchanges</h2>
            <p className="text-[#595959]">
              Size or variant exchanges are handled the same way as returns — raise a request via Account →
              Support. Exchange availability depends on the store having the item you need in stock.
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
