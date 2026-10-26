// AI write-up for the weekly recap email. No imports, so it's easy to test and
// the app can share the limits. The commissioner reviews and can edit the
// draft before anything is sent; the results below it always come from the
// scoring engine, never from the AI.

export const STORY_MAX_CHARS = 1200;
export const DEFAULT_STORY_MODEL = 'claude-opus-5-5';

const SYSTEM = `You write the opening of a golf league's weekly recap email, read by the golfers themselves.

Write 2 short paragraphs, 60 to 110 words in total. Make it fun to read: the voice of a witty clubhouse regular, with playful, good-natured ribbing and a little drama about how the week went. Lead with the best story of the week (an ace or eagle, a big skins haul, a lopsided or nail-biting match, the low round).

Rules:
- Use only facts in the results you're given. Never invent shots, distances, quotes, weather, scores or anything else.
- Refer to golfers by first name only.
- Keep teasing light and about golf only, never about anyone's looks, age, money troubles or life off the course. Don't single out who lost money or how much anyone owes.
- Plain text only: no title, no greeting, no sign-off, no hashtags, no emoji, no markdown.`;

/** The request body for Anthropic's Messages API. */
export function storyRequest(input: { leagueName: string; weekNumber: number; recapBody: string; model?: string }) {
  return {
    model: input.model || DEFAULT_STORY_MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `League: ${input.leagueName}\nWeek: ${input.weekNumber}\n\nThis week's results:\n\n${input.recapBody}\n\nWrite the opening now.`,
      },
    ],
  };
}

/** Pull the text out of a Messages API response. */
export function storyFromResponse(res: { content?: { type: string; text?: string }[] } | null): string | null {
  const text = (res?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  return text ? cleanStory(text) : null;
}

/** Tidy a draft or a commissioner's edit: plain paragraphs, length capped. */
export function cleanStory(s: string): string {
  const paras = s
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s*/, '').replace(/\*\*?|__/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let out = paras.join('\n\n');
  if (out.length > STORY_MAX_CHARS) out = out.slice(0, STORY_MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  return out;
}
