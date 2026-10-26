// Turns GolfCourseAPI responses into the small shapes the app uses.
// Pure functions: shared by the server function (Deno) and the app's tests.

export interface CourseSummary {
  id: string;
  clubName: string;
  courseName: string;
  city: string | null;
  state: string | null;
}

export interface LookupHole {
  par: number;
  yardage: number | null;
  /** Stroke index across the full layout (1 = hardest). */
  handicap: number | null;
}

export interface LookupTee {
  gender: 'male' | 'female';
  name: string;
  rating: number | null;
  slope: number | null;
  parTotal: number | null;
  holes: LookupHole[];
}

export interface LookupCourse extends CourseSummary {
  tees: LookupTee[];
}

type Raw = Record<string, any>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function normalizeSummary(c: Raw): CourseSummary | null {
  const id = c?.id != null ? String(c.id) : null;
  if (!id) return null;
  const clubName = str(c.club_name) ?? str(c.course_name) ?? 'Unnamed course';
  return {
    id,
    clubName,
    courseName: str(c.course_name) ?? clubName,
    city: str(c.location?.city),
    state: str(c.location?.state),
  };
}

function normalizeTee(t: Raw, gender: 'male' | 'female'): LookupTee | null {
  const holes: LookupHole[] = (Array.isArray(t?.holes) ? t.holes : [])
    .map((h: Raw) => ({ par: num(h?.par), yardage: num(h?.yardage), handicap: num(h?.handicap) }))
    .filter((h: { par: number | null }) => h.par !== null && h.par >= 3 && h.par <= 6) as LookupHole[];
  if (holes.length !== 9 && holes.length !== 18) return null;
  return {
    gender,
    name: str(t.tee_name) ?? 'Tees',
    rating: num(t.course_rating),
    slope: num(t.slope_rating),
    parTotal: num(t.par_total) ?? holes.reduce((s, h) => s + h.par, 0),
    holes,
  };
}

export function normalizeCourse(raw: Raw): LookupCourse | null {
  const c = raw?.course ?? raw;
  const summary = normalizeSummary(c);
  if (!summary) return null;
  const tees: LookupTee[] = [];
  for (const gender of ['male', 'female'] as const) {
    for (const t of Array.isArray(c?.tees?.[gender]) ? c.tees[gender] : []) {
      const tee = normalizeTee(t, gender);
      if (tee) tees.push(tee);
    }
  }
  return { ...summary, tees };
}

export function normalizeSearch(raw: Raw): CourseSummary[] {
  const list: Raw[] = Array.isArray(raw?.courses) ? raw.courses : Array.isArray(raw) ? raw : [];
  return list.map(normalizeSummary).filter((c): c is CourseSummary => c !== null).slice(0, 25);
}
