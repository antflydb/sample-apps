#!/usr/bin/env python3
"""Download the public-domain NASA corpus used by the hosted demo.

    python3 scripts/fetch-nasa-corpus.py corpus/

writes
    corpus/s3/photos/*.jpg    NASA Image and Video Library photos
    corpus/s3/audio/*.mp3     short historic clips (skip with --no-audio)
    corpus/drive/reports/*.pdf NASA Technical Reports Server PDFs

Upload corpus/s3 to a bucket and corpus/drive to a Drive folder, then add
both as sources. NASA material is generally not subject to copyright in the
United States; see https://www.nasa.gov/nasa-brand-center/images-and-media/.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "simple-file-search corpus fetcher"}

PHOTO_QUERIES = [
    "hubble servicing mission spacewalk",
    "apollo 11 moon surface",
    "space shuttle launch night",
    "international space station exterior",
    "mars rover surface",
    "astronaut spacewalk earth",
    "saturn v rocket",
    "earth from orbit",
    "lunar roving vehicle",
    "artemis sls rocket",
    "james webb space telescope mirror",
    "aurora from space station",
]
PHOTOS_PER_QUERY = 6

AUDIO = {  # NASA audio clips, all under 30 seconds
    "Kennedy - We choose to go to the Moon.mp3": "https://www.nasa.gov/wp-content/uploads/2015/01/590325main_ringtone_kennedy_WeChoose.mp3",
    "Apollo 11 - One small step.mp3": "https://www.nasa.gov/wp-content/uploads/2015/01/590331main_ringtone_smallStep.mp3",
    "Apollo 11 - The Eagle has landed.mp3": "https://www.nasa.gov/wp-content/uploads/2015/01/590333main_ringtone_eagleHasLanded_extended.mp3",
    "Apollo 13 - Houston, we've had a problem.mp3": "https://www.nasa.gov/wp-content/uploads/2015/01/574928main_houston_problem.mp3",
    "Cassini - Sounds of Saturn.mp3": "https://www.nasa.gov/wp-content/uploads/2015/01/584791main_spookysaturn.mp3",
}

REPORT_QUERIES = [
    "hubble space telescope servicing mission",
    "apollo 11 mission report",
    "space shuttle mission summary",
    "international space station assembly",
    "mars exploration rover",
    "lunar roving vehicle",
]
REPORTS_PER_QUERY = 3
MAX_REPORT_BYTES = 8 << 20

# These extract with no spaces between words (found with
# scripts/audit-extraction.py); leave them out.
EXCLUDE_REPORTS = {
    "Hubble Space Telescope Servicing Mission 3A",
    "International Space Station Carbon Dioxide Removal Assembly Testing",
    "Lunar roving vehicle deployment mechanism",
    "STS-36 Space Shuttle mission report",
    "STS-38 Space Shuttle mission report",
    "The Hubble Space Telescope Servicing Mission 3A Contamination Control Program",
    "The Hubble Space Telescope servicing missions: Past, present, and future operational challenges",
}


def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def get_json(url):
    return json.loads(get(url))


def filename(text, limit=90):
    """A readable file name: the original title, minus characters that
    trouble file systems and URLs."""
    s = re.sub(r'[\\/:*?"<>|#%]+', " ", text)
    s = re.sub(r"\s+", " ", s).strip(" .-")
    if len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0]
    return s or "Untitled"


def photo_title(meta):
    """NASA titles are often just the photo ID; then use the description."""
    title = meta.get("title", "").strip()
    if not title or title.lower() in (meta["nasa_id"].lower(), "untitled"):
        desc = re.sub(r"\s+", " ", meta.get("description", "")).strip()
        # Descriptions often open with "iss061e065379 (Dec. 31, 2019) --- ".
        desc = re.sub(r"^\S+\s*\([^)]*\)\s*-*\s*", "", desc)
        # First sentence: a period followed by a space and a capital letter.
        title = re.split(r"(?<=[a-z0-9][.!?])\s+(?=[A-Z])", desc, maxsplit=1)[0] if desc else meta["nasa_id"]
    return re.sub(r"^KENNEDY SPACE CENTER, FLA\.\s*-*\s*", "", title, flags=re.I)


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def fetch_photos(out):
    seen = set()
    titles = set()  # NASA often posts many frames under one title; keep one
    for q in PHOTO_QUERIES:
        url = "https://images-api.nasa.gov/search?" + urllib.parse.urlencode(
            {"q": q, "media_type": "image", "page_size": 30}
        )
        items = get_json(url)["collection"]["items"]
        n = 0
        for it in items:
            meta = it["data"][0]
            nasa_id = meta["nasa_id"]
            title = photo_title(meta)
            if nasa_id in seen or title.lower() in titles:
                continue
            titles.add(title.lower())
            path = os.path.join(out, "s3", "photos", f"{filename(title)} ({filename(nasa_id, 40)}).jpg")
            if os.path.exists(path):
                seen.add(nasa_id)
                n += 1
            else:
                # ~medium is about 1200px: plenty for embedding and preview.
                for size in ("medium", "small"):
                    asset = f"https://images-assets.nasa.gov/image/{urllib.parse.quote(nasa_id)}/{urllib.parse.quote(nasa_id)}~{size}.jpg"
                    try:
                        save(path, get(asset))
                        seen.add(nasa_id)
                        n += 1
                        break
                    except Exception:
                        continue
            if n >= PHOTOS_PER_QUERY:
                break
        print(f"photos  {q!r}: {n}")


def fetch_audio(out):
    for name, url in AUDIO.items():
        path = os.path.join(out, "s3", "audio", name)
        if not os.path.exists(path):
            save(path, get(url))
        print(f"audio   {name}")


def fetch_reports(out):
    seen = set()
    for q in REPORT_QUERIES:
        url = "https://ntrs.nasa.gov/api/citations/search?" + urllib.parse.urlencode(
            {"q": q, "page.size": 25}
        )
        results = get_json(url).get("results", [])
        n = 0
        for r in results:
            if r.get("distribution") != "PUBLIC" or r["id"] in seen or r["title"].strip() in EXCLUDE_REPORTS:
                continue
            pdfs = [d["links"].get("pdf") for d in r.get("downloads", []) if d.get("links", {}).get("pdf")]
            if not pdfs:
                continue
            path = os.path.join(out, "drive", "reports", f"{filename(r['title'], 120)}.pdf")
            if not os.path.exists(path):
                try:
                    data = get("https://ntrs.nasa.gov" + pdfs[0], timeout=120)
                except Exception as e:
                    print(f"  skip {r['id']}: {e}", file=sys.stderr)
                    continue
                if len(data) > MAX_REPORT_BYTES or not data.startswith(b"%PDF"):
                    continue
                save(path, data)
            seen.add(r["id"])
            n += 1
            if n >= REPORTS_PER_QUERY:
                break
            time.sleep(0.5)
        print(f"reports {q!r}: {n}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out")
    p.add_argument("--no-audio", action="store_true")
    args = p.parse_args()
    fetch_photos(args.out)
    if not args.no_audio:
        fetch_audio(args.out)
    fetch_reports(args.out)


if __name__ == "__main__":
    main()
