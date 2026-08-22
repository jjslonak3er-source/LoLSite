#!/usr/bin/env python3
"""Refresh champions.js from Riot Data Dragon."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from fetch_counters import load_champions

ROOT = Path(__file__).resolve().parents[1]


def write_champions(out_path: Path) -> str:
    patch, champs = load_champions()
    payload = {
        "patch": patch,
        "champions": [
            {
                "id": champ["id"],
                "key": champ["key"],
                "name": champ["name"],
                "tags": champ.get("tags") or [],
            }
            for champ in champs
        ],
    }
    out_path.write_text(
        "window.RIFT_DRAFT_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(payload['champions'])} champions ({patch}) to {out_path}")
    return patch


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ROOT / "champions.js")
    args = parser.parse_args()
    write_champions(args.out)


if __name__ == "__main__":
    main()
