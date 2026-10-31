# Tying GolfScoreHQ to GHIN

Researched October 2026. Check the fee and the program with the USGA before signing anything.

## How access works

There is no public GHIN API. The USGA licenses access through two programs:

- **Golfer Product Access (GPA)** is for golfer-facing apps. An approved company is a "Handicap Data Affiliate". A GPA app can look up a golfer's Handicap Index, read their scoring record, get Course and Slope Ratings, and post scores. U.S. only. You apply on the USGA's GPA form (https://form.jotform.com/222006675143146). The USGA Handicap & Course Rating department then sends the GPA and API agreements. Contact: hdcpquestions@usga.org, (908) 234-2300 x5.
- **Value Added Service Provider (VASP)** is for club software such as tournament, tee-time and league tools. A secondhand USGA reply says it needs approval from the state golf association (the FSGA in Florida) and support for at least 10 clubs or 1,400 golfers.

## Cost

- **GPA:** the USGA's application form says **$6,000 a year**. There's no published price list, so confirm it.
- **VASP:** no published fee.
- No published per-golfer or per-lookup fees.
- On top of the fee: the build work, separate sandbox, staging and production API accounts, and a compliance review.

## Rules we'd have to follow

- Never offer another handicap system, or call our own calculated number a "Handicap Index". The app's league-calculated handicap must stay labeled as a league handicap.
- **Posting scores:** league rounds count when played under the Rules of Golf, with at least one other person, over the minimum number of holes. Scrambles and other team formats don't count. Scores are due the same day, before midnight.
- **No scraping:** the GHIN terms of service forbid scraping and the unofficial APIs (such as the `ghin` npm package). The USGA can cut access off without notice.

## How other league apps do it

- **Unknown Golf** is a licensed USGA partner. It pulls each golfer's Index and posts scores.
- **Golf Genius** syncs Indexes and posts scores for clubs that already have GHIN.
- **Pattern:** the app holds the license, and the club or league holds the GHIN relationship. A league can become its own GHIN club through its state association (it needs at least 10 members and a handicap committee).

## Plan

1. **Now (no license, no cost) — built:** golfers add their own GHIN number on the league home page (commissioners can on the Roster). After a finished round that counts (not a scramble), the week page shows **Post to GHIN**: the scorecard hole by hole and an Open GHIN button (ghin.com, which may open the GHIN app on a phone), with "by midnight tonight" on the day. The golfer still enters the score in GHIN.
2. **Once paying customers cover the fee:** email hdcpquestions@usga.org and ask:
   - whether a league app is GPA or VASP;
   - what the current fee is;
   - whether there's a smaller pilot.
   Ask the FSGA contact too.
3. **Then:** apply, build the Index lookup first, and add score posting after it.
