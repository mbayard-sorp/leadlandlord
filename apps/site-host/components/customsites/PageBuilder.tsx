import type { CsPageBuilderBlock } from '@/lib/customsites-sanity';
import { HeroBlock } from './blocks/HeroBlock';
import { IntroBlock } from './blocks/IntroBlock';
import { PracticeGridBlock } from './blocks/PracticeGridBlock';
import { AttorneyBlock } from './blocks/AttorneyBlock';
import { TestimonialsBlock } from './blocks/TestimonialsBlock';
import { BadgeRowBlock } from './blocks/BadgeRowBlock';
import { PublicationsBlock } from './blocks/PublicationsBlock';
import { CalloutBlock } from './blocks/CalloutBlock';
import { RichTextBlock } from './blocks/RichTextBlock';
import { ContactCtaBlock } from './blocks/ContactCtaBlock';
import { CtaBannerBlock } from './blocks/CtaBannerBlock';

interface Props {
  blocks: CsPageBuilderBlock[] | null | undefined;
  siteKey: string;
  phone?: string | null;
}

/** Switches over csPage.pageBuilder[]._type — the 11 Custom Sites blocks,
 * rendered in Sanity array order. Mirrors BuildSellHome's section switch. */
export function PageBuilder({ blocks, siteKey, phone }: Props) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <>
      {blocks.map((block) => {
        switch (block._type) {
          case 'csHeroBlock':
            return <HeroBlock key={block._key} block={block} phone={phone} />;
          case 'csIntroBlock':
            return <IntroBlock key={block._key} block={block} />;
          case 'csPracticeGridBlock':
            return <PracticeGridBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csAttorneyBlock':
            return <AttorneyBlock key={block._key} block={block} />;
          case 'csTestimonialsBlock':
            return <TestimonialsBlock key={block._key} block={block} />;
          case 'csBadgeRowBlock':
            return <BadgeRowBlock key={block._key} block={block} />;
          case 'csPublicationsBlock':
            return <PublicationsBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csCalloutBlock':
            return <CalloutBlock key={block._key} block={block} />;
          case 'csRichTextBlock':
            return <RichTextBlock key={block._key} block={block} />;
          case 'csContactCtaBlock':
            return <ContactCtaBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csCtaBannerBlock':
            return <CtaBannerBlock key={block._key} block={block} phone={phone} />;
          default:
            return null;
        }
      })}
    </>
  );
}
