import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try & Buy",
  description: "Order it, try it on at your door, keep what you love — pay only for what you keep. How Lokl's Try & Buy works, on the products and stores that offer it.",
};

const STEPS = [
  {
    title: "Order like normal",
    body: "Pick your sizes and place the order — same checkout, no extra payment upfront.",
  },
  {
    title: "The rider waits while you try",
    body: "When it arrives, try it on right at your door. Take your time — the rider isn't going anywhere.",
  },
  {
    title: "Keep what you love, return the rest",
    body: "Hand back anything that doesn't work — on the spot, no box, no courier, no waiting for a refund.",
  },
];

export default function TryAndBuyPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Try &amp; Buy</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">
          Try before you pay
        </h1>
        <p className="text-sm text-[#64748B] mb-10 max-w-lg">
          Your neighbour&apos;s shop, not a faraway warehouse — so trying it on before you commit is just how Lokl works,
          on the products and stores that offer it.
        </p>

        <div className="space-y-6 mb-12">
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-[#E68910]/10 text-[#E68910] font-display font-bold text-sm flex items-center justify-center shrink-0">
                {i + 1}
              </div>
              <div>
                <h2 className="font-display text-lg font-medium tracking-tight text-[#0A1F5C] mb-1">{s.title}</h2>
                <p className="text-[15px] text-[#595959] leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Which products have Try &amp; Buy</h2>
            <p className="text-[#595959]">
              Try &amp; Buy is set per product by the store — it&apos;s not automatically available on everything.
              Look for the <strong>Try &amp; Buy</strong> option on a product page or at checkout; if you don&apos;t
              see it, that item ships as a standard order instead.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">How the on-the-spot return works</h2>
            <p className="text-[#595959]">
              You only pay the rider for what you&apos;re keeping. Anything you hand back goes straight
              back with them — there&apos;s no separate return process, no waiting for a refund to
              process, and nothing to repackage or ship. If you keep nothing, you pay nothing.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Payment</h2>
            <p className="text-[#595959]">
              Try &amp; Buy orders are <strong>Pay at Delivery only</strong> — cash or UPI, paid to the rider once
              you&apos;ve decided what you&apos;re keeping. Online prepayment isn&apos;t available for Try &amp; Buy
              orders, since you haven&apos;t decided what you&apos;re actually buying until the rider is at your door.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">What to check before the rider leaves</h2>
            <p className="text-[#595959]">
              Try items on over your own clothes, check fit and fabric in daylight if you can, and
              confirm the item matches what you ordered (size, colour, style). Once the rider leaves
              with your payment for the kept items, the order is complete.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Where it&apos;s available</h2>
            <p className="text-[#595959]">
              Try &amp; Buy uses the same delivery network as regular orders — no separate signup. It&apos;s
              available on eligible products, at stores that have turned it on, wherever Lokl currently delivers in Bhilai.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
