"""
Independent consistency check: recompute daily values straight from INMET's
RAW archive (as preserved by the pipeline) and compare with what the ARTEMIS
API serves. Pure standard library; reads the ZIP, calls the HTTP API.

    python -I scripts/inmet_consistency.py <raw.zip> <api_base> <out.json> [--sample 25] [--seed 7]

For each sampled (station, local day): hours observed, max/min temperature,
minimum humidity, humidity at 13 h local and the rain total. Missing markers
(-9999, empty) are skipped exactly as documented; values outside the QC limits
are expected to differ only where the pipeline flagged them.
"""
import json, random, sys, urllib.request, zipfile
from datetime import datetime, timedelta, timezone

UTC_M5 = {"AC"}; UTC_M4 = {"AM", "RO", "RR", "MT", "MS"}
LIM = {"t": (-10, 50), "rh": (1, 100), "rain": (0, 150)}


def num(v):
    v = (v or "").strip().replace(",", ".")
    if v == "" or v.startswith("-9999"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def ok(v, k):
    return v is not None and LIM[k][0] <= v <= LIM[k][1]


def get_day(api, code, day):
    """Respects the API rate limit (HTTP 429 → wait and retry)."""
    import time, urllib.error
    for attempt in range(6):
        try:
            with urllib.request.urlopen(f"{api}/api/weather-stations/{code}/daily?from={day}&to={day}", timeout=30) as r:
                time.sleep(0.55)
                return (json.load(r)["days"] or [{}])[0]
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(15)
    raise RuntimeError("limite de requisições persistente")


def main(zpath, api, out, sample=25, seed=7):
    z = zipfile.ZipFile(zpath)
    names = sorted(n for n in z.namelist() if n.upper().endswith(".CSV"))
    rnd = random.Random(seed)
    picked = rnd.sample(names, min(sample, len(names)))
    results, mism = [], 0
    for name in picked:
        lines = z.read(name).decode("latin-1").splitlines()
        meta = {l.split(";")[0].rstrip(":").strip().upper(): l.split(";")[1].strip() for l in lines[:8] if ";" in l}
        code, uf = meta.get("CODIGO (WMO)"), meta.get("UF")
        off = -5 if uf in UTC_M5 else -4 if uf in UTC_M4 else -3
        hdr = [h.upper() for h in lines[8].split(";")]
        ix = lambda p: next(i for i, h in enumerate(hdr) if h.startswith(p))
        it, itx, itn, irh, irhn, irain = ix("TEMPERATURA DO AR"), ix("TEMPERATURA MÁXIMA"), ix("TEMPERATURA MÍNIMA"), ix("UMIDADE RELATIVA DO AR"), ix("UMIDADE REL. MIN"), ix("PRECIPITA")
        days = {}
        for l in lines[9:]:
            c = l.split(";")
            if len(c) < len(hdr) - 1:
                continue
            t = datetime.strptime(c[0] + c[1][:2], "%Y/%m/%d%H").replace(tzinfo=timezone.utc)
            vals = [num(c[i]) for i in (it, itx, itn, irh, irhn, irain)]
            if all(v is None for v in [vals[0], vals[3], vals[5]]) and num(c[3]) is None:
                continue  # hour without any measure (dropped by the pipeline)
            local = t + timedelta(hours=off)
            d = days.setdefault(local.date().isoformat(), {"h": 0, "tmax": [], "tmin": [], "rh": [], "rh13": None, "rain": []})
            d["h"] += 1
            T, TX, TN, RH, RHN, RA = vals
            # pipeline rule: hourly max/min when present, otherwise the instantaneous value
            if ok(TX, "t") or ok(T, "t"): d["tmax"].append(TX if ok(TX, "t") else T)
            if ok(TN, "t") or ok(T, "t"): d["tmin"].append(TN if ok(TN, "t") else T)
            if ok(RH, "rh"): d["rh"].append(RHN if ok(RHN, "rh") else RH)
            if local.hour == 13 and ok(RH, "rh"): d["rh13"] = RH
            if ok(RA, "rain"): d["rain"].append(RA)
        full = [k for k, v in days.items() if v["h"] >= 20]
        if not full:
            continue
        for day in rnd.sample(full, min(3, len(full))):
            v = days[day]
            exp = {"hoursObserved": v["h"], "temperatureMaxC": max(v["tmax"]) if v["tmax"] else None, "temperatureMinC": min(v["tmin"]) if v["tmin"] else None,
                   "humidityMinPct": min(v["rh"]) if v["rh"] else None, "humidity13hPct": v["rh13"], "precipitationMm": round(sum(v["rain"]), 1) if v["rain"] else None}
            got = get_day(api, code, day)
            diffs = {k: (exp[k], got.get(k)) for k in exp if not (exp[k] is None and got.get(k) is None) and (exp[k] is None or got.get(k) is None or abs(float(exp[k]) - float(got[k])) > 0.051)}
            mism += bool(diffs)
            results.append({"station": code, "day": day, "expected": exp, "api": {k: got.get(k) for k in exp}, "differences": diffs})
    report = {"raw_archive": zpath.split("/")[-1], "station_files_sampled": len(picked), "station_days_checked": len(results), "station_days_with_difference": mism, "seed": seed, "checks": results}
    json.dump(report, open(out, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "checks"}, ensure_ascii=False))
    if mism:
        for r in results:
            if r["differences"]:
                print(r["station"], r["day"], r["differences"])


if __name__ == "__main__":
    a = sys.argv
    main(a[1], a[2], a[3], int(a[a.index("--sample") + 1]) if "--sample" in a else 25, int(a[a.index("--seed") + 1]) if "--seed" in a else 7)
