'use client';

import { icons } from 'lucide-react';

interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

/** Render a lucide icon by kebab-case or PascalCase name. */
export function Icon({ name, size = 20, className }: IconProps) {
  // Convert kebab-case to PascalCase: "arrow-right" -> "ArrowRight"
  const pascal = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  const Cmp = icons[pascal as keyof typeof icons];
  if (!Cmp) return null;
  return <Cmp size={size} className={className} aria-hidden="true" />;
}
