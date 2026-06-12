import { describe, it, expect } from 'vitest';
import { loadNicheKnowledge } from './niche-knowledge';

describe('loadNicheKnowledge', () => {
  it('returns a factual block with terminology + pain points for a known theme', () => {
    const block = loadNicheKnowledge('classic');
    expect(block).not.toBeNull();
    expect(block!).toMatch(/terminology/i);
    expect(block!).toMatch(/pain point/i);
  });

  it('maps each theme key to a non-empty overlay knowledge block', () => {
    for (const theme of ['classic', 'modern', 'premium', 'bright', 'haul', 'counsel']) {
      const block = loadNicheKnowledge(theme);
      expect(block, `knowledge for ${theme}`).not.toBeNull();
      expect(block!.length).toBeGreaterThan(100);
    }
  });

  it('caps the block at maxChars', () => {
    const block = loadNicheKnowledge('classic', 400);
    expect(block).not.toBeNull();
    expect(block!.length).toBeLessThanOrEqual(400);
  });

  it('returns null for an unknown theme or undefined', () => {
    expect(loadNicheKnowledge('nope')).toBeNull();
    expect(loadNicheKnowledge(undefined)).toBeNull();
  });
});
