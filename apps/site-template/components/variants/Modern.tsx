import type { Bundle } from '../../lib/content';
import { telHref, trackingNumber } from '../../lib/content';
import { StickyMobileBar } from '../shared/StickyMobileBar';

const INK = '#0f1620';
const AQUA = '#4ec3c9';
const AQUA_TINT = '#e8f7f8';
const PAPER = '#fbf8f1';
const PAPER_2 = '#f3eee2';
const BORDER = '#d8d2c4';

interface Props {
  bundle: Bundle;
}

/**
 * Variant B — Clean Modern.
 * Aqua accent, geometric SVG hero, soft-shadow icon cards, FAQ accordion.
 * For solar, EV charging, smart-home, water-heater install.
 */
export function ModernHome({ bundle }: Props) {
  const phone = trackingNumber();
  const tel = telHref(phone);
  const trust = bundle.trust_signals.length > 0 ? bundle.trust_signals : [
    'Licensed & insured',
    'Free quote',
    'Federal tax credit help',
  ];

  // Pull FAQ-shaped questions out of blog post titles for the home page accordion.
  const faqs = bundle.blog_posts
    .filter((p) => /\?$/.test(p.title))
    .slice(0, 5);

  return (
    <div className="min-h-screen pb-16 md:pb-0" style={{ background: PAPER, color: INK }}>
      <header
        className="px-4 py-3 flex items-center justify-between border-b"
        style={{ borderColor: BORDER }}
      >
        <a href="/" className="flex items-center gap-3">
          <span
            className="inline-block w-7 h-7 rounded-full border"
            style={{ background: AQUA, borderColor: INK }}
            aria-hidden
          />
          <span className="font-semibold tracking-tight">
            {bundle.business_name}
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-5 text-sm">
          <a href="/services">Services</a>
          <a href="/service-areas">Areas</a>
          <a href="/about">About</a>
          <a href="/blog">Blog</a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={tel}
            className="px-3 py-2 rounded-full border text-sm tabular-nums hidden sm:inline-block"
            style={{ borderColor: INK }}
          >
            ☎ {phone}
          </a>
          <a
            href="/contact"
            className="px-4 py-2 rounded-full font-semibold text-sm"
            style={{ background: INK, color: PAPER }}
          >
            Get quote
          </a>
        </div>
      </header>

      {/* hero with geometric SVG backdrop */}
      <section
        className="relative overflow-hidden border-b"
        style={{ borderColor: BORDER }}
      >
        <svg
          viewBox="0 0 880 480"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={AQUA} stopOpacity="0.45" />
              <stop offset="1" stopColor={AQUA} stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <circle cx="780" cy="120" r="200" fill="url(#g1)" />
          <circle cx="100" cy="380" r="120" fill={AQUA} opacity="0.18" />
          <rect
            x="640"
            y="220"
            width="140"
            height="140"
            fill="none"
            stroke={INK}
            strokeWidth="1"
            transform="rotate(15 710 290)"
          />
        </svg>

        <div className="relative grid md:grid-cols-[3fr_2fr] gap-10 px-6 md:px-12 py-12 md:py-20">
          <div className="self-center">
            <div className="text-xs uppercase tracking-widest text-slate-600">
              {bundle.city}, {bundle.state}
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] mt-3 max-w-2xl">
              {bundle.home.title}
            </h1>
            <p className="text-base md:text-lg leading-relaxed mt-4 max-w-lg text-slate-700">
              {bundle.home.meta_description}
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <a
                href="/contact"
                className="px-5 py-3 rounded-full font-semibold"
                style={{ background: INK, color: PAPER }}
              >
                Get free quote →
              </a>
              <a
                href={tel}
                className="px-5 py-3 rounded-full border tabular-nums"
                style={{ borderColor: INK }}
              >
                ☎ {phone}
              </a>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5 text-sm text-slate-700">
              {trust.map((t) => (
                <span key={t}>✓ {t}</span>
              ))}
            </div>
          </div>

          {/* inline form card */}
          <div className="relative self-center">
            {bundle.hero_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bundle.hero_image_url}
                alt={`${bundle.niche} in ${bundle.city}`}
                className="hidden md:block absolute -inset-4 w-[calc(100%+2rem)] h-[calc(100%+2rem)] object-cover rounded-3xl opacity-30"
                aria-hidden
              />
            ) : null}
            <div
              className="relative rounded-2xl border p-5 max-w-sm mx-auto md:mx-0 md:ml-auto"
              style={{
                background: PAPER,
                borderColor: BORDER,
                boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
              }}
            >
              <h2 className="font-semibold">Get a free quote</h2>
              <p className="text-xs text-slate-500 mt-1">Reply same business day.</p>
              <form action="/api/lead" method="post" className="flex flex-col gap-2 mt-4">
                <input
                  name="name"
                  placeholder="Your name"
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: PAPER_2 }}
                />
                <input
                  name="phone"
                  placeholder="Phone"
                  type="tel"
                  required
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: PAPER_2 }}
                />
                <input
                  name="zip"
                  placeholder="Zip"
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: PAPER_2 }}
                />
                <textarea
                  name="message"
                  placeholder="What can we help with?"
                  rows={3}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: PAPER_2 }}
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full font-semibold text-sm"
                  style={{ background: AQUA, color: INK }}
                >
                  Send →
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* services as soft-shadow icon cards */}
      <section className="px-6 md:px-12 py-12 md:py-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-600">What we install</div>
            <h2 className="text-2xl md:text-3xl font-bold mt-1">Services</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {bundle.services.map((s, i) => (
            <a
              key={s.slug}
              href={s.slug}
              className="block p-5 rounded-2xl border transition-shadow hover:shadow-md"
              style={{ background: PAPER, borderColor: BORDER, boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}
            >
              <div
                className="w-10 h-10 rounded-lg grid place-items-center text-xl border"
                style={{ background: AQUA_TINT, borderColor: AQUA }}
                aria-hidden
              >
                {['◉', '▦', '⌁', '◈', '◐', '◇'][i % 6]}
              </div>
              <div className="font-semibold mt-3">{s.title}</div>
              <div className="text-xs text-slate-500 mt-1 line-clamp-2">{s.meta_description}</div>
              <div className="text-xs font-semibold mt-4">Learn more →</div>
            </a>
          ))}
        </div>
      </section>

      {/* FAQ accordion + areas */}
      <section
        className="grid md:grid-cols-[55%_45%] border-t"
        style={{ background: PAPER_2, borderColor: BORDER }}
      >
        <div className="px-6 md:px-10 py-10">
          <h2 className="text-2xl font-bold">Common questions</h2>
          <div className="flex flex-col gap-2 mt-4">
            {faqs.length === 0 ? (
              <p className="text-sm text-slate-500">FAQ posts will appear here once published.</p>
            ) : (
              faqs.map((q, i) => (
                <details
                  key={q.slug}
                  className="rounded-xl p-3 text-sm"
                  style={{ background: PAPER }}
                  open={i === 0}
                >
                  <summary className="font-medium cursor-pointer flex items-center justify-between">
                    <span>{q.title}</span>
                    <span style={{ color: AQUA }}>+</span>
                  </summary>
                  <p className="mt-2 text-slate-600">{q.meta_description}</p>
                </details>
              ))
            )}
          </div>
        </div>
        <div className="px-6 md:px-10 py-10">
          <h2 className="text-2xl font-bold">Service areas</h2>
          <div className="flex flex-wrap gap-2 mt-4">
            {[bundle.city, ...bundle.nearby_cities, ...bundle.service_areas.map((a) => a.title)]
              .filter((c, i, arr) => c && arr.indexOf(c) === i)
              .slice(0, 10)
              .map((c) => (
                <span
                  key={c}
                  className="px-3 py-2 rounded-full border text-sm"
                  style={{ background: PAPER, borderColor: BORDER }}
                >
                  {c}
                </span>
              ))}
          </div>
        </div>
      </section>

      {/* CTA panel */}
      <section className="px-6 md:px-12 py-10 text-center" style={{ background: AQUA }}>
        <h2 className="text-2xl md:text-3xl font-bold">Ready for a quote?</h2>
        <p className="text-sm mt-1">15-min phone call, no pressure.</p>
        <a
          href={tel}
          className="inline-flex items-center gap-2 mt-4 px-5 py-3 rounded-full font-semibold tabular-nums"
          style={{ background: INK, color: PAPER }}
        >
          ☎ {phone}
        </a>
      </section>

      <StickyMobileBar
        phone={phone}
        cta="Get quote"
        ctaHref="/contact"
        bg={INK}
        fg={PAPER}
        ctaBg={AQUA}
        ctaFg={INK}
      />
    </div>
  );
}
