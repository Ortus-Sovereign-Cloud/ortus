"""Every dependency shipped in the Ortus programs, with its licence, as
LICENSES.md (it goes into each release archive). Rust crates come from
`cargo metadata` (normal dependencies of the programs, for Linux), web
packages from each part's package-lock.json (not development ones).
Fails when a licence is not one Ortus takes: permissive only.

    python3 tools/licences.py > LICENSES.md
"""
import glob, json, os, re, subprocess, sys

ALLOWED = {"MIT", "MIT-0", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-2-Clause", "BSD-3-Clause", "BSL-1.0",
           "ISC", "Zlib", "0BSD", "CC0-1.0", "Unlicense", "Unicode-3.0", "Unicode-DFS-2016", "CDLA-Permissive-2.0", "BlueOak-1.0.0"}
# The fonts of the web clients (SIL Open Font License), the one agreed exception.
EXCEPTIONS = {"@fontsource-variable/geist", "@fontsource-variable/noto-sans-arabic"}
# Packages whose lock entry gives no (or an old-style) licence: their own
# licence files say these.
KNOWN = {"pdfjs-dist": "Apache-2.0", "duck": "BSD-2-Clause", "@napi-rs/canvas": "MIT"}


def acceptable(expr):
    """An SPDX expression any of whose OR choices is all allowed."""
    expr = (expr or "").replace("/", " OR ").replace("(", " ").replace(")", " ")
    for choice in re.split(r"\s+OR\s+", expr):
        parts = [p.strip() for p in re.split(r"\s+AND\s+", choice) if p.strip()]
        if parts and all(p in ALLOWED for p in parts):
            return True
    return False


def crates():
    meta = json.loads(subprocess.check_output(["cargo", "metadata", "--format-version", "1", "--filter-platform", "x86_64-unknown-linux-gnu"], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    pkgs = {p["id"]: p for p in meta["packages"]}
    seen, todo = set(), list(meta["workspace_members"])
    while todo:
        id = todo.pop()
        if id in seen:
            continue
        seen.add(id)
        for dep in nodes[id]["deps"]:
            if any(k["kind"] in (None, "build") for k in dep["dep_kinds"]):
                todo.append(dep["pkg"])
    out = []
    for id in seen:
        p = pkgs[id]
        if p["source"] is None and id in meta["workspace_members"]:
            continue
        out.append(("crate", p["name"], p["version"], p.get("license") or "", p.get("repository") or ""))
    return out


def web():
    out = {}
    for lock in glob.glob(".deps/*/web/package-lock.json"):
        for path, info in json.load(open(lock))["packages"].items():
            if not path or info.get("dev") or info.get("devOptional"):
                continue
            name = path.split("node_modules/")[-1]
            known = KNOWN.get(name) or KNOWN.get(name.split("-android")[0].split("-darwin")[0].split("-linux")[0].split("-win32")[0])
            out[(name, info.get("version", ""))] = known or info.get("license", "")
    return [("npm", n, v, l, "") for (n, v), l in out.items()]


def main():
    rows = sorted(crates() + web(), key=lambda r: (r[0], r[1].lower(), r[2]))
    bad = [r for r in rows if not acceptable(r[3]) and r[1] not in EXCEPTIONS]
    print("# Licences of what Ortus ships\n")
    print(f"Ortus is MIT OR Apache-2.0. These are the {len(rows)} parts others wrote that the programs carry (Rust crates in the binary, packages in the web clients), with their licences. The web clients' fonts are under the SIL Open Font License.\n")
    print("| Kind | Name | Version | Licence |\n| --- | --- | --- | --- |")
    for kind, name, version, licence, _ in rows:
        print(f"| {kind} | {name} | {version} | {licence or '(none given)'} |")
    for kind, name, version, licence, _ in bad:
        print(f"licences: {kind} {name} {version} has '{licence}', not a licence Ortus takes", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
