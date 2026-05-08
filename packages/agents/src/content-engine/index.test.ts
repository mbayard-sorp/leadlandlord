import { describe, expect, it } from 'vitest';
import { loadNicheOverlay, composeSystemPrompt } from './index';

describe('content-engine niche overlays', () => {
  it('loadNicheOverlay returns non-empty content with Terminology section for classic', () => {
    const overlay = loadNicheOverlay('classic');
    expect(overlay).not.toBeNull();
    expect(overlay!.length).toBeGreaterThan(500);
    expect(overlay!).toContain('Terminology');
  });

  it('all four theme keys map to non-empty overlays', () => {
    for (const theme of ['classic', 'modern', 'premium', 'bright']) {
      const overlay = loadNicheOverlay(theme);
      expect(overlay, `overlay for ${theme}`).not.toBeNull();
      expect(overlay!).toContain('Terminology');
      expect(overlay!).toContain('Seasonal Patterns');
      expect(overlay!).toContain('Regulations');
      expect(overlay!).toContain('Pain Points');
      expect(overlay!).toContain('Objections');
      expect(overlay!).toContain('Tone Notes');
    }
  });

  it('each theme overlay contains its own distinguishing heading', () => {
    expect(loadNicheOverlay('classic')!).toContain('Trade-Classic');
    expect(loadNicheOverlay('modern')!).toContain('Modern-Tech');
    expect(loadNicheOverlay('premium')!).toContain('Premium-Craft');
    expect(loadNicheOverlay('bright')!).toContain('Bright-Friendly');
  });

  it('unknown theme returns null', () => {
    expect(loadNicheOverlay('not-a-real-theme')).toBeNull();
    expect(loadNicheOverlay('')).toBeNull();
  });

  it('composeSystemPrompt with no theme returns base prompt only', () => {
    const base = composeSystemPrompt(undefined);
    expect(base.length).toBeGreaterThan(0);
    expect(base).not.toContain('Trade-Classic Overlay');
  });

  it('composeSystemPrompt with unknown theme falls back to base prompt', () => {
    const base = composeSystemPrompt(undefined);
    const unknown = composeSystemPrompt('nonsense');
    expect(unknown).toBe(base);
  });

  it('composeSystemPrompt with classic includes overlay separated by divider', () => {
    const composed = composeSystemPrompt('classic');
    expect(composed).toContain('\n\n---\n\n');
    expect(composed).toContain('Trade-Classic Overlay');
  });

  it('composeSystemPrompt produces different content per theme', () => {
    const classic = composeSystemPrompt('classic');
    const modern = composeSystemPrompt('modern');
    const premium = composeSystemPrompt('premium');
    const bright = composeSystemPrompt('bright');
    expect(new Set([classic, modern, premium, bright]).size).toBe(4);
  });
});
