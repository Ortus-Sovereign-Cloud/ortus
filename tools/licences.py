"""Every dependency shipped in the Ortus programs, with its licence, as
LICENSES.md (it goes into each release archive). Rust crates come from
`cargo metadata` (normal dependencies of the programs, for Linux), web
packages from each part's package-lock.json (not development ones).
Fails when a licence is not one Ortus takes: permissive only.

    python3 tools/licences.py > LICENSES.md
"""
import glob, json, os, re, subprocess, sys

ALLOWED = {"MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSL-1.0",
           "ISC", "Zlib", "0BSD", "CC0-1.0", "Unlicense", "Unicode-3.0", "Unicode-DFS-2016", "CDLA-Permissive-2.0", "BlueOak-1.0.0"}
# Exceptions an allowed licence may carry (they only add permissions).
ALLOWED_WITH = {"LLVM-exception"}
# The web clients' fonts: the one agreed exception, and only under the SIL
# Open Font License.
FONTS = {"@fontsource-variable/geist", "@fontsource-variable/noto-sans-arabic"}
# Lock entries that give no licence or no SPDX one, for these exact
# versions and exactly that lock value: their own licence files say these
# (checked by hand; a new version, or a lock that says something else,
# fails until it is checked again).
KNOWN = {
    ("pdfjs-dist", "4.10.38", ""): "Apache-2.0",
    ("duck", "0.1.12", "BSD"): "BSD-2-Clause",
    ("@napi-rs/canvas", "0.1.100", ""): "MIT",
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def tokens(expr):
    return re.findall(r"\(|\)|[A-Za-z0-9.+-]+", expr)


def acceptable(expr):
    """An SPDX expression that holds with allowed licences only: OR needs one
    side allowed, AND both, `X WITH e` needs X allowed and e an additive
    exception. Anything it cannot read fails."""
    toks = tokens((expr or "").replace("/", " OR "))
    pos = 0

    def peek():
        return toks[pos] if pos < len(toks) else None

    def take(want=None):
        nonlocal pos
        t = peek()
        if t is None or (want and t != want):
            raise ValueError(expr)
        pos += 1
        return t

    def atom():
        if peek() == "(":
            take("(")
            v = disjunction()
            take(")")
            return v
        name = take()
        if name in ("AND", "OR", "WITH", ")"):
            raise ValueError(expr)
        ok = name in ALLOWED
        if peek() == "WITH":
            take("WITH")
            ok = ok and take() in ALLOWED_WITH
        return ok

    def conjunction():
        v = atom()
        while peek() == "AND":
            take("AND")
            v = atom() and v
        return v

    def disjunction():
        v = conjunction()
        while peek() == "OR":
            take("OR")
            v = conjunction() or v
        return v

    try:
        v = disjunction()
        return v and pos == len(toks)
    except ValueError:
        return False


def crates():
    meta = json.loads(subprocess.check_output(["cargo", "metadata", "--format-version", "1", "--filter-platform", "x86_64-unknown-linux-gnu"], cwd=ROOT))
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
    for lock in glob.glob(os.path.join(ROOT, ".deps", "*", "web", "package-lock.json")):
        for path, info in json.load(open(lock))["packages"].items():
            if not path or info.get("dev") or info.get("devOptional"):
                continue
            name = path.split("node_modules/")[-1]
            version = info.get("version", "")
            licence = info.get("license") or ""
            base = re.sub(r"-(android|darwin|linux|win32|freebsd)-.*$", "", name)
            licence = KNOWN.get((name, version, licence)) or KNOWN.get((base, version, licence)) or licence
            out[(name, version)] = licence
    if not out:
        sys.exit("licences: no web packages found: run ci/fetch.sh first")
    return [("npm", n, v, l, "") for (n, v), l in out.items()]


def main():
    rows = sorted(crates() + web(), key=lambda r: (r[0], r[1].lower(), r[2]))
    bad = [r for r in rows if not (acceptable(r[3]) or (r[1] in FONTS and r[3] == "OFL-1.1"))]
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
