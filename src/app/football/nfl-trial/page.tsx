import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Link from 'next/link';
import { Nav } from '@/components/nav';

export const metadata = {
  title: 'NFL Pregame Trial',
  description: 'Compare logged NFL forecasts with the market and check their results.',
};

type Side = 'home' | 'away';
type Decision = Side | 'pass';
type Quote = { book: string; homeSpread: number; homeOdds: number; awayOdds: number };
type Estimate = { coverGivenNoPush: number; breakEven: number; expectedReturn: number };
type Settlement = {
  side: Decision;
  profit?: number;
  closingLinePoints?: number;
  sameSpreadPayoutAdvantage?: number | null;
};
type Forecast = {
  id: string;
  kickoff: string;
  recordedAt: string;
  home: string;
  away: string;
  request: { target: Quote };
  prediction: {
    modelDecision: Decision;
    marketDecision: Decision;
    model: Record<Side, Estimate>;
    market: Record<Side, Estimate>;
  };
  grade: {
    homeCover: boolean | null;
    finalScores: [number, number];
    closingQuote?: Quote;
    strategies: { model: Settlement; market: Settlement };
  } | null;
};

const exportPath = 'football/nfl-trial.json';
const sides = ['away', 'home'] as const;
const percent = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

async function loadForecasts(): Promise<Forecast[]> {
  try {
    const raw = await readFile(join(process.cwd(), 'public', exportPath), 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.forecasts)) throw new Error('Invalid NFL trial export.');
    return data.forecasts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function signed(value: number) {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function line(quote: Quote, side: Side) {
  return `${signed(side === 'home' ? quote.homeSpread : -quote.homeSpread)} (${signed(side === 'home' ? quote.homeOdds : quote.awayOdds)})`;
}

function decisionText(forecast: Forecast, decision: Decision) {
  return decision === 'pass' ? 'Pass · Skip this price' : `${forecast[decision]} ${line(forecast.request.target, decision)}`;
}

function settlementText(settlement: Settlement) {
  if (settlement.side === 'pass') return 'Pass';
  const outcome = settlement.profit === undefined ? 'Graded' : settlement.profit > 0 ? 'Win' : settlement.profit < 0 ? 'Loss' : 'Push';
  const points = settlement.closingLinePoints;
  if (points !== undefined && points !== 0) return `${outcome} · ${signed(points)} pts vs. close`;
  const payout = settlement.sameSpreadPayoutAdvantage;
  if (payout !== undefined && payout !== null && payout !== 0) {
    return `${outcome} · ${signed(Math.round(payout * 100) / 100)} units in payout vs. close`;
  }
  return outcome;
}

function ForecastCard({ forecast }: { forecast: Forecast }) {
  const { prediction, grade } = forecast;
  const quote = forecast.request.target;
  return <article className="panel space-y-4 p-4 sm:p-5">
    <header>
      <h2 className="text-xl font-bold">{forecast.away} at {forecast.home}</h2>
      <p className="mt-1 text-sm text-muted">{eastern.format(new Date(forecast.kickoff))} · {quote.book}</p>
      <p className="mt-1 text-xs text-muted">Forecast recorded {eastern.format(new Date(forecast.recordedAt))}</p>
    </header>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Cover probabilities and price requirements for {forecast.away} at {forecast.home}</caption>
        <thead className="border-b border-border text-xs text-muted">
          <tr><th scope="col" className="py-2 pr-3">Quote</th><th scope="col" className="py-2 pr-3">Market</th><th scope="col" className="py-2 pr-3">SportIQ</th><th scope="col" className="py-2">Break-even</th></tr>
        </thead>
        <tbody>
          {sides.map(side => <tr key={side} className="border-b border-border">
            <th scope="row" className="py-2 pr-3 font-semibold">{forecast[side]} {line(quote, side)}</th>
            <td className="py-2 pr-3 tabular-nums">{percent.format(prediction.market[side].coverGivenNoPush)}</td>
            <td className="py-2 pr-3 font-semibold tabular-nums text-accent">{percent.format(prediction.model[side].coverGivenNoPush)}</td>
            <td className="py-2 tabular-nums">{percent.format(prediction.model[side].breakEven)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <dl className="grid grid-cols-2 gap-3 text-sm">
      {([
        ['market', 'Market decision', prediction.marketDecision],
        ['model', 'SportIQ decision', prediction.modelDecision],
      ] as const).map(([strategy, label, decision]) => {
        const estimates = prediction[strategy];
        const estimatedReturn = decision === 'pass'
          ? Math.max(estimates.home.expectedReturn, estimates.away.expectedReturn)
          : estimates[decision].expectedReturn;

        return <div key={strategy}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="mt-1 font-semibold">{decisionText(forecast, decision)}</dd>
          <dd className="mt-1 text-xs text-muted">
            {decision === 'pass' ? 'Best estimated return' : 'Estimated return'} {percent.format(estimatedReturn)}
            {decision === 'pass' && ' · Below the 3% trial cutoff'}
          </dd>
          {grade && <dd className="mt-1 text-xs text-muted">{settlementText(grade.strategies[strategy])}</dd>}
        </div>;
      })}
    </dl>
    {grade ? <p className="text-sm text-muted">
      Final · {forecast.away} {grade.finalScores[1]} · {forecast.home} {grade.finalScores[0]}
      {grade.closingQuote && <> · Close {forecast.home} {line(grade.closingQuote, 'home')}</>}
    </p> : <p className="text-sm text-muted">Awaiting final score and closing quote.</p>}
  </article>;
}

export default async function NflTrialPage() {
  const forecasts = (await loadForecasts()).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const graded = forecasts.filter(forecast => forecast.grade).length;
  return <><Nav /><main className="mx-auto max-w-5xl space-y-6 px-4 pb-28 pt-8 sm:px-6">
    <Link href="/football" className="text-sm text-accent underline">Football Lab</Link>
    <header className="border-b border-border pb-5">
      <p className="text-xs font-bold uppercase tracking-wider text-accent">NFL research</p>
      <h1 className="mt-2 font-display text-4xl font-black sm:text-5xl">Pregame trial</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-strong">Compare what the market and SportIQ think each team’s chances are of beating the spread at the listed sportsbook.</p>
    </header>
    <section className="panel space-y-2 p-4 text-sm leading-relaxed sm:p-5" aria-labelledby="trial-guide">
      <h2 id="trial-guide" className="font-bold">How to read the trial</h2>
      <p><strong>Pass means skip this price.</strong> Neither side reached the trial’s minimum estimated return of 3%. A different spread or price could change the decision.</p>
      <p><strong>Break-even</strong> is how often the bet needs to win to cover its cost over time. At −110, that’s 52.4%. Compare that number with the Market or SportIQ estimate for the same side.</p>
      <p className="text-xs text-muted">The cover and break-even columns exclude pushes, when the spread lands exactly and the stake is returned. The trial includes pushes when estimating return.</p>
    </section>
    {forecasts.length ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted">{forecasts.length} logged {forecasts.length === 1 ? 'forecast' : 'forecasts'} · {graded} graded</p>
        <a href={`/${exportPath}`} className="text-accent underline">Download trial records</a>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{forecasts.map(forecast => <ForecastCard key={forecast.id} forecast={forecast} />)}</div>
    </> : <section className="panel p-5">
      <h2 className="text-lg font-bold">No pregame forecasts logged yet</h2>
      <p className="mt-2 text-sm text-muted-strong">Forecasts will appear after the research log has been exported with a timestamped target quote and reference prices from at least two other books.</p>
    </section>}
  </main></>;
}
