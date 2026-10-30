// The user's guide: the season from start to finish, step by step, one guide
// for commissioners and one for golfers. The app shows it on /guide, and the
// ask-help function hands it to Claude along with the Help page. No imports,
// so both can use it. Quote the buttons exactly as the app shows them.

export type GuideFor = 'commissioners' | 'golfers';

export interface GuideStep {
  text: string;
  /** A Help answer with more detail: /help#<id>. */
  help?: string;
  /** Needs Pro (or the Course plan, or a pilot league). */
  pro?: boolean;
}

export interface GuideChapter {
  id: string;
  title: string;
  intro: string;
  steps: GuideStep[];
  tip?: string;
  /** Other words people search with. */
  tags?: string;
}

export interface Guide {
  id: GuideFor;
  title: string;
  intro: string;
  chapters: GuideChapter[];
}

/** Where things are, for both guides: the tabs differ between a phone and a computer. */
export const FINDING_YOUR_WAY =
  'On a phone, the bar at the bottom has Home, Play, Live, Standings and More; Roster, Courses, Settings and Awards are under More. On a computer the same pages run along the top, and Home is called Overview.';

export const GUIDES: Guide[] = [
  {
    id: 'commissioners',
    title: "Commissioner's guide",
    intro: 'Running a league on GolfScoreHQ, in the order a season happens: set it up, get your golfers in, run league night, settle up, and start again next year.',
    chapters: [
      {
        id: 'set-up',
        title: 'Set up your league',
        intro: 'About ten minutes. You need your course, your league night and a list of your golfers.',
        tags: 'start begin first new commissioner getting started create step by step how to',
        steps: [
          { text: 'Go to golfscorehq.app, enter your email and tap "Email me a sign-in code". Type the code from the email. There is no password.', help: 'sign-in' },
          { text: 'On Your leagues, fill in "Create a league" with your league\'s name and tap "Create league".', help: 'create-league' },
          { text: 'You land on the setup questions. Your course: search for it, pick the tees you play and tap "Use these tees". Check the pars against your scorecard.', help: 'add-course' },
          { text: 'How you play: pick the format, then answer the side game and money questions (skins, closest to the pin, the match bet and presses).', help: 'formats' },
          { text: 'When you play: the season, league night, how many weeks and the first league night. Untick any night you\'re not playing and the rest move along a week. With Pro, set tee times here too.', help: 'setup-questions' },
          { text: 'Your golfers: paste your list, one golfer per line, like "Mike Walsh, mike@example.com" or "Chris Lee, sub".', help: 'add-golfers' },
          { text: 'Check and build shows everything that will be made. Tap "Build my league".' },
        ],
        tip: 'Skip any question and come back later: the "Set up your league" checklist on Home links to each step. Rather not type it in at all? "Send my answers to GolfScoreHQ" on the last step, or More → "We set up your league", and we do it for you (Pro).',
      },
      {
        id: 'golfers-in',
        title: 'Get your golfers into the app',
        intro: 'Golfers need to join so they can score, see results and say if they\'re playing.',
        steps: [
          { text: 'On the Roster, tap "Invite golfers by text" for one text for everyone, or "Invite" next to a golfer for their own link. Each link works once and lasts 30 days.', help: 'invite-golfers' },
          { text: 'Or set a league code in Settings → "League code". Golfers type it on Your leagues under "Join with a code", and you approve each request.', help: 'join-league' },
          { text: 'Tell golfers to put GolfScoreHQ on their phone\'s home screen (More → "Put GolfScoreHQ on your home screen") and turn on notifications on Home.', help: 'home-screen' },
          { text: 'Decide what golfers see in Settings → "What golfers see": season money, phone numbers and emails each have their own switch.', help: 'share-contacts' },
        ],
        tip: 'The Roster shows who hasn\'t joined yet. A golfer who signs in with a different email than the one you have won\'t be matched: check the email on their Roster entry.',
      },
      {
        id: 'money',
        title: 'Side games and money',
        intro: 'GolfScoreHQ works out who won what. It never holds or moves money: everyone pays with Venmo, PayPal or Zelle themselves.',
        steps: [
          { text: 'Play tab → "Edit format" → "Side games and money": the match bet and press per man, skins with the pot and what happens on a tie, closest to the pin on par 3s.', help: 'side-games', pro: true },
          { text: 'Settings → "How golfers pay you": your Venmo, PayPal.me or Zelle, so golfers\' pay buttons go to you.', help: 'commish-handles', pro: true },
          { text: 'Collect money up front? Set the amount under "Season dues" on the Play tab and tick off golfers as they pay.', help: 'season-dues', pro: true },
          { text: 'Settings → "Match and press money": by default golfers settle match money with each other. Switch it if it goes through you.', help: 'who-pays-whom', pro: true },
          { text: 'Ask golfers to fill in "How you get paid" on Home so you can pay their winnings in one tap.', help: 'my-venmo', pro: true },
        ],
      },
      {
        id: 'week-before',
        title: 'The week before league night',
        intro: 'Know who\'s playing and fill the groups before you get to the course.',
        steps: [
          { text: 'Set tee times once on the Play tab ("Set tee times"): the first tee, minutes apart and how many. Every week gets them, and golfers join groups themselves.', help: 'tee-times', pro: true },
          { text: 'Turn on the "Are you playing?" emails in Settings. They go out at 9 AM before league night with one-tap answers.', help: 'rsvp', pro: true },
          { text: 'Open the week to see who\'s in, who\'s out and who needs a partner or a match.', pro: true },
          { text: 'Short a golfer? On the week page tap "Find a sub" and pick who to ask. The first "I\'ll play" gets the spot.', help: 'sub-finder', pro: true },
        ],
        tip: 'On the free plan there\'s no tee sheet: golfers just show up and each group starts its own card on the night.',
      },
      {
        id: 'league-night',
        title: 'League night',
        intro: 'One person in each group keeps the card on their phone.',
        steps: [
          { text: 'Play tab → this week → "Start scoring a group". Pick the tee time and the golfers, then "Start scoring".', help: 'start-scoring' },
          { text: 'A sub showed up? Tap "Add a sub" when starting the group.', help: 'add-sub' },
          { text: 'Enter each hole with + and −, then "Next hole →". Presses and closest to the pin are on the card too.', help: 'presses' },
          { text: 'No signal? Keep scoring. The scores send themselves when the phone gets signal back.', help: 'no-signal' },
          { text: 'At the end, "Review scores", then "Submit scores".' },
          { text: 'Everyone can follow along on the Live tab, or on the clubhouse TV.', help: 'live' },
          { text: 'Rained out? On the week page tap "Mark as rainout".', help: 'rainout' },
        ],
      },
      {
        id: 'settle',
        title: 'After the round: settle up',
        intro: 'When every group has submitted, make the week final.',
        steps: [
          { text: 'Open the week, tap "Settle the week", check the results, then "Settle and post results". The week shows Final for everyone.', help: 'settle-week', pro: true },
          { text: 'Pay the winners: "Pay out week N" lists each winner. "Pay with Venmo" fills in the golfer, amount and note; tick "Paid" when it\'s done.', help: 'pay-out', pro: true },
          { text: 'Tap "Email the recap" to send everyone the results and what they won or owe. "Write it up with AI" drafts an opening you can edit.', help: 'recap-email', pro: true },
          { text: 'Share it with the group text: "Winner card" or "League results" makes a picture.', help: 'share-week' },
        ],
        tip: 'Found a mistake after settling? "Reopen week", fix the card, and settle again.',
      },
      {
        id: 'season',
        title: 'Through the season',
        intro: 'The little jobs that come up between league nights.',
        steps: [
          { text: 'Standings: sort by Money, Points, Average, Hot, Wins, Skins or CTP. Tap a golfer for their rounds.', help: 'standings' },
          { text: 'Roster changes: "Make sub", "Make regular" or "Deactivate" (history is kept). Golfer on there twice? "Merge into one".', help: 'subs-regulars' },
          { text: 'A scramble night mid-season: open the week and tap "Make this a scramble week".', help: 'scramble-week', pro: true },
          { text: 'Need help running it? Settings → "Members", make someone a co-commissioner.', help: 'co-commissioner', pro: true },
          { text: 'Put the leaderboard on the clubhouse TV: Settings → "Clubhouse TV" → "Create a TV link".', help: 'tv', pro: true },
        ],
      },
      {
        id: 'next-season',
        title: 'End of the season, and next year',
        intro: 'Wrap it up and start again without setting everything up twice.',
        steps: [
          { text: 'More → "Season awards and stats", then "Make the awards picture" for the group text.', help: 'awards', pro: true },
          { text: 'Play tab → "Start the … season" (the button names next year, like "Start the 2028 season"). It copies your format, side games, league night and tee times.', help: 'next-season' },
          { text: 'Tap "Add the season\'s weeks", update the roster, and invite any new golfers.' },
        ],
        tip: 'Last season stays in Standings and Awards. Looking back at past seasons needs Pro.',
      },
      {
        id: 'help',
        title: 'When you\'re stuck',
        intro: 'Three ways to get an answer.',
        steps: [
          { text: 'The Help page (golfscorehq.app/help) has answers to the common questions, with search.' },
          { text: '"Ask a question" at the bottom of the Help page answers in plain English. If it isn\'t sure, tap "Send it to us" and a person emails you back.' },
          { text: 'Something broken? More → "Report a problem".', help: 'report' },
        ],
      },
    ],
  },
  {
    id: 'golfers',
    title: "Golfer's guide",
    intro: 'Everything a golfer does on GolfScoreHQ: join, say you\'re playing, score your group, and see what you won.',
    chapters: [
      {
        id: 'join',
        title: 'Join your league',
        intro: 'Two minutes, once.',
        tags: 'start begin first new golfer player getting started sign up',
        steps: [
          { text: 'Open the invite link your commissioner sent and tap "Email me a code to join". Type the code from the email and you\'re in.', help: 'join-league' },
          { text: 'Got a 6-letter league code instead? On Your leagues, use "Join with a code" and wait for the commissioner to approve you.', help: 'join-league' },
          { text: 'Next time, sign in with your email and a code. There is no password.', help: 'sign-in' },
        ],
        tip: 'Use the same email your commissioner has for you, so the app knows which golfer on the roster you are.',
      },
      {
        id: 'phone',
        title: 'Set up your phone',
        intro: 'Make it feel like an app and get the reminders.',
        steps: [
          { text: 'Put GolfScoreHQ on your home screen: More → "Put GolfScoreHQ on your home screen". On iPhone use Safari\'s Share button → "Add to Home Screen".', help: 'home-screen' },
          { text: 'On Home, tap "Turn on notifications" for "Are you playing?" reminders, sub requests and results. On iPhone, do it from the home screen icon.', help: 'notifications' },
          { text: 'Fill in "How you get paid" on Home (Venmo, PayPal or Zelle) so the commissioner can pay your winnings. Only you and the commissioners see it.', help: 'my-venmo', pro: true },
        ],
      },
      {
        id: 'before',
        title: 'Before league night',
        intro: 'Let everyone know if you\'re playing.',
        steps: [
          { text: 'Tap "I\'m in", "Maybe" or "I\'m out" on Home, or from the reminder email without signing in.', help: 'rsvp', pro: true },
          { text: 'Grab a tee time: open the week and tap "Join" on a group. Need a partner? "I need a partner".', help: 'join-group', pro: true },
          { text: 'Asked to sub? Tap "I\'ll play" or "Can\'t make it" on the notification.', help: 'sub-finder', pro: true },
        ],
      },
      {
        id: 'night',
        title: 'League night: keep the card',
        intro: 'One golfer in each group keeps score for the group.',
        steps: [
          { text: 'Play tab → this week → "Start scoring a group". Pick your tee time and your group, then "Start scoring".', help: 'start-scoring' },
          { text: 'Each hole: + and − for every golfer, then "Next hole →".' },
          { text: 'Down in the match? Tap the press button at the hole the press starts.', help: 'presses', pro: true },
          { text: 'On a par 3, answer whether anyone got inside the closest-to-the-pin marker.', help: 'ctp', pro: true },
          { text: 'At the end, "Review scores", then "Submit scores". Every hole needs a score.' },
          { text: 'Watch the other groups on the Live tab.', help: 'live' },
        ],
        tip: 'No signal on the course? Keep going. The scores are saved on your phone and send themselves later; don\'t close the app until it says they\'re saved.',
      },
      {
        id: 'after',
        title: 'After the round',
        intro: 'Results, money and bragging rights.',
        steps: [
          { text: 'When the commissioner settles the week it shows Final, with what each golfer won or lost.', help: 'settle-week' },
          { text: 'Skins and closest-to-the-pin winnings are paid by the commissioner; you\'ll see "Paid ✓". Match money you usually settle with the other golfers.', help: 'who-pays-whom', pro: true },
          { text: 'Season dues show on Home with a "Pay with Venmo" button.', help: 'season-dues', pro: true },
          { text: 'The recap email has the week\'s results. Don\'t want it? Untick "Email me the weekly recap" on Home.', help: 'recap-email', pro: true },
          { text: 'Share the "Winner card" picture with the group text.', help: 'share-week' },
          { text: 'Wrong score on the card? Fix it before the week is settled; after that, ask the commissioner.', help: 'fix-score' },
        ],
      },
      {
        id: 'season',
        title: 'All season long',
        intro: 'Keep an eye on the race.',
        steps: [
          { text: 'Standings: sort by Money, Points, Average, Hot and more. Tap your name for your rounds and stats.', help: 'standings' },
          { text: 'Season awards: More → "Season awards and stats".', help: 'awards', pro: true },
          { text: 'League on the free plan? Tap "Yes, I\'d chip in" to tell the commissioner you\'d pay your share of Pro. Nobody is charged.', help: 'chip-in' },
          { text: 'Stuck? The Help page answers most questions, and "Ask a question" at the bottom answers the rest.' },
        ],
      },
    ],
  },
];

/** Both guides as plain text, for the "Ask a question" helper. */
export function guideText(): string {
  return [
    FINDING_YOUR_WAY,
    ...GUIDES.map((g) => [
      `# ${g.title}`,
      g.intro,
      ...g.chapters.map((c, n) => [
        `## ${n + 1}. ${c.title}`,
        c.intro,
        ...c.steps.map((s, i) => `${i + 1}. ${s.text}${s.pro ? ' (needs Pro)' : ''}`),
        ...(c.tip ? [`Tip: ${c.tip}`] : []),
      ].join('\n')),
    ].join('\n\n')),
  ].join('\n\n');
}
