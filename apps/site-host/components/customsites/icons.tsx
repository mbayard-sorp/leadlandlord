import type { CsValuePropIcon } from '@/lib/customsites-sanity';

/**
 * Custom Sites inline icon set. Authors pick an icon BY NAME in Sanity
 * (csValuePropsBlock.items[].icon, csPublication.listenLinks[].platform) — no
 * uploads, no icon font, no CDN. 24x24, 1.5px stroke, currentColor, so every
 * icon inherits the surrounding text color and stays crisp at any scale.
 */

interface IconProps {
  className?: string;
}

function base(props: IconProps) {
  return {
    className: props.className,
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function TeamIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M16 14.75c2.6.2 4.5 1.9 4.5 4.25" />
    </svg>
  );
}

export function PracticeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="7" width="17" height="12.5" rx="1.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3.5 12h17" />
      <path d="M12 10.5v3" />
    </svg>
  );
}

export function RoadmapIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 18.5c4.5 0 4.5-6 9-6s4.5-6 7-6" />
      <circle cx="4" cy="18.5" r="1.75" />
      <circle cx="20" cy="6.5" r="1.75" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-2.5Z" />
      <path d="m9 11.5 2.25 2.25L15.5 9.5" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4v16h16" />
      <path d="M8 15v-4" />
      <path d="M12 15V8" />
      <path d="M16 15v-6.5" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function PodcastIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9.25" y="4" width="5.5" height="10" rx="2.75" />
      <path d="M6 11.5a6 6 0 0 0 12 0" />
      <path d="M12 17.5V20" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m7 17 10-10" />
      <circle cx="16" cy="8" r="3.5" />
      <path d="m6.5 17.5-2 2M8.5 19l-1.5 1.5" />
    </svg>
  );
}

export function DocIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 3.5h7L18.5 8v12.5h-11.5Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9.5 12.5h5M9.5 15.5h5" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 7.5v9l7.5-4.5L9 7.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Platform marks for listen links. Simplified single-path glyphs drawn for
 * this repo (used per each platform's brand guidelines as identifying marks,
 * monochrome, next to the platform name). */
export function SpotifyGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 10.2c2.8-.8 5.6-.5 8 .9M8.4 12.9c2.3-.6 4.5-.3 6.5.8M8.8 15.4c1.8-.4 3.4-.2 5 .6" />
    </svg>
  );
}

export function AppleGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="10.5" r="2.5" />
      <path d="M10 19.5c-.4-2.4.4-4.25 2-4.25s2.4 1.85 2 4.25" />
      <circle cx="12" cy="12" r="8.5" />
    </svg>
  );
}

export function YoutubeGlyph(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="6.5" width="17" height="11" rx="3" />
      <path d="M10.5 9.75v4.5l4-2.25-4-2.25Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ReportIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 3.5h7L18 8v12.5H6.5Z" />
      <path d="M13.5 3.5V8H18" />
      {/* Bars, short to tall — a benchmark report reads as data, not prose. */}
      <path d="M9.75 16.5v-2.25M12.25 16.5v-4M14.75 16.5v-3" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v10" />
      <path d="M8.25 10.75 12 14.5l3.75-3.75" />
      <path d="M5 17.5v1.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1.5" />
    </svg>
  );
}

const VALUE_PROP_ICONS: Record<CsValuePropIcon, (props: IconProps) => React.JSX.Element> = {
  team: TeamIcon,
  practice: PracticeIcon,
  roadmap: RoadmapIcon,
  shield: ShieldIcon,
  chart: ChartIcon,
  clock: ClockIcon,
};

/** Icon component for a csValuePropsBlock icon name, or null for unknown/empty. */
export function ValuePropIcon({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return null;
  const Icon = VALUE_PROP_ICONS[name as CsValuePropIcon];
  return Icon ? <Icon className={className} /> : null;
}

const PLATFORM_GLYPHS: Record<string, (props: IconProps) => React.JSX.Element> = {
  spotify: SpotifyGlyph,
  apple: AppleGlyph,
  youtube: YoutubeGlyph,
};

export const PLATFORM_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  apple: 'Apple Podcasts',
  youtube: 'YouTube',
};

/** Glyph for a listen-link platform, or null (the "other" platform has no mark). */
export function PlatformGlyph({ platform, className }: { platform?: string | null; className?: string }) {
  if (!platform) return null;
  const Icon = PLATFORM_GLYPHS[platform];
  return Icon ? <Icon className={className} /> : null;
}

const INSIGHTS_TAB_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  podcast: PodcastIcon,
  mic: MicIcon,
  doc: DocIcon,
};

/** Icon for a csTabbedInsightsBlock tab, or null for unknown/empty. */
export function InsightsTabIcon({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return null;
  const Icon = INSIGHTS_TAB_ICONS[name];
  return Icon ? <Icon className={className} /> : null;
}
