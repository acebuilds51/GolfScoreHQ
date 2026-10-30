// "Ask a question" on the Help page: Claude answers from the Help page's own
// questions and answers (manual.ts). No imports, so it's easy to test and the
// app shares the limits.

export const ASK_MAX_CHARS = 600;
export const ASK_TURNS = 8;
export const DEFAULT_HELP_MODEL = 'claude-opus-5-5';

export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You answer questions about GolfScoreHQ, an app golf leagues use to run league night: scoring on phones, skins and closest to the pin, standings, tee sheets, and the weekly money. The people asking are league commissioners and golfers, many of them not comfortable with technology.

Answer only from the GolfScoreHQ help below. If the help doesn't cover the question, say you're not sure and suggest tapping "Send it to us" under your answer so a person can help. Never guess at buttons, screens, prices or features that the help doesn't mention.

How to answer:
- Short and plain: 1 to 4 sentences, or a few numbered steps when it's a how-to. Name the exact button or page (for example: Play tab, More → Roster, Settings → How golfers pay you).
- Say when something needs Pro.
- Plain text only: no markdown headings, bold, tables or links.
- GolfScoreHQ never moves money: golfers pay each other and the commissioner with Venmo, PayPal or Zelle themselves.
- Golf questions that aren't about the app (rules of golf, handicap math in general): answer briefly if you're sure, and say it's general golf knowledge, not something the app decides.`;

/** The conversation to send: the last few turns, user first, each trimmed. Null when there's nothing to ask. */
export function cleanConversation(raw: unknown): AskMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter((m): m is AskMessage => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, m.role === 'user' ? ASK_MAX_CHARS : 2000) }))
    .filter((m) => m.content)
    .slice(-ASK_TURNS);
  while (msgs.length && msgs[0]!.role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1]!.role !== 'user') return null;
  return msgs;
}

/** The request body for Anthropic's Messages API. The help text is cached: it's the same for every question. */
export function helpRequest(input: { manual: string; messages: AskMessage[]; model?: string }) {
  return {
    model: input.model || DEFAULT_HELP_MODEL,
    max_tokens: 4000,
    // Quick answers: a help desk question doesn't need deep thought.
    output_config: { effort: 'low' },
    // If the model declines, the API retries on a fallback model in the same call.
    fallbacks: 'default',
    system: [
      { type: 'text', text: SYSTEM },
      { type: 'text', text: `GolfScoreHQ help:\n\n${input.manual}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: input.messages,
  };
}

export const HELP_BETA = 'server-side-fallback-2026-07-01';

/** Pull the answer out of a Messages API response: plain text, markdown stripped. */
export function answerFromResponse(res: { content?: { type: string; text?: string }[]; stop_reason?: string | null } | null): string | null {
  if (res?.stop_reason === 'refusal') return null;
  const text = (res?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  if (!text) return null;
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/\*\*|__/g, '').replace(/^\s*[*-]\s+/, '• ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 3000);
}
