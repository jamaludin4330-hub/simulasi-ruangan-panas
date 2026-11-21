/* TA-07 Simulator Suhu Ruangan - sisi klien */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const DEFAULTS = {
    C: 50000, UA: 20, Q: 200, T0: 28, T_luar: 28,
    tstep: 30, amp: 3, period: 24, dt: 10, jam: 4,
    heater_mode: "konstan", outside_mode: "konstan",
  };
  const PRESETS = {
    baseline:  { ...DEFAULTS },
    pemanas50: { ...DEFAULTS, Q: 100 },
    jendela:   { ...DEFAULTS, UA: 30 },
    uji:       { ...DEFAULTS, heater_mode: "step", tstep: 30, outside_mode: "sinus", amp: 3, period: 24, jam: 24 },
  };
  const NUM_KEYS = ["C", "UA", "Q", "T0", "T_luar", "tstep", "amp", "period", "jam"];

  const state = { last: null, page: 0, pageSize: 20, show: { base: true, ana: true, out: true, ss: true } };
  let charts = {};
  let timer = null;
  let reqId = 0;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "-" : Number(v).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));

  /* ---------------- Form ---------------- */
  function fieldOf(key) { return document.querySelector(`.field[data-key="${key}"]`); }

  function setFill(range) {
    const min = +range.min, max = +range.max;
    range.style.setProperty("--fill", ((+range.value - min) / (max - min)) * 100 + "%");
  }

  function initFields() {
    NUM_KEYS.forEach((key) => {
      const f = fieldOf(key);
      const num = $("input[type=number]", f), rng = $("input[type=range]", f);
      [num, rng].forEach((el) => { el.min = f.dataset.min; el.max = f.dataset.max; el.step = f.dataset.step; });
      num.addEventListener("input", () => {
        const v = parseFloat(num.value);
        const ok = Number.isFinite(v) && v >= +f.dataset.min && v <= +f.dataset.max;
        num.classList.toggle("invalid", !ok);
        if (ok) { rng.value = v; setFill(rng); schedule(); }
      });
      rng.addEventListener("input", () => { num.value = rng.value; num.classList.remove("invalid"); setFill(rng); schedule(); });
    });
    $("#dt").addEventListener("change", schedule);
    $$("input[name=heater_mode], input[name=outside_mode]").forEach((r) => r.addEventListener("change", () => { syncModes(); schedule(); }));
  }

  function syncModes() {
    const step = $("input[name=heater_mode]:checked").value === "step";
    const sinus = $("input[name=outside_mode]:checked").value === "sinus";
    $("#grp-step").hidden = !step;
    $$(".grp-sinus").forEach((e) => (e.hidden = !sinus));
    $("label[for=Q]").firstChild.textContent = step ? "Daya pemanas setelah menyala Q " : "Daya pemanas Q ";
    $("label[for=T_luar]").firstChild.textContent = sinus ? "Suhu luar (rata-rata) " : "Suhu luar ";
  }

  function setState(s) {
    NUM_KEYS.forEach((key) => {
      const f = fieldOf(key);
      $("input[type=number]", f).value = s[key];
      const r = $("input[type=range]", f); r.value = s[key]; setFill(r);
      $("input[type=number]", f).classList.remove("invalid");
    });
    $("#dt").value = String(s.dt);
    $(`input[name=heater_mode][value=${s.heater_mode}]`).checked = true;
    $(`input[name=outside_mode][value=${s.outside_mode}]`).checked = true;
    syncModes();
  }

  function getState() {
    const s = {};
    NUM_KEYS.forEach((k) => (s[k] = parseFloat($(`#${k}`).value)));
    s.dt = parseFloat($("#dt").value);
    s.heater_mode = $("input[name=heater_mode]:checked").value;
    s.outside_mode = $("input[name=outside_mode]:checked").value;
    return s;
  }

  function markPreset(name) {
    $$(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === name)));
  }

  /* ---------------- Util UI ---------------- */
  function showAlert(msg, warn = false) {
    const a = $("#alert");
    a.textContent = msg; a.hidden = !msg; a.classList.toggle("warn", warn);
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2200);
  }
  function schedule() { markPreset(null); clearTimeout(timer); timer = setTimeout(run, 350); }

  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Terjadi kesalahan pada server.");
    return data;
  }

  /* ---------------- Simulasi ---------------- */
  async function run(manual = false) {
    const btn = $("#btn-run");
    const my = ++reqId;
    btn.classList.add("loading"); btn.disabled = true;
    try {
      const data = await post("/api/simulate", getState());
      if (my !== reqId) return;
      state.last = data; state.page = 0;
      showAlert("");
      render(data);
      if (manual === true) toast("Simulasi selesai dijalankan");
    } catch (e) {
      showAlert(e.message);
    } finally {
      if (my === reqId) { btn.classList.remove("loading"); btn.disabled = false; }
    }
  }

  function render(r) {
    renderStats(r);
    renderCharts(r);
    renderTable();
    renderAwal(r);
    renderInterpretasi(r);
    if (!r.stats.stabil) showAlert("Step size dt terlalu besar (dt >= 2 * tau). Metode Euler bisa tidak stabil, kecilkan dt.", true);
  }

  function renderStats(r) {
    const s = r.stats, p = r.params;
    $("#st-tss").textContent = fmt(s.T_ss, 1) + " °C";
    $("#st-tss-note").textContent = p.outside_mode === "sinus" ? "level rata-rata (suhu luar berosilasi)" : "T_luar + Q / UA";
    $("#st-tau").textContent = fmt(s.tau_menit, 1) + " menit";
    $("#st-end").textContent = fmt(s.T_akhir, 2) + " °C";
    $("#st-end-note").textContent = "setelah " + p.jam + " jam";
    if (s.galat_maks === null) {
      $("#st-err").textContent = "n/a";
      $("#st-err-note").textContent = "tidak ada solusi eksak (sinusoida)";
    } else {
      $("#st-err").textContent = s.galat_maks.toFixed(4) + " °C";
      $("#st-err-note").textContent = "dt = " + p.dt + " detik";
    }
  }

  /* ---------------- Grafik ---------------- */
  function baseOptions(yTitle) {
    const grid = "rgba(169,153,164,0.14)", tick = css("--muted");
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#e2d6dd", usePointStyle: true, boxWidth: 8, font: { family: "Inter", size: 12 } } },
        tooltip: {
          backgroundColor: "#2b2232", borderColor: "#3b2f43", borderWidth: 1, titleColor: "#f0e7ec", bodyColor: "#e2d6dd", padding: 10,
          callbacks: { title: (it) => "t = " + fmt(it[0].parsed.x, 1) + " menit", label: (c) => c.dataset.label + ": " + fmt(c.parsed.y, 3) },
        },
      },
      scales: {
        x: { type: "linear", title: { display: true, text: "Waktu (menit)", color: tick }, ticks: { color: tick }, grid: { color: grid } },
        y: { title: { display: true, text: yTitle, color: tick }, ticks: { color: tick }, grid: { color: grid } },
      },
    };
  }

  const pts = (x, y) => x.map((v, i) => ({ x: v, y: y[i] }));

  function renderCharts(r) {
    const x = r.t_menit, p = r.params, s = r.stats;
    const rose = css("--rose"), mauve = css("--mauve"), sand = css("--sand"), sky = css("--sky"), sage = css("--sage");

    const ds = [
      { key: "sim", label: "Simulasi Euler", data: pts(x, r.T), borderColor: rose, backgroundColor: rose, borderWidth: 2.6, pointRadius: 0, tension: 0.15 },
      { key: "base", label: "Baseline (TP-07)", data: pts(x, r.T_baseline), borderColor: mauve, backgroundColor: mauve, borderWidth: 2, borderDash: [7, 5], pointRadius: 0, hidden: !state.show.base },
      { key: "ana", label: "Solusi analitik", data: r.T_analitik ? pts(x, r.T_analitik) : [], borderColor: sand, backgroundColor: sand, borderWidth: 1.8, borderDash: [2, 4], pointRadius: 0, hidden: !state.show.ana || !r.T_analitik },
      { key: "out", label: "Suhu luar", data: pts(x, r.T_luar), borderColor: sky, backgroundColor: sky, borderWidth: 1.6, pointRadius: 0, hidden: !state.show.out },
      { key: "ss", label: "Steady state", data: [{ x: x[0], y: s.T_ss }, { x: x[x.length - 1], y: s.T_ss }], borderColor: sage, backgroundColor: sage, borderWidth: 1.4, borderDash: [10, 6], pointRadius: 0, hidden: !state.show.ss },
    ];

    if (charts.temp) {
      charts.temp.data.datasets = ds;
      charts.temp.update();
    } else {
      charts.temp = new Chart($("#chart-temp"), { type: "line", data: { datasets: ds }, options: baseOptions("Suhu (°C)") });
    }

    const qds = [{ label: "Daya pemanas Q (W)", data: pts(x, r.Q), borderColor: sand, backgroundColor: "rgba(217,197,163,0.16)", fill: true, borderWidth: 2, pointRadius: 0, stepped: true }];
    const qopt = baseOptions("Q (W)");
    qopt.plugins.legend.display = false;
    qopt.scales.y.suggestedMin = 0;
    qopt.scales.y.suggestedMax = Math.max(p.Q * 1.2, 10);
    if (charts.q) { charts.q.data.datasets = qds; charts.q.options = qopt; charts.q.update(); }
    else charts.q = new Chart($("#chart-q"), { type: "line", data: { datasets: qds }, options: qopt });

    $$(".toggle[data-series='ana']").forEach((b) => (b.disabled = !r.T_analitik));
  }

  function bindToggles() {
    $$(".toggle").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.series;
      state.show[k] = !state.show[k];
      b.setAttribute("aria-pressed", String(state.show[k]));
      if (!charts.temp) return;
      const d = charts.temp.data.datasets.find((x) => x.key === k);
      if (d) { d.hidden = !state.show[k] || (k === "ana" && !(state.last && state.last.T_analitik)); charts.temp.update(); }
    }));
  }

  /* ---------------- Tabel ---------------- */
  function renderTable() {
    const r = state.last; if (!r) return;
    const total = r.t_menit.length, pages = Math.ceil(total / state.pageSize);
    state.page = Math.min(state.page, pages - 1);
    const from = state.page * state.pageSize, to = Math.min(from + state.pageSize, total);
    $("#tbl-data tbody").innerHTML = r.t_menit.slice(from, to).map((t, i) => {
      const j = from + i;
      return `<tr><td>${fmt(t, 2)}</td><td>${fmt(r.T[j], 3)}</td><td>${fmt(r.T_luar[j], 3)}</td><td>${fmt(r.Q[j], 1)}</td></tr>`;
    }).join("");
    $("#pg-info").textContent = `Halaman ${state.page + 1} dari ${pages}`;
    $("#pg-prev").disabled = state.page === 0;
    $("#pg-next").disabled = state.page >= pages - 1;
    $("#data-note").textContent = r.stride > 1
      ? `Total ${r.n_langkah.toLocaleString("id-ID")} langkah. Tabel dan grafik menampilkan tiap ${r.stride} langkah agar ringan.`
      : `Total ${r.n_langkah.toLocaleString("id-ID")} langkah ditampilkan seluruhnya.`;
  }

  function renderAwal(r) {
    $("#tbl-awal tbody").innerHTML = r.awal.map((a) =>
      `<tr><td>${a.k}</td><td>${a.t}</td><td>${a.dTdt.toFixed(6)}</td><td>${a.T.toFixed(5)}</td></tr>`).join("");
  }

  /* ---------------- Interpretasi otomatis ---------------- */
  function renderInterpretasi(r) {
    const s = r.stats, p = r.params, out = [];
    const naik = s.T_akhir - p.T0;
    out.push(`Suhu ruangan bergerak dari <strong>${fmt(p.T0, 1)} °C</strong> menjadi <strong>${fmt(s.T_akhir, 2)} °C</strong> setelah ${p.jam} jam (${naik >= 0 ? "naik" : "turun"} ${fmt(Math.abs(naik), 2)} °C).`);

    if (p.outside_mode === "sinus") {
      out.push(`Karena suhu luar berosilasi (amplitudo ${fmt(p.amp, 1)} °C, periode ${p.period} jam), suhu ruangan ikut bergoyang tetapi tertinggal dan teredam. Sistem bekerja seperti filter low-pass: perubahan cepat di luar diredam oleh kapasitas panas C, perubahan lambat tetap terlihat.`);
    } else if (p.Q === 0 && p.heater_mode === "konstan") {
      out.push(`Pemanas mati, sehingga suhu ruangan hanya menyesuaikan diri ke suhu luar (${fmt(p.T_luar, 1)} °C) dengan konstanta waktu ${fmt(s.tau_menit, 1)} menit.`);
    } else {
      out.push(`Polanya mendekati batas (goal-seeking) menuju steady state <strong>${fmt(s.T_ss, 1)} °C</strong>, bukan eksponensial yang naik terus dan bukan osilasi. Ini ciri feedback loop negatif: makin tinggi suhu ruangan, makin besar panas yang hilang, sampai panas masuk sama dengan panas keluar.`);
    }
    out.push(`Konstanta waktu <strong>τ = C / UA = ${fmt(s.tau_menit, 1)} menit</strong>. Suhu mencapai sekitar 63% dari kenaikan totalnya pada τ dan hampir stabil setelah sekitar 5τ (${fmt((5 * s.tau_menit) / 60, 1)} jam).`);

    const dBase = s.T_akhir - s.T_akhir_baseline;
    if (Math.abs(dBase) > 0.01) {
      out.push(`Dibanding baseline TP-07 (steady state ${fmt(s.T_ss_baseline, 1)} °C), suhu akhir skenario ini ${dBase > 0 ? "lebih tinggi" : "lebih rendah"} <strong>${fmt(Math.abs(dBase), 2)} °C</strong>.`);
    }
    if (s.galat_maks !== null) {
      out.push(`Galat maksimum Euler terhadap solusi analitik hanya ${s.galat_maks.toFixed(4)} °C pada dt = ${p.dt} detik. Coba perbesar dt, galatnya akan ikut membesar (lihat menu Uji Step Size).`);
    }
    $("#interpretasi").innerHTML = out.map((t) => `<p>${t}</p>`).join("");
  }

  /* ---------------- Uji step size ---------------- */
  async function runStep() {
    const btn = $("#btn-step");
    btn.classList.add("loading"); btn.disabled = true;
    try {
      const d = await post("/api/stepsize", getState());
      const cols = [css("--rose"), css("--mauve"), css("--sage")];
      const ds = [{ label: "Solusi analitik", data: pts(d.t_menit, d.T_analitik), borderColor: css("--sand"), borderWidth: 2.4, pointRadius: 0 }];
      d.seri.forEach((s, i) => ds.push({ label: `Euler dt = ${s.dt} s`, data: pts(s.t_menit, s.T), borderColor: cols[i % 3], borderWidth: 1.9, borderDash: [6, 4], pointRadius: 0 }));
      if (charts.step) { charts.step.data.datasets = ds; charts.step.update(); }
      else charts.step = new Chart($("#chart-step"), { type: "line", data: { datasets: ds }, options: baseOptions("Suhu (°C)") });
      $("#tbl-step tbody").innerHTML = d.seri.map((s) =>
        `<tr><td>${s.dt}</td><td>${s.langkah.toLocaleString("id-ID")}</td><td>${s.galat_maks.toFixed(4)}</td><td><span class="badge ${s.stabil ? "ok" : "bad"}">${s.stabil ? "Stabil (dt < 2 tau)" : "Berisiko tidak stabil"}</span></td></tr>`).join("");
      showAlert("");
      toast("Perbandingan step size selesai");
    } catch (e) { showAlert(e.message); }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }

  /* ---------------- Unduh ---------------- */
  function downloadBlob(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function downloadCSV() {
    const r = state.last; if (!r) return;
    const rows = ["waktu_menit,suhu_ruangan_C,suhu_luar_C,q_heater_W"];
    r.t_menit.forEach((t, i) => rows.push([t, r.T[i], r.T_luar[i], r.Q[i]].join(",")));
    downloadBlob("hasil_simulasi_suhu.csv", new Blob([rows.join("\n")], { type: "text/csv" }));
    toast("Data CSV diunduh");
  }
  function downloadPNG() {
    if (!charts.temp) return;
    const a = document.createElement("a");
    a.href = charts.temp.toBase64Image("image/png", 1); a.download = "grafik_suhu_ruangan.png";
    document.body.appendChild(a); a.click(); a.remove();
    toast("Grafik PNG diunduh");
  }

  /* ---------------- Tab ---------------- */
  function bindTabs() {
    $$(".tab").forEach((t) => t.addEventListener("click", () => {
      $$(".tab").forEach((x) => { const on = x === t; x.classList.toggle("active", on); x.setAttribute("aria-selected", String(on)); });
      $$(".tabpanel").forEach((p) => (p.hidden = p.id !== "tab-" + t.dataset.tab));
      Object.values(charts).forEach((c) => c.resize());
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (t.dataset.tab === "step" && !charts.step) runStep();
    }));
  }

  /* ---------------- Init ---------------- */
  function init() {
    initFields();
    bindToggles();
    bindTabs();
    setState(DEFAULTS);

    $$(".preset").forEach((b) => b.addEventListener("click", () => {
      setState(PRESETS[b.dataset.preset]);
      markPreset(b.dataset.preset);
      run(true);
    }));
    $("#btn-run").addEventListener("click", () => { clearTimeout(timer); run(true); });
    $("#btn-reset").addEventListener("click", () => { setState(DEFAULTS); markPreset("baseline"); run(true); toast("Parameter dikembalikan ke baseline"); });
    $("#btn-csv").addEventListener("click", downloadCSV);
    $("#btn-png").addEventListener("click", downloadPNG);
    $("#btn-step").addEventListener("click", runStep);
    $("#pg-prev").addEventListener("click", () => { state.page = Math.max(0, state.page - 1); renderTable(); });
    $("#pg-next").addEventListener("click", () => { state.page += 1; renderTable(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input[type=number]")) { clearTimeout(timer); run(true); } });

    run();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
