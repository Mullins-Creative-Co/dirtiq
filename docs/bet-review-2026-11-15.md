# Bet review, 8–15 November 2026

A review of every bet in the owner's tracker through 15 November, what went wrong, and
which explanations hold up against history. Written for whoever next works on the
forecasting models. The machine-readable list of tested ideas is
`docs/tested-hypotheses.json`; the scripts are in `scripts/research/`.

## The record

59 bets logged, 56 graded: 24 wins, 32 losses, down 9.57 units on 83.8 staked (−11%).
All but one are spreads. Stakes are in units; no dollar amounts are recorded here.

| Group | Record | Staked | Profit |
|---|---|---|---|
| NFL | 6–2 | 28.0 | +13.83 |
| NBA | 2–4 | 4.5 | −0.69 |
| College football | 6–9 | 23.1 | −9.68 |
| College basketball | 10–17 | 28.2 | −13.03 |
| Followed a daily-card pick | 10–19 | 23.8 | −8.56 |
| Bet against a card pick | 2–0 | 2.0 | +1.82 |
| Not on the card | 12–13 | 58.0 | −2.83 |
| 5-unit bets, NFL | 4–1 | 25.0 | +12.98 |
| 5-unit bets, college | 0–3 | 15.0 | −15.00 |

The daily card itself, over the same four days, is 16–23 and down 4.8 units on 24.

## What went wrong

1. **The model's picks lost, and most of the volume followed them.** 29 of the 40 graded bets
   placed since the card launched on 12 November were card picks, and they went 10–19.
   This matches the backtest, which shows no edge at the closing line in any sport.
2. **Three 5-unit college bets lost 15 units**, more than the whole week's deficit. The
   notes on all three recorded a key absence on the side that was bet: Ohio State's
   starting quarterback, a Miami receiver, and injuries on Illinois. The model has no
   injury or lineup data, and the stake was ten times the card's.
3. **Vig paid on both sides of one game, twice.** Texas +4.5 and LSU −4.5, and UCLA −10 and
   Illinois +10. One side wins, one loses, and the pair costs the juice.
4. **One ticket appears twice.** UL Monroe +31.5 is logged on 14 November and again on
   15 November. If it was one bet, the record overstates the loss by a unit.
5. **Some bets were taken at a worse number than the card listed** (for example Sacred
   Heart −6.5 against −4.5, UL Monroe +31.5 against +32.5). None of those results flipped
   on the difference this week, but each half point costs about 1.5–2% in cover rate.
6. **College basketball blowouts.** Seven of the 17 basketball losses missed the spread by
   15 points or more. Southern Utah was bet twice in three days as a big underdog and
   lost by 29 and 38.

## What history says about each explanation

Every idea below was tested on all priced games since 2015–2019, not on this week.

| Idea | Result | Verdict |
|---|---|---|
| Early-season basketball picks are worse | 51.2% and 52.4% in a team's first six games, 50–51% later (10,610 picks) | Not supported |
| Big basketball underdogs (15+) are worse | 53.1% early, 50.2% later | Not supported |
| A team the model just missed by 15+ keeps losing | 51.1% basketball, 47.3% football, same as all picks | Not supported |
| Correcting the model for spread size, form and rest | 46–50% on later seasons | Not supported |
| Key absences on the picked side | No data to test | Open, most promising |
| Roster turnover in early-season basketball | No data to test | Open |
| Beating the closing line predicts winning | Tracker does not store the close | Open |

At a true 51% a run of 10–17 over 27 bets is about a one-in-ten outcome. The basketball
week was bad luck on top of a model with no edge; it was not a new flaw.

## What to change

- **Betting**: flat stakes, including on personal picks; no bet when a starter on that
  side is out or doubtful; never both sides of one game; take the card's number or
  better or pass.
- **Model, in order**: injuries and lineups for the four focus sports; returning-minutes
  or transfer data for November college basketball; store the closing line beside each
  tracked bet so closing-line value can be measured.
- **Not worth doing**: filters on spread size, time of season, recent form or the model's
  last miss. All were tested and none helped.
