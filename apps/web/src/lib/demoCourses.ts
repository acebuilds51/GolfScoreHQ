import type { LookupCourse } from './api';

// Made-up courses so the lookup can be tried in demo mode without an API key.
const hole = (par: number, yardage: number, handicap: number) => ({ par, yardage, handicap });

export const DEMO_COURSES: LookupCourse[] = [
  {
    id: 'demo-maple', clubName: 'Maple Hills Golf Club', courseName: 'Championship', city: 'Troy', state: 'MI',
    tees: [
      {
        gender: 'male', name: 'Blue', rating: 72.4, slope: 133, parTotal: 72,
        holes: [hole(4, 402, 7), hole(5, 531, 3), hole(3, 176, 17), hole(4, 418, 1), hole(4, 365, 11), hole(4, 389, 5), hole(3, 162, 15), hole(5, 515, 9), hole(4, 377, 13),
          hole(4, 395, 8), hole(5, 548, 2), hole(3, 189, 18), hole(4, 404, 6), hole(4, 351, 10), hole(3, 171, 16), hole(4, 428, 4), hole(5, 502, 12), hole(4, 368, 14)],
      },
      {
        gender: 'male', name: 'White', rating: 70.1, slope: 126, parTotal: 72,
        holes: [hole(4, 372, 7), hole(5, 498, 3), hole(3, 152, 17), hole(4, 391, 1), hole(4, 338, 11), hole(4, 360, 5), hole(3, 141, 15), hole(5, 486, 9), hole(4, 349, 13),
          hole(4, 366, 8), hole(5, 515, 2), hole(3, 165, 18), hole(4, 377, 6), hole(4, 322, 10), hole(3, 148, 16), hole(4, 399, 4), hole(5, 471, 12), hole(4, 340, 14)],
      },
      {
        gender: 'female', name: 'Red', rating: 70.8, slope: 122, parTotal: 72,
        holes: [hole(4, 322, 5), hole(5, 431, 1), hole(3, 118, 17), hole(4, 340, 3), hole(4, 288, 11), hole(4, 310, 7), hole(3, 112, 15), hole(5, 420, 9), hole(4, 298, 13),
          hole(4, 315, 6), hole(5, 452, 2), hole(3, 131, 18), hole(4, 326, 4), hole(4, 276, 10), hole(3, 120, 16), hole(4, 344, 8), hole(5, 410, 12), hole(4, 292, 14)],
      },
    ],
  },
  {
    id: 'demo-pine', clubName: 'Pine Creek Golf Course', courseName: 'Executive Nine', city: 'Holly', state: 'MI',
    tees: [
      { gender: 'male', name: 'White', rating: 33.1, slope: 112, parTotal: 34, holes: [hole(4, 341, 3), hole(3, 155, 7), hole(4, 362, 1), hole(4, 318, 5), hole(3, 140, 9), hole(4, 335, 4), hole(4, 352, 2), hole(3, 168, 8), hole(5, 455, 6)] },
    ],
  },
];
