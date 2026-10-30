// The Help page's questions and answers. The app shows them on /help, and the
// ask-help server function hands the same text to Claude so "Ask a question"
// answers from it. No imports, so both can use it. Keep the wording matched to
// the buttons in the app: people look for the exact words they read here.

export type HelpAudience = 'everyone' | 'commissioner' | 'golfer';

export interface HelpItem {
  /** Stable anchor: /help#<id> opens it. */
  id: string;
  q: string;
  /** Plain text; a line break starts a new paragraph. */
  a: string;
  who: HelpAudience;
  /** Needs Pro (or the Course plan, or a pilot league). */
  pro?: boolean;
  /** Other words people search with. */
  tags?: string;
}

export interface HelpSection {
  id: string;
  title: string;
  icon: string;
  items: HelpItem[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'getting-started', title: 'Getting started', icon: '👋',
    items: [
      {
        id: 'sign-in', who: 'everyone', tags: 'login log in password code email',
        q: 'How do I sign in?',
        a: 'Enter your email and tap "Email me a sign-in code". Type the code from the email under "Sign-in code" and tap "Sign in". There is no password to remember.\nOn a computer you can also tap the link in the email instead of typing the code. Didn\'t get it? Check your spam folder, or tap "Send a new code".',
      },
      {
        id: 'home-screen', who: 'everyone', tags: 'install app icon iphone android phone',
        q: 'How do I put GolfScoreHQ on my phone like an app?',
        a: 'Open the More tab and look for "Put GolfScoreHQ on your home screen". On Android tap "Add to home screen". On iPhone, open golfscorehq.app in Safari, tap the Share button, then "Add to Home Screen".\nIt then opens full screen from its own icon, like any other app. Nothing to download from an app store.',
      },
      {
        id: 'join-league', who: 'golfer', tags: 'invite link code join request approve',
        q: 'How do I join my league?',
        a: 'The easiest way is the invite link your commissioner texts or emails you: open it and tap "Email me a code to join", and you\'re in.\nOr, on Your leagues, use "Join with a code": type the 6-letter league code and your name and tap "Ask to join". Your commissioner approves it, then the league shows up on Your leagues.',
      },
      {
        id: 'create-league', who: 'commissioner', tags: 'new league start setup',
        q: 'How do I start a league?',
        a: 'Sign in, then on Your leagues fill in "Create a league": the league name (the league link fills itself in) and tap "Create league".\nYou go straight to a few setup questions (your course, how you play, when you play, your golfers), and GolfScoreHQ builds the season, weeks and roster from your answers. Skip any of it and do it later from the "Set up your league" checklist on the league\'s Home page.',
      },
      {
        id: 'setup-questions', who: 'commissioner', tags: 'set up build wizard questions season weeks quick',
        q: 'Can the app set up my league from my answers?',
        a: 'Yes. Home → "Answer a few questions and we\'ll build it" (new leagues start there). Five short steps: your course, how you play (format, side games, match money), when you play (league night, first week, how many weeks, nights off), your golfers (paste a list), then "Check and build" shows what will be made before you tap "Build my league". Tee times and season dues need Pro. Change anything later on the Play, Roster and Settings tabs.\nRather have us do it? "Send my answers to GolfScoreHQ" on the last step sends them to "We set up your league" (Pro).',
      },
      {
        id: 'demo', who: 'everyone', tags: 'try test practice sample',
        q: 'Can I try it before setting up my league?',
        a: 'Yes: golfscorehq.app/demo builds a made-up league with 16 golfers and six weeks played, right in your browser. Score a group, settle a week and look around; nothing is saved and no emails go out. "Exit demo" at the top takes you back.',
      },
      {
        id: 'tabs', who: 'everyone', tags: 'menu bottom bar where find',
        q: 'Where is everything?',
        a: 'The bar at the bottom of a league: Home (your week, dues, notifications), Play (the season and its weeks, where scoring starts), Live (scores as they come in), Standings, and More (awards, roster, courses, settings, help).',
      },
    ],
  },
  {
    id: 'league-night', title: 'League night: scoring', icon: '⛳',
    items: [
      {
        id: 'start-scoring', who: 'everyone', tags: 'enter scores group card start round',
        q: 'How do we score our group?',
        a: '1. Open the Play tab and tap this week.\n2. Tap "Start scoring a group", pick your tee time and the golfers in your group, then "Start scoring".\n3. Use + and − for each golfer, then "Next hole →" (or swipe).\n4. At the end tap "Review scores", then "Submit scores".\nOne person per group keeps the card. Every hole needs a score before you can submit.',
      },
      {
        id: 'who-scores', who: 'everyone', tags: 'scorer permission enter scores',
        q: 'Who can enter scores?',
        a: 'Anyone in the league can score a group until the commissioner settles the week. After that, only commissioners can change scores.',
      },
      {
        id: 'fix-score', who: 'everyone', tags: 'mistake wrong change correct edit',
        q: 'We entered a wrong score. How do we fix it?',
        a: 'Open the group\'s card again from the week page, change the hole, and tap "Submit corrections". If the week is already settled, ask your commissioner: they can reopen the week, fix it, and settle again.',
      },
      {
        id: 'no-signal', who: 'everyone', tags: 'offline signal internet connection lost',
        q: 'What if there\'s no cell signal on the course?',
        a: 'Keep scoring. The card shows "No signal · saved on this phone", and the scores send themselves when the phone gets signal again. Don\'t close the app or clear the browser until it says it\'s saved.',
      },
      {
        id: 'add-sub', who: 'everyone', tags: 'sub guest substitute missing player',
        q: 'How do I add a sub on league night?',
        a: 'When you start your group, tap "Add a sub" and type the sub\'s name. They\'re added to the roster as a sub and to your group, and you can score them right away.',
      },
      {
        id: 'presses', who: 'everyone', pro: true, tags: 'press bet match',
        q: 'How do presses work?',
        a: 'In a best ball match, the team that\'s down taps their "press" button on the card at the hole the press starts. It\'s a new bet from that hole to the end. "Undo" takes it back if it was a mistake. The press amount is set by the commissioner.',
      },
      {
        id: 'ctp', who: 'everyone', pro: true, tags: 'closest to the pin marker par 3 ctp',
        q: 'How does closest to the pin work?',
        a: 'On each par 3 the card shows the current marker. Answer "Did anyone in your group get inside it?" and, if so, pick who and "Whose ball were they inside of?". The app follows the chain of markers, so the order groups finish in doesn\'t matter.\nIf two groups claim the same marker, the commissioner picks the winner when settling the week.',
      },
      {
        id: 'live', who: 'everyone', tags: 'leaderboard watch follow',
        q: 'Can we follow the other groups?',
        a: 'Yes: the Live tab shows the leaderboard, matches, skins, closest to the pin and highlights, updating as scores come in.',
      },
      {
        id: 'rainout', who: 'commissioner', tags: 'rain weather cancel',
        q: 'What if we get rained out?',
        a: 'On the week page tap "Mark as rainout". Any scores already entered are kept but don\'t count. "Undo rainout" puts the week back.',
      },
    ],
  },
  {
    id: 'money', title: 'Money: settling, skins, payouts', icon: '💵',
    items: [
      {
        id: 'settle-week', who: 'commissioner', pro: true, tags: 'settle post results final',
        q: 'How do I settle the week?',
        a: 'When every group has submitted, open the week and tap "Settle the week", check the results, then "Settle and post results". Everyone then sees the week marked Final with what each golfer won or lost.\nMade a mistake? "Reopen week" takes the results back down until you settle again.',
      },
      {
        id: 'who-pays-whom', who: 'everyone', pro: true, tags: 'venmo paypal zelle pay owe money match',
        q: 'Who pays whom?',
        a: 'Skins, closest to the pin and prize money are paid by the commissioner. Match and press money is usually settled between the golfers: the app shows each golfer what they won or lost on their match and presses. Commissioners can switch that in Settings → "Match and press money" if match money goes through them instead.\nGolfScoreHQ never holds or moves money. Everyone pays with Venmo, PayPal or Zelle themselves.',
      },
      {
        id: 'pay-out', who: 'commissioner', pro: true, tags: 'pay out winners venmo skins ctp',
        q: 'How do I pay out the winners each week?',
        a: 'Open the settled week and find "Pay out week N". Each winner is listed with what they won. "Pay with Venmo" opens Venmo with the golfer, amount and a note already filled in; you just press Pay. Then tick "Paid".\nIf a golfer hasn\'t added their Venmo yet, tap "Add their details" and fill it in.',
      },
      {
        id: 'my-venmo', who: 'golfer', pro: true, tags: 'venmo paypal zelle get paid handle',
        q: 'How do I get paid my winnings?',
        a: 'On your league\'s Home page, fill in "How you get paid" with your Venmo, PayPal or Zelle. Only you and the commissioners see it. When you win, the commissioner pays you from the week\'s Pay out list and you\'ll see "Paid ✓" on the week.',
      },
      {
        id: 'season-dues', who: 'everyone', pro: true, tags: 'dues upfront season pay commissioner',
        q: 'How do season dues work?',
        a: 'If your league collects skins and closest-to-the-pin money up front, the commissioner sets the amount under "Season dues" on the Play tab and ticks off who has paid.\nGolfers see their dues on Home with a "Pay with Venmo" button to the commissioner, and "Paid ✓" once it\'s ticked.',
      },
      {
        id: 'commish-handles', who: 'commissioner', pro: true, tags: 'venmo paypal zelle collect',
        q: 'Where do I put my own Venmo?',
        a: 'Settings → "How golfers pay you": your Venmo username, PayPal.me name or Zelle email or phone. Golfers\' pay buttons for dues and the recap email use them.',
      },
      {
        id: 'hide-money', who: 'commissioner', tags: 'hide money private season winnings',
        q: 'Can I hide the season money from golfers?',
        a: 'Yes: Settings → "What golfers see" → untick "Season money". Each week\'s results still show that week\'s money, and commissioners always see everything.',
      },
    ],
  },
  {
    id: 'season', title: 'Setting up the season', icon: '📅',
    items: [
      {
        id: 'add-course', who: 'commissioner', tags: 'course scorecard pars tees',
        q: 'How do I add our course?',
        a: 'More → Courses → "Add a course". Search for your course, pick the tees your league plays and tap "Use these tees". Check the pars against your scorecard before saving.\nNot found? Enter the pars yourself. Pick front and back nines, a 9-hole course, or 18 holes. With two nines, weeks alternate: odd weeks play the first nine, even weeks the second.',
      },
      {
        id: 'add-golfers', who: 'commissioner', tags: 'roster add golfers players paste list',
        q: 'How do I add my golfers?',
        a: 'More → Roster → "Add golfers". Add them one at a time (name, email, phone, sub or not), or tap "Paste a list instead" and paste one golfer per line, like "Chris Lee, sub".',
      },
      {
        id: 'invite-golfers', who: 'commissioner', tags: 'invite text email link',
        q: 'How do I get my golfers into the app?',
        a: 'On the Roster, tap "Invite" next to a golfer for their own link (it works once and lasts 30 days), or "Invite golfers by text" to get a text ready for everyone. You can also turn on a league code in Settings → "League code" and approve requests as they come in.',
      },
      {
        id: 'subs-regulars', who: 'commissioner', tags: 'sub regular inactive deactivate',
        q: 'What\'s the difference between a sub and a regular?',
        a: 'Regulars are your league\'s golfers. Subs fill in when someone can\'t make it and are listed separately. "Make sub" or "Make regular" switches a golfer. "Deactivate" takes someone off the roster without losing their history.',
      },
      {
        id: 'duplicates', who: 'commissioner', tags: 'duplicate merge twice',
        q: 'A golfer is on the roster twice. How do I fix it?',
        a: 'The Roster shows "Possible duplicates" with a "Merge into one" button, or use Edit on a golfer. All their rounds and money move to one golfer. It can\'t be undone, so check the names first.',
      },
      {
        id: 'set-up-season', who: 'commissioner', tags: 'season format rules year',
        q: 'How do I set up the season?',
        a: 'Add your course first, then open the Play tab: pick the year, league night and first week, the format, side games and handicaps, and tap "Start the season". Then "Add the season\'s weeks" adds every week at once; untick any night you\'re not playing and the rest move along.',
      },
      {
        id: 'formats', who: 'everyone', tags: 'format best ball stroke play stableford scramble',
        q: 'What formats can we play?',
        a: '2 vs 2 best ball match (each hole goes to the team with the lowest single score), stroke play (lowest total wins), Stableford (points per hole, most points wins) and scramble (one team ball). Best ball match and stroke play are free; Stableford and scramble need Pro.',
      },
      {
        id: 'side-games', who: 'commissioner', pro: true, tags: 'skins ctp match bet presses prize money pot',
        q: 'How do I set up skins, closest to the pin and the match bet?',
        a: 'Play tab → "Edit format". Under "Side games and money": the match bet and press per man, or prize money by place, "Skins across the whole league" with the pot each week and what happens on a tie, and "Closest to the pin on par 3s" with the amount per par 3.',
      },
      {
        id: 'handicaps', who: 'everyone', tags: 'handicap ghin net strokes allowance',
        q: 'How do handicaps work?',
        a: 'Turn on "Play with handicaps (net scoring)" in the season\'s format (free on every plan). Handicaps can come from the GHIN index the commissioner enters on the Roster, from the league\'s own rounds, or GHIN first and league rounds when there\'s no GHIN.\nYou can also set the percent of handicap used and, for matches, play off the low man. Each golfer\'s strokes are fixed when their group starts, so changing a handicap later never changes a finished week. A league handicap needs 6 nines or 3 full rounds.',
      },
      {
        id: 'scramble-week', who: 'commissioner', pro: true, tags: 'scramble special week one week',
        q: 'Can we play one scramble week in the middle of the season?',
        a: 'Yes: open the upcoming week and tap "Make this a scramble week", and set its prize money and skins. "Back to the regular format" undoes it. It can\'t be changed once groups have started scoring.',
      },
      {
        id: 'next-season', who: 'commissioner', tags: 'new season next year',
        q: 'How do I start next season?',
        a: 'Play tab → "Start the next season". It copies your format, side games, league night and tee times; change anything after. Last season stays in Standings and Awards (looking back at past seasons needs Pro).',
      },
      {
        id: 'setup-service', who: 'commissioner', pro: true, tags: 'set up for me spreadsheet help import',
        q: 'Can someone set up my league for me?',
        a: 'Yes, with Pro: More → "We set up your league". Tick what you want set up, add your spreadsheets, PDFs or photos of scorecards, and tap "Send to GolfScoreHQ". We\'ll email you if we have a question and when it\'s done.',
      },
      {
        id: 'import', who: 'commissioner', tags: 'import spreadsheet excel csv history past rounds',
        q: 'Can I bring in last season\'s rounds?',
        a: 'More → "Import past rounds" takes an Excel (.xlsx) file, a CSV, or cells pasted from a spreadsheet: one row per golfer per round, with the week or date, golfer, and hole-by-hole scores. Old .xls files: save them as .xlsx or CSV first.',
      },
    ],
  },
  {
    id: 'tee-sheet', title: 'Tee sheet, RSVPs and subs', icon: '🗓️',
    items: [
      {
        id: 'tee-times', who: 'commissioner', pro: true, tags: 'tee times captains groups',
        q: 'How do I set tee times?',
        a: 'On the Play tab, "Set tee times": the first tee, minutes apart and how many. Every upcoming week gets them. Captains are optional; a week can have its own times or captains under "Captains or times this week".',
      },
      {
        id: 'join-group', who: 'golfer', pro: true, tags: 'join group partner tee time',
        q: 'How do I get into a group?',
        a: 'Open the week and tap "Join" on a tee time. If you need a partner tap "I need a partner", or "My partner and I need a match". "Not playing" lets everyone know you\'re out.',
      },
      {
        id: 'captain-leaves', who: 'everyone', pro: true, tags: 'captain drop out leave',
        q: 'What happens if a captain drops out?',
        a: 'The captain gives up the tee time: their group breaks up and the groups behind move up. The commissioner can put a captain back in.',
      },
      {
        id: 'rsvp', who: 'everyone', pro: true, tags: 'rsvp in out playing reminder email',
        q: 'How do we say who\'s playing?',
        a: 'Tap "I\'m in", "Maybe" or "I\'m out" on Home or the week page. Commissioners can turn on "Are you playing?" emails in Settings: they go out at 9 AM 1 to 6 days before league night with one-tap answers, no sign-in needed. Golfers can stop them from the email.',
      },
      {
        id: 'sub-finder', who: 'commissioner', pro: true, tags: 'sub finder short need a sub',
        q: 'How do I find a sub?',
        a: 'On the week page tap "Find a sub" and choose who to ask. They get a phone notification and tap "I\'ll play" or "Can\'t make it"; the first yes gets the spot. "Stop asking" ends it.',
      },
    ],
  },
  {
    id: 'results', title: 'Standings, recap and notifications', icon: '🏆',
    items: [
      {
        id: 'standings', who: 'everyone', tags: 'standings sort hot points average',
        q: 'How do the standings work?',
        a: 'The Standings tab sorts by Money, Points, Average, 🔥 Hot (the last 4 rounds), Wins, Skins or CTP. Tap a golfer to see their rounds and stats.',
      },
      {
        id: 'recap-email', who: 'everyone', pro: true, tags: 'email recap weekly results write-up',
        q: 'What is the weekly recap email?',
        a: 'After a week is settled, the commissioner can tap "Email the recap". Each golfer gets the week\'s results, skins and highlights plus what they won or lost. "Write it up with AI" drafts a fun opening that the commissioner reads and edits before sending.\nDon\'t want it? Untick "Email me the weekly recap" on your league\'s Home page.',
      },
      {
        id: 'notifications', who: 'everyone', tags: 'notifications push alerts phone',
        q: 'How do I get notifications on my phone?',
        a: 'On your league\'s Home page tap "Turn on notifications", then "Send me a test" to check. On iPhone, add GolfScoreHQ to your Home Screen first; iPhones only allow notifications from home screen apps.\nYou\'ll hear about sub requests, tee sheet changes, RSVP reminders and the weekly results.',
      },
      {
        id: 'awards', who: 'everyone', pro: true, tags: 'awards stats picture share',
        q: 'Where are the season awards?',
        a: 'More → "Season awards and stats". Tap "Make the awards picture" to share it with the group text.',
      },
      {
        id: 'share-week', who: 'everyone', tags: 'share picture text group winner card',
        q: 'Can I share the results with the group text?',
        a: 'Yes: on a settled week, "Winner card" makes a picture anyone can share, and commissioners also get "League results". Money only shows if you tick it.',
      },
      {
        id: 'tv', who: 'commissioner', pro: true, tags: 'tv clubhouse screen leaderboard',
        q: 'How do I put the leaderboard on the clubhouse TV?',
        a: 'Settings → "Clubhouse TV" → "Create a TV link", and open the link in the TV\'s browser (a smart TV, Fire Stick, Chromecast or a laptop plugged in). No sign-in needed on the TV. Choose which screens show and hide dollar amounts if you like.',
      },
    ],
  },
  {
    id: 'settings', title: 'Commissioner settings', icon: '⚙️',
    items: [
      {
        id: 'co-commissioner', who: 'commissioner', pro: true, tags: 'co commissioner help admin role',
        q: 'Can someone help me run the league?',
        a: 'Yes: in Settings → "Members", change their role to "Co-commissioner". They can then settle weeks, edit the roster and season, and change settings.',
      },
      {
        id: 'share-contacts', who: 'commissioner', tags: 'phone email privacy share text',
        q: 'Can golfers see each other\'s phone numbers?',
        a: 'Only if you turn it on: Settings → "What golfers see" has separate switches for phone numbers (with Text buttons) and emails. Commissioners always see them.',
      },
      {
        id: 'branding', who: 'commissioner', pro: true, tags: 'logo colors photo branding look',
        q: 'Can we use our logo and colors?',
        a: 'Yes: Settings → "League look". Upload your logo and a course photo and pick your two colors. They show on every page, the clubhouse TV and the recap email.',
      },
    ],
  },
  {
    id: 'plans', title: 'Plans and paying for GolfScoreHQ', icon: '💳',
    items: [
      {
        id: 'free-vs-pro', who: 'everyone', tags: 'free pro price cost plan what do i get',
        q: 'What\'s free and what needs Pro?',
        a: 'Free: scoring on phones, the live leaderboard, standings, roster, invites, handicaps, best ball match and stroke play, and the current season.\nPro ($149 per league, per year) adds skins, closest to the pin, presses and match money, payouts and dues, Stableford and scramble, the tee sheet, RSVPs and the sub finder, the recap email, awards, past seasons, co-commissioners, your logo and colors, Clubhouse TV, and "We set up your league".\nGolf courses: the Course plan ($990 a year) covers every league at the course and adds a pro shop sponsor on the clubhouse TV. It\'s set up by GolfScoreHQ and invoiced; see golfscorehq.app/courses.',
      },
      {
        id: 'upgrade', who: 'commissioner', tags: 'upgrade buy pay subscribe stripe',
        q: 'How do I upgrade to Pro?',
        a: 'Settings → Plan → "Upgrade to Pro". Checkout is by Stripe; have a discount code? Enter it at checkout. "Manage billing" later changes the card or cancels.',
      },
      {
        id: 'chip-in', who: 'golfer', tags: 'chip in share cost pro',
        q: 'What\'s "I\'d chip in"?',
        a: 'In a free league, golfers can tell the commissioner they\'d pay their share of Pro for the season: the price split across the league\'s golfers. Tap "Yes, I\'d chip in" and the commissioner gets a note. "Changed my mind" takes it back. Nobody is charged.',
      },
      {
        id: 'pilot', who: 'commissioner', tags: 'pilot code free trial',
        q: 'I have a pilot code. Where do I use it?',
        a: 'Open your pilot link (golfscorehq.app/pilot/…) and tap "Start my pilot league", or enter the code in Settings → Plan. A pilot league gets everything in Pro for free.',
      },
      {
        id: 'lapse', who: 'commissioner', tags: 'cancel lapse expire refund',
        q: 'What if we stop paying, or want a refund?',
        a: 'The league goes back to Free: the Pro features pause, and nothing is deleted. Turn Pro back on and it\'s all there. Refunds: full refund within 14 days of paying; email support@golfscorehq.app.',
      },
    ],
  },
  {
    id: 'trouble', title: 'Something not working?', icon: '🛠️',
    items: [
      {
        id: 'report', who: 'everyone', tags: 'bug problem broken error not working',
        q: 'Something isn\'t working. What do I do?',
        a: 'More → "Report a problem": say what happened and what you were trying to do, and tap "Send". The page you were on and your phone type go with it so we can find it. Or ask at the bottom of this page and tap "Send it to us".',
      },
      {
        id: 'cant-see-league', who: 'golfer', tags: 'missing league not showing',
        q: 'I joined but don\'t see my league.',
        a: 'If you asked to join with a code, your commissioner has to approve it first. Also check you signed in with the same email the commissioner invited.',
      },
      {
        id: 'privacy', who: 'everyone', tags: 'privacy data who sees',
        q: 'Who can see my phone number and email?',
        a: 'Your commissioners, and you. Other golfers only see them if the commissioner turns on sharing. The clubhouse TV never shows contact details.',
      },
    ],
  },
];

const ALL_ITEMS = HELP_SECTIONS.flatMap((s) => s.items);

const STOP = new Set('a an and are can do does for how i in is it me my of on or our the to we what when where who why with you your'.split(' '));
// Rough word endings, so "settling", "settled" and "settle" all match.
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '').replace(/e$/, '') : w);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

/** The questions that best match what someone typed, best first. */
export function searchHelp(query: string, limit = 10): HelpItem[] {
  const want = [...new Set(words(query))];
  if (!want.length) return [];
  return ALL_ITEMS
    .map((item) => {
      const q = words(item.q);
      const tags = words(item.tags ?? '');
      const a = words(item.a);
      const score = want.reduce((sum, w) => sum + (q.includes(w) ? 3 : 0) + (tags.includes(w) ? 2 : 0) + (a.includes(w) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    // Only the close matches: anything under half the best match is noise.
    .filter((x, _, all) => x.score * 2 >= all[0]!.score)
    .slice(0, limit)
    .map((x) => x.item);
}

const AUDIENCE_LABEL: Record<HelpAudience, string> = { everyone: 'everyone', commissioner: 'commissioners', golfer: 'golfers' };

/** The whole Help page as plain text, for the "Ask a question" helper. */
export function manualText(): string {
  return HELP_SECTIONS.map((s) => [
    `## ${s.title}`,
    ...s.items.map((i) => `Q: ${i.q} (for ${AUDIENCE_LABEL[i.who]}${i.pro ? '; needs Pro' : ''})\nA: ${i.a}`),
  ].join('\n\n')).join('\n\n');
}
