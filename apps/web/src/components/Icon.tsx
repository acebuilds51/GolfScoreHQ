// A few outline icons (24px grid, 2px stroke) so the app needs no icon library.
const PATHS = {
  home: 'M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6',
  flag: 'M12 18V3l7 4-7 4M9 17.67C7.21 18.2 6 19.2 6 20.33 6 22 8.69 23 12 23s6-1 6-2.67c0-1.13-1.21-2.13-3-2.66',
  podium: 'M8 21V11h8v10M3 21v-6h5M16 21V7h5v14M2 21h20M11.5 5.5 12 3l.5 2.5',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M6 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4',
  download: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12',
  chevron: 'M9 6l6 6-6 6',
  users: 'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85',
  map: 'M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13',
  settings: 'M10.3 4.3c.4-1.8 3-1.8 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.4 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1c-1.5.9-3.3-.9-2.4-2.4a1.7 1.7 0 0 0-1-2.6c-1.8-.4-1.8-3 0-3.4a1.7 1.7 0 0 0 1-2.6c-.9-1.5.9-3.3 2.4-2.4a1.7 1.7 0 0 0 2.6-1M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  trophy: 'M8 21h8M12 17v4M7 4h10M17 4v8a5 5 0 0 1-10 0V4M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  install: 'M12 3v12M8 11l4 4 4-4M5 21h14',
  help: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
