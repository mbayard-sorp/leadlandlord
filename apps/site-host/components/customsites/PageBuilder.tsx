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
import { FaqBlock } from './blocks/FaqBlock';
import { StatRailBlock } from './blocks/StatRailBlock';
import { ValuePropsBlock } from './blocks/ValuePropsBlock';
import { JourneyBlock } from './blocks/JourneyBlock';
import { CompareBlock } from './blocks/CompareBlock';
import { TeamGridBlock } from './blocks/TeamGridBlock';
import { FocusAreaListBlock } from './blocks/FocusAreaListBlock';
import { CaseStudyGridBlock } from './blocks/CaseStudyGridBlock';
import { NumbersIqBlock } from './blocks/NumbersIqBlock';
import { LeadMagnetBlock } from './blocks/LeadMagnetBlock';
import { TabbedInsightsBlock } from './blocks/TabbedInsightsBlock';
import { EpisodeListBlock } from './blocks/EpisodeListBlock';
import { AssessmentBlock } from './blocks/AssessmentBlock';
import { DisclosureBlock } from './blocks/DisclosureBlock';

interface Props {
  blocks: CsPageBuilderBlock[] | null | undefined;
  siteKey: string;
  phone?: string | null;
  /** Business name — csCompareBlock's "us" column falls back to it. */
  siteName?: string | null;
  /** Public path of the page rendering these blocks (e.g. "/insights") —
   * lets csTabbedInsightsBlock mark the active tab server-side. */
  currentPath?: string;
}

/** Switches over csPage.pageBuilder[]._type — the Custom Sites blocks,
 * rendered in Sanity array order. Mirrors BuildSellHome's section switch. */
export function PageBuilder({ blocks, siteKey, phone, siteName, currentPath }: Props) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <>
      {blocks.map((block) => {
        switch (block._type) {
          case 'csStatRailBlock':
            return <StatRailBlock key={block._key} block={block} />;
          case 'csValuePropsBlock':
            return <ValuePropsBlock key={block._key} block={block} />;
          case 'csJourneyBlock':
            return <JourneyBlock key={block._key} block={block} />;
          case 'csCompareBlock':
            return <CompareBlock key={block._key} block={block} siteName={siteName} />;
          case 'csTeamGridBlock':
            return <TeamGridBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csFocusAreaListBlock':
            return <FocusAreaListBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csCaseStudyGridBlock':
            return <CaseStudyGridBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csNumbersIqBlock':
            return <NumbersIqBlock key={block._key} block={block} />;
          case 'csLeadMagnetBlock':
            return <LeadMagnetBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csTabbedInsightsBlock':
            return <TabbedInsightsBlock key={block._key} block={block} currentPath={currentPath} />;
          case 'csEpisodeListBlock':
            return <EpisodeListBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csAssessmentBlock':
            return <AssessmentBlock key={block._key} block={block} siteKey={siteKey} />;
          case 'csDisclosureBlock':
            return <DisclosureBlock key={block._key} block={block} />;
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
          case 'csFaqBlock':
            return <FaqBlock key={block._key} block={block} phone={phone} />;
          default:
            return null;
        }
      })}
    </>
  );
}
