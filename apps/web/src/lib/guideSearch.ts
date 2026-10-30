import { GUIDES, type Guide, type GuideChapter } from '../../../../supabase/functions/ask-help/guide';
import { words } from '../../../../supabase/functions/ask-help/manual';

export interface GuideMatch {
  guide: Guide;
  chapter: GuideChapter;
}

const CHAPTERS = GUIDES.flatMap((guide) => guide.chapters.map((chapter) => ({ guide, chapter })));

/** The user's guide chapters that best match a search, best first: so "what do I do first" finds "Set up your league". */
export function searchGuide(query: string, limit = 2): GuideMatch[] {
  const want = [...new Set(words(query))];
  if (!want.length) return [];
  return CHAPTERS
    .map((m) => {
      const title = words(m.chapter.title);
      const intro = words(m.chapter.intro);
      const tags = words(m.chapter.tags ?? '');
      const steps = words(m.chapter.steps.map((s) => s.text).join(' '));
      const score = want.reduce((sum, w) => sum + (title.includes(w) ? 3 : 0) + (tags.includes(w) ? 2 : 0) + (intro.includes(w) ? 2 : 0) + (steps.includes(w) ? 1 : 0), 0);
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .filter((x, _, all) => x.score * 2 >= all[0]!.score)
    .slice(0, limit)
    .map((x) => x.m);
}

/** /guide link for a chapter. */
export const guideHref = ({ guide, chapter }: GuideMatch) => `/guide${guide.id === 'golfers' ? '?for=golfers' : ''}#${chapter.id}`;
