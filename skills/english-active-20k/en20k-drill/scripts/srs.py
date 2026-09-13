#!/usr/bin/env python3
"""SRS scheduler for the en20k chunk bank. Stdlib only.

Bank file: english-active-20k/data/bank.json  (override with EN20K_BANK env)

Commands:
  due [n]                      list up to n due chunks (default 10)
  grade ID SCORE               score one chunk 0-3 and reschedule
  grade-batch "id:score,..."   batch scoring
  stats                        bank statistics
  add --chunk "..." [--gloss "..."] [--type collocation] [--register "..."]
      [--source "..."] [--example "..."]... [--my-example "..."] [--tags a,b]
"""
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

DEFAULT_BANK = Path(__file__).resolve().parents[2] / "data" / "bank.json"
BANK = Path(os.environ.get("EN20K_BANK", str(DEFAULT_BANK)))
TYPES = ("collocation", "phrasal", "idiom", "frame", "single")


def load():
    if not BANK.exists():
        return {"chunks": []}
    data = json.loads(BANK.read_text(encoding="utf-8"))
    data.setdefault("chunks", [])
    return data


def save(bank):
    BANK.parent.mkdir(parents=True, exist_ok=True)
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_date(s):
    if not s or s == "TODAY":
        return date.today()
    return date.fromisoformat(s)


def grade_one(chunk, score):
    s = chunk.setdefault("srs", {})
    s.setdefault("ease", 2.5)
    s.setdefault("interval", 0)
    s.setdefault("reps", 0)
    s.setdefault("lapses", 0)
    if score == 3:
        s["reps"] += 1
        s["streak"] = s.get("streak", 0) + 1
        s["ease"] = min(3.0, s["ease"] + 0.05)
        iv = s["interval"]
        s["interval"] = 1 if iv == 0 else (3 if iv == 1 else max(iv + 1, round(iv * s["ease"])))
        if s["streak"] >= 3:
            chunk["status"] = "active"
    elif score == 2:
        s["streak"] = 0
        s["interval"] = max(1, s["interval"])
    elif score == 1:
        s["streak"] = 0
        s["ease"] = max(1.3, s["ease"] - 0.15)
        s["interval"] = 1
    else:
        s["streak"] = 0
        s["lapses"] += 1
        s["ease"] = max(1.3, s["ease"] - 0.2)
        s["interval"] = 0
        if chunk.get("status") == "active":
            chunk["status"] = "learning"
    s["due"] = (date.today() + timedelta(days=s["interval"])).isoformat()
    s["last"] = date.today().isoformat()
    return s


def cmd_due(n):
    bank = load()
    due = [c for c in bank["chunks"] if parse_date(c.get("srs", {}).get("due", "TODAY")) <= date.today()]
    due.sort(key=lambda c: (parse_date(c["srs"].get("due", "TODAY")),
                            -c.get("srs", {}).get("lapses", 0),
                            0 if c.get("status") == "learning" else 1))
    due = due[:n]
    if not due:
        print("No cards due. Bank has %d chunks." % len(bank["chunks"]))
        return
    print("%-8s %-12s %-6s %-7s %s" % ("id", "due", "iv", "lapses", "chunk — gloss"))
    for c in due:
        s = c.get("srs", {})
        print("%-8s %-12s %-6s %-7s %s — %s" % (
            c.get("id", "?"), s.get("due", "?"), s.get("interval", 0),
            s.get("lapses", 0), c.get("chunk", "?"), c.get("gloss", "")))


def cmd_grade(cid, score):
    bank = load()
    for c in bank["chunks"]:
        if c.get("id") == cid or c.get("id", "").startswith(cid):
            s = grade_one(c, score)
            save(bank)
            print("%s scored %d -> next due %s (interval %dd, ease %.2f, status %s)" % (
                c["id"], score, s["due"], s["interval"], s["ease"], c.get("status", "learning")))
            return
    sys.exit("chunk id not found: %s" % cid)


def cmd_grade_batch(pairs):
    bank = load()
    index = {c.get("id", ""): c for c in bank["chunks"]}
    for pair in pairs.split(","):
        pair = pair.strip()
        if not pair:
            continue
        cid, _, sc = pair.partition(":")
        c = index.get(cid.strip())
        if c is None:
            print("!! not found: %s" % cid)
            continue
        s = grade_one(c, int(sc))
        print("%s scored %s -> due %s" % (c["id"], sc, s["due"]))
    save(bank)


def cmd_stats():
    bank = load()
    chunks = bank["chunks"]
    today = date.today()
    learning = [c for c in chunks if c.get("status") != "active"]
    active = [c for c in chunks if c.get("status") == "active"]
    due_today = [c for c in chunks if parse_date(c.get("srs", {}).get("due", "TODAY")) <= today]
    by_type = {}
    for c in chunks:
        by_type[c.get("type", "?")] = by_type.get(c.get("type", "?"), 0) + 1
    print("total: %d (learning %d / active %d)" % (len(chunks), len(learning), len(active)))
    print("due today: %d" % len(due_today))
    print("by type: %s" % ", ".join("%s %d" % kv for kv in sorted(by_type.items())))
    lapse_kings = sorted(chunks, key=lambda c: -c.get("srs", {}).get("lapses", 0))[:5]
    shown = [c for c in lapse_kings if c.get("srs", {}).get("lapses", 0) > 0]
    if shown:
        print("most-lapsed:")
        for c in shown:
            print("  %s (%d lapses) %s" % (c.get("id"), c["srs"]["lapses"], c.get("chunk", "")))


def cmd_add(args):
    fields = {"--chunk": "chunk", "--gloss": "gloss", "--type": "type", "--register": "register",
              "--source": "source", "--my-example": "my_example"}
    flags = {"--example": "examples", "--tags": "tags"}
    values = {}
    examples = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in fields:
            values[fields[a]] = args[i + 1]
            i += 2
        elif a == "--example":
            examples.append(args[i + 1])
            i += 2
        elif a == "--tags":
            values["tags"] = [t.strip() for t in args[i + 1].split(",") if t.strip()]
            i += 2
        else:
            sys.exit("unknown arg for add: %s" % a)
    if not values.get("chunk"):
        sys.exit("add requires --chunk")
    if values.get("type") and values["type"] not in TYPES:
        sys.exit("type must be one of: %s" % ", ".join(TYPES))
    bank = load()
    cid = "c-%04d" % (len(bank["chunks"]) + 1)
    entry = {
        "id": cid,
        "type": values.get("type", "collocation"),
        "chunk": values["chunk"],
        "gloss": values.get("gloss", ""),
        "register": values.get("register", ""),
        "source": values.get("source", ""),
        "examples": examples,
        "my_example": values.get("my_example", ""),
        "status": "learning",
        "tags": values.get("tags", []),
        "created": date.today().isoformat(),
        "srs": {"due": date.today().isoformat(), "interval": 0, "ease": 2.5,
                "reps": 0, "lapses": 0, "streak": 0},
    }
    bank["chunks"].append(entry)
    save(bank)
    print("added %s: %s" % (cid, values["chunk"]))


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "due":
        cmd_due(int(sys.argv[2]) if len(sys.argv) > 2 else 10)
    elif cmd == "grade" and len(sys.argv) >= 4:
        cmd_grade(sys.argv[2], int(sys.argv[3]))
    elif cmd == "grade-batch" and len(sys.argv) >= 3:
        cmd_grade_batch(sys.argv[2])
    elif cmd == "stats":
        cmd_stats()
    elif cmd == "add":
        cmd_add(sys.argv[2:])
    else:
        print(__doc__)
        sys.exit("bad command")


if __name__ == "__main__":
    main()
