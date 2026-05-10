interface Props {
  city: string;
  state: string;
  className?: string;
  height?: number;
  zoom?: number;
  title?: string;
}

export function MapEmbed({
  city,
  state,
  className,
  height = 360,
  zoom = 11,
  title,
}: Props) {
  const query = encodeURIComponent(`${city}, ${state}`);
  const src = `https://maps.google.com/maps?q=${query}&z=${zoom}&output=embed`;
  return (
    <iframe
      className={className}
      src={src}
      title={title ?? `Map of ${city}, ${state}`}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      style={{ width: '100%', height, border: 0, display: 'block' }}
      allowFullScreen
    />
  );
}
