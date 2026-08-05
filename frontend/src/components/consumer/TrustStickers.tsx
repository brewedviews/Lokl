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
  return `0 0 0 3px #FFFFFF, 0 0 0 6px ${outlineColor}, var(--shadow-2)`;
}

export function TrustStickers() {
  return (
    <section
      className="max-w-7xl mx-auto px-4 pt-10 pb-10 sm:pb-6"
      data-testid="trust-stickers"
    >
      <div className="text-center mb-9">
        <p className="font-display italic text-[22px] text-brand-primary leading-tight">
          Bhilai&apos;s own
        </p>
        <p className="text-[13px] text-text-muted mt-1">
          neighbourhood shopping app
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-8">
        {/* Made in Bhilai — navy stamp */}
        <div
          data-testid="sticker-made-in-bhilai"
          className="bg-brand-primary text-white rounded-card px-6 py-4 text-center"
          style={{ transform: "rotate(-5deg)", boxShadow: stickerRing(ORANGE) }}
        >
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/70 font-medium">
            Made in
          </div>
          <div className="font-display font-bold text-lg leading-tight -mt-0.5">
            BHILAI
          </div>
        </div>

        {/* 45 mins delivery — orange circle */}
        <div
          data-testid="sticker-delivery-time"
          className="bg-brand-accent text-white rounded-pill w-28 h-28 sm:w-32 sm:h-32 flex flex-col items-center justify-center"
          style={{ transform: "rotate(3deg)", boxShadow: stickerRing(NAVY) }}
        >
          <div className="font-display font-bold text-3xl sm:text-4xl leading-none">
            45
          </div>
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.1em] font-semibold mt-1">
            Mins delivery
          </div>
        </div>

        {/* Try & Buy — cream, navy outline */}
        <div
          data-testid="sticker-try-buy"
          className="bg-surface-tint text-brand-primary rounded-card px-6 py-4 text-center"
          style={{ transform: "rotate(-3deg)", boxShadow: stickerRing(NAVY) }}
        >
          <div className="font-display font-bold text-lg leading-tight">TRY</div>
          <div className="font-display font-bold text-lg leading-tight -mt-0.5">
            &amp; BUY
          </div>
        </div>
      </div>
    </section>
  );
}
