import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQs",
  description: "Answers to common questions about ordering, delivery, Try & Buy, payments, and returns on Lokl.",
};

const FAQS: { q: string; a: string }[] = [
  {
    q: "How fast is delivery?",
    a: "We target 45 minutes from a store accepting your order. Actual time depends on distance, traffic and how busy the store is — but 45 minutes is the number we build around.",
  },
  {
    q: "Where does Lokl deliver?",
    a: "Bhilai only, for now — we're a hyperlocal app built for one city. You'll need a Bhilai address with a 490xxx pincode to check out.",
  },
  {
    q: "What is Try & Buy?",
    a: "Order like normal, and when your rider arrives, try the item on right at your door. Keep what you love, hand back what you don't — on the spot, no separate return process. You only pay for what you keep.",
  },
  {
    q: "How do I pay?",
    a: "Pay at Delivery — cash or UPI, straight to the rider when your order arrives. We don't collect any payment upfront or store card details.",
  },
  {
    q: "Can I return or exchange an item?",
    a: "If you used Try & Buy, most of this happens on the spot before you pay. For anything after the rider leaves (wrong item, damaged item), you have 24 hours to reach out via Account → Support. See our Return & Exchange Policy for the full details.",
  },
  {
    q: "How do I track my order?",
    a: "Open Account → Orders and tap the order — you'll see live status (placed, accepted, out for delivery, delivered). If you're mid-order, a tracker pill also floats above the bottom nav on every page.",
  },
  {
    q: "What happens if the store is closed when I order?",
    a: "You can still add items and check out — it becomes a pre-order. We'll show you when the store opens, and your order is delivered once they're back online, typically the same or next day.",
  },
  {
    q: "How do I become a seller on Lokl?",
    a: "It's free to list and we take zero commission. Head to lokl.shop or WhatsApp us at +91 7719052107 and our team will set up your store.",
  },
  {
    q: "Is there a delivery fee?",
    a: "Orders above ₹499 deliver free. Below that, a small distance-based fee applies, shown clearly at checkout before you place the order.",
  },
  {
    q: "Do I need to create an account?",
    a: "Yes — a quick WhatsApp OTP sign-in, no password needed. This is how we send order updates and let you track orders and manage addresses.",
  },
  {
    q: "How do I cancel an order?",
    a: "Orders can usually be cancelled before a rider is assigned, from Account → Orders. Once a rider has picked up your order, cancellation isn't guaranteed — contact support and we'll do our best.",
  },
  {
    q: "What if my order arrives wrong or damaged?",
    a: "Raise a request from Account → Support within 24 hours of delivery with your order ID — our team will sort out a refund or replacement with the store.",
  },
];

export default function FaqPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Support</p>
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] leading-tight mb-2">Frequently Asked Questions</h1>
        <p className="text-sm text-[#64748B] mb-10">Can&apos;t find your answer? <a href="/contact" className="text-[#0A1F5C] font-semibold hover:underline">Contact us</a> directly.</p>

        <div className="space-y-6">
          {FAQS.map((item) => (
            <section key={item.q} className="border-b border-[#E5E2DC] pb-6 last:border-0">
              <h2 className="font-display text-base sm:text-lg font-bold text-[#0A1F5C] mb-2">{item.q}</h2>
              <p className="text-[15px] leading-relaxed text-[#595959]">{item.a}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
