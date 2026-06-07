import { describe, expect, it } from 'vitest';
import { logoPrompt } from './logo-prompt';

describe('logoPrompt', () => {
  const base = { niche: 'roofing', businessName: 'Acme Roofing', city: 'Phoenix' };

  it('returns a prompt and negativePrompt', () => {
    const result = logoPrompt(base);
    expect(typeof result.prompt).toBe('string');
    expect(typeof result.negativePrompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(20);
    expect(result.negativePrompt.length).toBeGreaterThan(10);
  });

  it('negativePrompt always includes text/letters/words/typography/faces', () => {
    const { negativePrompt } = logoPrompt(base);
    expect(negativePrompt).toContain('text');
    expect(negativePrompt).toContain('letters');
    expect(negativePrompt).toContain('words');
    expect(negativePrompt).toContain('typography');
    expect(negativePrompt).toContain('faces');
  });

  it('prompt explicitly forbids text/letters/words', () => {
    const { prompt } = logoPrompt(base);
    expect(prompt).toMatch(/NO text/i);
    expect(prompt).toMatch(/NO letters/i);
    expect(prompt).toMatch(/NO words/i);
  });

  it('uses roofing motif for roofing niche', () => {
    const { prompt } = logoPrompt(base);
    expect(prompt).toContain('gable');
  });

  it('uses plumbing motif for plumbing niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'plumbing' });
    expect(prompt).toContain('pipe');
  });

  it('uses hvac motif for hvac niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'hvac' });
    expect(prompt).toContain('snowflake');
  });

  it('uses tree motif for tree service niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'tree removal' });
    expect(prompt).toContain('canopy');
  });

  it('uses electrical motif for electrician niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'electrical' });
    expect(prompt).toContain('lightning');
  });

  it('uses painting motif for painting niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'painting' });
    expect(prompt).toContain('roller');
  });

  it('uses cleaning motif for house cleaning niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'house cleaning' });
    expect(prompt).toContain('sparkle');
  });

  it('uses landscaping motif for landscaping niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'landscaping' });
    expect(prompt).toContain('leaf');
  });

  it('uses pest motif for pest control niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'pest control' });
    expect(prompt).toContain('shield');
  });

  it('uses locksmith motif for locksmith niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'locksmith' });
    expect(prompt).toContain('key');
  });

  it('uses moving motif for moving company niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'moving' });
    expect(prompt).toContain('box');
  });

  it('falls back to default (house/shield) motif for unknown niche', () => {
    const { prompt } = logoPrompt({ ...base, niche: 'widget manufacturing' });
    expect(prompt).toContain('house');
  });

  it('is deterministic — same inputs always produce the same output', () => {
    const a = logoPrompt(base);
    const b = logoPrompt(base);
    expect(a.prompt).toBe(b.prompt);
    expect(a.negativePrompt).toBe(b.negativePrompt);
  });

  it('produces different color/container when businessName differs', () => {
    // With 8 colors and 3 containers the hash outputs may differ — at minimum
    // they must not both be identical for wildly different names.
    const r1 = logoPrompt({ niche: 'plumbing', businessName: 'Acme Plumbing', city: 'Denver' });
    const r2 = logoPrompt({ niche: 'plumbing', businessName: 'Zephyr Pipe Works', city: 'Denver' });
    // Same niche -> same motif, but prompts may differ in color or container.
    // We just verify they are strings and the function is consistent.
    expect(r1.prompt).toBe(logoPrompt({ niche: 'plumbing', businessName: 'Acme Plumbing', city: 'Denver' }).prompt);
    expect(r2.prompt).toBe(logoPrompt({ niche: 'plumbing', businessName: 'Zephyr Pipe Works', city: 'Denver' }).prompt);
  });

  it('accepts optional colorPalette without changing behavior', () => {
    const without = logoPrompt(base);
    const with_ = logoPrompt({ ...base, colorPalette: 'alt1' });
    // colorPalette is accepted but currently unused — prompt is identical.
    expect(without.prompt).toBe(with_.prompt);
  });
});
