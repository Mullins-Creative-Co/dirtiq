export type FeaturedRaceStatus = "OPEN" | "CLOSED";

export type FeaturedMarket =
  | "Outright"
  | "Top 3"
  | "Top 5"
  | "Top 10"
  | "Most Laps Led"
  | "Caution Free"
  | "Matchup"
  | "Creative";

export type FeaturedRace = {
  id: string;
  series: string;
  raceName: string;
  track: string;
  location: string;
  dateLabel: string;
  purse: string;
  status: FeaturedRaceStatus;
  note: string;
};

export type FeaturedPick = {
  raceId: string;
  market: FeaturedMarket;
  selection: string;
  line: string;
  model: string;
  edge: string;
  stake: string;
  confidence: "Core" | "Lean" | "Spec";
  note: string;
};

export function featuredPickId(pick: Pick<FeaturedPick, "raceId" | "market" | "selection">) {
  return `${pick.raceId}::${pick.market}::${pick.selection}`;
}

export const featuredRaces: FeaturedRace[] = [
  {
    id: "smoky-n1",
    series: "Lucas Oil Late Model Dirt Series",
    raceName: "Mountain Moonshine Classic - Night One",
    track: "Smoky Mountain Speedway",
    location: "Maryville, TN",
    dateLabel: "Fri, Jun 19",
    purse: "$10,000 to win",
    status: "OPEN",
    note: "High-banked late model race; top-10 floors can price before heat lineups.",
  },
  {
    id: "smoky-finale",
    series: "Lucas Oil Late Model Dirt Series",
    raceName: "Mountain Moonshine Classic - Finale",
    track: "Smoky Mountain Speedway",
    location: "Maryville, TN",
    dateLabel: "Sat, Jun 20",
    purse: "$30,000 to win",
    status: "OPEN",
    note: "Finale money increases aggression and late-race restart chaos.",
  },
  {
    id: "woo-141-n1",
    series: "World of Outlaws Late Model Series",
    raceName: "Maribel Late Model Showdown - Night One",
    track: "141 Speedway",
    location: "Maribel, WI",
    dateLabel: "Fri, Jun 19",
    purse: "WoO payout TBA",
    status: "OPEN",
    note: "New WoO Late Model stop; adaptability gets weighted more than track history.",
  },
  {
    id: "woo-141-finale",
    series: "World of Outlaws Late Model Series",
    raceName: "Maribel Late Model Showdown - Finale",
    track: "141 Speedway",
    location: "Maribel, WI",
    dateLabel: "Sat, Jun 20",
    purse: "WoO payout TBA",
    status: "OPEN",
    note: "Second-night notebook creates overreaction edges from night-one results.",
  },
];

export const featuredPicks: FeaturedPick[] = [
  {
    raceId: "smoky-n1",
    market: "Outright",
    selection: "Ricky Thornton Jr.",
    line: "+420",
    model: "23.9%",
    edge: "+4.7%",
    stake: "0.70u",
    confidence: "Core",
    note: "Cleanest mix of qualifying speed and high-banked late-model balance.",
  },
  {
    raceId: "smoky-n1",
    market: "Top 3",
    selection: "Jonathan Davenport",
    line: "+145",
    model: "43.6%",
    edge: "+2.8%",
    stake: "0.35u",
    confidence: "Lean",
    note: "Only playable after entry confirmation; his independent schedule can skip non-crown-jewel nights.",
  },
  {
    raceId: "smoky-n1",
    market: "Top 5",
    selection: "Brandon Overton",
    line: "+135",
    model: "46.9%",
    edge: "+4.3%",
    stake: "0.45u",
    confidence: "Lean",
    note: "Official Smoky results support: 2024 Moonshine Night 2 winner from pole, Night 1 P7 from P5, and 2026 Tipoff leader before crash.",
  },
  {
    raceId: "smoky-n1",
    market: "Top 5",
    selection: "Hudson O'Neal",
    line: "+105",
    model: "52.8%",
    edge: "+4.0%",
    stake: "0.55u",
    confidence: "Lean",
    note: "Better early-week profile as a finish prop than an outright at a high-banked track.",
  },
  {
    raceId: "smoky-n1",
    market: "Top 10",
    selection: "Mike Marlar",
    line: "-210",
    model: "76.4%",
    edge: "+8.7%",
    stake: "1.10u",
    confidence: "Core",
    note: "Regional comfort plus national pace makes the floor attractive.",
  },
  {
    raceId: "smoky-n1",
    market: "Matchup",
    selection: "Ricky Thornton Jr. over Brandon Sheppard",
    line: "-108",
    model: "55.0%",
    edge: "+3.1%",
    stake: "0.35u",
    confidence: "Lean",
    note: "RTJ grades slightly better on current Lucas pace if both start within two rows.",
  },
  {
    raceId: "smoky-n1",
    market: "Caution Free",
    selection: "Longest green run over 21.5 laps",
    line: "-102",
    model: "56.7%",
    edge: "+6.2%",
    stake: "0.55u",
    confidence: "Lean",
    note: "Night one has a better rhythm-run profile than the finale.",
  },
  {
    raceId: "smoky-finale",
    market: "Outright",
    selection: "Jimmy Owens",
    line: "+900",
    model: "14.1%",
    edge: "+4.1%",
    stake: "0.35u",
    confidence: "Lean",
    note: "Value if the track slows and patience beats first-lap burst.",
  },
  {
    raceId: "smoky-finale",
    market: "Top 5",
    selection: "Brandon Overton",
    line: "+120",
    model: "49.6%",
    edge: "+4.1%",
    stake: "0.50u",
    confidence: "Lean",
    note: "Track-style transfer play: Overton grades up on Smoky plus 411, Boyd's, Rome, Dixie, Cherokee, and East Alabama high-banked Southeast profiles.",
  },
  {
    raceId: "smoky-finale",
    market: "Top 5",
    selection: "Ricky Thornton Jr.",
    line: "-118",
    model: "59.0%",
    edge: "+4.8%",
    stake: "0.70u",
    confidence: "Core",
    note: "Finale card should preserve more edge in top-five form than in a compressed outright market.",
  },
  {
    raceId: "smoky-finale",
    market: "Top 3",
    selection: "Hudson O'Neal",
    line: "+160",
    model: "40.2%",
    edge: "+1.7%",
    stake: "0.25u",
    confidence: "Spec",
    note: "Podium flyer if night-one speed carries into the higher-money program.",
  },
  {
    raceId: "smoky-finale",
    market: "Matchup",
    selection: "Mike Marlar over Devin Moran",
    line: "+110",
    model: "51.1%",
    edge: "+3.5%",
    stake: "0.25u",
    confidence: "Spec",
    note: "Local/regional comfort can matter if the finale turns slick and technical.",
  },
  {
    raceId: "smoky-finale",
    market: "Creative",
    selection: "Hard charger from rows 7-10",
    line: "+260",
    model: "33.6%",
    edge: "+5.8%",
    stake: "0.20u",
    confidence: "Spec",
    note: "Finale attrition creates plus-position ROI for mid-pack national cars.",
  },
  {
    raceId: "woo-141-n1",
    market: "Outright",
    selection: "Bobby Pierce",
    line: "+380",
    model: "25.1%",
    edge: "+4.3%",
    stake: "0.70u",
    confidence: "Core",
    note: "WoO form plus cushion aggression if the top lane comes in.",
  },
  {
    raceId: "woo-141-n1",
    market: "Most Laps Led",
    selection: "Tyler Erb",
    line: "+575",
    model: "20.2%",
    edge: "+5.4%",
    stake: "0.25u",
    confidence: "Spec",
    note: "Clean-air conversion profile keeps leader equity elevated if he starts up front.",
  },
  {
    raceId: "woo-141-finale",
    market: "Matchup",
    selection: "Tyler Erb over Nick Hoffman",
    line: "+104",
    model: "52.9%",
    edge: "+3.9%",
    stake: "0.35u",
    confidence: "Lean",
    note: "Plus-money edge from late-feature passing and recent confidence.",
  },
  {
    raceId: "woo-141-finale",
    market: "Creative",
    selection: "Two of model top four both podium",
    line: "+310",
    model: "28.9%",
    edge: "+4.5%",
    stake: "0.15u",
    confidence: "Spec",
    note: "Correlation ticket if front-row speed controls the podium.",
  },
];
