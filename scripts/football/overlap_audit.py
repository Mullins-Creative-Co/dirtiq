"""Controlled overlap experiments; never evaluates 2025 week 10 onward.

Separates statistical redundancy, damage from an assumed duplicate adjustment,
and directional errors in actual archived lines. It does not observe bookmaker
features, identify causal QB contributions, or prove sportsbook double counting.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

import numpy as np

RAW = ['off_epa_diff', 'def_epa_allowed_diff', 'home_field']
ADJUSTED = ['adj_off_epa_diff', 'adj_def_epa_allowed_diff', 'home_field', 'qb_epa_diff']
EXPERIMENTS = [
    dict(id='qb', name='Team EPA + individual QB', baseline=RAW, signal=['qb_epa_diff'],
         mechanism='Team EPA already reflects QB play. An extra full QB effect can repeat information embedded in team efficiency.'),
    dict(id='protection', name='EPA/QB + protection', baseline=ADJUSTED, signal=['pressure_allowed_diff', 'pressure_forced_diff'],
         mechanism='Sacks and QB hits affect team EPA and QB results. Adding their standalone effect again can repeat protection-related information.'),
    dict(id='turnovers', name='EPA + turnovers', baseline=ADJUSTED, signal=['turnover_margin_diff'],
         mechanism='Interceptions and lost fumbles already affect EPA. A separate full turnover effect may duplicate their impact.'),
    dict(id='opponents', name='Adjusted EPA + schedule correction', baseline=ADJUSTED, signal=['schedule_off_gap', 'schedule_def_gap'],
         mechanism='Opponent-adjusted ratings already account for opponents. An additional standalone schedule adjustment can reapply related information.'),
    dict(id='home', name='Home-aware baseline + home bonus', baseline=ADJUSTED, signal=['home_field'],
         mechanism='The exact home/neutral indicator is already a baseline feature. Adding it again is a deliberately constructed duplicate-column control.'),
    dict(id='passrush', name='Total EPA + pass/run efficiency', baseline=RAW, signal=['pass_matchup', 'rush_matchup'],
         mechanism='Total efficiency and its pass/run matchup components share information. Only incremental matchup information should earn an extra effect.'),
    dict(id='rest', name='EPA + current rest (comparison)', baseline=ADJUSTED, signal=['rest_diff'],
         mechanism='Current rest is not explicitly in this baseline. This comparison checks that the procedure does not automatically call every extra input a duplicate.'),
]


def dt(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def development(row):
    return row['season'] < 2025 or row['season'] == 2025 and row['week'] <= 9


def scale(x, w):
    center = np.average(x, axis=0, weights=w)
    sd = np.sqrt(np.average((x-center)**2, axis=0, weights=w))
    return center, np.where(sd < 1e-12, 1., sd)


def ridge(x, y, w, alpha):
    center, sd = scale(x, w)
    z = (x-center)/sd
    intercept = float(np.average(y, weights=w))
    coef = np.linalg.solve(z.T @ (w[:, None]*z)+alpha*np.eye(x.shape[1]), z.T @ (w*(y-intercept)))
    return lambda v: intercept+(v-center)/sd @ coef


def overlap_fit(b, z, y, w, b_test, z_test, alpha=20.):
    """Fit all stages on training rows only; project with weighted SVD/OLS.

    The baseline stays fixed. Full-add uses an independently learned standalone
    signal effect, with its intercept removed. New-only projects the signal onto
    baseline inputs, then learns the baseline outcome residual from only the
    remaining signal. Correlation/projection is not a causal decomposition.
    """
    w = np.asarray(w, dtype=float); w = w/w.mean()
    baseline = ridge(b, y, w, alpha)
    base_train, base_test = baseline(b), baseline(b_test)
    z_mean, z_sd = scale(z, w); z_train = (z-z_mean)/z_sd; z_target = (z_test-z_mean)/z_sd
    b_mean, b_sd = scale(b, w)
    design = np.column_stack([np.ones(len(b)), (b-b_mean)/b_sd])
    design_test = np.column_stack([np.ones(len(b_test)), (b_test-b_mean)/b_sd])
    root = np.sqrt(w)
    projection = np.linalg.lstsq(design*root[:, None], z_train*root[:, None], rcond=1e-10)[0]
    shared_train, shared_test = design @ projection, design_test @ projection
    remainder, new_target = z_train-shared_train, z_target-shared_test
    full_coef = np.linalg.solve(z_train.T @ (w[:, None]*z_train)+alpha*np.eye(z.shape[1]), z_train.T @ (w*(y-np.average(y, weights=w))))
    active = np.average(remainder**2, weights=w, axis=0) > 1e-10
    new_add = np.zeros(len(b_test))
    if active.any():
        r = remainder[:, active]
        coef = np.linalg.solve(r.T @ (w[:, None]*r)+alpha*np.eye(r.shape[1]), r.T @ (w*(y-base_train)))
        new_add = new_target[:, active] @ coef
    full_add = z_target @ full_coef
    total_var = float(np.sum(w[:, None]*z_train**2))
    unexplained = float(np.sum(w[:, None]*remainder**2))
    return dict(baseline=base_test, full=base_test+full_add, new=base_test+new_add,
        full_add=full_add, new_add=new_add, projected_add=shared_test @ full_coef,
        train_overlap=None if total_var < 1e-10 else 1-unexplained/total_var,
        test_total=np.sum(z_target**2, axis=1), test_remainder=np.sum(new_target**2, axis=1),
        active_signals=int(active.sum()))


def interval(values, blocks, family, samples=4000):
    if len(values) == 0:
        return None
    unique = sorted(set(blocks))
    if len(unique) < 2:
        return None
    grouped = [(sum(v for v, b in zip(values, blocks) if b == key), blocks.count(key)) for key in unique]
    totals, counts = np.array(grouped).T
    rng = np.random.default_rng(7703)
    indices = rng.integers(0, len(unique), size=(samples, len(unique)))
    draws = totals[indices].sum(axis=1)/counts[indices].sum(axis=1)
    tail = .05/(2*family)
    low, high = np.quantile(draws, [tail, 1-tail])
    return [float(low), float(high)]


def metrics(rows):
    if not rows:
        return None
    actual = np.array([r['actual'] for r in rows])
    result = {'games': len(rows)}
    for key in ['baseline', 'full', 'new', 'market']:
        result[key+'Mae'] = float(np.mean(np.abs(np.array([r[key] for r in rows])-actual)))
    selected = [r for r in rows if abs(r['new']-r['full']) >= 1.]
    errors = [(r['actual']-r['market'])*np.sign(r['new']-r['full']) for r in selected]
    wins, losses = int(sum(v > 0 for v in errors)), int(sum(v < 0 for v in errors))
    result['directional'] = dict(sides=len(selected), wins=int(wins), losses=int(losses), pushes=len(selected)-wins-losses,
        coverRate=wins/(wins+losses) if wins+losses else None,
        meanMarketError=float(np.mean(errors)) if errors else None)
    return result


def prepare(data):
    rows = []
    for original in data:
        if not development(original):
            continue
        row = dict(original)
        row['schedule_off_gap'] = row['off_epa_diff']-row['adj_off_epa_diff']
        row['schedule_def_gap'] = row['def_epa_allowed_diff']-row['adj_def_epa_allowed_diff']
        row['_kickoff'] = dt(row['kickoff']); row['_asof'] = dt(row['feature_asof']); row['_available'] = dt(row['completed_at'])
        if not row['_asof'] < row['_kickoff'] < row['_available']:
            raise ValueError('Invalid timing in source history.')
        for field in set(RAW+ADJUSTED+[f for exp in EXPERIMENTS for f in exp['signal']]):
            if not np.isfinite(row[field]):
                raise ValueError(f'Missing/nonfinite overlap feature: {field}')
        rows.append(row)
    return sorted(rows, key=lambda r: r['_kickoff'])


def audit(data, source_hash='', samples=4000):
    rows = prepare(data)
    blocks = {}
    for row in rows:
        if row['season'] >= 2023:
            blocks.setdefault(row['feature_asof'], []).append(row)
    results = {exp['id']: [] for exp in EXPERIMENTS}
    for key, test in sorted(blocks.items()):
        cutoff = min(r['_asof'] for r in test)
        try:
            oldest = cutoff.replace(year=cutoff.year-2)
        except ValueError:
            oldest = cutoff.replace(year=cutoff.year-2, day=28)
        train = [r for r in rows if oldest <= r['_kickoff'] and r['_available'] < cutoff]
        if len(train) < 80:
            continue
        weights = np.array([2 ** (-(cutoff-r['_kickoff']).total_seconds()/86400/365) for r in train])
        y = np.array([r['home_margin'] for r in train])
        for exp in EXPERIMENTS:
            b = np.array([[r[f] for f in exp['baseline']] for r in train], dtype=float)
            z = np.array([[r[f] for f in exp['signal']] for r in train], dtype=float)
            bt = np.array([[r[f] for f in exp['baseline']] for r in test], dtype=float)
            zt = np.array([[r[f] for f in exp['signal']] for r in test], dtype=float)
            fitted = overlap_fit(b, z, y, weights, bt, zt)
            for i, g in enumerate(test):
                results[exp['id']].append(dict(gameId=g['game_id'], season=g['season'], week=g['week'], cutoff=key,
                    actual=g['home_margin'], market=g['market_home_margin'], trainCount=len(train),
                    trainOverlap=fitted['train_overlap'], activeSignals=fitted['active_signals'],
                    **{field: float(fitted[field][i]) for field in ['baseline', 'full', 'new', 'full_add', 'new_add', 'projected_add', 'test_total', 'test_remainder']}))
    family = len(EXPERIMENTS)*3
    experiments = []
    for exp in EXPERIMENTS:
        values = results[exp['id']]
        summary = metrics(values)
        if summary is None:
            raise ValueError('Insufficient eligible development games.')
        keys = [r['cutoff'] for r in values]
        changes = {ref: [abs(r['new']-r['actual'])-abs(r[ref]-r['actual']) for r in values] for ref in ['full', 'baseline']}
        comparisons = {ref: dict(delta=float(np.mean(v)), interval=interval(v, keys, family, samples)) for ref, v in changes.items()}
        selected = [r for r in values if abs(r['new']-r['full']) >= 1.]
        market_values = [(r['actual']-r['market'])*np.sign(r['new']-r['full']) for r in selected]
        market_interval = interval(market_values, [r['cutoff'] for r in selected], family, samples)
        periods = [dict(label=str(year) if year != 2025 else '2025 weeks 1–9', **metrics([r for r in values if r['season'] == year])) for year in [2023, 2024, 2025]]
        repeats = all(p['newMae'] < p['baselineMae'] and p['newMae'] < p['fullMae'] and p['directional']['meanMarketError'] is not None and p['directional']['meanMarketError'] > 0 for p in periods[1:])
        improves = all(c['interval'] is not None and c['interval'][1] < 0 for c in comparisons.values())
        candidate = improves and repeats and len(selected) >= 50 and market_interval is not None and market_interval[0] > 0
        total = sum(r['test_total'] for r in values)
        overlap = 1-sum(r['test_remainder'] for r in values)/total if total > 1e-10 else None
        experiments.append(dict(**exp, **summary, comparisons=comparisons, marketErrorInterval=market_interval,
            signalExplainedOutOfSample=overlap, repeated=repeats,
            status='Exact duplicate control removed' if exp['id'] == 'home' else 'Candidate for price-timed validation' if candidate else 'No repeatable market edge established',
            examples=sorted(values, key=lambda r: abs(r['new']-r['full']), reverse=True)[:5], periods=periods))
        experiments[-1]['firstPredictions'] = values[:3]
    return dict(version=1, generatedAt=datetime.now(timezone.utc).isoformat(), sourceSha256=source_hash,
        games=experiments[0]['games'], settings=dict(trainingYears=2, halfLifeDays=365, alpha=20, minimumTraining=80,
            minimumDirectionalCorrectionPoints=1, bootstrapSamples=samples, familyComparisons=family, individualIntervalConfidence=1-.05/family),
        experiments=experiments,
        holdout=dict(season=2025, fromWeek=10, evaluated=False),
        method=[
            'Fit a baseline on earlier games. Learn the added signal’s standalone points effect separately, with no second intercept.',
            'Project the signal onto baseline inputs with training-only weighted least squares. This measures linear predictability, not causal attribution.',
            'Compare baseline + full standalone effect with baseline + a newly learned effect of only the unprojected signal. Baseline coefficients stay fixed.',
            'Correlated inputs are not automatically double counted; reparameterizing an unregularized joint linear model alone cannot create an edge.',
            'Full-add is an intentionally constructed overlap stress test, not a reconstruction of any sportsbook’s model.',
            'Market alignment uses only games where new-only minus full-add is at least one point in magnitude, chosen without target outcomes. It is a directional diagnostic, not an executable betting rule.',
            'Approximate intervals resample weekly blocks and adjust for 21 current-audit checks. Earlier inspected research and all future selection choices still require an untouched final test.',
        ],
        deferred=[
            dict(name='New injury penalty versus absence already in recent results', needed='Timestamped lineup/availability snapshots and role/usage history. The 2025 injury archive lacks publication/modification times.'),
            dict(name='Weather-adjusted baseline plus another weather penalty', needed='Archived pregame forecast timestamps and an explicit record of what the baseline already includes; realized weather is insufficient.'),
            dict(name='Travel/fatigue rating plus separate rest penalty', needed='A documented fatigue baseline, travel itinerary/venue history, and timestamped inputs. Current rest-only comparison is not that model.'),
        ],
        limits=['QB identity remains a previous-game proxy, not a verified announced starter.', 'Historical EPA is from current source vintages; source revision effects remain.', 'Archived line times and bookmaker inputs are unknown. This audit cannot prove that Vegas duplicates an adjustment.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('public/football/history.json'))
    parser.add_argument('--output', type=Path, default=Path('public/football/overlap.json'))
    args = parser.parse_args()
    source = args.input.read_bytes(); data = json.loads(source)
    report = audit(data['games'], hashlib.sha256(source).hexdigest())
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps([dict(name=r['name'], explained=r['signalExplainedOutOfSample'], baseline=r['baselineMae'], full=r['fullMae'], new=r['newMae'], alignedSides=r['directional']['sides'], marketError=r['directional']['meanMarketError'], status=r['status']) for r in report['experiments']], indent=2))


if __name__ == '__main__':
    main()
