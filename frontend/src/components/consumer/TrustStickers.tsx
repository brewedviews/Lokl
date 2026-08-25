/**
 * End-of-homepage trust strip — die-cut "sticker" badges (tilted, white
 * inner ring + colored outline, whisper shadow) in place of the old plain
 * icon-and-text row. Brand colors only (navy/orange/cream), no emojis.
 *
 * The "sticker" edge is a stacked box-shadow, not extra DOM nesting: a 3px
 * white ring sits closest to the fill, a further 3px colored ring sits
 * outside it (CSS box-shadow stacking paints earlier entries on top, so the
 * white ring occludes the inner half of the colored one) — that's the
 * peeled-sticker "white border, then colored outline" look from a single
 * element, plus the whisper drop shadow.
 */
const NAVY = "var(--color-brand-primary)";
const ORANGE = "var(--color-brand-accent)";

function stickerRing(outlineColor: string) {
  return `0 0 0 2px #FFFFFF, 0 0 0 4px ${outlineColor}, var(--shadow-2)`;
}

// Sized to fit all 3 in one row with room to spare at 360px width (section
// has px-4 = 32px total side padding, so ~328px of content width there):
// two ~92px rects + one 76px circle + 2×10px gaps ≈ 280px.
export function TrustStickers() {
  return (
    <section
      className="max-w-7xl mx-auto px-4 pt-8 pb-8 sm:pb-6"
      data-testid="trust-stickers"
    >
      <div className="text-center mb-5">
        <p className="font-display font-medium text-xl sm:text-2xl tracking-tight text-brand-primary leading-tight">
          Bhilai&apos;s own
        </p>
        <p className="text-[12px] text-text-muted mt-0.5">
          neighbourhood shopping app
        </p>
      </div>

      <div className="flex items-center justify-center gap-2.5">
        {/* Made in Bhilai — navy stamp */}
        <div
          data-testid="sticker-made-in-bhilai"
          className="bg-brand-primary text-white rounded-card px-3.5 py-2 text-center shrink-0"
          style={{ transform: "rotate(-5deg)", boxShadow: stickerRing(ORANGE) }}
        >
          <div className="text-[7px] uppercase tracking-[0.12em] text-white/70 font-medium">
            Made in
          </div>
          <div className="font-display font-bold text-sm leading-tight -mt-0.5">
            BHILAI
          </div>
        </div>

        {/* 45 mins delivery — orange circle */}
        <div
          data-testid="sticker-delivery-time"
          className="bg-brand-accent text-white rounded-pill w-[76px] h-[76px] flex flex-col items-center justify-center shrink-0"
          style={{ transform: "rotate(3deg)", boxShadow: stickerRing(NAVY) }}
        >
          <div className="font-display font-bold text-xl leading-none">
            45
          </div>
          <div className="text-[6px] uppercase tracking-[0.08em] font-semibold mt-0.5">
            Mins delivery
          </div>
        </div>

        {/* Try & Buy — cream, navy outline */}
        <div
          data-testid="sticker-try-buy"
          className="bg-surface-tint text-brand-primary rounded-card px-3.5 py-2 text-center shrink-0"
          style={{ transform: "rotate(-3deg)", boxShadow: stickerRing(NAVY) }}
        >
          <div className="font-display font-bold text-sm leading-tight">TRY</div>
          <div className="font-display font-bold text-sm leading-tight -mt-0.5">
            &amp; BUY
          </div>
        </div>
      </div>
    </section>
  );
}
