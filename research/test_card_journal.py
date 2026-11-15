from __future__ import annotations
import unittest
from card_journal import review_pick,aggregate
class JournalTest(unittest.TestCase):
    def pick(self):return {'id':'nfl:x','sport':'nfl','pick':'JAX','side':'away','line':-10.5,'price':-115,'stakeUnits':.5,'startsAt':'2026-11-15T18:00:00Z','lockedAt':'2026-11-15T12:00:00Z','modelHomeMargin':-15.0}
    def test_locked_line_not_updated_price_and_missing_is_pending(self):
        p=self.pick();p['current']={'line':-20.5}
        row=review_pick(p,{'homeScore':23,'awayScore':40},close=-12.5)
        self.assertEqual(row['outcome'],'win');self.assertEqual(row['coverMargin'],6.5)
        self.assertAlmostEqual(row['units'],.5*100/115)
        self.assertEqual(row['clvPoints'],2)
        self.assertEqual(aggregate([row,review_pick(p,None)])['pending'],1)
    def test_postgame_lock_is_excluded(self):
        p=self.pick();p['lockedAt']='2026-11-15T23:00:00Z'
        self.assertEqual(review_pick(p,{'homeScore':23,'awayScore':40})['status'],'excluded')
if __name__=='__main__':unittest.main()
