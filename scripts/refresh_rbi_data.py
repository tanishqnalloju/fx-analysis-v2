#!/usr/bin/env python3
"""Refresh public/data/reserves.json from RBI's public HTML pages (no API keys).

Sources (all www.rbi.org.in HTML views; rbidocs PDF/XLSX downloads are bot-protected):
  * Weekly Statistical Supplement (WSS) Table 2 - weekly FX reserves (total, FCA, gold, SDR, IMF RTP)
  * RBI Bulletin Current Statistics T4 - Sale/Purchase of US$ by RBI (monthly, ~2-month lag)
  * RBI Bulletin Current Statistics NEER/REER table (T36/T37) - 6- and 40-currency indices (monthly)
  * Handbook of Statistics 2025-26 Tables 207, 211, 145 (for revised history)
  * External debt press releases (quarterly, Mar & Jun quarters published by RBI)
  * MPC resolutions (Annualpolicy.aspx) and the FOMC calendar (federalreserve.gov) for event markers

Usage:  python3 scripts/refresh_rbi_data.py [--cache /tmp] [--out public/data/reserves.json]
The cache dir keeps raw HTML so re-runs are cheap; delete it to force refetch.
Never interpolates: a month/week missing at source is simply absent in the output.
"""
import argparse, concurrent.futures as cf, datetime as dt, html, http.cookiejar, json, os, re, statistics, subprocess, sys, time, urllib.parse, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--cache", default="/tmp")
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "data", "reserves.json"))
ap.add_argument("--from-year", type=int, default=2019)
A = ap.parse_args()
C = A.cache
for d in ("rb", "wss", "hbx", "mpc"):
    os.makedirs(os.path.join(C, d), exist_ok=True)
TODAY = dt.date.today().isoformat()
UA = "Mozilla/5.0 (X11; Linux x86_64)"
RBI = "https://www.rbi.org.in/Scripts/"
MON = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}

# ---------------------------------------------------------------- fetch helpers
def curl(url, path):
    if not os.path.exists(path) or os.path.getsize(path) < 1000:
        for k in range(3):
            subprocess.run(["curl", "-s", "-m", "60", "-A", UA, "-o", path, url])
            if os.path.exists(path) and os.path.getsize(path) > 1000: break
            time.sleep(2 + 3 * k)
    return open(path, encoding="utf8", errors="ignore").read()

def opener():
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    o.addheaders = [("User-Agent", UA)]
    return o

def get(o, u, data=None):
    err = None
    for k in range(3):
        try: return o.open(u, data, timeout=60).read().decode("utf8", "ignore")
        except Exception as e: err = e; time.sleep(2 + 3 * k)
    raise err

def hidden(s):
    return {m.group(1): html.unescape(m.group(2)) for m in re.finditer(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', s)}

def text(s):
    s = re.sub(r"<(script|style).*?</\1>", "", s, flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)))

def rows(s):
    out = []
    for tb in re.findall(r"<table[^>]*>(.*?)</table>", s, flags=re.S):
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, flags=re.S):
            cells = [html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S)]
            if any(cells) and len(" ".join(cells)) < 600: out.append(cells)
    return out

def num(x):
    x = x.replace(",", "").replace("–", "-").replace("−", "-").strip()
    if x in ("-", "", "..", "…"): return None
    try: return float(x)
    except ValueError: return None

def find(rs, pred, start=0):
    if start is None: return None
    for i in range(start, len(rs)):
        if rs[i] and pred(rs[i][0]): return i
    return None

def bull_url(i): return f"{RBI}BS_ViewBulletin.aspx?Id={i}"
def pub_url(i): return f"{RBI}PublicationsView.aspx?id={i}"
def pr_url(p): return f"{RBI}BS_PressReleaseDisplay.aspx?prid={p}"

# ---------------------------------------------------------------- 1. weekly reserves (WSS)
NUM_INT = r"(-?[\d,]+|–|-)"
NUM_DEC = r"(–?-?[\d,]+\.\d+|–|-)"
def wss_month_dates(y, m):
    cp = f"{C}/wss/cal_{y}_{m}.json"
    if os.path.exists(cp): return json.load(open(cp))
    o = opener(); u = RBI + "BS_viewWssExtract.aspx"
    s = get(o, u); f = hidden(s); f.update({"__EVENTTARGET": "ddlYear", "ddlYear": str(y), "ddlMonth": "0"})
    s = get(o, u, urllib.parse.urlencode(f).encode()); f = hidden(s); f.update({"__EVENTTARGET": "ddlMonth", "ddlYear": str(y), "ddlMonth": str(m)})
    s = get(o, u, urllib.parse.urlencode(f).encode())
    d = sorted({x for x in re.findall(r"SelectedDate=(\d+/\d+/\d{4})", s) if int(x.split("/")[0]) == m and x.endswith(str(y))})
    json.dump(d, open(cp, "w")); return d

def wss_week(pub):
    cp = f"{C}/wss/w_{pub.replace('/', '-')}.json"
    if os.path.exists(cp):
        r = json.load(open(cp))
        if r.get("total") and r.get("asOn"): return r
    o = opener(); s = get(o, RBI + "BS_viewWssExtract.aspx?SelectedDate=" + pub)
    ids = re.findall(r"BS_ViewWssExtractdetails\.aspx\?id=(\d+)", s, re.I)
    wid = ids[0] if ids else None
    t = text(s)
    if "Total Reserves" not in t and wid: t = text(get(o, RBI + "BS_ViewWssExtractdetails.aspx?id=" + wid))
    m = re.search(r"Foreign Exchange Reserves\*? Item As on (\w+\.? \d+,? \d{4})", t)
    dec = bool(re.search(r"₹ Bn\.", t[:t.find("Total Reserves") + 1] if "Total Reserves" in t else ""))
    def row(lbl):
        r = re.search(lbl + r"[^0-9\-–]*" + " ".join([NUM_DEC if dec else NUM_INT] * 8), t)
        if not r: return None
        out = []
        for k, g in enumerate(r.groups()):
            if g in ("–", "-"): out.append(None); continue
            v = float(g.replace(",", "").replace("–", "-"))
            out.append(round(v * 100) if (dec and k % 2 == 0) else round(v))
        return out
    rec = {"pub": pub, "id": wid, "asOn": m and m.group(1), "total": row(r"1 Total Reserves"), "fca": row(r"1\.1 Foreign Currency Assets ?#?"),
           "gold": row(r"1\.2 Gold"), "sdr": row(r"1\.3 SDRs"), "imf": row(r"1\.4 Reserve Position in the IMF")}
    json.dump(rec, open(cp, "w")); return rec

def parse_date(a):
    a = a.replace(",", "").replace(".", "")
    for f in ("%B %d %Y", "%b %d %Y"):
        try: return dt.datetime.strptime(a, f).date()
        except ValueError: pass
    raise ValueError(a)

def weekly():
    now = dt.date.today()
    months = [(y, m) for y in range(A.from_year, now.year + 1) for m in range(1, 13) if (y, m) <= (now.year, now.month)]
    with cf.ThreadPoolExecutor(4) as ex: cal = list(ex.map(lambda a: wss_month_dates(*a), months))
    pubs = [d for c in cal for d in c]
    with cf.ThreadPoolExecutor(4) as ex: recs = list(ex.map(wss_week, pubs))
    out = []
    for r in recs:
        if not (r.get("total") and r.get("asOn")): print("WSS skip", r.get("pub"), file=sys.stderr); continue
        d = parse_date(r["asOn"])
        p = dt.datetime.strptime(r["pub"], "%m/%d/%Y").date()
        url = f"{RBI}BS_ViewWssExtractdetails.aspx?id={r['id']}" if r.get("id") else f"{RBI}BS_viewWssExtract.aspx?SelectedDate={r['pub']}"
        g = lambda k, i: (r.get(k) or [None] * 8)[i]
        out.append({"date": d.isoformat(), "pub": p.isoformat(), "src": url,
                    "total": g("total", 1), "fca": g("fca", 1), "gold": g("gold", 1), "sdr": g("sdr", 1), "imf": g("imf", 1),
                    "totalInrCr": g("total", 0), "wow": g("total", 3), "wowFca": g("fca", 3), "wowGold": g("gold", 3)})
    out.sort(key=lambda x: x["date"])
    dedup = {x["date"]: x for x in out}
    return list(dedup.values())

# ---------------------------------------------------------------- 2/3. bulletin tables
def b_months(rs):
    for i, r in enumerate(rs):
        if r and r[0].startswith("Item"):
            yrs = [c for c in r[1:] if re.fullmatch(r"\d{4}", c)]
            ms = [MON.get(c.strip(". ")[:3]) for c in rs[i + 1] if c]
            if len(yrs) < 2 or len(ms) < 3 or None in ms[-3:]: return None
            cur = int(yrs[-1]); lm, pm, am = ms[-1], ms[-2], ms[-3]
            return [(int(yrs[-2]), am), (cur if pm < lm else cur - 1, pm), (cur, lm)]
    return None

def last3(r): return [num(c) for c in r[1:]][-3:]

def parse_t4(s):
    rs = rows(s); ms = b_months(rs)
    if not ms: return None
    i = find(rs, lambda c: "Net Purchase" in c and c.lstrip().startswith("1"))
    ip = find(rs, lambda c: c.startswith("1.1 Purchase"), i); isl = find(rs, lambda c: c.startswith("1.2 Sale"), i)
    ifw = find(rs, lambda c: "Outstanding Net Forward" in c)
    if None in (i, ip, isl): return None
    N, P, S = last3(rs[i]), last3(rs[ip]), last3(rs[isl]); F = last3(rs[ifw]) if ifw is not None else [None] * 3
    res = {}
    for k, (y, m) in enumerate(ms):
        if N[k] is None: continue
        res[f"{y}-{m:02d}"] = dict(purchase=P[k] if P[k] is not None else 0.0, sale=S[k] if S[k] is not None else 0.0, net=N[k], fwd=F[k])
    return res

def parse_neer(s):
    rs = rows(s); ms = b_months(rs)
    if not ms: return None
    out = {f"{y}-{m:02d}": {} for y, m in ms}
    def grab(ib, key):
        for lab, name in (("NEER", "neer"), ("REER", "reer")):
            j = find(rs, lambda c, l=lab: c.endswith(l), ib + 1)
            if j is None or j > ib + 4: continue
            for k, (y, m) in enumerate(ms):
                v = last3(rs[j])[k]
                if v is not None: out[f"{y}-{m:02d}"][name + key] = v
    i6 = find(rs, lambda c: c.startswith("6-Currency"))
    if i6 is not None:
        for j in range(i6, min(i6 + 6, len(rs))):
            if "2015-16" in rs[j][0]: grab(j, "6")
            if "2004-05" in rs[j][0]: grab(j, "6_0405")
    i40 = find(rs, lambda c: c.startswith("40-Currency"))
    if i40 is not None and "2015-16" in rs[i40][0]:
        j = find(rs, lambda c: c.startswith("1. Trade") or c.startswith("1 Trade"), i40)
        if j is not None: grab(j, "40")
    return out

def parse_trade(s):
    """Bulletin 'Foreign Trade' table: merchandise exports/imports (US$ mn) for the year-ago month and the last 5 months."""
    rs = rows(s)
    for i, r in enumerate(rs):
        if r and r[0].startswith("Item") and "Unit" in r:
            ms = [MON.get(c.strip(". ")[:3]) for c in rs[i + 1] if c]
            yrs = [int(c) for c in r if re.fullmatch(r"\d{4}", c)]
            if len(ms) < 6 or None in ms or not yrs: return None
            cur = yrs[-1]; keys = []; y = cur
            for k in range(len(ms) - 1, 0, -1):
                if k < len(ms) - 1 and ms[k] > ms[k + 1]: y -= 1
                keys.append((y, ms[k]))
            keys = keys[::-1]; keys.insert(0, (cur - 1, ms[-1]))
            break
    else: return None
    out = {}
    def usd_after(label):
        j = find(rs, lambda c: re.match(label, c) is not None)
        if j is None or j + 1 >= len(rs): return None
        v = [num(c) for c in rs[j + 1][2:]]
        return v[-len(keys):]
    imp, exp = usd_after(r"2\.? Imports"), usd_after(r"1\.? Exports")
    if not imp: return None
    for k, (y, m) in enumerate(keys):
        if imp[k] is not None: out[f"{y}-{m:02d}"] = dict(imports=imp[k], exports=exp[k] if exp else None)
    return out

def title_of(i):
    t = text(curl(bull_url(i), f"{C}/rb/{i}.html"))
    m = re.search(r"\( \d+ kb \) (?:or \( \d+ kb \) )?(.{0,160}?) Date : (\w+ \d+, \d{4})", t)
    return (m.group(1), m.group(2)) if m else (None, None)

def discover_new_bulletins(known):
    """Probe forward from the newest known NEER-table id for bulletins published after it."""
    last = max(v["NEER"] for v in known.values())
    while True:
        found = None
        for i in range(last + 55, last + 100):
            t, d = title_of(i)
            if t and "Effective Exchange Rate" in t and d not in known:
                found = (i, d); break
        if not found: break
        i, d = found; entry = {"NEER": i}
        for off in (37, 36, 38, 35, 39):
            t, _ = title_of(i - off)
            if t and "Purchase of U.S. Dollar" in t.replace("Sale/ ", "Sale/"): entry["T4"] = i - off; break
        known[d] = entry; last = i
    return known

def bulletins():
    p = os.path.join(os.path.dirname(__file__), "rbi_bulletin_ids.json")
    known = discover_new_bulletins(json.load(open(p)))
    json.dump(known, open(p, "w"), indent=0)
    order = sorted(known, key=lambda d: dt.datetime.strptime(d, "%b %d, %Y"))
    iv, ne, notes, tr = {}, {}, [], {}
    for d in order:
        if "NEER" in known[d]:
            i = known[d]["NEER"] - 5; s_ = curl(bull_url(i), f"{C}/rb/{i}.html")
            if re.search(r"Foreign Trade Date :", text(s_)):
                r = parse_trade(s_)
                for m, x in (r or {}).items(): tr[m] = dict(x, src=bull_url(i), srcLabel=f"RBI Bulletin {d}, Current Statistics: Foreign Trade")
            else: notes.append(f"{d} Foreign Trade table not found at Id {i}")
        for kind, fn, store in (("T4", parse_t4, iv), ("NEER", parse_neer, ne)):
            if kind not in known[d]: continue
            i = known[d][kind]; r = fn(curl(bull_url(i), f"{C}/rb/{i}.html"))
            if not r: notes.append(f"{d} {kind} (Id {i}): HTML table not published (PDF only) - skipped"); continue
            for m, x in r.items():
                x = {k: v for k, v in x.items() if v is not None}
                if not x: continue
                old = store.get(m, {}); old.update(x); old["src"] = bull_url(i); old["srcLabel"] = f"RBI Bulletin {d}, Current Statistics {'T4' if kind == 'T4' else 'NEER/REER'}"
                store[m] = old
    return iv, ne, notes, tr

# ---------------------------------------------------------------- Handbook tables
def hb_blocks(s, width):
    rs = rows(s); yr = [None, None]; out = []
    for r in rs:
        for k, sd in enumerate([r[:width], r[width:2 * width]]):
            if not sd: continue
            if re.fullmatch(r"\d{4}", sd[0]): yr[k] = int(sd[0])
            elif sd[0][:3] in MON and yr[k]: out.append((yr[k], MON[sd[0][:3]], sd[1:]))
    return out

HB = {"t211": 24036, "t207": 24032, "t145": 23970, "t215": 24040}
def handbook():
    s211 = curl(pub_url(HB["t211"]), f"{C}/hbx/{HB['t211']}.html")
    t211 = {}
    for y, m, c in hb_blocks(s211, 4):
        p, sl, f = [num(x) for x in c[:3]]
        if p is None and sl is None and f is None: continue
        p = p or 0.0; sl = sl or 0.0
        t211[f"{y}-{m:02d}"] = dict(purchase=p, sale=sl, net=p - sl, fwd=f, src=pub_url(HB["t211"]), srcLabel="RBI Handbook of Statistics 2025-26, Table 211")
    s207 = curl(pub_url(HB["t207"]), f"{C}/hbx/{HB['t207']}.html")
    t207 = {}
    for y, m, c in hb_blocks(s207, 5):
        v = [num(x) for x in c[:4]]
        if v[0] is not None: t207[f"{y}-{m:02d}"] = dict(neer40=v[0], reer40=v[1])
    s145 = curl(pub_url(HB["t145"]), f"{C}/hbx/{HB['t145']}.html")
    years = None; t145 = {}
    keymap = {"X. Gross External Debt Position": "total", "IX. Short-term Debt": "st", "Debt Service Ratio (%)": "dsr", "Short-term Debt as % of Total Debt": "stPct", "Debt to GDP Ratio (%)": "debtGdp"}
    for r in rows(s145):
        if r[0].startswith("Item"): years = [int(x) for x in r[1:] if re.fullmatch(r"\d{4}", x)]; continue
        k = keymap.get(r[0])
        if years and k:
            for y, v in zip(years, [num(x) for x in r[1:]]): t145.setdefault(y, {})[k] = v
    return t211, t207, t145

# ---------------------------------------------------------------- external debt releases
ED_PRIDS = [63700, 63041, 61322, 60729, 58788, 58156, 56460, 55959, 54457, 53948]
def ext_debt():
    out = []; table5 = []
    for p in ED_PRIDS:
        s = curl(pr_url(p), f"{C}/ed{p}.html"); t = text(s)
        rel = dt.datetime.strptime(re.search(r"Date : (\w+ \d+, \d{4})", t).group(1), "%b %d, %Y").date().isoformat()
        q = re.search(r"External Debt as at the end of (\w+ \d{4})", t).group(1)
        qd = dt.datetime.strptime(q, "%B %Y").date()
        qend = (dt.date(qd.year, qd.month % 12 + 1, 1) if qd.month < 12 else dt.date(qd.year + 1, 1, 1)) - dt.timedelta(days=1)
        tot = float(re.search(r"external debt was placed at US\$ ([\d.]+) billion", t).group(1))
        cur = re.search(r"share of ([\d.]+) per cent at end-\w+ \d{4}, followed by (.{0,260}?)\.\s", t)
        shares = {"USD": float(cur.group(1))}
        for name, val in re.findall(r"(Indian rupee|[Yy]en|SDR|[Ee]uro)\s*\d?\s*\(([\d.]+) per cent\)", cur.group(2)):
            shares[{"indian rupee": "INR", "yen": "JPY", "sdr": "SDR", "euro": "EUR"}[name.lower()]] = float(val)
        st = re.search(r"share of short-term debt[^.]*?(?:to|at) ([\d.]+) per cent at end-", t, re.I)
        stres = re.search(r"short-term debt \(original maturity\) to foreign exchange reserves (?:\w+ )*?(?:to|at|was) ([\d.]+) per cent", t, re.I)
        ds = re.search(r"Debt service \(i\.e\., principal repayments and interest payments\)[^.]*? ([\d.]+) per cent of current receipts", t)
        val = re.search(r"((?:Excluding the valuation effect|Valuation effect)[^.]*?(?:\d\.\d[^.]*?)*\.)\s", t)
        rs = rows(s); stbn = None
        i = find(rs, lambda c: c.startswith("B. Short-term Debt (original maturity)"))
        if i is not None:
            v = [num(x) for x in rs[i][1:]]; stbn = v[2] if len(v) > 2 else None
        out.append(dict(quarter=qend.isoformat(), label=q, release=rel, src=pr_url(p), total=tot, shares=shares,
                        stPctTotal=st and float(st.group(1)), stPctReserves=stres and float(stres.group(1)),
                        stUsdBn=stbn, dsr=ds and float(ds.group(1)), valuation=val and val.group(1)))
        if p == ED_PRIDS[0]:
            i5 = find(rs, lambda c: c.startswith("End-March"))
            for r in rs[i5 + 2 if i5 is not None else 0:]:
                m = re.match(r"(\d{4})", r[0] if r else "")
                if not m or len(r) < 8: continue
                v = [num(x.replace("#", "")) for x in r[1:8]]
                table5.append(dict(year=int(m.group(1)), total=v[0], debtGdp=v[1], dsr=v[2], resToDebt=v[3], concPct=v[4], stToRes=v[5], stPct=v[6]))
    out.sort(key=lambda x: x["quarter"])
    return out, table5

# ---------------------------------------------------------------- MPC + FOMC events
def mpc_events():
    o = opener(); u = RBI + "Annualpolicy.aspx"; s0 = get(o, u)
    btn = re.search(r'<input type="submit" name="([^"]+)" value="([^"]*)" id="btn"', s0)
    prids = set()
    for y in range(dt.date.today().year + 1, 2020, -1):
        f = hidden(s0); f["hdnYear"] = str(y)
        if btn: f[btn.group(1)] = btn.group(2)
        s = get(o, u, urllib.parse.urlencode(f).encode())
        prids |= set(re.findall(r"prid=(\d+)", s))
    ev = []
    def one(p):
        t = text(curl(pr_url(p), f"{C}/mpc/{p}.html"))
        d = re.search(r"Date : (\w+ \d+, \d{4})", t); ti = re.search(r"Date : \w+ \d+, \d{4} (.{0,140})", t)
        if not (d and ti and "Resolution of the Monetary Policy Committee" in ti.group(1) and "Minutes" not in ti.group(1)): return None
        rr = re.search(r"(?:decided to|voted to|unanimously)[^.]{0,200}?repo rate[^.]{0,160}?(\d+\.\d+) per cent", t)
        return dict(date=dt.datetime.strptime(d.group(1), "%b %d, %Y").date().isoformat(), prid=int(p), repo=rr and float(rr.group(1)))
    with cf.ThreadPoolExecutor(6) as ex: res = [r for r in ex.map(one, sorted(prids)) if r]
    res.sort(key=lambda r: r["date"]); prev = None
    for r in res:
        if r["repo"] is None: continue
        if prev is None: act = f"kept/set the policy repo rate at {r['repo']:.2f}%"
        elif r["repo"] > prev: act = f"raised the policy repo rate by {round((r['repo'] - prev) * 100)} bps to {r['repo']:.2f}%"
        elif r["repo"] < prev: act = f"cut the policy repo rate by {round((prev - r['repo']) * 100)} bps to {r['repo']:.2f}%"
        else: act = f"kept the policy repo rate unchanged at {r['repo']:.2f}%"
        ev.append(dict(date=r["date"], kind="mpc", title="RBI MPC decision", text=f"RBI's Monetary Policy Committee {act}.", src=pr_url(r["prid"]), srcLabel="RBI press release: MPC resolution"))
        prev = r["repo"]
    return ev

FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
def fomc_events():
    s = curl(FOMC_URL, f"{C}/fomc.html")
    parts = re.split(r'<h4><a id="\d+">(\d{4}) FOMC Meetings', s)
    ev = []
    for k in range(1, len(parts), 2):
        y = int(parts[k]); seg = parts[k + 1]
        for mon, days, tail in re.findall(r'fomc-meeting__month[^>]*><strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<(.{0,400})', seg, flags=re.S):
            if "notation vote" in tail.lower(): continue
            mname = mon.strip().split("/")[-1]
            dm = re.match(r"(\d{1,2})(?:-(\d{1,2}))?", days.strip())
            if not dm: continue
            last = int(dm.group(2) or dm.group(1))
            try: mm = dt.datetime.strptime(mname[:3], "%b").month; d = dt.date(y, mm, last)
            except ValueError: continue
            if d > dt.date.today(): continue
            note = " (unscheduled)" if "unscheduled" in days.lower() or "notation" in days.lower() else ""
            ev.append(dict(date=d.isoformat(), kind="fomc", title="FOMC decision day" + note, text="US Federal Reserve FOMC meeting concluded" + note + " (decision day per the Fed's meeting calendar).", src=FOMC_URL, srcLabel="Federal Reserve: FOMC meeting calendars"))
    return sorted({e["date"]: e for e in ev}.values(), key=lambda e: e["date"])

# ---------------------------------------------------------------- assemble
def main():
    wk = weekly()
    iv_b, ne_b, notes, trade = bulletins()
    t211, t207, t145 = handbook()
    debt, table5 = ext_debt()
    # Intervention: Handbook (latest revision) where available, bulletin elsewhere.
    iv = dict(iv_b); iv.update(t211)
    ivrows = [dict(month=m, **{k: v for k, v in x.items()}) for m, x in sorted(iv.items()) if m >= f"{A.from_year - 1}-01"]
    nets = [r["net"] for r in ivrows]
    mu, sd = statistics.mean(nets), statistics.pstdev(nets)
    # NEER: bulletin 6-currency (2015-16 base, and 2004-05 base before 2021); 40-currency from Handbook T207 + bulletins.
    ne = {m: dict(x) for m, x in ne_b.items()}
    for m, x in t207.items():
        ne.setdefault(m, {}).update({k: v for k, v in x.items()}); ne[m].setdefault("src40", pub_url(HB["t207"]))
    nerows = [dict(month=m, **x) for m, x in sorted(ne.items())]
    try: mpc = mpc_events()
    except Exception as e: print("MPC fetch failed", e, file=sys.stderr); mpc = []
    try: fomc = fomc_events()
    except Exception as e: print("FOMC fetch failed", e, file=sys.stderr); fomc = []
    out = {
        "generated": TODAY,
        "script": "scripts/refresh_rbi_data.py",
        "notes": notes,
        "weekly": {"title": "Foreign exchange reserves (weekly)", "unit": "US$ million", "frequency": "weekly (Friday as-on, published the following Friday)",
                   "source": "RBI Weekly Statistical Supplement, Table 2 (Foreign Exchange Reserves)", "sourceUrl": RBI + "BS_viewWssExtract.aspx",
                   "crossCheck": pub_url(HB["t215"]), "retrieved": TODAY, "rows": wk,
                   "caveat": "Weekly change ('wow') is RBI's own reported variation; it includes valuation effects (USD vs EUR/JPY/GBP and gold price moves), so it is not a pure measure of RBI FX sales."},
        "intervention": {"title": "RBI sale/purchase of US dollar (OTC, monthly)", "unit": "US$ million", "frequency": "monthly, ~2-month publication lag",
                         "source": "RBI Handbook of Statistics 2025-26 Table 211 (Apr 2022-Apr 2026, value dates) and RBI Bulletin Current Statistics Table 4 (other months)",
                         "sourceUrl": pub_url(HB["t211"]), "retrieved": TODAY, "mean": mu, "sd": sd, "rows": ivrows,
                         "caveat": "Net = purchase - sale in the onshore/offshore OTC segment. Futures-segment operations and forward-book changes are separate; 'fwd' is the outstanding net forward position at month-end (negative = net forward sales)."},
        "neer": {"title": "NEER / REER of the rupee (monthly average)", "unit": "index", "frequency": "monthly, ~1-month lag",
                 "source": "RBI Bulletin Current Statistics (NEER/REER table) and RBI Handbook Table 207 (40-currency)", "sourceUrl": pub_url(HB["t207"]), "retrieved": TODAY, "rows": nerows,
                 "caveat": "An increase means the rupee appreciated. 6-currency (trade-weighted) on base 2015-16=100 from Jan 2020; months before that only exist on the older 2004-05=100 base and are kept as a separate field (neer6_0405), never spliced. Latest months are provisional."},
        "debt": {"title": "India's external debt (quarterly, RBI releases)", "unit": "US$ billion", "frequency": "quarterly; RBI publishes the March and June quarters (~1 quarter lag); Sep/Dec quarters are released by the Ministry of Finance and are not included",
                 "source": "RBI press releases 'India's External Debt as at the end of ...'", "sourceUrl": "https://www.rbi.org.in/scripts/Pr_DataRelease.aspx?DateFilter=Year&SectionID=355", "retrieved": TODAY, "rows": debt,
                 "caveat": "Currency shares are as stated in each release (first-published, may be revised later). The USD share includes US-dollar debt only; SDR allocations have no market INR rate and are converted as a USD-equivalent approximation."},
        "debtAnnual": {"title": "Key external debt indicators (end-March)", "source": "RBI press release, Table 5 (Sep 30, 2026)", "sourceUrl": pr_url(ED_PRIDS[0]), "retrieved": TODAY, "rows": table5,
                       "handbook": {"source": "RBI Handbook of Statistics 2025-26, Table 145", "sourceUrl": pub_url(HB["t145"]), "rows": [dict(year=y, **v) for y, v in sorted(t145.items())]}},
        "trade": {"title": "Merchandise trade (monthly)", "unit": "US$ million", "frequency": "monthly, ~1-2 month lag", "source": "RBI Bulletin Current Statistics 'Foreign Trade' table (source: DGCI&S)", "sourceUrl": bull_url(max(v["NEER"] for v in json.load(open(os.path.join(os.path.dirname(__file__), "rbi_bulletin_ids.json"))).values()) - 5), "retrieved": TODAY,
                  "rows": [dict(month=m, **x) for m, x in sorted(trade.items())], "caveat": "Merchandise (goods) imports only; services imports are excluded, so import cover here is goods-import cover. Latest months are provisional."},
        "events": {"retrieved": TODAY, "rows": mpc + fomc},
    }
    json.dump(out, open(A.out, "w"), separators=(",", ":"))
    print(f"wrote {A.out}: weeks={len(wk)} ({wk[0]['date']}..{wk[-1]['date']}), iv={len(ivrows)} ({ivrows[0]['month']}..{ivrows[-1]['month']}), neer={len(nerows)}, debt={len(debt)}, events mpc={len(mpc)} fomc={len(fomc)}")
    for n in notes: print("note:", n)

if __name__ == "__main__":
    main()
