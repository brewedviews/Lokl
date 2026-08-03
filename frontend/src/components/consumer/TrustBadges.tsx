import { MapPin, Bike, RotateCcw } from "lucide-react";

const BADGES = [
  { icon: MapPin, label: "Made in Bhilai" },
  { icon: Bike, label: "Delivered in minutes" },
  { icon: RotateCcw, label: "Try & Buy" },
] as const;

/**
 * End-of-homepage trust strip — takes over the page-ender role the Footer
 * used to play on the homepage, without the redundant nav/legal links
 * (those live in the bottom nav / account / a real footer elsewhere).
 * Understated by design: tint surface, navy text, orange used only as a
 * small icon accent — no emojis, no heavy fills.
 */
export function TrustBadges() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-2" data-testid="trust-badges">
      <div className="bg-surface-tint rounded-card py-5 px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-10">
        {BADGES.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2">
            <Icon size={16} className="text-brand-accent shrink-0" />
            <span className="text-meta font-medium text-brand-primary">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
