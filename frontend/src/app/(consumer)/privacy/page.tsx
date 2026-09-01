import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Lokl collects, uses and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-xs uppercase tracking-widest text-[#E68910] font-bold mb-2">Legal</p>
        <h1 className="text-2xl sm:text-3xl font-display font-medium tracking-tight text-[#0A1F5C] leading-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#64748B] mb-10">Last updated: June 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-[#1C1C1C]">
          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">What we collect</h2>
            <p className="text-[#595959]">When you use Lokl we collect:</p>
            <ul className="mt-2 space-y-1.5 text-[#595959] list-disc list-inside">
              <li>Your name and phone number (used to create your account and send order updates)</li>
              <li>Delivery address — house number, street, landmark and pincode</li>
              <li>Order history — items purchased, store, amount and delivery status</li>
              <li>GPS coordinates — only when you tap &ldquo;Detect my location&rdquo; to confirm your delivery area</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">How we use your data</h2>
            <ul className="mt-2 space-y-1.5 text-[#595959] list-disc list-inside">
              <li>To process and deliver your orders</li>
              <li>To send delivery updates and OTPs via WhatsApp and SMS</li>
              <li>To improve our service, feeds and delivery estimates</li>
              <li>To detect your serviceable delivery area from GPS coordinates</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">What we do not do</h2>
            <p className="text-[#595959]">We do <strong>not</strong> sell, rent or share your personal data with third parties for marketing purposes.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Third-party services we use</h2>
            <ul className="mt-2 space-y-1.5 text-[#595959] list-disc list-inside">
              <li><strong>Cloudinary</strong> — image storage for product and store photos</li>
              <li><strong>MongoDB Atlas</strong> — database for account, order and product data</li>
              <li><strong>Gupshup</strong> — WhatsApp and SMS notifications for order updates and OTPs</li>
              <li><strong>Razorpay</strong> — processes online payments (UPI, cards, netbanking) when you choose to pay online</li>
            </ul>
            <p className="mt-3 text-[#595959]">Each of these services has its own privacy policy. We do not grant them access to your data beyond what is strictly required for the service.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Payments</h2>
            <p className="text-[#595959]">
              Lokl supports both <strong>Pay at Delivery</strong> (cash or UPI, paid directly to the rider) and{" "}
              <strong>online prepaid payment</strong> (UPI, cards, netbanking) where available. When you pay online,
              our payment partner Razorpay processes your payment details directly — we do not collect, process or
              store your card numbers or UPI credentials ourselves. Try &amp; Buy orders are Pay at Delivery only.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Location data</h2>
            <p className="text-[#595959]">GPS coordinates are only collected when you explicitly tap &ldquo;Detect my location&rdquo;. We use these coordinates solely to confirm whether your delivery area is currently serviceable on Lokl. We do not track your location continuously or in the background.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Data retention</h2>
            <p className="text-[#595959]">Your data is retained for as long as your account is active. Order history is retained for at least 12 months for dispute resolution. If you request account deletion, we will remove your personal data within 30 days.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Your rights</h2>
            <p className="text-[#595959]">You may request:</p>
            <ul className="mt-2 space-y-1.5 text-[#595959] list-disc list-inside">
              <li>A copy of the data we hold about you</li>
              <li>Correction of incorrect data</li>
              <li>Deletion of your account and associated personal data</li>
            </ul>
            <p className="mt-3 text-[#595959]">Send requests to <a href="mailto:hello@shoplokl.in" className="text-[#0A1F5C] font-semibold hover:underline">hello@shoplokl.in</a>.</p>
          </section>

          <section>
            <h2 className="font-display text-xl font-medium tracking-tight text-[#0A1F5C] mb-3">Contact</h2>
            <p className="text-[#595959]">Lokl is operated by Ujjwal Deshlahare, Founder &amp; Sole Proprietor. For any privacy-related questions:</p>
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
