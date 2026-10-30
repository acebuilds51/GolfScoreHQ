import type { ReactNode } from 'react';
import type { FormatKey } from '../lib/scoring';
import { Card, Check, Field, Formats, Lines, Phone, Tap } from './Pretend';

// Walk-through lessons, like Ladle & Spoon's: a pretend screen, the button to
// tap glows, then a quick quiz. One for golfers and one for commissioners in
// each format. The rules here are the engine's (packages/engine): keep them in step.

export type LessonFor = 'golfers' | 'commissioners';

/** Do something on the pretend screen: tap the glowing button (`times` taps for a counter). */
export interface TapStep { say: ReactNode; screen: (taps: number) => ReactNode; tap: string; times?: number }
/** Read, then Next. */
export interface ReadStep { say: ReactNode; screen?: ReactNode }
/** A question: one right answer, and what to say for each pick. */
export interface QuizStep { quiz: ReactNode; opts: { text: ReactNode; right?: true; why: ReactNode }[] }
export type LessonStep = TapStep | ReadStep | QuizStep;

export interface Lesson {
  id: string;
  for: LessonFor;
  format: FormatKey;
  icon: string;
  title: string;
  mins: number;
  pro?: boolean;
  steps: LessonStep[];
}

export const isTap = (s: LessonStep): s is TapStep => 'tap' in s;
export const isQuiz = (s: LessonStep): s is QuizStep => 'quiz' in s;

export const FORMAT_NAMES: Record<FormatKey, string> = {
  bestBallMatch: 'Best ball match',
  strokePlay: 'Stroke play',
  stableford: 'Stableford',
  scramble: 'Scramble',
};

const weekStart = (
  <Phone title="Week 3 · Thu, May 13">
    <Lines title="Groups" rows={[['Tee time 1 · Pat / Lee', 'On the tee'], ['Tee time 2', 'Not started']]} />
    <Tap id="start" className="btn btn-primary">Start scoring a group</Tap>
  </Phone>
);

const startGroup = (labels: string[], names: string[]) => (
  <Phone title="Start scoring a group">
    <Field label="Tee time" value="2" />
    {labels.map((l, i) => <Field key={l} label={l} value={names[i] ?? '— none —'} />)}
    <Tap id="go" className="btn btn-primary">Start scoring</Tap>
  </Phone>
);

const submit = (
  <Phone title="Review and submit">
    <Lines title="Scorecard" rows={[['Holes 1–9', 'every hole scored ✓'], ['Saved', '✓']]} />
    <Tap id="submit" className="btn btn-primary">Submit scores</Tap>
  </Phone>
);

const settle = (
  <Phone title="Week 3 · all groups in">
    <Lines title="Groups" rows={[['Tee time 1', 'Submitted'], ['Tee time 2', 'Submitted'], ['Tee time 3', 'Submitted']]} />
    <Tap id="settle" className="btn btn-primary">Settle the week</Tap>
  </Phone>
);

const post = (rows: [ReactNode, ReactNode][]) => (
  <Phone title="Settle the week">
    <Lines title="Check the results" rows={rows} />
    <Tap id="post" className="btn btn-primary">Settle and post results</Tap>
  </Phone>
);

const editFormat = (label: string) => (_: number) => (
  <Phone title="Play tab · Edit format">
    <Formats tapId={{ label, id: 'fmt' }} />
  </Phone>
);

export const LESSONS: Lesson[] = [
  // ── Golfers ──
  {
    id: 'golfer-best-ball', for: 'golfers', format: 'bestBallMatch', icon: '🤝', title: 'Best ball match: keep the card', mins: 3,
    steps: [
      { say: <>It's league night. On the <b>Play</b> tab, open this week and tap <b>Start scoring a group</b>.</>, screen: () => weekStart, tap: 'start' },
      { say: <>Pick your tee time and your four golfers. The first two are <b>Team A</b>, the next two <b>Team B</b>. Tap <b>Start scoring</b>.</>,
        screen: () => startGroup(['Team A — player 1', 'Team A — player 2', 'Team B — player 1', 'Team B — player 2'], ['You', 'Mike Walsh', 'Chris Lee', 'Dave Brown']), tap: 'go' },
      { say: <>Hole 1 is a par 4, and every score starts at par. You made a 5: tap <b>+</b> next to your name.</>,
        screen: () => <Card hole={1} par={4} rows={[{ name: 'You', score: 4, plus: 'plus' }, { name: 'Mike Walsh', score: 4 }, { name: 'Chris Lee', score: 4 }, { name: 'Dave Brown', score: 5, note: 'Bogey' }]} />, tap: 'plus' },
      { say: <>Mike made 4 and Chris made 4. Each team's <b>best ball</b> is its lower score: 4 against 4, so the hole is halved. Tap <b>Next hole →</b>.</>,
        screen: () => <Card hole={1} par={4} rows={[{ name: 'You', score: 5, note: 'Bogey' }, { name: 'Mike Walsh', score: 4 }, { name: 'Chris Lee', score: 4 }, { name: 'Dave Brown', score: 5, note: 'Bogey' }]} nextId="next" />, tap: 'next' },
      { say: <>On hole 2 your 3 is the best ball in the group, so Team A wins the hole. The top of the card keeps the match: <b>A 1 up thru 2</b>.</>,
        screen: <Phone><Card hole={3} par={5} line="A 1 up thru 2" rows={[{ name: 'You', score: 5 }, { name: 'Mike Walsh', score: 5 }, { name: 'Chris Lee', score: 5 }, { name: 'Dave Brown', score: 5 }]} /></Phone> },
      { say: <>Behind in the match? The team that's down can <b>press</b>: a new bet from this hole to the end. Chris and Dave press here. Tap <b>Chris / Dave press</b>.</>,
        screen: () => (
          <Phone>
            <Card hole={3} par={5} line="A 1 up thru 2" rows={[{ name: 'You', score: 5 }, { name: 'Mike Walsh', score: 5 }, { name: 'Chris Lee', score: 5 }, { name: 'Dave Brown', score: 5 }]}
              extra={<div className="card stack press-panel"><h3>Presses</h3><p className="small muted">No presses yet.</p><div className="row wrap"><span className="btn btn-sm pretend-off">You / Mike press</span><Tap id="press" className="btn btn-sm">Chris / Dave press</Tap></div></div>} />
          </Phone>
        ), tap: 'press' },
      { quiz: <>On a hole you make 5 and Mike makes 6. Chris makes 5 and Dave makes 4. Who wins the hole?</>, opts: [
        { text: 'Team B', right: true, why: 'Right. Dave\'s 4 is the best ball on the hole, and it beats your 5.' },
        { text: 'Team A', why: 'Team A\'s best is your 5, but Team B\'s best is Dave\'s 4. Team B wins it.' },
        { text: 'Halved: both teams made 5 somewhere', why: 'Only each team\'s lowest score counts: Dave\'s 4 beats your 5, so Team B wins it.' },
      ] },
      { quiz: <>The match ends with Team A winning 7 holes and Team B 5 (the rest halved). The match bet is $5 a man. What happens?</>, opts: [
        { text: 'You and Mike each win $5; Chris and Dave each lose $5', right: true, why: 'Right. Each loser pays one winner, and the app shows everyone what they won or lost.' },
        { text: 'Team A shares $5', why: 'It\'s $5 a man: you and Mike each win $5, and Chris and Dave each lose $5.' },
        { text: 'Nothing: it has to be won by 3', why: 'More holes won takes the match: 7 to 5 is a win. You and Mike each win $5.' },
      ] },
      { say: <>After the last hole the button says <b>Review scores</b>. Check every hole, then tap <b>Submit scores</b>. That's it.</>, screen: () => submit, tap: 'submit' },
    ],
  },
  {
    id: 'golfer-stroke-play', for: 'golfers', format: 'strokePlay', icon: '🏌️', title: 'Stroke play: keep the card', mins: 3,
    steps: [
      { say: <>In stroke play everyone plays their own ball against the whole league: no teams. Tap <b>Start scoring a group</b>.</>, screen: () => weekStart, tap: 'start' },
      { say: <>Pick your tee time and up to five golfers, then <b>Start scoring</b>.</>, screen: () => startGroup(['Golfer 1', 'Golfer 2', 'Golfer 3', 'Golfer 4'], ['You', 'Pat Jones', 'Lee Park', 'Sam Ortiz']), tap: 'go' },
      { say: <>Hole 1, par 4. You made a birdie 3: tap <b>−</b> next to your name.</>,
        screen: () => <Card hole={1} par={4} rows={[{ name: 'You', score: 4, minus: 'minus' }, { name: 'Pat Jones', score: 5, note: 'Bogey' }, { name: 'Lee Park', score: 4 }, { name: 'Sam Ortiz', score: 4 }]} />, tap: 'minus' },
      { say: <>Under each name is the round so far: <b>−1 thru 1</b> is one under par after one hole. The <b>Live</b> tab shows where that puts you in the whole league.</>,
        screen: <Phone><Card hole={2} par={3} rows={[{ name: 'You', score: 3, note: '−1 thru 1' }, { name: 'Pat Jones', score: 3, note: '+1 thru 1' }, { name: 'Lee Park', score: 3, note: 'E thru 1' }, { name: 'Sam Ortiz', score: 3, note: 'E thru 1' }]} /></Phone> },
      { quiz: <>After nine holes: Pat is +3, Lee is +1 and you're +2. Who wins the week?</>, opts: [
        { text: 'Lee', right: true, why: 'Right. Fewest strokes against par wins.' },
        { text: 'Pat', why: 'Pat has the most strokes. Fewest wins: Lee at +1.' },
        { text: 'You', why: 'Close! Lee\'s +1 is one better than your +2.' },
      ] },
      { quiz: <>Prize money is $30, $20 and $10. You and Pat tie for 2nd. What do you each get?</>, opts: [
        { text: '$15 each', right: true, why: 'Right. Golfers tied for a place split the money for the places they cover: 2nd and 3rd, $20 + $10.' },
        { text: '$20 each', why: 'Two golfers tied for 2nd cover 2nd and 3rd: $20 + $10 split two ways is $15 each.' },
        { text: '$10 each', why: 'The tie covers 2nd and 3rd: $20 + $10 split two ways is $15 each.' },
      ] },
      { quiz: <>Skins are on. Your 3 on hole 4 is the only 3 in the whole league that night. What happens?</>, opts: [
        { text: 'You win a skin', right: true, why: 'Right. Skins go across the whole league: the only lowest score on a hole wins it.' },
        { text: 'Only if you also win the week', why: 'Skins are their own game: the only lowest score on a hole wins it, wherever you finish.' },
        { text: 'You split it with your group', why: 'Skins are won by one golfer: the only lowest score in the league on that hole.' },
      ] },
      { say: <>After the last hole: <b>Review scores</b>, then <b>Submit scores</b>. Every hole needs a score.</>, screen: () => submit, tap: 'submit' },
    ],
  },
  {
    id: 'golfer-stableford', for: 'golfers', format: 'stableford', icon: '🔢', title: 'Stableford: points, not strokes', mins: 3, pro: true,
    steps: [
      { say: <>In Stableford every hole earns points, and the <b>most points</b> wins. One bad hole never ruins the night.</>,
        screen: <Phone title="Points on each hole"><Lines rows={[['Double bogey or worse', '0'], ['Bogey', '1'], ['Par', '2'], ['Birdie', '3'], ['Eagle', '4'], ['Albatross', '5']]} /></Phone> },
      { say: <>Hole 1, par 4. You made a bogey 5: tap <b>+</b>.</>,
        screen: () => <Card hole={1} par={4} rows={[{ name: 'You', score: 4, plus: 'plus', note: '2 pts here · 2 total' }, { name: 'Pat Jones', score: 4, note: '2 pts here · 2 total' }]} />, tap: 'plus' },
      { say: <>A bogey is worth 1 point: the line under your name shows it. Tap <b>Next hole →</b>.</>,
        screen: () => <Card hole={1} par={4} rows={[{ name: 'You', score: 5, note: 'Bogey · 1 pts here · 1 total' }, { name: 'Pat Jones', score: 4, note: '2 pts here · 2 total' }]} nextId="next" />, tap: 'next' },
      { say: <>Hole 2 you made a birdie: 3 points, so you have <b>4 total</b>. Pat's par gives 2 more, for 4. All square.</>,
        screen: <Phone><Card hole={2} par={3} rows={[{ name: 'You', score: 2, note: 'Birdie · 3 pts here · 4 total' }, { name: 'Pat Jones', score: 3, note: '2 pts here · 4 total' }]} /></Phone> },
      { quiz: <>Four holes: par, bogey, double bogey, birdie. How many points?</>, opts: [
        { text: '6', right: true, why: 'Right. 2 + 1 + 0 + 3 = 6.' },
        { text: '5', why: 'Par 2, bogey 1, double 0, birdie 3: that\'s 6.' },
        { text: '4', why: 'Par 2, bogey 1, double 0, birdie 3: that\'s 6.' },
      ] },
      { quiz: <>You make a 9 on a par 4. What does it cost you?</>, opts: [
        { text: '0 points for the hole, same as a double bogey', right: true, why: 'Right. Double bogey or worse is 0, so a blow-up hole can\'t sink you.' },
        { text: 'Minus 3 points', why: 'Points never go below 0: double bogey or worse is 0.' },
        { text: 'All your points so far', why: 'It\'s just 0 for that hole. Double bogey or worse is 0.' },
      ] },
      { quiz: <>Pat finishes with 34 points and you have 31. Who's ahead?</>, opts: [
        { text: 'Pat', right: true, why: 'Right. In Stableford the most points wins.' },
        { text: 'You', why: 'It\'s the opposite of stroke play: the most points wins, so Pat is ahead.' },
      ] },
    ],
  },
  {
    id: 'golfer-scramble', for: 'golfers', format: 'scramble', icon: '👥', title: 'Scramble: one ball for the team', mins: 2, pro: true,
    steps: [
      { say: <>In a scramble your group is one team. Everyone hits, you pick the best shot, and all play from there. Start your group the usual way: <b>Start scoring a group</b>.</>, screen: () => weekStart, tap: 'start' },
      { say: <>Pick your teammates, then <b>Start scoring</b>.</>, screen: () => startGroup(['Team member 1', 'Team member 2', 'Team member 3', 'Team member 4'], ['You', 'Mike Walsh', 'Chris Lee', 'Dave Brown']), tap: 'go' },
      { say: <>There's <b>one row</b> for the whole team. The team made 3 on this par 4: tap <b>−</b>.</>,
        screen: () => <Card hole={1} par={4} rows={[{ name: 'Team · You / Mike / Chris / Dave', score: 4, minus: 'minus' }]} />, tap: 'minus' },
      { say: <>The line under the team keeps the total: <b>−1 thru 1 · one score for the whole team</b>.</>,
        screen: <Phone><Card hole={2} par={5} rows={[{ name: 'Team · You / Mike / Chris / Dave', score: 5, note: '−1 thru 1 · one score for the whole team' }]} /></Phone> },
      { quiz: <>Who keeps the card in a scramble?</>, opts: [
        { text: 'One person, for the whole team', right: true, why: 'Right. One score per hole for the team, so one card.' },
        { text: 'Everyone, for themselves', why: 'There\'s one ball and one score, so one person keeps the card for the team.' },
      ] },
      { quiz: <>Your team of four wins 1st place: $40. What does each of you get?</>, opts: [
        { text: '$10', right: true, why: 'Right. Each team\'s prize is split among its players.' },
        { text: '$40', why: 'The $40 is the team\'s prize, split four ways: $10 each.' },
      ] },
    ],
  },

  // ── Commissioners ──
  {
    id: 'commish-best-ball', for: 'commissioners', format: 'bestBallMatch', icon: '🤝', title: 'Best ball match: set it up and settle up', mins: 4,
    steps: [
      { say: <>On the <b>Play</b> tab tap <b>Edit format</b>, then pick <b>2 vs 2 best ball match</b>.</>, screen: editFormat('2 vs 2 best ball match'), tap: 'fmt' },
      { say: <>Under <b>Side games and money</b> (Pro): the match bet per man, presses, skins and closest to the pin. Tap <b>Save format</b>.</>,
        screen: () => (
          <Phone title="Side games and money">
            <Field label="Match bet per man ($)" value="5" />
            <Check on>Presses</Check>
            <Field label="Press per man ($)" value="10" />
            <Check on>Skins across the whole league</Check>
            <Field label="When the low score ties" value="No skin — pot split among skins won" />
            <Check on>Closest to the pin on par 3s</Check>
            <Tap id="save" className="btn btn-primary">Save format</Tap>
          </Phone>
        ), tap: 'save' },
      { say: <>On league night each group sets its own teams when it starts: the first two picks are Team A, the next two Team B. A fifth golfer can play for skins and closest to the pin only.</> },
      { say: <>When every group shows <b>Submitted</b>, tap <b>Settle the week</b>.</>, screen: () => settle, tap: 'settle' },
      { say: <>Check the results, then <b>Settle and post results</b>. Everyone sees the week as Final.</>,
        screen: () => post([['Match: You / Mike beat Chris / Dave', '+$5 / −$5 a man'], ['Skins: 3 won', '$40 each'], ['CTP hole 4', 'Pat Jones']]), tap: 'post' },
      { say: <><b>Pay out week 3</b> lists the skins and closest-to-the-pin winners. <b>Pay with Venmo</b> fills in the golfer, amount and note; then tick <b>Paid</b>. Match and press money the golfers settle with each other.</>,
        screen: <Phone title="Pay out week 3"><Lines rows={[['Pat Jones · skin, CTP', '$76'], ['Lee Park · skin', '$40']]} /><span className="btn btn-sm pretend-off">Pay with Venmo</span></Phone> },
      { quiz: <>A match ends with each team winning 6 holes. Who pays?</>, opts: [
        { text: 'Nobody: a halved match pays nothing', right: true, why: 'Right. The card shows "Halved 6–6" and no money changes hands for the match.' },
        { text: 'The team that was ahead first', why: 'Only the final count matters: 6–6 is halved, and halved pays nothing.' },
      ] },
      { quiz: <>Skins are set to "No skin — pot split among skins won". The pot is $120 and 3 skins are won in the league. What's each skin worth?</>, opts: [
        { text: '$40', right: true, why: 'Right. Tied holes win nothing, and the pot is split among the skins that were won.' },
        { text: '$120 ÷ 18 holes, about $6.67', why: 'That\'s the carry-over way. With "No skin", the pot is split among the skins won: $40 each.' },
      ] },
    ],
  },
  {
    id: 'commish-stroke-play', for: 'commissioners', format: 'strokePlay', icon: '🏌️', title: 'Stroke play: set it up and settle up', mins: 3,
    steps: [
      { say: <>On the <b>Play</b> tab tap <b>Edit format</b>, then pick <b>Stroke play</b>.</>, screen: editFormat('Stroke play'), tap: 'fmt' },
      { say: <>With Pro, set <b>Prize money each week by place</b>, like 30, 20, 10. Turn on handicaps for net scoring if you like. Tap <b>Save format</b>.</>,
        screen: () => (
          <Phone title="Side games and money">
            <Field label="Prize money each week by place ($)" value="30, 20, 10" />
            <Check on>Skins across the whole league</Check>
            <Check on>Play with handicaps (net scoring)</Check>
            <Tap id="save" className="btn btn-primary">Save format</Tap>
          </Phone>
        ), tap: 'save' },
      { say: <>When every group shows <b>Submitted</b>, tap <b>Settle the week</b>.</>, screen: () => settle, tap: 'settle' },
      { say: <>Check the leaderboard and payouts, then <b>Settle and post results</b>.</>, screen: () => post([['1st · Lee Park −2', '$30'], ['2nd · Pat Jones +1', '$20'], ['3rd · Sam Ortiz +3', '$10']]), tap: 'post' },
      { quiz: <>Prize money is $30, $20, $10. Two golfers tie for 1st. What do they get?</>, opts: [
        { text: '$25 each', right: true, why: 'Right. They cover 1st and 2nd: $30 + $20 split two ways. The next golfer is 3rd.' },
        { text: '$30 each', why: 'Tied golfers split the money for the places they cover: $30 + $20, so $25 each.' },
        { text: '$15 each', why: 'Tied golfers split the money for the places they cover: $30 + $20, so $25 each.' },
      ] },
      { quiz: <>Skins carry over. The pot is $180 for 18 holes ($10 a hole). Hole 1 ties; Pat wins hole 2 alone. What's Pat's skin worth?</>, opts: [
        { text: '$20', right: true, why: 'Right. The tied hole\'s $10 carries to hole 2.' },
        { text: '$10', why: 'With carry-over, hole 1\'s $10 moves to hole 2: $20.' },
      ] },
    ],
  },
  {
    id: 'commish-stableford', for: 'commissioners', format: 'stableford', icon: '🔢', title: 'Stableford: set it up and settle up', mins: 3, pro: true,
    steps: [
      { say: <>Stableford needs Pro. On the <b>Play</b> tab tap <b>Edit format</b>, then pick <b>Stableford</b>.</>, screen: editFormat('Stableford'), tap: 'fmt' },
      { say: <>The points are standard and the same every week: double bogey or worse 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5. Most points wins.</>,
        screen: <Phone title="2027 season"><p className="small">Stableford · points: double bogey 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5</p></Phone> },
      { say: <>Set <b>Prize money each week by place</b> and any side games, then <b>Save format</b>.</>,
        screen: () => (
          <Phone title="Side games and money">
            <Field label="Prize money each week by place ($)" value="30, 20, 10" />
            <Check on>Play with handicaps (net scoring)</Check>
            <Tap id="save" className="btn btn-primary">Save format</Tap>
          </Phone>
        ), tap: 'save' },
      { quiz: <>Handicaps are on. A golfer gets a stroke on a par 4 and makes 5. How many points?</>, opts: [
        { text: '2: a net par', right: true, why: 'Right. 5 minus the stroke is a net 4: par, 2 points.' },
        { text: '1: a bogey', why: 'Points come from the net score: 5 minus the stroke is 4, a net par, 2 points.' },
      ] },
      { quiz: <>You switch from stroke play to Stableford mid-season. What happens?</>, opts: [
        { text: 'Earlier weeks count the new way in the standings; money already posted stays', right: true, why: 'Right. The app warns you about this when you change the format.' },
        { text: 'Nothing changes until next season', why: 'The new format applies to the standings straight away, earlier weeks too. Money already posted doesn\'t change.' },
      ] },
    ],
  },
  {
    id: 'commish-scramble', for: 'commissioners', format: 'scramble', icon: '👥', title: 'Scramble: a season or one week', mins: 3, pro: true,
    steps: [
      { say: <>A whole season of scrambles: <b>Edit format</b> and pick <b>Scramble</b>.</>, screen: editFormat('Scramble'), tap: 'fmt' },
      { say: <>Set <b>Team prize money each week by place</b>. Each team's prize is split among its players. Tap <b>Save format</b>.</>,
        screen: () => (
          <Phone title="Side games and money">
            <Field label="Team prize money each week by place ($)" value="40, 20" />
            <Check on>Skins across the whole league</Check>
            <Tap id="save" className="btn btn-primary">Save format</Tap>
          </Phone>
        ), tap: 'save' },
      { say: <>Just one scramble night in another format? Open that week and tap <b>Make this a scramble week</b>.</>,
        screen: () => <Phone title="Week 6 · Thu, Jun 10"><Lines rows={[['Course', 'Maple Hills · Front 9']]} /><Tap id="special" className="btn">Make this a scramble week</Tap></Phone>, tap: 'special' },
      { say: <>With handicaps on, each team gets a team handicap when it starts: 25/20/15/10% of the course handicaps, low to high (35/15% for twosomes).</> },
      { quiz: <>Your second-place team has three players and wins $30. What does each get?</>, opts: [
        { text: '$10', right: true, why: 'Right. The team\'s prize is split among its players.' },
        { text: '$30', why: 'The $30 is for the team, split three ways: $10 each.' },
      ] },
      { quiz: <>Groups have started scoring. Can you still make this week a scramble?</>, opts: [
        { text: 'No: change it before anyone starts', right: true, why: 'Right. Once groups are scoring, the week\'s format is locked.' },
        { text: 'Yes, any time before you settle', why: 'Once groups are scoring, the format is locked. Make the change before league night.' },
      ] },
    ],
  },
];

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id) ?? null;
