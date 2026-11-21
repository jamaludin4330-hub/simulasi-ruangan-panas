"""
TA-07 Pemodelan dan Simulasi
Simulator Dinamika Suhu Ruangan dengan Pemanas (Metode Euler)

Model:  C * dT/dt = Q_heater - UA * (T - T_luar)
Euler:  T[k+1] = T[k] + dt * dT/dt
"""
import math
import os

import numpy as np
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

MAX_STEPS = 300_000     # batas langkah Euler supaya server tidak berat
MAX_POINTS = 1200       # batas titik data yang dikirim ke grafik

# batas nilai tiap parameter: (minimum, maksimum, nama untuk pesan error)
LIMITS = {
    "C":      (5_000, 500_000, "Kapasitas panas C"),
    "UA":     (2, 100, "Koefisien kehilangan panas UA"),
    "Q":      (0, 1000, "Daya pemanas Q"),
    "T0":     (10, 40, "Suhu awal T(0)"),
    "T_luar": (0, 40, "Suhu luar"),
    "tstep":  (0, 600, "Waktu pemanas menyala"),
    "amp":    (0, 10, "Amplitudo suhu luar"),
    "period": (1, 48, "Periode suhu luar"),
    "dt":     (1, 600, "Step size dt"),
    "jam":    (1, 48, "Lama simulasi"),
}

BASELINE = {"C": 50_000.0, "UA": 20.0, "Q": 200.0, "T0": 28.0, "T_luar": 28.0}


# ---------------------------------------------------------------- utilitas
def ambil_angka(data, key, default):
    lo, hi, nama = LIMITS[key]
    try:
        v = float(data.get(key, default))
    except (TypeError, ValueError):
        raise ValueError(f"{nama} harus berupa angka.")
    if not math.isfinite(v) or v < lo or v > hi:
        raise ValueError(f"{nama} harus berada di antara {lo:g} dan {hi:g}.")
    return v


def baca_parameter(data):
    p = {
        "C": ambil_angka(data, "C", 50_000),
        "UA": ambil_angka(data, "UA", 20),
        "Q": ambil_angka(data, "Q", 200),
        "T0": ambil_angka(data, "T0", 28),
        "T_luar": ambil_angka(data, "T_luar", 28),
        "tstep": ambil_angka(data, "tstep", 30),
        "amp": ambil_angka(data, "amp", 3),
        "period": ambil_angka(data, "period", 24),
        "dt": ambil_angka(data, "dt", 10),
        "jam": ambil_angka(data, "jam", 4),
        "heater_mode": data.get("heater_mode", "konstan"),
        "outside_mode": data.get("outside_mode", "konstan"),
    }
    if p["heater_mode"] not in ("konstan", "step"):
        raise ValueError("Mode pemanas tidak dikenal.")
    if p["outside_mode"] not in ("konstan", "sinus"):
        raise ValueError("Mode suhu luar tidak dikenal.")
    n = int(round(p["jam"] * 3600 / p["dt"]))
    if n > MAX_STEPS:
        raise ValueError(
            f"Jumlah langkah ({n:,}) terlalu besar. Perbesar dt atau perpendek lama simulasi."
        )
    return p


def sinyal_pemanas(t, p):
    if p["heater_mode"] == "step":
        return np.where(t >= p["tstep"] * 60, p["Q"], 0.0)
    return np.full_like(t, p["Q"], dtype=float)


def sinyal_luar(t, p):
    if p["outside_mode"] == "sinus":
        return p["T_luar"] + p["amp"] * np.sin(2 * np.pi * t / (p["period"] * 3600))
    return np.full_like(t, p["T_luar"], dtype=float)


def euler(T0, dt, jam, C, UA, Q, TL):
    """Metode Euler. Q dan TL adalah array nilai input di setiap langkah."""
    n = len(Q) - 1
    T = [0.0] * (n + 1)
    T[0] = T0
    Ql, TLl = Q.tolist(), TL.tolist()
    for k in range(n):
        T[k + 1] = T[k] + dt * (Ql[k] - UA * (T[k] - TLl[k])) / C
    return np.array(T)


def analitik(t, p, C, UA, Q, T0, T_luar):
    """Solusi eksak. Hanya untuk input konstan atau step dengan suhu luar konstan."""
    tau = C / UA
    if p["outside_mode"] == "sinus":
        return None
    if p["heater_mode"] == "konstan":
        Tss = T_luar + Q / UA
        return Tss + (T0 - Tss) * np.exp(-t / tau)
    ts = p["tstep"] * 60
    fase1 = T_luar + (T0 - T_luar) * np.exp(-t / tau)
    T_ts = T_luar + (T0 - T_luar) * math.exp(-ts / tau)
    Tss = T_luar + Q / UA
    fase2 = Tss + (T_ts - Tss) * np.exp(-(t - ts) / tau)
    return np.where(t < ts, fase1, fase2)


def kurangi_titik(n_total):
    stride = max(1, math.ceil(n_total / MAX_POINTS))
    idx = np.arange(0, n_total, stride)
    if idx[-1] != n_total - 1:
        idx = np.append(idx, n_total - 1)
    return idx, stride


def bulatkan(arr, nd=4):
    return [round(float(x), nd) for x in arr]


# ----------------------------------------------------------------- routes
@app.route("/")
def index():
    return render_template("index.html")


@app.post("/api/simulate")
def api_simulate():
    try:
        p = baca_parameter(request.get_json(silent=True) or {})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    dt, jam = p["dt"], p["jam"]
    n = int(round(jam * 3600 / dt))
    t = np.arange(n + 1) * dt

    Q = sinyal_pemanas(t, p)
    TL = sinyal_luar(t, p)
    T = euler(p["T0"], dt, jam, p["C"], p["UA"], Q, TL)

    # baseline selalu parameter TP-07 (input konstan) dengan dt dan lama yang sama
    Qb = np.full_like(t, BASELINE["Q"], dtype=float)
    TLb = np.full_like(t, BASELINE["T_luar"], dtype=float)
    Tb = euler(BASELINE["T0"], dt, jam, BASELINE["C"], BASELINE["UA"], Qb, TLb)

    ana = analitik(t, p, p["C"], p["UA"], p["Q"], p["T0"], p["T_luar"])
    galat_maks = float(np.max(np.abs(T - ana))) if ana is not None else None

    tau = p["C"] / p["UA"]
    Q_akhir = p["Q"]
    T_ss = p["T_luar"] + Q_akhir / p["UA"]          # untuk suhu luar sinusoida: level rata-rata
    stabil = dt < 2 * tau

    # tiga langkah awal Euler (untuk dijelaskan di laporan/video)
    awal = []
    for k in range(min(3, n)):
        dTdt = (Q[k] - p["UA"] * (T[k] - TL[k])) / p["C"]
        awal.append({"k": k + 1, "t": round(float(t[k]), 2), "dTdt": round(float(dTdt), 6),
                     "T": round(float(T[k + 1]), 5)})

    idx, stride = kurangi_titik(n + 1)
    hasil = {
        "params": p,
        "stride": stride,
        "n_langkah": n,
        "t_menit": bulatkan(t[idx] / 60, 3),
        "T": bulatkan(T[idx]),
        "Q": bulatkan(Q[idx], 2),
        "T_luar": bulatkan(TL[idx]),
        "T_baseline": bulatkan(Tb[idx]),
        "T_analitik": bulatkan(ana[idx]) if ana is not None else None,
        "stats": {
            "T_ss": round(T_ss, 3),
            "tau_s": round(tau, 1),
            "tau_menit": round(tau / 60, 2),
            "T_akhir": round(float(T[-1]), 3),
            "T_maks": round(float(np.max(T)), 3),
            "galat_maks": round(galat_maks, 6) if galat_maks is not None else None,
            "stabil": bool(stabil),
            "T_ss_baseline": round(BASELINE["T_luar"] + BASELINE["Q"] / BASELINE["UA"], 3),
            "T_akhir_baseline": round(float(Tb[-1]), 3),
        },
        "awal": awal,
    }
    return jsonify(hasil)


@app.post("/api/stepsize")
def api_stepsize():
    """Bandingkan Euler dengan beberapa step size terhadap solusi analitik (input konstan)."""
    data = request.get_json(silent=True) or {}
    data = dict(data, heater_mode="konstan", outside_mode="konstan", dt=10)
    try:
        p = baca_parameter(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    tau = p["C"] / p["UA"]
    jam = p["jam"]
    t_ref = np.linspace(0, jam * 3600, 600)
    ana = analitik(t_ref, p, p["C"], p["UA"], p["Q"], p["T0"], p["T_luar"])

    seri = []
    for dt in (600, 100, 10):
        n = int(round(jam * 3600 / dt))
        if n < 1:
            continue
        t = np.arange(n + 1) * dt
        Q = np.full_like(t, p["Q"], dtype=float)
        TL = np.full_like(t, p["T_luar"], dtype=float)
        T = euler(p["T0"], dt, jam, p["C"], p["UA"], Q, TL)
        ana_t = analitik(t, p, p["C"], p["UA"], p["Q"], p["T0"], p["T_luar"])
        idx, _ = kurangi_titik(n + 1)
        seri.append({
            "dt": dt,
            "t_menit": bulatkan(t[idx] / 60, 3),
            "T": bulatkan(T[idx]),
            "galat_maks": round(float(np.max(np.abs(T - ana_t))), 6),
            "stabil": bool(dt < 2 * tau),
            "langkah": n,
        })
    return jsonify({
        "t_menit": bulatkan(t_ref / 60, 3),
        "T_analitik": bulatkan(ana),
        "seri": seri,
        "tau_s": round(tau, 1),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
