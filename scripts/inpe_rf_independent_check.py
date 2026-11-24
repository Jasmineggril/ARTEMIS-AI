import json, math, random, sys
import netCDF4, numpy as np, psycopg2
from shapely.geometry import shape, Point
ds = netCDF4.Dataset(sys.argv[1]); rf = ds["rf"][0, :, :]; lat = ds["lat"][:]; lon = ds["lon"][:]
rf = np.ma.filled(rf.astype("float64"), -999.0)
c = psycopg2.connect(sys.argv[2]); cur = c.cursor()
def valid(v): return 0 <= v <= 1
def at(la, lo):
    y = int(round((la - lat[0]) / 0.01)); x = int(round((lo - lon[0]) / 0.01))
    v = rf[y, x]
    if valid(v): return v, 0.0
    best = None
    for yy in range(y - 5, y + 6):
        for xx in range(x - 5, x + 6):
            w = rf[yy, xx]
            if not valid(w): continue
            d = math.hypot(yy - y, (xx - x) * math.cos(math.radians(la)))
            if d <= 5 and (best is None or d < best[1]): best = (w, d)
    return best if best else (None, None)
cur.execute("select s.id, s.code, s.latitude, s.longitude, v.value_mean from weather_stations s join fire_risk_values v on v.target_id=s.id and v.target_type='station' where v.product='observado' and v.valid_day='2026-11-22'")
rows = cur.fetchall(); random.seed(7); sample = random.sample(rows, 40)
diffs = []
for sid, code, la, lo, v in sample:
    e, d = at(la, lo)
    diffs.append({"code": code, "banco": v, "independente": None if e is None else round(float(e), 4), "ok": (e is None and v is None) or (e is not None and v is not None and abs(e - v) < 1e-4)})
cur.execute("select a.id, a.name, a.boundary::text, v.value_mean, v.pixels_total from monitored_areas a join fire_risk_values v on v.target_id=a.id and v.target_type='area' where v.product='observado' and v.valid_day='2026-11-22' and a.boundary is not null and v.pixels_total > 0")
areas = []
for aid, name, b, v, n in cur.fetchall():
    g = shape(json.loads(b)); x0, y0, x1, y1 = g.bounds
    ys = range(int(round((y0 - lat[0]) / 0.01)), int(round((y1 - lat[0]) / 0.01)) + 1); xs = range(int(round((x0 - lon[0]) / 0.01)), int(round((x1 - lon[0]) / 0.01)) + 1)
    vals = [rf[y, x] for y in ys for x in xs if g.covers(Point(float(lon[x]), float(lat[y]))) and valid(rf[y, x])]
    m = float(np.mean(vals)) if vals else None
    areas.append({"area": aid, "banco": v, "independente": None if m is None else round(m, 4), "pixels": len(vals), "ok": m is not None and v is not None and abs(m - v) < 1e-3})
print(json.dumps({"estacoes": {"n": len(diffs), "conferem": sum(d["ok"] for d in diffs)}, "areas": {"n": len(areas), "conferem": sum(a["ok"] for a in areas)}, "divergentes": [d for d in diffs + areas if not d["ok"]][:10]}, ensure_ascii=False, indent=1, default=float))
