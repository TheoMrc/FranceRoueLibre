"""Extract tidy CSVs from the DGAFP / Insee / data.economie files downloaded by fetch-sources.mjs
(sources/raw/fonction-publique/, source « fonction-publique ») into sources/fonction-publique/ (versioned),
checking every published total. Only reads published numbers; no estimation.
Usage: python3 scripts/extract-effectifs-fp.py [raw dir] [output dir]"""
import sys, os, json, csv, re, unicodedata, zipfile
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "sources/raw/fonction-publique")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "sources/fonction-publique")
os.makedirs(OUT, exist_ok=True)
for name in ("ra_2026_postes", "ra_2026_effectifs", "ra_2026_remu_niveaux"):   # the DGAFP zips, unpacked once
    folder, archive = os.path.join(E, "dgafp-ra2026", name), os.path.join(E, "dgafp-ra2026", name + ".zip")
    if not os.path.isdir(folder) and os.path.exists(archive):
        with zipfile.ZipFile(archive) as z:
            z.extractall(folder)
PO = os.path.join(E, "dgafp-ra2026/ra_2026_postes")
EF = os.path.join(E, "dgafp-ra2026/ra_2026_effectifs")
RE_ = os.path.join(E, "dgafp-ra2026/ra_2026_remu_niveaux")
checks = []


def chk(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK  " if ok else "FAIL"), name, detail)


def rows(path, sheet):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    return [list(r) for r in wb[sheet].iter_rows(values_only=True)]


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def num(v):
    if v is None or v == "" or v == "nd":
        return None
    if isinstance(v, str):
        v = v.replace(" ", "").replace(" ", "").replace(",", ".")
        try:
            return float(v)
        except ValueError:
            return None
    return float(v)


def write(name, header, data):
    p = os.path.join(OUT, name)
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(data)
    print("wrote", p, len(data), "rows")


# ---------- département reference (geo.api.gouv.fr) ----------
geo = json.load(open(os.path.join(ROOT, "sources/departements-meta.json"), encoding="utf-8"))   # same records as geo.api.gouv.fr/departements
code_by_name = {norm(d["nom"]): d["code"] for d in geo}
REGIONS = {"auvergnerhonealpes", "bourgognefranchecomte", "bretagne", "centrevaldeloire", "corse",
           "grandest", "hautsdefrance", "iledefrance", "normandie", "nouvelleaquitaine", "occitanie",
           "paysdelaloire", "provencealpescotedazur", "dom", "totalmetropole",
           "totalfranceentiereagentscivils"}


def split_geo(table):
    """table: list of rows starting at the first data row; returns list of (kind, code, name, region, row)."""
    out, region = [], None
    for r in table:
        name = r[0]
        if name is None or str(name).startswith(("Source", "Champ", "Note", "Lecture", "(")):
            continue
        n = norm(re.sub(r"\(\d\)", "", str(name)))
        if n in REGIONS:
            region = str(name).strip()
            out.append(("region", None, region, None, r))
        elif n in code_by_name:
            out.append(("departement", code_by_name[n], str(name).strip(), region, r))
        else:
            raise SystemExit("unknown geo label: %r" % name)
    return out


FP = os.path.join(PO, "ra2026_caracteristiques_postes_donnees_comp_FP.xlsx")
f2 = split_geo(rows(FP, "Figure 2 loc")[3:])
f3 = {g[2]: g[4] for g in split_geo(rows(FP, "Figure 3 loc")[3:])}
f4 = rows(FP, "Figure 4 loc")
hdr4 = f4[2]
i24 = [i for i, h in enumerate(hdr4) if h and str(h).startswith("2024")][0]
taux = {"FP": {g[2]: g[4][i24] for g in split_geo(f4[3:])}}
for v in ("FPE", "FPT", "FPH"):
    t = rows(os.path.join(PO, f"ra2026_caracteristiques_postes_donnees_comp_{v}.xlsx"), "Figure 2 loc")
    j = [i for i, h in enumerate(t[2]) if h and str(h).startswith("2024")][0]
    taux[v] = {g[2]: g[4][j] for g in split_geo(t[3:])}


def agents(x):
    v = round(x * 1000, 6)
    assert abs(v - round(v)) < 1e-6, x
    return int(round(v))


dep_rows, reg_rows = [], []
reg_acc = {}
for kind, code, name, region, r in f2:
    fpe, fpt, fph, tot = (agents(r[i]) for i in (1, 2, 3, 4))
    s = f3[name]
    fonc, contr, autres, tot3 = (agents(s[i]) for i in (1, 2, 3, 4))
    line = [fpe, fpt, fph, tot, fonc, contr, autres,
            round(taux["FPE"][name], 2), round(taux["FPT"][name], 2), round(taux["FPH"][name], 2),
            round(taux["FP"][name], 2), "", 2024]
    if abs(fpe + fpt + fph - tot) > 1:
        chk(f"versants sum {name}", False, f"{fpe}+{fpt}+{fph} vs {tot}")
    if tot3 != tot or abs(fonc + contr + autres - tot) > 1:
        chk(f"statut sum {name}", False, f"{fonc}+{contr}+{autres} vs {tot3} vs {tot}")
    if kind == "departement":
        dep_rows.append([code, name, region] + line)
        a = reg_acc.setdefault(region, [0, 0, 0, 0])
        for k, val in enumerate((fpe, fpt, fph, tot)):
            a[k] += val
    else:
        reg_rows.append([name, fpe, fpt, fph, tot, fonc, contr, autres] + line[7:11] + [2024])
        reg_tot = (fpe, fpt, fph, tot)
        reg_acc.setdefault(name, [0, 0, 0, 0])
        reg_rows[-1].append(None)
chk("FP fig2: fpe+fpt+fph == total (each of %d dept+region rows, tol 1 agent)" % len(f2),
    not any(c[0].startswith("versants sum") for c in checks))
chk("FP fig3: fonctionnaires+contractuels+autres == total, and total == fig2 total",
    not any(c[0].startswith("statut sum") for c in checks))
# regional sums
bad = []
for kind, code, name, region, r in f2:
    if kind == "region":
        exp = [agents(r[i]) for i in (1, 2, 3, 4)]
        got = reg_acc.get(name)
        if any(abs(a - b) > 2 for a, b in zip(exp, got)):
            bad.append((name, exp, got))
chk("sum of départements == published region row (13 metro regions + DOM, 4 columns)", not bad, str(bad))
chk("96 metro + 4 DOM départements present (Mayotte absent from source)", len(dep_rows) == 100, str(len(dep_rows)))
nat = [sum(r[i] for r in dep_rows) for i in (3, 4, 5, 6)]
print("sum of départements (FPE civils, FPT, FPH, total civils):", nat)
NAT_DEPT_SUM = nat
H = ["code_departement", "departement", "region", "fpe_civils", "fpt", "fph", "total_civils",
     "fonctionnaires", "contractuels", "autres_statuts",
     "taux_admin_fpe_etp_1000hab", "taux_admin_fpt_etp_1000hab", "taux_admin_fph_etp_1000hab",
     "taux_admin_total_etp_1000hab", "population_if_given", "year"]
dep_rows.sort(key=lambda r: r[0])
write("effectifs-departements.csv", H, dep_rows)
write("effectifs-regions.csv", ["region", "fpe_civils", "fpt", "fph", "total_civils", "fonctionnaires",
                                "contractuels", "autres_statuts", "taux_admin_fpe_etp_1000hab",
                                "taux_admin_fpt_etp_1000hab", "taux_admin_fph_etp_1000hab",
                                "taux_admin_total_etp_1000hab", "year"],
      [r[:13] for r in reg_rows] + [["Total métropole", "", "", "", "", "", "", "",
                                     round(taux["FPE"]["Total métropole"], 2), round(taux["FPT"]["Total métropole"], 2),
                                     round(taux["FPH"]["Total métropole"], 2), round(taux["FP"]["Total métropole"], 2), 2024],
                                    ["Total France entière, agents civils (hors Mayotte)", "", "", "", "", "", "", "",
                                     round(taux["FPE"]["Total France entière, agents civils(1)"], 2),
                                     round(taux["FPT"]["Total France entière, agents civils(1)"], 2),
                                     round(taux["FPH"]["Total France entière, agents civils(1)"], 2),
                                     round(taux["FP"]["Total France entière, agents civils(1)"], 2), 2024]])

# ---------- département time series (effectifs milliers + taux) ----------
serie = []
for v, fn in (("FP", "FP"), ("FPE", "FPE"), ("FPT", "FPT"), ("FPH", "FPH")):
    path = os.path.join(PO, f"ra2026_caracteristiques_postes_donnees_comp_{fn}.xlsx")
    for sheet, ind, unit in (("Figure 1 loc", "effectif_physique", "milliers d'agents"),
                             ("Figure 4 loc" if v == "FP" else "Figure 2 loc", "taux_administration", "ETP pour 1000 habitants")):
        t = rows(path, sheet)
        hdr = t[2]
        for kind, code, name, region, r in split_geo(t[3:]):
            for i, h in enumerate(hdr):
                if h is None or i == 0 or r[i] is None:
                    continue
                serie.append([kind, code or "", name, v, ind, str(h).strip(), round(r[i], 3 if ind == "effectif_physique" else 4), unit])
write("effectifs-departements-serie.csv",
      ["niveau", "code_departement", "zone", "versant", "indicateur", "annee_millesime", "valeur", "unite"], serie)

# ---------- versant / ministry series (DGAFP) ----------
t = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FPE.xlsx"), "Figure 1")
hdr = t[2]
out, cur = [], None
hdr_fixed = list(hdr)
# header bug in source: '2022 millésime 2023' appears twice; first occurrence is the 2022 millésime 2022 column
idx = [i for i, h in enumerate(hdr) if h == "2022 millésime 2023"]
if len(idx) == 2:
    hdr_fixed[idx[0]] = "2022 millésime 2022"
for r in t[3:]:
    if r[0] and str(r[0]).startswith(("Source", "Champ", "Note", "-", "Les effectifs", "(", "Lecture")):
        break
    if r[0]:
        cur = str(r[0]).strip()
    if r[1] is None:
        continue
    for i in range(2, len(hdr_fixed)):
        if hdr_fixed[i] is not None and r[i] is not None:
            out.append(["FPE", cur, str(r[1]).strip(), str(hdr_fixed[i]).strip(), r[i]])
fpe_series = list(out)
write("effectifs-fpe-ministeres-serie.csv",
      ["versant", "ministere", "perimetre", "annee_millesime", "effectif_milliers"], out)
# check ministries sum to total for 2024
d24 = {(m, p): v for _, m, p, y, v in out if y == "2024"}
mins = sorted({m for m, p in d24 if not m.startswith("Total")})
for p in ("Ministères", "EPA", "Total"):
    s = sum(d24[(m, p)] for m in mins)
    chk(f"FPE 2024 sum of {len(mins)} ministries ({p}) == Total row", abs(s - d24[("Total", p)]) < 1.0,
        f"{s:.3f} vs {d24[('Total', p)]:.3f}")
s = sum(d24[(m, "Ministères")] + d24[(m, "EPA")] - d24[(m, "Total")] for m in mins)
chk("FPE 2024 Ministères+EPA == Total for each ministry", abs(s) < 0.5, f"cum diff {s:.3f}")

# versants headline 2024 + FP total series
v2 = rows(os.path.join(EF, "ra_2026_vue_emploi_effectifs.xlsx"), "Figure 2")
vers = {}
for r in v2:
    if r[1] and r[2] is not None and isinstance(r[2], (int, float)):
        vers[str(r[1]).strip()] = r[2]
s = vers["Fonction publique de l’État"] + vers["Fonction publique territoriale"] + vers["Fonction publique hospitalière"]
chk("2024 FPE+FPT+FPH == Ensemble FP (vue Figure 2)", abs(s - vers["Ensemble de la fonction publique"]) < 0.05,
    f"{s:.4f} vs {vers['Ensemble de la fonction publique']:.4f} milliers")
fp3 = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FP.xlsx"), "Figure 3")
h3 = fp3[2]
ser = []
for r in fp3[3:8]:
    lab = re.sub(r"\s+", " ", (r[2] or "").replace("\u00a0", " ")).strip()
    for i in range(3, len(h3)):
        if h3[i] is not None and r[i] is not None:
            ser.append(["FP", lab, str(h3[i]).strip(), r[i]])
fpt1 = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FPT_FPH.xlsx"), "Figure 1 ")
fph = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FPT_FPH.xlsx"), "Figure 3")
for r in fpt1[6:7]:
    for i in range(1, len(fpt1[2])):
        if fpt1[2][i] is not None and r[i] is not None:
            ser.append(["FPT", "Total emplois principaux", str(fpt1[2][i]).strip(), r[i]])
for r in fph[8:9]:
    for i in range(1, len(fph[2])):
        if fph[2][i] is not None and r[i] is not None:
            ser.append(["FPH", "Total FPH", str(fph[2][i]).strip(), r[i]])
for _, m, pr, yy, vv in fpe_series:
    if m == "Total" and pr == "Total":
        ser.append(["FPE", "Total ministères + EPA", yy, vv])
write("effectifs-versants-serie.csv", ["versant", "ligne", "annee_millesime", "effectif_milliers"], ser)
d = {(a, b, c): v for a, b, c, v in ser}
s = d[("FPE", "Total ministères + EPA", "2024")] + d[("FPT", "Total emplois principaux", "2024")] + d[("FPH", "Total FPH", "2024")]
tot = d[("FP", "Total hors bénéficiaire de contrats aidés", "2024")]
chk("2024 FPE(fig1 FPE)+FPT(fig1 FPT)+FPH(fig3) == FP total hors contrats aidés (fig3 FP)", abs(s - tot) < 0.5,
    f"{s:.3f} vs {tot:.3f} milliers")
tca = d[("FP", "Total y compris bénéficiaires de contrats aidés", "2024")]
ca = d[("FP", "Bénéficiaires de contrats aidés de la fonction publique(2)", "2024")]
chk("2024 FP hors CA + contrats aidés == FP y c. CA", abs(tot + ca - tca) < 0.5, f"{tot:.3f}+{ca:.3f} vs {tca:.3f}")

# ---------- FPT by employer ----------
t = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FPT_FPH.xlsx"), "Figure 2")
hdr = t[2]
out = []
for r in t[3:31]:
    lab = str(r[0]).strip()
    for i in range(1, len(hdr)):
        if hdr[i] is not None and r[i] is not None:
            out.append(["FPT", lab, str(hdr[i]).strip(), r[i]])
write("effectifs-fpt-employeurs-serie.csv", ["versant", "type_employeur", "annee_millesime", "effectif_milliers"], out)
d = {(b, c): v for a, b, c, v in out}
y = "2024"
communal = d[("Communes, dont :", y)] + d[("Établissements communaux (CCAS, CDE)(1)", y)]
chk("FPT 2024 communes + établissements communaux == organismes communaux", abs(communal - d[("Organismes communaux(1)", y)]) < 0.5,
    f"{communal:.3f} vs {d[('Organismes communaux(1)', y)]:.3f}")
inter = d[(" EPCI à fiscalité propre, dont :".strip(), y)] if ("EPCI à fiscalité propre, dont :", y) in d else None
dep = d[("Départements", y)] + d[("SDIS", y)] + d[("Autres établissements départementaux", y)]
chk("FPT 2024 départements + SDIS + autres étab. départementaux == organismes départementaux",
    abs(dep - d[("Organismes départementaux", y)]) < 0.5, f"{dep:.3f} vs {d[('Organismes départementaux', y)]:.3f}")
top = d[("Organismes communaux(1)", y)] + d[("Organismes intercommunaux(1)", y)] + d[("Organismes départementaux", y)] + d[("Régions", y)] + d[("Autres EPA locaux (CCM, régies)", y)]
chk("FPT 2024 communaux+intercommunaux+départementaux+régions+autres EPA == Total", abs(top - d[("Total", y)]) < 0.5,
    f"{top:.3f} vs {d[('Total', y)]:.3f}")
communes = sum(v for (b, c), v in d.items() if c == y and b.startswith("Communes de"))
chk("FPT 2024 sum of commune size classes == Communes", abs(communes - d[("Communes, dont :", y)]) < 0.5,
    f"{communes:.3f} vs {d[('Communes, dont :', y)]:.3f}")
t = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FPT_FPH.xlsx"), "Figure 3")
out = []
for r in t[3:9]:
    for i in range(1, len(t[2])):
        if t[2][i] is not None and r[i] is not None:
            out.append(["FPH", str(r[0]).strip(), str(t[2][i]).strip(), r[i]])
write("effectifs-fph-etablissements-serie.csv", ["versant", "type_etablissement", "annee_millesime", "effectif_milliers"], out)
d = {(b, c): v for a, b, c, v in out}
s = d[("Total hôpitaux", y)] + d[("Établissements d'hébergement pour personnes âgées", y)] + d[("Autres établissements médico-sociaux", y)]
chk("FPH 2024 hôpitaux + EHPA + autres médico-sociaux == Total FPH", abs(s - d[("Total FPH", y)]) < 0.5, f"{s:.3f} vs {d[('Total FPH', y)]:.3f}")

# ---------- salaries 2024 by versant ----------
t = rows(os.path.join(RE_, "ra_2026_remu_niveaux_donnees_comp.xlsx"), "Figure 2")
groups = [(1, "FPE"), (5, "FPT"), (9, "FPH (ensemble)"), (13, "FPH (hôpitaux publics)"), (17, "FPH (établissements médico-sociaux)")]
out = []
for r in t[4:25]:
    lab = str(r[0]).strip()
    for c, g in groups:
        out.append([g, lab, round(r[c], 2), round(r[c + 1], 2), round(r[c + 2], 3), round(r[c + 3], 3), 2024])
v1 = rows(os.path.join(RE_, "ra_2026_vue_renumerations_niveaux.xlsx"), "Figure 1")
for r in v1:
    if r[1] and str(r[1]).strip() == "Ensemble" and isinstance(r[3], (int, float)):
        out.insert(0, ["Ensemble FP", "Ensemble", round(r[3], 2), round(r[4], 2), "", "", 2024])
        fp_net = r[4]
write("salaires-versants-2024.csv", ["versant", "population", "salaire_brut_mensuel_moyen_eqtp_eur",
                                     "salaire_net_mensuel_moyen_eqtp_eur", "evol_brut_2023_2024_euros_constants_pct",
                                     "evol_net_2023_2024_euros_constants_pct", "year"], out)
# weighted mean check with EQTP structure shares from vue Figure 1
sh = {}
for r in v1:
    if r[1] and isinstance(r[2], (int, float)):
        sh[str(r[1]).strip()] = (r[2], r[4])
w = sum(sh[k][0] * sh[k][1] for k in ("Fonction publique de l’État (FPE)", "Fonction publique territoriale (FPT)", "Fonction publique hospitalière (FPH)")) / 100
chk("2024 net salary: EQTP-weighted mean of 3 versants == Ensemble FP", abs(w - fp_net) < 2, f"{w:.1f} vs {fp_net:.1f} EUR")

# ---------- plafonds d'emplois LFI 2019-2026 + consommation 2025 ----------
t = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FPE.xlsx"), "Figure 3")
hdr = t[2]
out, cur = [], None
for r in t[3:50]:
    if r[0]:
        cur = str(r[0]).strip()
    mission = (str(r[1]).strip() if r[1] else "")
    for i in range(2, 10):
        if r[i] is not None:
            out.append([cur, mission, int(hdr[i]), r[i]])
write("plafonds-emplois-lfi-2019-2026.csv", ["ministere_2026", "mission", "annee_lfi", "plafond_milliers_etpt"], out)
d = {}
for m, mi, yr, v in out:
    d[(m, mi, yr)] = v
for yr in range(2019, 2027):
    mins = [k for k in d if k[2] == yr and k[1] == "" and not k[0].startswith("Total")]
    bad = [m for (m, mi, y2) in mins if abs(sum(v for (m2, mi2, y3), v in d.items() if m2 == m and mi2 and y3 == yr) - d[(m, "", yr)]) > 0.01]
    bg = sum(d[k] for k in mins)
    ok = not bad and abs(bg - d[("Total budget général", "", yr)]) < 0.01 and \
        abs(d[("Total budget général", "", yr)] + d[("Total budgets annexes", "", yr)] - d[("Total", "", yr)]) < 0.01
    chk(f"LFI {yr}: missions sum to ministries, ministries to budget général, BG+BA == Total", ok,
        f"BG {d[('Total budget général', '', yr)]:.3f} + BA {d[('Total budgets annexes', '', yr)]:.3f} = {d[('Total', '', yr)]:.3f} milliers ETPT; bad={bad}")
t = rows(os.path.join(EF, "RA_2026_effectifs_donnees_comp_FPE.xlsx"), "Figure 4")
out = []
for r in t[2:25]:
    out.append([str(r[0]).strip(), r[1], r[2], 2025])
write("consommation-emplois-ministeres-2025.csv", ["ministere_2025", "consommation_etpt", "ecart_vs_plafond_lfr_etpt", "year"], out)
d = {r[0]: r for r in out}
bg = sum(r[1] for r in out if not r[0].startswith("Total") and r[0] not in ("Publications officielles et information administrative", "Contrôle et exploitation aériens"))
chk("RAP 2025 consommation: sum of ministries == Total budget général", abs(bg - d["Total Budget général"][1]) < 1, f"{bg:.1f} vs {d['Total Budget général'][1]:.1f} ETPT")

# ---------- LFI 2023 ETPT (data.economie.gouv.fr) cross-check ----------
p = os.path.join(E, "data-economie/etpt-par-ministere-mission-programme-pour-le-bg-et-les-ba-lfi-2023.csv")
with open(p, encoding="utf-8-sig") as f:
    rr = list(csv.DictReader(f, delimiter=";"))
tot = sum(float(r["etpt_lfi_2023"]) for r in rr)
bgs = sum(float(r["etpt_lfi_2023"]) for r in rr if r["budget"] == "BG")
dg = d2023 = None
print("LFI 2023 ETPT total from data.economie:", tot, "BG", bgs)
LFI23 = (tot, bgs)

# ---------- Insee 2493501 (versant x ministère x statut) ----------
p = os.path.join(E, "insee/marc-empl-eff-fonc-pub.xlsx")
out = []
for sheet in ("Figure 1", "Figure 3"):
    t = rows(p, sheet)
    hi = [i for i, r in enumerate(t) if r[0] == "Fonction publique"][0]
    yrs, st = t[hi], t[hi + 1]
    cur = None
    years = []
    for i, v in enumerate(yrs):
        if i == 0:
            years.append(None); continue
        if v is not None:
            cur = str(v).strip()
        years.append(cur)
    for r in t[hi + 2:]:
        if r[0] is None or str(r[0]).startswith(("nd :", "r :", "1.", "2.", "3.", "4.", "5.", "Lecture", "Champ", "Source", "au 31")):
            continue
        raw = str(r[0]).replace("\n", " ")
        depth = (len(raw) - len(raw.lstrip(" "))) // 3
        lab = raw.strip()
        for i in range(1, len(r)):
            if i >= len(st) or st[i] is None or years[i] is None:
                continue
            v = r[i]
            out.append([sheet, depth, lab, years[i], str(st[i]).strip(), num(v) if v != "nd" else None, "nd" if v == "nd" else ""])
write("insee-effectifs-versant-ministere-serie.csv",
      ["figure", "niveau_indentation", "ligne", "annee", "statut", "effectif_milliers", "note"], out)
d = {(f, l, y, s): v for f, _, l, y, s, v, _ in out}
ins = d[("Figure 1", "Ensemble", "2024", "Ensemble")]
print("INFO Insee 2024 Ensemble y c. contrats aidés vs DGAFP:", ins, "vs", round(tca, 3), "milliers (diff", round(ins - tca, 3), ")")
for v in ("Fonction publique de l'État (FPE)", "Fonction publique territoriale (FPT)", "Fonction publique hospitalière (FPH)", "Ensemble"):
    comp = sum(d[("Figure 1", v, "2024", s)] for s in ("Fonctionnaire et militaires", "Contractuels (hors contrats aidés)", "Bénéficiaires de contrats aidés", "Autres catégories et statuts²"))
    chk(f"Insee 2024 {v}: sum of 4 statuts == Ensemble", abs(comp - d[("Figure 1", v, "2024", "Ensemble")]) < 0.25, f"{comp:.1f} vs {d[('Figure 1', v, '2024', 'Ensemble')]}")
failed = [c for c in checks if not c[1]]
json.dump({"checks": [{"name": n, "ok": ok, "detail": d} for n, ok, d in checks]}, open(os.path.join(OUT, "checks.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
if failed:
    sys.exit(f"FAILED: {failed}")
print(f"{len(checks)} contrôles OK")
