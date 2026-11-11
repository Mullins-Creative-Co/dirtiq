"""Map The Odds API's full team names to the abbreviations the sport reports use."""
from __future__ import annotations

import re
from typing import Dict, Iterable, Optional

SPORT_KEYS: Dict[str, str] = {
    "nfl": "americanfootball_nfl",
    "nba": "basketball_nba",
    "ncaaf": "americanfootball_ncaaf",
    "ncaab": "basketball_ncaab",
    "mlb": "baseball_mlb",
    "nhl": "icehockey_nhl",
}

NFL: Dict[str, str] = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
    "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE",
    "Dallas Cowboys": "DAL", "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
    "Los Angeles Rams": "LA", "Los Angeles Chargers": "LAC", "Las Vegas Raiders": "LV", "Miami Dolphins": "MIA",
    "Minnesota Vikings": "MIN", "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "Seattle Seahawks": "SEA",
    "San Francisco 49ers": "SF", "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}

NBA: Dict[str, str] = {
    "Atlanta Hawks": "ATL", "Brooklyn Nets": "BKN", "Boston Celtics": "BOS", "Charlotte Hornets": "CHA",
    "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE", "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN",
    "Detroit Pistons": "DET", "Golden State Warriors": "GS", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
    "Los Angeles Clippers": "LAC", "LA Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
    "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN", "New Orleans Pelicans": "NO",
    "New York Knicks": "NY", "Oklahoma City Thunder": "OKC", "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI",
    "Phoenix Suns": "PHX", "Portland Trail Blazers": "POR", "San Antonio Spurs": "SA", "Sacramento Kings": "SAC",
    "Toronto Raptors": "TOR", "Utah Jazz": "UTAH", "Washington Wizards": "WSH",
}

NHL: Dict[str, str] = {
    "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF", "Calgary Flames": "CGY",
    "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI", "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ",
    "Dallas Stars": "DAL", "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM", "Florida Panthers": "FLA",
    "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Montréal Canadiens": "MTL", "Montreal Canadiens": "MTL",
    "Nashville Predators": "NSH", "New Jersey Devils": "NJD", "New York Islanders": "NYI", "New York Rangers": "NYR",
    "Ottawa Senators": "OTT", "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS",
    "Seattle Kraken": "SEA", "St Louis Blues": "STL", "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL",
    "Toronto Maple Leafs": "TOR", "Utah Mammoth": "UTA", "Utah Hockey Club": "UTA", "Vancouver Canucks": "VAN",
    "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
}

MLB: Dict[str, str] = {
    "Arizona Diamondbacks": "AZ", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL", "Boston Red Sox": "BOS",
    "Chicago Cubs": "CHC", "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL", "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
    "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL",
    "Minnesota Twins": "MIN", "New York Mets": "NYM", "New York Yankees": "NYY", "Oakland Athletics": "ATH",
    "Athletics": "ATH", "Sacramento Athletics": "ATH", "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT",
    "San Diego Padres": "SD", "San Francisco Giants": "SF", "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL",
    "St Louis Cardinals": "STL", "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
    "Washington Nationals": "WSH",
}

EXPLICIT: Dict[str, Dict[str, str]] = {"nfl": NFL, "nba": NBA, "nhl": NHL, "mlb": MLB}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


class TeamMapper:
    """Resolve a full team name to a report abbreviation.

    Explicit tables cover NFL, NBA, NHL and MLB. Other sports fall back to matching the
    report's own team list by abbreviation prefix or by nickname tokens, and
    report unresolved names instead of guessing silently."""

    def __init__(self, sport: str, known: Iterable[str] = ()):
        self.sport = sport
        self.explicit = EXPLICIT.get(sport, {})
        self.known = sorted(set(known))
        self.unresolved: Dict[str, int] = {}

    def resolve(self, name: str) -> Optional[str]:
        if name in self.explicit:
            return self.explicit[name]
        n = _norm(name)
        for full, abbr in self.explicit.items():
            if _norm(full) == n:
                return abbr
        if self.known:
            tokens = n.split()
            # exact abbreviation inside the name (e.g. college names like "Ohio State Buckeyes" vs "OSU" won't hit; fine)
            for abbr in self.known:
                if _norm(abbr) in tokens:
                    return abbr
            # single known team whose abbreviation starts with the first word
            first = tokens[0] if tokens else ""
            cands = [a for a in self.known if first and _norm(a).startswith(first[:3])]
            if len(cands) == 1:
                return cands[0]
        self.unresolved[name] = self.unresolved.get(name, 0) + 1
        return None
