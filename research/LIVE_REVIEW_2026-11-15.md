# Live locked-card review — November 15, 2026

Run `python3 research/card_journal.py --data ../dirtiq-nfl/public/data --through 2026-11-15`. Outputs and source hashes are written to ignored `research/output/`. This descriptive journal uses locked pregame terms, never current lines, and does not reopen the frozen holdout or fit a new rule.

At the afternoon refresh, NFL card picks Buffalo -7.5 and Jacksonville -10.5 both won: Buffalo beat the Jets 31–12 (11.5 points over the spread); Jacksonville beat Tennessee 40–23 (6.5 points over). Arizona remained pending. The two NFL wins returned +0.881 units on 1.0 unit staked. Two results do not establish an edge.

Across the four published card dates, policies, stakes and NBA participation changed. Daily W–L was 4–7, 4–5, 6–6, then 2–1 with seven pending at the snapshot. Do not pool that into strategy validation. The journal records locked market error versus model error and close-spread cover margins to guide later preregistered questions. Injuries, lineups and weather were not verified, so no causal explanations are assigned.

The missing Jacksonville grade was a data freshness issue: the batch results artifact lacked the final, and NFL had no ESPN final-score fallback. Product code addresses final-score recovery separately; model parameters and card rules are unchanged. Private manually entered bet terms are not part of this public-card study.
