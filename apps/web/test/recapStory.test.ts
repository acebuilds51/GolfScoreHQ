import { describe, expect, it } from 'vitest';
import { cleanStory, DEFAULT_STORY_MODEL, STORY_MAX_CHARS, storyFromResponse, storyRequest } from '../../../supabase/functions/send-recap/story';

describe('AI recap write-up', () => {
  it('asks for a short, fact-only write-up of the week', () => {
    const req = storyRequest({ leagueName: 'Maple', weekNumber: 3, recapBody: 'SKINS\n  Hole 1: Al Adams (+$90)' });
    expect(req.model).toBe(DEFAULT_STORY_MODEL);
    expect(req.system).toMatch(/only facts/i);
    expect(req.system).toMatch(/first name/i);
    expect(req.messages[0]!.content).toContain('Week: 3');
    expect(req.messages[0]!.content).toContain('Hole 1: Al Adams (+$90)');
    expect(storyRequest({ leagueName: 'M', weekNumber: 1, recapBody: '', model: 'other-model' }).model).toBe('other-model');
  });

  it('reads the text from the response and tidies it', () => {
    expect(storyFromResponse({ content: [{ type: 'text', text: '## Week 3\n\n**Al** went  low.\n\n\nBob   did not.' }] })).toBe('Week 3\n\nAl went low.\n\nBob did not.');
    expect(storyFromResponse({ content: [] })).toBeNull();
    expect(storyFromResponse(null)).toBeNull();
  });

  it('caps the length at a word boundary', () => {
    const s = cleanStory('birdie '.repeat(400));
    expect(s.length).toBeLessThanOrEqual(STORY_MAX_CHARS + 1);
    expect(s.endsWith('birdie…')).toBe(true);
  });
});
