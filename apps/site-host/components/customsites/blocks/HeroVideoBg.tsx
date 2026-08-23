'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  type?: string | null;
}

/**
 * Autoplaying silent loop layered over the hero's background image.
 *
 * Client-side on purpose: `prefers-reduced-motion` cannot be honored by hiding
 * the element in CSS, because a hidden <video> still downloads and decodes.
 * Mounting it only when motion is welcome means reduced-motion visitors get the
 * poster image and pay nothing for the video. The image underneath is server
 * rendered, so there is no flash before this mounts and no-JS still sees a hero.
 */
export function HeroVideoBg({ src, type }: Props) {
  const [play, setPlay] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPlay(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Publish the clip's real aspect ratio to the section so the hero can size
  // itself to the video instead of cropping it. The CSS carries a 16/9 default
  // for the window before metadata lands; only the section can hold the custom
  // property, since the ::before spacer that reads it lives there.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const section = video.closest<HTMLElement>('.cs-hero');
    if (!section) return;

    const publish = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      section.style.setProperty('--cs-hero-video-ar', `${video.videoWidth} / ${video.videoHeight}`);
    };
    publish();
    video.addEventListener('loadedmetadata', publish);
    return () => {
      video.removeEventListener('loadedmetadata', publish);
      section.style.removeProperty('--cs-hero-video-ar');
    };
  }, [play]);

  if (!play) return null;

  return (
    <video
      ref={ref}
      className="cs-hero-video"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    >
      <source src={src} type={type ?? 'video/mp4'} />
    </video>
  );
}
