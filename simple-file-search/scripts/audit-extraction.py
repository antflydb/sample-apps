#!/usr/bin/env python3
"""Flag PDFs whose extracted text lost its word spacing.

    python3 scripts/audit-extraction.py [--antfly http://127.0.0.1:8080] [--table files]

Some PDFs come back from text extraction with no spaces between words, which
breaks full-text search on them and makes their evidence unreadable. Run this
after indexing; files marked BAD are better left out of a demo corpus.
"""

import argparse
import json
import urllib.request


def query(base, body):
    req = urllib.request.Request(base + "/db/v1/query", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)["responses"][0]["hits"]["hits"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--antfly", default="http://127.0.0.1:8080")
    p.add_argument("--table", default="files")
    args = p.parse_args()
    pdfs = query(args.antfly, {"table": args.table, "fields": ["title"], "limit": 1000,
                               "filter_query": {"term": "pdf", "field": "kind"}})
    for doc in sorted(pdfs, key=lambda h: h["_source"].get("title", "")):
        units = query(args.antfly, {
            "table": args.table, "fields": ["text"], "limit": 30,
            "hierarchy": {"children": {"parent": {"level": "source", "id": doc["_id"]}, "level": "unit"}},
            "order_by": [{"field": "_hierarchy.position"}],
        })
        words = " ".join(u["_source"].get("text", "") for u in units).split()
        mean = sum(map(len, words)) / max(1, len(words))
        print(f"{'BAD' if mean > 12 else 'ok '}  {mean:7.1f}  {doc['_source'].get('title', doc['_id'])}")


if __name__ == "__main__":
    main()
