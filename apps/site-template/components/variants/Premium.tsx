import type { Bundle } from '../../lib/content';
import { telHref, trackingNumber } from '../../lib/content';
import { StickyMobileBar } from '../shared/StickyMobileBar';

const INK = '#1f1b16';
const CREAM = '#f5f0e3';
const PAPER = '#fbf8f1';
const HAIR = '0.5px solid #1f1b16';

interface Props {
  bundle: Bundle;
}

/**
 * Variant C — Premium Curated.
 * Cream + serif display. Full-bleed editorial hero. By-appointment tone.
 * For custom landscape, kitchen remodel, pool builders, fine carpentry.
 *
 * Uses serif system stack (Cambria, Georgia) with italics for accent.
 */
export function PremiumHome({ bundle }: Props) {
  const phone = trackingNumber();
  const tel = telHref(phone);
  const heroImg = bundle.hero_image_url;

  const serifFamily = `'Cormorant Garamond', 'Cormorant', 'Cambria', Georgia, serif`;
  const sansFamily = `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

  return (
    <div
      className="min-h-screen pb-16 md:pb-0"
      style={{ background: CREAM, color: INK, fontFamily: sansFamily }}
    >
      {/* utility bar */}
      <div
        className="px-6 py-2 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-700"
        style={{ borderBottom: HAIR }}
      >
        <span>Boise · Idaho</span>
        <span className="hidden sm:inline tabular-nums">By appointment · ☎ {phone}</span>
      </div>

      {/* wordmark */}
      <header className="px-6 py-5 text-center" style={{ borderBottom: HAIR }}>
        <a href="/" className="inline-block">
          <span
            className="text-3xl md:text-5xl font-medium tracking-wide"
            style={{ fontFamily: serifFamily, lineHeight: 1 }}
          >
            {bundle.business_name}
          </span>
        </a>
        <nav
          className="mt-3 flex items-center justify-center gap-5 md:gap-7 text-[11px] uppercase tracking-[0.25em]"
        >
          <a href="/services">Practice</a>
          <a href="/service-areas">Where</a>
          <a href="/about">Process</a>
          <a href="/blog">Journal</a>
          <a href="/contact">Visit</a>
        </nav>
      </header>

      {/* full-bleed editorial hero */}
      <section className="relative">
        <div
          className="relative h-[60vh] min-h-[420px] md:h-[70vh]"
          style={{
            background: heroImg ? 'transparent' : '#9b8c70',
            backgroundImage: heroImg
              ? `linear-gradient(180deg, transparent 30%, rgba(31,27,22,0.55)), url("${heroImg}")`
              : 'linear-gradient(180deg, #b9a784 0%, #6c5d44 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-x-0 bottom-0 px-6 md:px-12 pb-10 md:pb-16">
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/85">
              {bundle.city}, {bundle.state}
            </div>
            <h1
              className="text-4xl sm:text-5xl md:text-7xl font-medium leading-[1.0] text-white mt-3 max-w-3xl"
              style={{ fontFamily: serifFamily, textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
            >
              Considered <em className="italic">{bundle.niche}</em>
              <br />
              for {bundle.city} homes.
            </h1>
          </div>
        </div>
      </section>

      {/* lede band */}
      <section
        className="px-6 md:px-12 py-12 md:py-16 grid md:grid-cols-[220px_1fr_220px] gap-8 md:gap-12 items-start"
        style={{ borderBottom: HAIR }}
      >
        <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">I. The Practice</div>
        <p
          className="text-xl md:text-2xl leading-snug max-w-2xl"
          style={{ fontFamily: serifFamily, fontWeight: 400 }}
        >
          {bundle.home.meta_description}
        </p>
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">Begin</div>
          <a
            href="/contact"
            className="inline-block text-lg mt-2"
            style={{
              fontFamily: serifFamily,
              fontWeight: 500,
              borderBottom: HAIR,
              paddingBottom: 2,
            }}
          >
            Request a visit →
          </a>
          <div className="text-xs text-slate-600 mt-3 tabular-nums">
            ☎ <a href={tel}>{phone}</a>
          </div>
        </div>
      </section>

      {/* services as editorial list */}
      <section
        className="px-6 md:px-12 py-12 md:py-16 grid md:grid-cols-[220px_1fr] gap-8 md:gap-12"
        style={{ borderBottom: HAIR }}
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">II. Practice</div>
          <h2 className="text-3xl md:text-4xl mt-2" style={{ fontFamily: serifFamily, fontWeight: 500 }}>
            What we do
          </h2>
        </div>
        <div className="flex flex-col">
          {bundle.services.map((s, i) => (
            <a
              key={s.slug}
              href={s.slug}
              className="grid grid-cols-[40px_1fr_24px] md:grid-cols-[60px_220px_1fr_24px] gap-4 md:gap-6 py-5 items-baseline hover:opacity-80 transition-opacity"
              style={{
                borderTop: i === 0 ? HAIR : undefined,
                borderBottom: HAIR,
              }}
            >
              <span className="tabular-nums text-xs text-slate-600">{String(i + 1).padStart(2, '0')}</span>
              <span
                className="text-2xl md:text-3xl"
                style={{ fontFamily: serifFamily, fontWeight: 600 }}
              >
                {s.title}
              </span>
              <span className="hidden md:block text-sm text-slate-700 max-w-md">
                {s.meta_description}
              </span>
              <span className="text-lg" style={{ fontFamily: serifFamily }}>
                →
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* editorial pull quote */}
      <section
        className="px-6 md:px-12 py-16 md:py-24 text-center"
        style={{ background: INK, color: CREAM }}
      >
        <blockquote
          className="text-2xl md:text-4xl italic leading-[1.25] max-w-3xl mx-auto"
          style={{ fontFamily: serifFamily, fontWeight: 500 }}
        >
          "[TESTIMONIAL — REPLACE WITH 1–2 SENTENCE QUOTE FROM A REAL CLIENT]"
        </blockquote>
        <div className="mt-6 text-[10px] uppercase tracking-[0.3em] text-white/70">
          — [CLIENT NAME], [{bundle.city.toUpperCase()} NEIGHBORHOOD]
        </div>
      </section>

      {/* areas */}
      <section
        className="px-6 md:px-12 py-12 md:py-16 grid md:grid-cols-[1fr_320px] gap-12"
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">III. Where</div>
          <h2 className="text-3xl md:text-4xl mt-2" style={{ fontFamily: serifFamily, fontWeight: 500 }}>
            Serving the {bundle.city} area
          </h2>
        </div>
        <div className="text-base text-slate-700 leading-loose" style={{ fontFamily: serifFamily, fontSize: '1.125rem' }}>
          {[bundle.city, ...bundle.nearby_cities, ...bundle.service_areas.map((a) => a.title)]
            .filter((c, i, arr) => c && arr.indexOf(c) === i)
            .slice(0, 8)
            .map((c) => (
              <div key={c}>{c}</div>
            ))}
        </div>
      </section>

      {/* request a visit CTA */}
      <section className="px-6 md:px-12 py-10 text-center" style={{ borderTop: HAIR }}>
        <h2 className="text-3xl md:text-4xl" style={{ fontFamily: serifFamily, fontWeight: 500 }}>
          Begin a project
        </h2>
        <p className="text-sm text-slate-600 mt-2">Initial consultations are by appointment.</p>
        <div className="text-sm mt-3 tabular-nums">
          ☎ <a href={tel}>{phone}</a>
        </div>
        <a
          href="/contact"
          className="inline-block mt-3 text-lg"
          style={{ fontFamily: serifFamily, fontWeight: 500, borderBottom: HAIR, paddingBottom: 2 }}
        >
          Request a visit →
        </a>
      </section>

      <StickyMobileBar
        phone={phone}
        cta="Visit"
        ctaHref="/contact"
        bg={INK}
        fg={CREAM}
        ctaBg={CREAM}
        ctaFg={INK}
      />
    </div>
  );
}
