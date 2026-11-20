import Link from "next/link";
import { connection } from "next/server";
import { Nav } from "@/components/nav";
import { EmptyState, Note, PageHeader, Section, StatTile, Table } from "@/components/ui/primitives";
import { getAvailabilityView, listSportReports, SPORT_LABELS, type AvailabilityTeam } from "@/lib/model-reports";
import { dateTime, relativeAge, signed, num } from "@/lib/format";
import { availabilitySummary, injuryNewsHref } from "@/lib/availability-display";
import { AvailabilitySummary } from "@/components/availability/summary";

export const dynamic="force-dynamic";
export const metadata={title:"Injuries and availability",description:"Current listed absences, NBA rotation exposure and experimental player impact scenarios, with source dates and coverage gaps."};
const SPORTS=["ncaaf","ncaab","nba","nfl"];

function TeamReport({team,current,nba}:{team:AvailabilityTeam;current:boolean;nba:boolean}) {
  return <div className="min-w-0">
    <h3 className="font-bold">{team.name}{team.qbFlag?<span className="ml-2 text-xs text-[var(--warn)]">QB listed · starter unverified</span>:null}</h3>
    <p className="mt-1 text-xs text-[var(--muted)]">{!nba?"Player status flags; point conversion unvalued":team.outMinutes==null?"Rotation value unavailable":`${team.outMinutes.toFixed(1)} recent minutes listed out · ${team.uncertainMinutes?.toFixed(1)??"—"} unresolved minutes`}</p>
    {team.reason?<p className="mt-1 text-xs text-[var(--muted)]">{team.reason}</p>:null}
    {team.players.length ? <div className="mt-3 overflow-x-auto"><Table caption={`${team.name} listed availability`}>
      <thead><tr><th>Player</th><th>Status</th>{nba?<><th>Recent min / 48</th><th>Team change if out alone</th></>:null}<th>Report</th></tr></thead>
      <tbody>{team.players.map(p=><tr key={p.athleteId??p.name}>
        <td><span className="font-semibold">{p.name}</span><div className="text-xs text-[var(--muted)]">{p.position}{p.note?` · ${p.note}`:""}</div></td>
        <td>{p.status}{p.stale?<p className="text-xs">Older than 7 days · not valued</p>:null}{p.contradictedByAppearance?<p className="text-xs">Played after this Out report · recheck</p>:null}</td>
        {nba?<><td>{p.baselineMinutes==null?"Unvalued":p.baselineMinutes.toFixed(1)}</td>
        <td>{!current?"Stale · recheck":p.impactPointsIfOut==null?"Unvalued":`${signed(p.impactPointsIfOut,1)} pts`}<p className="text-xs text-[var(--muted)]">Experimental association</p></td></>:null}
        <td className="text-xs">{dateTime(p.publishedAt)}{p.sourceUrl?<Link className="block underline" href={p.sourceUrl}>Player source</Link>:null}</td>
      </tr>)}</tbody>
    </Table></div>:<p className="mt-3 text-sm text-[var(--muted)]">No current issues listed in this source. This does not verify a healthy roster.</p>}
  </div>;
}

export default async function InjuriesPage({searchParams}:{searchParams:Promise<{sport?:string}>}) {
  await connection();const params=await searchParams;
  const sport=SPORTS.includes(params.sport??"")?params.sport!:"nba";
  const {report,loadedAt}=getAvailabilityView();const now=Date.parse(loadedAt);
  const upcoming=(listSportReports().find(r=>r.sport===sport)?.upcoming??[]).filter(g=>Date.parse(g.startsAt)>now).slice(0,30);
  return <div className="min-h-screen"><Nav/><main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <PageHeader kicker="Availability" title="Who is missing, and what changes?" lede="Listed injuries with source dates. NBA values compare possible rotations with the recent five-game rotation; listed-out replacement changes feed the experimental injury-adjusted spread and total. Baseline win probabilities and locked betting terms stay unchanged."/>
    <nav aria-label="Injury report sport" className="flex flex-wrap gap-2">{SPORTS.map(s=><Link key={s} href={`/injuries?sport=${s}`} aria-current={s===sport?"page":undefined} className={`rounded border px-3 py-2 text-sm ${s===sport?"border-[var(--accent)] text-[var(--accent)]":"border-[var(--border)]"}`}>{SPORT_LABELS[s]}</Link>)}</nav>
    <Section title="Check upcoming matchups" description="Open current injury news and verify the source date and announced starters. Search results are source discovery, not a verified report.">
      {upcoming.length?<ul className="grid gap-2 sm:grid-cols-2">{upcoming.map(g=><li key={g.gameId} className="panel p-3"><p className="font-semibold">{g.away} at {g.home}</p><p className="text-xs text-[var(--muted)]">{dateTime(g.startsAt)}</p><a className="mt-1 inline-block text-sm underline" href={injuryNewsHref(`${g.away} at ${g.home}`,sport,g.startsAt)} target="_blank" rel="noopener noreferrer">Check injury news ↗</a></li>)}</ul>:<p className="text-sm">No upcoming matchups in the current schedule.</p>}
    </Section>
    {!report?<EmptyState title="Availability reports not collected yet" detail="The sports refresh collects the report and starts timestamped evaluation." command="python3 -m dirtiq_model availability refresh"/>:<>
      <div className="grid gap-3 sm:grid-cols-3"><StatTile label="Report collected" value={relativeAge(report.generatedAt,now)} detail={dateTime(report.generatedAt)}/><StatTile label="NBA association model" value={report.model?`${report.model.trainingGames} games`:"Unavailable"} detail={report.model?`Training available through ${dateTime(report.model.trainedThrough)}`:"No points are invented"}/><StatTile label="NBA paired evaluation" value={`${report.evaluation.games} games`} detail={report.evaluation.games?`Base MAE ${num(report.evaluation.baselineMae,2)} · scenario ${num(report.evaluation.listedOutScenarioMae,2)}`:"Collecting future evidence; not promoted"}/></div>
      <Note>The injury-adjusted numbers are experimental estimates. Their scenario ranges are not confidence intervals, calibrated probabilities or causal injury values. Questionable, doubtful and probable labels receive no invented chance of playing. No additional stakes are enabled.</Note>
      <Section title={`${SPORT_LABELS[sport]} coverage`} description={report.feeds[sport]?.reason??"A listed status is scoped to the team’s next game. Missing players or teams are not verified healthy."}>
        <p className="text-sm">{report.feeds[sport]?.coverage??"unavailable"} · {report.feeds[sport]?.recentPlayers??0} recent player reports · <Link className="underline" href={report.feeds[sport]?.sourceUrl??"https://www.espn.com"}>ESPN source</Link></p>
        {sport==="nba"?<Link className="text-sm underline" href={report.feeds.nba?.officialSourceUrl??"https://official.nba.com"}>Cross-check the official NBA report</Link>:null}
        {report.feeds[sport]?.coverage==="unavailable"?<Note tone="warn">Current injury coverage is unavailable. No player values are assigned from this feed.</Note>:report.games.filter(g=>g.sport===sport).map(g=><article key={g.id} id={g.id} className="panel space-y-4 p-4">
          <div><h2 className="text-lg font-bold">{g.away} at {g.home}</h2><p className="text-xs text-[var(--muted)]">{dateTime(g.startsAt)} · status snapshot {dateTime(g.asOf)}</p><AvailabilitySummary game={g} now={now}/></div>
          <div className="grid gap-6 xl:grid-cols-2"><TeamReport nba={g.sport==="nba"} team={g.contexts.away} current={!availabilitySummary(g,now).stale}/><TeamReport nba={g.sport==="nba"} team={g.contexts.home} current={!availabilitySummary(g,now).stale}/></div>
        </article>)}
      </Section>
      <p className="text-xs text-[var(--muted)]">NBA same priced games: {report.evaluation.pricedGames??0} · baseline MAE {num(report.evaluation.baselineMaeOnPricedGames,2)} · listed-out scenario {num(report.evaluation.listedOutScenarioMaeOnPricedGames,2)} · reference market {num(report.evaluation.marketMae,2)}. Reference medians are not executable offers.</p>
      <details className="note"><summary>How the value is calculated</summary><p className="mt-2">{report.policy}</p><p className="mt-2">Recent rotations are scaled to 240 team minutes per regulation game. Player effects are regularized associations with historical game margins after team and home-field terms. They can be confounded by teammates, role and game state. The same missing minutes are replaced; raw scoring averages are not subtracted from the spread.</p><p className="mt-2">Long absences that already contribute zero minutes to the recent rotation create no new absence penalty. Young players or replacements without enough history remain unvalued. An unavailable value is not zero impact.</p></details>
      {report.failures.length?<Note tone="warn">Refresh errors: {report.failures.join("; ")}</Note>:null}
    </>}
  </main></div>;
}
