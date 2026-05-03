import type { Bundle } from '../../lib/content';
import { telHref, trackingNumber } from '../../lib/content';
import { StickyMobileBar } from '../shared/StickyMobileBar';

const INK = '#1f1b16';
const CREAM = '#fff7ed';
const CORAL = '#ff8e7a';
const CORAL_SOFT = '#ffe7df';
const YELLOW = '#fff2c2';
const GREEN_SOFT = '#dfeee1';
const BLUE_SOFT = '#dfeaf6';
const SLATE = '#4a4036';

const SERVICE_BGS = [CORAL_SOFT, YELLOW, GREEN_SOFT, BLUE_SOFT];

interface Props {
  bundle: Bundle;
}

/**
 * Variant D — Bright Approachable.
 * Warm cream + coral accent. Rounded everything. Friendly handwritten accent.
 * For cleaning, junk removal, pest, lawn care, dog walking, mobile detail.
 */
export function BrightHome({ bundle }: Props) {
  const phone = trackingNumber();
  const tel = telHref(phone);
  const trust = bundle.trust_signals.length > 0 ? bundle.trust_signals : [
    'Bonded',
    'Insured',
    'Same person every visit',
  ];

  const handFamily = `'Caveat', 'Patrick Hand', cursive`;
  const sansFamily = `'DM Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;

  return (
    <div
      className="min-h-screen pb-16 md:pb-0"
      style={{ background: CREAM, color: INK, fontFamily: sansFamily }}
    >
      <header
        className="px-4 md:px-6 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px dashed #1f1b16' }}
      >
        <a href="/" className="flex items-center gap-3">
          <span
            className="inline-grid place-items-center w-9 h-9 md:w-11 md:h-11 rounded-full border-2 text-base md:text-xl"
            style={{ background: CORAL, borderColor: INK, fontFamily: handFamily, fontWeight: 700 }}
            aria-hidden
          >
            {bundle.business_name
              .split(/\s+/)
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toLowerCase()}
          </span>
          <div>
            <div
              className="text-lg md:text-2xl leading-none"
              style={{ fontFamily: handFamily, fontWeight: 700 }}
            >
              {bundle.business_name}
            </div>
            <div className="text-[10px] text-slate-500">
              {bundle.city.toLowerCase()} · {bundle.niche.toLowerCase()}
            </div>
          </div>
        </a>
        <div className="flex items-center gap-2">
          <a
            href={tel}
            className="hidden sm:inline-flex items-center gap-1 px-3 py-2 rounded-full border-2 text-sm tabular-nums"
            style={{ borderColor: INK }}
          >
            ☎ {phone}
          </a>
          <a
            href="/contact"
            className="px-4 py-2 rounded-full border-2 font-semibold text-sm"
            style={{ background: CORAL, borderColor: INK, fontFamily: handFamily, fontSize: '1rem' }}
          >
            Book online ✦
          </a>
        </div>
      </header>

      {/* hero */}
      <section className="relative">
        <svg
          viewBox="0 0 880 380"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <path
            d="M-20 240 Q 200 180 380 220 T 760 200 Q 880 200 920 280 L 920 380 L -20 380 Z"
            fill={CORAL_SOFT}
            stroke={INK}
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <circle cx="120" cy="80" r="36" fill="none" stroke={INK} strokeWidth="1.2" strokeDasharray="3 3" />
          <circle cx="780" cy="60" r="20" fill={YELLOW} stroke={INK} strokeWidth="1.2" />
        </svg>
        <div className="relative grid md:grid-cols-[3fr_2fr] gap-8 px-6 md:px-12 py-12 md:py-20">
          <div className="self-center">
            <div className="text-xs uppercase tracking-widest">
              {bundle.niche} · {bundle.city}, {bundle.state}
            </div>
            <h1
              className="text-5xl sm:text-6xl md:text-7xl leading-[1] mt-3 max-w-2xl"
              style={{ fontFamily: handFamily, fontWeight: 700 }}
            >
              {bundle.home.title}
            </h1>
            <p className="text-base md:text-lg leading-relaxed mt-5 max-w-md" style={{ color: SLATE }}>
              {bundle.home.meta_description}
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <a
                href="/contact"
                className="px-5 py-3 rounded-full border-2 font-bold text-base"
                style={{ background: CORAL, borderColor: INK, fontFamily: handFamily, fontSize: '1.1rem' }}
              >
                Book online ✦
              </a>
              <a
                href={tel}
                className="px-5 py-3 rounded-full border-2 font-bold text-base tabular-nums"
                style={{ background: CREAM, borderColor: INK, fontFamily: handFamily, fontSize: '1.1rem' }}
              >
                ☎ {phone}
              </a>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5 text-sm" style={{ color: SLATE }}>
              {trust.slice(0, 4).map((t, i) => (
                <span key={t}>
                  {['★', '♥', '✿', '☻'][i % 4]} {t}
                </span>
              ))}
            </div>
          </div>
          <div className="relative self-center min-h-[260px]">
            <div
              className="absolute inset-0 m-auto rounded-full overflow-hidden border-2"
              style={{ width: 280, height: 280, borderColor: INK, background: YELLOW }}
            >
              {bundle.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bundle.hero_image_url}
                  alt={`${bundle.niche} in ${bundle.city}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full grid place-items-center text-sm uppercase tracking-widest" style={{ color: SLATE }}>
                  [hero image]
                </div>
              )}
            </div>
            {/* sticky-note callout */}
            <div
              className="absolute top-4 right-2 md:right-6 max-w-[180px] px-3 py-2 -rotate-6"
              style={{
                background: '#fef4a8',
                color: '#5a4a2a',
                fontFamily: handFamily,
                fontSize: '1.1rem',
                lineHeight: 1.2,
                boxShadow: '1px 2px 0 rgba(0,0,0,0.12)',
                borderRadius: 2,
              }}
            >
              same friendly crew, every visit ♥
            </div>
          </div>
        </div>
      </section>

      {/* services */}
      <section className="px-6 md:px-12 py-12">
        <div className="flex items-end justify-between mb-6">
          <h2
            className="text-3xl md:text-4xl"
            style={{ fontFamily: handFamily, fontWeight: 700 }}
          >
            What we do
          </h2>
          <span className="text-xs text-slate-500">not sure? give us a ring →</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bundle.services.map((s, i) => (
            <a
              key={s.slug}
              href={s.slug}
              className="block p-5 rounded-3xl border-2 transition-transform hover:-translate-y-0.5"
              style={{ background: SERVICE_BGS[i % SERVICE_BGS.length], borderColor: INK }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="grid place-items-center w-12 h-12 rounded-full border-2 text-2xl"
                  style={{ background: CREAM, borderColor: INK }}
                  aria-hidden
                >
                  {['🏡', '✦', '⌂', '◐', '☘', '◇'][i % 6]}
                </div>
                <div>
                  <div className="text-xl md:text-2xl" style={{ fontFamily: handFamily, fontWeight: 700 }}>
                    {s.title}
                  </div>
                </div>
              </div>
              <p className="text-sm mt-3" style={{ color: SLATE }}>
                {s.meta_description}
              </p>
              <span className="inline-block mt-3 font-bold text-sm" style={{ borderBottom: '1.5px solid #1f1b16', fontFamily: handFamily, fontSize: '1rem' }}>
                See details →
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* big cheerful CTA */}
      <section className="px-6 md:px-12 py-10 grid md:grid-cols-[3fr_2fr] gap-6" style={{ borderTop: '1px dashed #1f1b16' }}>
        <div className="p-6 md:p-8 rounded-3xl border-2" style={{ background: CORAL, borderColor: INK }}>
          <h2
            className="text-3xl md:text-5xl leading-[1]"
            style={{ fontFamily: handFamily, fontWeight: 700 }}
          >
            Ready when you are.
          </h2>
          <p className="text-sm mt-3 max-w-md">Most weeks we have same-week openings. Book online or call — whichever's easier for you.</p>
          <div className="flex flex-wrap gap-3 mt-5">
            <a
              href="/contact"
              className="px-4 py-2 rounded-full font-bold"
              style={{ background: INK, color: CREAM, fontFamily: handFamily, fontSize: '1.1rem' }}
            >
              Book online ✦
            </a>
            <a
              href={tel}
              className="px-4 py-2 rounded-full border-2 font-bold tabular-nums"
              style={{ background: CREAM, borderColor: INK, fontFamily: handFamily, fontSize: '1.1rem' }}
            >
              ☎ {phone}
            </a>
          </div>
        </div>
        <div className="p-6 rounded-3xl border-2" style={{ background: YELLOW, borderColor: INK }}>
          <h2
            className="text-2xl md:text-3xl"
            style={{ fontFamily: handFamily, fontWeight: 700 }}
          >
            We come to —
          </h2>
          <div className="flex flex-wrap gap-2 mt-3">
            {[bundle.city, ...bundle.nearby_cities, ...bundle.service_areas.map((a) => a.title)]
              .filter((c, i, arr) => c && arr.indexOf(c) === i)
              .slice(0, 8)
              .map((c) => (
                <span
                  key={c}
                  className="px-3 py-1 rounded-full border-2 text-sm"
                  style={{ background: CREAM, borderColor: INK }}
                >
                  {c}
                </span>
              ))}
          </div>
          <p className="text-xs mt-4" style={{ color: SLATE }}>Don't see your town? Just ask.</p>
        </div>
      </section>

      <StickyMobileBar
        phone={phone}
        cta="Book"
        ctaHref="/contact"
        bg={INK}
        fg={CREAM}
        ctaBg={CORAL}
        ctaFg={INK}
      />
    </div>
  );
}
