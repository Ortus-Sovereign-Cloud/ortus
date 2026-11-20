#!/usr/bin/env python3
"""Copies every story step from the design (ortus-brand/design/tools/
generators/story.py) into stories/steps.json, with whether it is in V1.

Run it again when the stories change:
    python3 stories/tools/import-steps.py ../ortus-brand/design/tools/generators/story.py
"""
import ast
import json
import sys
from pathlib import Path

# Steps the plan (GOAL.md) leaves out of V1 although their board may be V1,
# and steps on V2 boards that V1 still covers in its own way.
OUT_OF_V1 = {"S1.11", "S2.6", "S2.7", "S3.5", "S3.9"}
# S1.1 (QR sign-in at a workstation) and S3.3–4 (laptop first boot) use
# Ortus OS boards. V1 covers their purpose on the web: signing in with a
# passkey, and enrolling the phone as the key.
V1_ON_THE_WEB = {"S1.1": "Signs in on the web with a passkey (V1 stand-in for the workstation QR sign-in).",
                 "S3.3–4": "Picks her language and enrols her phone as her key (V1 stand-in for the laptop first boot)."}

source = Path(sys.argv[1]).read_text()
tree = ast.parse(source)
expr = next(node.value for node in tree.body
            if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "STORIES" for t in node.targets))
stories = eval(compile(ast.Expression(expr), "story.py", "eval"), {"__builtins__": {}, "dict": dict})
steps = []
for story in stories:
    for (sid, time, who, text, board, release, _status) in story["steps"]:
        if story["k"] == "s4" or sid in OUT_OF_V1:
            v1 = False
        elif sid in V1_ON_THE_WEB:
            v1 = True
        else:
            v1 = release == "V1"
        steps.append({"id": sid, "story": story["n"], "title": story["title"], "time": time, "who": who,
                      "text": text, "board": board, "release": release, "v1": v1,
                      **({"v1_scope": V1_ON_THE_WEB[sid]} if sid in V1_ON_THE_WEB else {})})
out = Path(__file__).resolve().parent.parent / "steps.json"
out.write_text(json.dumps(steps, ensure_ascii=False, indent=2) + "\n")
print(f"{len(steps)} steps, {sum(s['v1'] for s in steps)} in V1 -> {out}")
