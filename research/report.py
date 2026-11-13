"""Format already-evaluated aggregates; never fits models or re-evaluates holdout."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output'

def pct(x):
    return '—' if x is None else '%.2f%%' % (100*x)

def interval(ci):
    return '—' if ci[0] is None else '%s–%s' % (pct(ci[0]),pct(ci[1]))

def score(st):
    ci=st['ci95']
    roi_ci=[None,None] if ci[0] is None else [v*21/11-1 for v in ci]
    return '%s | %s | %s | %s | %s | %s' % (st['n'],pct(st['cover']),interval(ci),pct(st['roi']),interval(roi_ci),'—' if st['zVsBreakEven'] is None else '%.3f'%st['zVsBreakEven'])

def section(lines,title,st):
    lines.extend(['\n### '+title,'','Season | n decided | Cover | Cover 95% | ROI (-110) | ROI 95% | z vs break-even','---|---:|---:|---|---:|---|---:','Combined | '+score(st)])
    for season,row in st['bySeason'].items():
        lines.append(season+' | '+score(row))

def acceptance(development,held):
    seasons={**development['bySeason'],**held['bySeason']}
    positive=sum(row['roi'] is not None and row['roi']>0 for row in seasons.values())
    above=held['cover'] is not None and held['cover']>.524
    most=positive>len(seasons)/2
    return {'above52_4Holdout':above,'positiveSeasons':positive,'totalSeasons':len(seasons),
            'necessaryScreenPass':above and most,'zAtLeast3':held['zVsBreakEven'] is not None and held['zVsBreakEven']>=3}

def main():
    data=json.loads((OUT/'results.json').read_text())
    lines=['# Detailed results — frozen 2026-11-13 study','',
      'Generated from the first final results.json, not a second holdout evaluation. Pushes excluded. Every bet risks one unit; win pays 10/11. Wilson intervals are marginal, not multiplicity-adjusted; date-cluster bootstrap is used for MAE/Brier/CLV differences.',
      '', 'Code commit: '+data['codeCommit'], 'Protocol SHA256: '+data['protocolSha256'], 'Manifest SHA256: '+data['manifestSha256']]
    gates={}
    for sport,d in data['sports'].items():
        lines.extend(['\n## '+sport.upper(),'', 'Input/coverage audit:','```json',json.dumps(d['audit'],indent=2),'```'])
        section(lines,'Closing headline — development',d['developmentBaseline'])
        section(lines,'Closing headline — holdout',d['holdoutBaseline'])
        a=d['anatomyDevelopmentOnly']
        lines.extend(['\n### Error anatomy','', 'Development excess MAE %.5f points on %d games. Groups ranked only in development; holdout does not change their order.'%(a['overallExcessMae'],a['n'])])
        for dimension,rows in a['rankings'].items():
            lines.extend(['\n#### '+dimension,'','Group | Development n | Excess MAE | Date-bootstrap 95% | Held n | Held excess MAE | Held date-bootstrap 95%','---|---:|---:|---|---:|---:|---'])
            held={r['group']:r for r in d['anatomyHoldoutFixedGroups'][dimension]}
            if not rows:
                lines.append('Unavailable or no group meets the frozen minimum sample size.')
            for row in rows:
                h=held[row['group']]
                def fmt(ci):
                    return '—' if ci[0] is None else '[%.4f, %.4f]'%tuple(ci)
                lines.append('%s | %d | %.4f | %s | %d | %s | %s'%(row['group'],row['n'],row['excessMae'],fmt(row['ci95DateBootstrap']),h['n'],'—' if h['excessMae'] is None else '%.4f'%h['excessMae'],fmt(h['ci95DateBootstrap'])))
            for row in rows:
                section(lines,dimension+' '+row['group']+' fixed-headline picks (development)',row['picks'])
                section(lines,dimension+' '+row['group']+' fixed-headline picks (holdout)',held[row['group']]['picks'])
        if 'carryHoldout'in d:
            for period in ['Development','Holdout']:
                c=d['carry'+period]
                lines.extend(['\n### November carry-over — '+period,'', 'Games %d; baseline MAE %.6f; changed MAE %.6f; paired delta %.6f, 95%% date-bootstrap [%s].'%(c['nGames'],c['baselineMae'],c['changedMae'],c['deltaMae'],', '.join('%.6f'%v for v in c['deltaMaeCI95'])),'', 'Season | Games | Fitted reversion | Changed reversion | Original CSV independent MAE | Control MAE | Changed MAE | Delta 95%','---|---:|---:|---:|---:|---:|---:|---'])
                for row in c['bySeason']:
                    lines.append('%s | %d | %.5f | %.5f | %.5f | %.5f | %.5f | %s'%(row['season'],row['nGames'],row['fittedReversion'],row['changedReversion'],row['baseCsvIndMae'],row['baselineMae'],row['changedMae'],row['deltaMaeCI95']))
                section(lines,'Prior control picks — '+period,c['baselinePicks'])
                section(lines,'Prior changed picks — '+period,c['changedPicks'])
            gates[sport+' carry']=acceptance(d['carryDevelopment']['changedPicks'],d['carryHoldout']['changedPicks'])
        if 'nearClose'in d['openingHoldout']:
            for period in ['Development','Holdout']:
                o=d['opening'+period]
                section(lines,'Open-price sensitivity — '+period+' — NOT EXECUTABLE / TIMING LEAKAGE',o['counterfactualOpen'])
                section(lines,'Opening-edge plus move screen at CLOSE — '+period,o['nearClose'])
                lines.extend(['\nCLV is open minus close, signed for pick; positive favors opener. Not a timestamped execution test.','```json',json.dumps(o['clvOpenMinusClose'],indent=2),'```'])
            gates[sport+' opening screen at close']=acceptance(d['openingDevelopment']['nearClose'],d['openingHoldout']['nearClose'])
        for name in ['missDevelopment','missHoldoutRolling','missHoldoutStrict']:
            m=d[name]
            lines.extend(['\n### '+name,'','Probability games: %s; Brier %.8f vs .25; date-bootstrap delta CI %s; log loss %.8f vs %.8f.'%(m['nGames'],m['brier'],m['brierDeltaCI95'],m['logLoss'],m['baselineLogLoss']),
                          'Football models omit unavailable travel coordinates. Strict freezes the meta-classifier before both holdout seasons; underlying supplied OOF forecasts still roll by season.'])
            section(lines,name+' fixed p>=.55 / p<=.45 picks',m['picks'])
            lines.extend(['\nPer-season probability scores and training cutoffs:','```json',json.dumps({'bySeason':m['bySeason'],'fits':[{k:v for k,v in f.items() if k!='coefficientsStandardized'}for f in m['fits']]},indent=2),'```'])
        gates[sport+' market miss']=acceptance(d['missDevelopment']['picks'],d['missHoldoutStrict']['picks'])
    lines.extend(['\n## Frozen candidate acceptance screen','```json',json.dumps(gates,indent=2),'```','\n## Source audit','```json',(OUT/'source-audit.json').read_text(),'```'])
    (OUT/'DETAILS.md').write_text('\n'.join(lines)+'\n')
    (OUT/'acceptance.json').write_text(json.dumps(gates,indent=2)+'\n')
    print('Wrote DETAILS.md and acceptance.json; model evaluation was not rerun')
    print(json.dumps(gates,indent=2))

if __name__=='__main__':
    main()
