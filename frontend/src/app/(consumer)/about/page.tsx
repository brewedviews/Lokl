import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Us",
  description: "Lokl is Bhilai's own neighbourhood shopping app — real local stores, delivered fast.",
};

export default function AboutPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">About</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">About Lokl</h1>
        <p className="text-sm text-[#64748B] mb-10">Bhilai&apos;s own neighbourhood shopping app.</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Your neighbour&apos;s shop, not a faraway warehouse</h2>
            <p className="text-[#595959]">
              Every order on Lokl comes from a real shop in Bhilai, run by someone who lives here — not a warehouse
              you&apos;ll never see. We started Lokl because we love the shopkeepers who already know this city, and
              we wanted a faster, easier way for them to reach the neighbours who&apos;d already walk past their
              store every day.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Why local matters</h2>
            <p className="text-[#595959]">
              You&apos;re ordering from a shopkeeper you could actually meet, not a warehouse in another city. We
              think that&apos;s worth building around — real stores, real stock, real prices, and a rider who&apos;s
              often just a few minutes away because the store already is.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">What we&apos;re building</h2>
            <ul className="mt-2 space-y-1.5 text-[#595959] list-disc list-inside">
              <li>Fast delivery — 45 minutes, because the store is already in your city</li>
              <li>Try &amp; Buy — try it on at your door where the store offers it, pay only for what you keep</li>
              <li>Zero commission for merchants, so local shops keep what they earn</li>
              <li>Pay online or Pay at Delivery — whichever&apos;s available for your order</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Where we are today</h2>
            <p className="text-[#595959]">
              Lokl is live in Bhilai, Chhattisgarh, and growing — more shops join every week. If you run a store here,
              we&apos;d love to have you; see <a href="/contact" className="text-[#0A1F5C] font-semibold hover:underline">Contact Us</a> to get started.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
