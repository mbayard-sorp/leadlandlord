import type { Bundle } from '../../lib/content';
import { telHref, trackingNumber } from '../../lib/content';
import { StickyMobileBar } from '../shared/StickyMobileBar';

const NAVY = '#0f1620';
const ORANGE = '#ff7a1f';
const CREAM = '#fbf8f1';
const CREAM_2 = '#f3eee2';

interface Props {
  bundle: Bundle;
}

/**
 * Variant A — Trade-Classic.
 * Navy + safety-orange. Big phone in the header. Numbered service tiles.
 * For HVAC, plumbing, electrical, gutter, roofing, fence, septic, tree.
 */
export function ClassicHome({ bundle }: Props) {
  const phone = trackingNumber();
  const tel = telHref(phone);
  const trust = bundle.trust_signals.length > 0 ? bundle.trust_signals : [
    'Licensed & insured',
    'Same-week service',
    'Free quotes',
    'We answer the phone',
  ];

  return (
    <div className="min-h-screen pb-16 md:pb-0" style={{ background: CREAM, color: NAVY }}>
      {/* utility bar */}
      <div
        className="px-4 py-1 flex items-center justify-between text-[10px] sm:text-xs uppercase tracking-wider"
        style={{ background: NAVY, color: CREAM }}
      >
        <span>★ Family-owned · {bundle.city}, {bundle.state}</span>
        <span className="hidden sm:inline">Open 7am–9pm · 7 days</span>
      </div>

      {/* header */}
      <header
        className="px-4 py-3 flex items-center justify-between border-b-2"
        style={{ borderColor: NAVY }}
      >
        <a href="/" className="flex items-center gap-3">
          <span
            className="inline-block w-7 h-7 rounded border-2"
            style={{ background: ORANGE, borderColor: NAVY }}
            aria-hidden
          />
          <span className="font-bold tracking-tight uppercase text-sm md:text-base leading-tight">
            {bundle.business_name}
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-5 text-sm">
          <a href="/services">Services</a>
          <a href="/service-areas">Areas</a>
          <a href="/about">About</a>
          <a href="/blog">Blog</a>
        </nav>
        <a
          href={tel}
          className="font-bold tabular-nums px-3 py-1.5 md:px-4 md:py-2 rounded-full border-2 text-sm md:text-base"
          style={{ background: ORANGE, borderColor: NAVY }}
        >
          ☎ {phone}
        </a>
      </header>

      {/* hero */}
      <section
        className="grid md:grid-cols-2 border-b-2"
        style={{ borderColor: NAVY }}
      >
        <div className="px-6 py-10 md:py-14">
          <div className="text-xs font-bold uppercase tracking-widest" style={{ color: ORANGE }}>
            {bundle.city}, {bundle.state} · Family-owned
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight leading-[0.95] mt-3">
            {bundle.niche}
            <br />
            in {bundle.city},<br className="hidden sm:block" /> {bundle.state}.
          </h1>
          <div
            className="h-1 w-20 mt-5 mb-5"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${ORANGE} 0 8px, transparent 8px 14px)`,
            }}
          />
          <p className="text-base md:text-lg leading-relaxed max-w-md">
            {bundle.home.meta_description ||
              'Family-owned. We answer the phone. Licensed and insured. Free quotes — same-week service.'}
          </p>
          <div className="flex flex-wrap gap-3 mt-6">
            <a
              href={tel}
              className="inline-flex items-center px-5 py-3 border-2 font-bold uppercase tracking-wide"
              style={{ background: ORANGE, color: NAVY, borderColor: NAVY }}
            >
              ☎ Call {phone}
            </a>
            <a
              href="/contact"
              className="inline-flex items-center px-5 py-3 border-2 font-bold uppercase tracking-wide"
              style={{ background: CREAM, color: NAVY, borderColor: NAVY }}
            >
              Get free quote →
            </a>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 text-sm">
            {trust.slice(0, 3).map((t) => (
              <span key={t}>✓ {t}</span>
            ))}
          </div>
        </div>
        <div className="relative min-h-[260px] md:min-h-[420px] border-l-0 md:border-l-2" style={{ borderColor: NAVY }}>
          {bundle.hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bundle.hero_image_url}
              alt={`${bundle.niche} in ${bundle.city}, ${bundle.state}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-sm uppercase tracking-widest"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, transparent 48%, rgba(15,22,32,0.25) 49%, rgba(15,22,32,0.25) 51%, transparent 52%), linear-gradient(135deg, transparent 48%, rgba(15,22,32,0.25) 49%, rgba(15,22,32,0.25) 51%, transparent 52%)',
                backgroundColor: '#ece5d2',
                backgroundSize: '14px 14px, 14px 14px',
                backgroundPosition: '0 0, 7px 7px',
                color: NAVY,
              }}
            >
              [hero image]
            </div>
          )}
        </div>
      </section>

      {/* trust strip */}
      <section
        className="grid grid-cols-2 md:grid-cols-4 border-b-2"
        style={{ background: NAVY, color: CREAM, borderColor: NAVY }}
      >
        {trust.slice(0, 4).map((t, i) => (
          <div
            key={t}
            className="px-4 py-4 flex items-center gap-3 border-r-0 md:border-r"
            style={{ borderColor: '#2a3040' }}
          >
            <span className="text-xl" aria-hidden>{['🛡', '⚡', '$', '☎'][i] ?? '★'}</span>
            <div>
              <div className="font-bold uppercase text-xs tracking-wide">{t}</div>
            </div>
          </div>
        ))}
      </section>

      {/* services */}
      <section className="px-6 py-10 md:py-14">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-600">What we do</div>
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight mt-1">Services</h2>
          </div>
          <span className="hidden sm:inline text-xs text-slate-600">One call covers it all →</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {bundle.services.map((s, i) => (
            <a
              key={s.slug}
              href={s.slug}
              className="block p-4 border-2 hover:opacity-90 transition-opacity"
              style={{ background: i === 0 ? '#fff5e6' : CREAM, borderColor: NAVY }}
            >
              <div
                className="font-black tabular-nums leading-none"
                style={{ color: ORANGE, fontSize: 'clamp(2rem, 4vw, 2.75rem)' }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="font-bold uppercase tracking-wide mt-3 text-base">{s.title}</div>
              <div className="text-xs mt-1 text-slate-600 line-clamp-2">{s.meta_description}</div>
              <div className="text-xs font-bold uppercase tracking-wider mt-4" style={{ color: ORANGE }}>
                Read more →
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* service areas + form */}
      <section
        className="grid md:grid-cols-[55%_45%] border-t-2"
        style={{ background: CREAM_2, borderColor: NAVY }}
      >
        <div className="px-6 py-10">
          <div className="text-xs uppercase tracking-widest text-slate-600">Service areas</div>
          <h2 className="text-2xl md:text-3xl font-bold mt-1">{bundle.city} & nearby towns</h2>
          <div className="flex flex-wrap gap-2 mt-4">
            {[bundle.city, ...bundle.nearby_cities, ...bundle.service_areas.map((a) => a.title)]
              .filter((c, i, arr) => c && arr.indexOf(c) === i)
              .slice(0, 12)
              .map((c) => (
                <span
                  key={c}
                  className="px-3 py-1 border-2 text-sm"
                  style={{ borderColor: NAVY, background: CREAM }}
                >
                  {c}
                </span>
              ))}
          </div>
        </div>
        <div
          className="px-6 py-10 border-t-2 md:border-t-0 md:border-l-2"
          style={{ background: CREAM, borderColor: NAVY }}
        >
          <h2 className="text-xl md:text-2xl font-bold">Get a free quote</h2>
          <p className="text-xs text-slate-600 mt-1">Or just call. We pick up.</p>
          <form action="/api/lead" method="post" className="mt-4 flex flex-col gap-2">
            <input
              name="name"
              placeholder="Your name"
              className="border-2 px-3 py-2 text-sm bg-white"
              style={{ borderColor: NAVY }}
            />
            <input
              name="phone"
              placeholder="Phone"
              type="tel"
              required
              className="border-2 px-3 py-2 text-sm bg-white"
              style={{ borderColor: NAVY }}
            />
            <input
              name="zip"
              placeholder="Zip"
              className="border-2 px-3 py-2 text-sm bg-white"
              style={{ borderColor: NAVY }}
            />
            <textarea
              name="message"
              placeholder="What do you need?"
              rows={3}
              className="border-2 px-3 py-2 text-sm bg-white"
              style={{ borderColor: NAVY }}
            />
            <button
              type="submit"
              className="px-4 py-3 border-2 font-bold uppercase tracking-wide"
              style={{ background: ORANGE, color: NAVY, borderColor: NAVY }}
            >
              Send →
            </button>
          </form>
        </div>
      </section>

      <StickyMobileBar
        phone={phone}
        cta="Get quote"
        ctaHref="/contact"
        bg={NAVY}
        fg={CREAM}
        ctaBg={ORANGE}
        ctaFg={NAVY}
      />
    </div>
  );
}
