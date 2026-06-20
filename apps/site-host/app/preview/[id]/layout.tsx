import { draftMode } from 'next/headers';
import { SanityLive } from '@/lib/sanity-live';
import { VisualEditing } from 'next-sanity/visual-editing';
import { DisableDraftMode } from '@/components/DisableDraftMode';

export default async function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isEnabled } = await draftMode();

  return (
    <>
      {children}
      <SanityLive />
      {isEnabled && (
        <>
          <VisualEditing />
          <DisableDraftMode />
        </>
      )}
    </>
  );
}
