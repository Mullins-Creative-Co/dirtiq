#!/usr/bin/env python3
"""List Eldora event coverage URLs that are likely useful for Dirt IQ backfill."""

from __future__ import annotations

import argparse
import html
import re
import urllib.request


DEFAULT_URL = "https://www.eldoraspeedway.com/events/"
KEYWORDS = [
    "dream",
    "world",
    "floracing",
    "late-model",
    "late_model",
    "million",
]


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="replace")


def page_title(page_html: str) -> str:
    title = re.search(r"<title>(.*?)</title>", page_html, flags=re.IGNORECASE | re.DOTALL)
    if not title:
        return "Untitled"
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", title.group(1))).split())


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover Eldora coverage URLs for crown backfill.")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--all", action="store_true", help="Show every coverage URL, not just late model/crown-like links.")
    args = parser.parse_args()

    page = fetch(args.url)
    links = sorted(set(re.findall(r"https://www\.eldoraspeedway\.com/event_coverage/[^\"']+", page)))
    if not args.all:
        links = [link for link in links if any(keyword in link.lower() for keyword in KEYWORDS)]

    print(f"Eldora coverage links from {args.url}: {len(links)}")
    for link in links:
        try:
            title = page_title(fetch(link))
        except Exception:
            title = "Title unavailable"
        print(f"- {title}\n  {link}")


if __name__ == "__main__":
    main()
