// ---------------------------------------------------------------------------
// dsiModel.js — Drill String Interference (DSI): axial magnetic interference
// from the BHA at the MWD sensor and the resulting azimuth error.
// Added 2026-10-25 for views/dsi.ejs (John). Only CONFIRMED formulas are used;
// the SPE 11382 required-NMDC-length chart is NOT implemented (pending the
// original paper — see claude/dsi-status.md).
//
// SOURCES
//  [1] Pole representation of magnetised steel sections (poles at the section
//      ends, field of a pole falling off as 1/d²): Scott & MacDonald,
//      SPE 7748 (1979), eqs. (1)–(3), Fig. 1.
//  [2] Field of a magnetic pole of strength P (Wb) at distance r (m):
//      B = P / (4·π·r²)  [T]   (standard magnetostatics, Coulomb's law for
//      magnetic poles with B = μ0·H; SI form of SPE 7748 eq. 2).
//      => ΔBz [nT] = P[µWb]·1000 / (4·π·r²).
//  [3] Pole strength guide values (North Sea, N. hemisphere; "a guide and
//      certainly not an upper limit"): ISCWSA eBook (2017) §5.2.2, from Shell
//      field measurements (CUR 252 / SPE 11382): drill collars above NMDC up to
//      +900 µWb; stabilisers and bit up to −90 µWb; 10 m drill collar below
//      NMDC up to −300 µWb; turbines up to −1000 µWb.
//  [4] Azimuth error from an axial field error:
//      ΔA = ΔBz · sin I · sin A · (180/π) / (B · cos Dip)
//      Wolff & de Wardt SPE 9223 (1981) eq. 2 (ΔC2 = sinI·sinA·ΔBz/B_N,
//      B_N = B·cosDip); ISCWSA eBook §5.2.3. A = MAGNETIC azimuth.
//  [5] Short-NMDC screening: error_used ≈ error_acc·(L_req/L_used)²
//      (ISCWSA eBook §5.2.4) — exported for display only.
//  INDUCED (added 2026-11-14, John): pole strengths from the component
//      geometry, induced magnetisation only.
//      Lalji, Haneef, Khan & Ali (2020), "Demagnetizing the drill string
//      magnetic interference in Far North and in Pakistan", J. Petrol. Explor.
//      Prod. Technol. 10:821-828, doi 10.1007/s13202-019-00801-7:
//        Eq. 3  Q = mu0 (mu - 1) H A / (1 + N (mu - 1))   [Wb]
//               with mu0*H = axial Earth field B_ax  =>  Q = (mu-1) B_ax A / (1 + N (mu-1));
//               mu -> infinity gives Q = B_ax A / N.
//        Eq. 4  B = Q / (4 pi r^2)   (same law as [2]).
//      N = axial demagnetising factor of a prolate spheroid, m = length/diameter
//      (Osborn 1945, Phys. Rev. 67:351; Lalji Eq. 2 — as printed it has a typo,
//      ln((m+s)/(m-s)) with s = sqrt(m^2-1) equals 2 ln(m+s), so the two agree):
//        N = [ m/s * ln(m + s) - 1 ] / (m^2 - 1)
//      Axial component of the Earth field along the tool, downhole positive
//      (standard tool-frame geometry): B_ax = B (cosI sinDip + sinI cosDip cosAm).
//      MTX IMPLEMENTATION CHOICES (stated, not from the paper):
//        - each CONTIGUOUS steel section (between non-mag runs / bit / BHA top)
//          is one body: length = section length, A = length-weighted steel area
//          pi/4 (OD^2-ID^2), diameter for m = length-weighted OD;
//        - magnetised along +z (downhole): +Q at its bottom end, -Q at its top
//          end (gives the eBook signs: upper pole +, lower pole -);
//        - only the BHA rows entered are modelled (string above the last row
//          is not); REMANENT magnetisation (NDT/MPI, handling) is NOT included.
//  SNIPER (legacy, optional, NOT default): line-for-line port of John's
//      SNIPER v1-3 Form1.vb Calcular_DSI(). Its pole strength P = 300·OD/ID
//      has NO known published source (confirmed with John 2026-10-25); its
//      azimuth formula is [4] with ΔBz[nT] = 1000·ΣBm.
//
// SIGN CONVENTION (pole model): z positive DOWNHOLE (towards the bit). A pole
// of strength P at distance r ABOVE the sensor gives ΔBz = +P/(4πr²); BELOW
// the sensor, −P/(4πr²). With the eBook's signs (upper pole +, lower pole −)
// both terms add, and the optimum sensor position lies nearer the lower pole
// (reproduces the eBook example's "30 % from bottom of NMDC", see status doc).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DsiModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, FT = 3.280839; // SNIPER's m->ft factor (Form1.vb)

  var PRESETS = { // [3] ISCWSA eBook §5.2.2 (µWb)
    upperDC: 900, belowStabBit: -90, belowDC10m: -300, belowTurbine: -1000
  };
  function isNM(r) { return /^non/i.test(String(r.material || '')); }

  // Material boundaries, bit first. rows: [{name, od, id, len (m), material}]
  function boundaries(rows) {
    var out = [], x = 0;
    for (var i = 0; i < rows.length; i++) {
      x += +rows[i].len;
      if (i < rows.length - 1 && isNM(rows[i]) !== isNM(rows[i + 1]))
        out.push({ x: x, below: i, above: i + 1, steelAbove: !isNM(rows[i + 1]) });
    }
    return out;
  }
  // The contiguous non-mag run holding the sensor: {bottom, top} distances from bit (m)
  function sensorRun(rows, sensor) {
    var x = 0, start = null;
    for (var i = 0; i < rows.length; i++) {
      var x0 = x; x += +rows[i].len;
      if (isNM(rows[i])) { if (start === null) start = x0; }
      else start = null;
      if (sensor > x0 && sensor <= x) {
        if (!isNM(rows[i])) return null;
        var top = x; for (var j = i + 1; j < rows.length && isNM(rows[j]); j++) top += +rows[j].len;
        return { bottom: start, top: top };
      }
    }
    return null;
  }

  /**
   * defaultPoles(rows, sensor, opts) — automatic pole list for the pole model.
   * opts: {pUpper (µWb, default +900), pLower (µWb, default −90),
   *        bitDipole (default true: the steel section below the sensor's
   *        NMDC run is a dipole, its far end at +|pLower|, as in the eBook
   *        example "length steel below NMDC")}
   * Poles at other boundaries get 0 µWb and flag 'noDefault' (no published
   * value — the user should enter one if known).
   */
  function defaultPoles(rows, sensor, opts) {
    opts = opts || {};
    var pU = opts.pUpper != null ? +opts.pUpper : PRESETS.upperDC;
    var pL = opts.pLower != null ? +opts.pLower : PRESETS.belowStabBit;
    var run = sensorRun(rows, sensor);
    if (!run) throw new Error('The sensor is not inside a non-magnetic component. Check the sensor distance and the Material column.');
    var b = boundaries(rows), poles = [];
    b.forEach(function (q) {
      var p = { x: q.x, P: 0, label: '', noDefault: true };
      if (Math.abs(q.x - run.top) < 1e-9 && q.steelAbove) { p.P = pU; p.label = 'Upper pole (steel above NMDC)'; p.noDefault = false; }
      else if (Math.abs(q.x - run.bottom) < 1e-9 && !q.steelAbove) { p.P = pL; p.label = 'Lower pole (steel below NMDC)'; p.noDefault = false; }
      else p.label = q.steelAbove ? 'Steel bottom end (no published default)' : 'Steel top end (no published default)';
      poles.push(p);
    });
    // far end of the steel section below the sensor's run (dipole): only when
    // that steel reaches the bit (no further NM below it)
    var lowerBoundaryIsLowest = b.length && Math.abs(b[0].x - run.bottom) < 1e-9 && !b[0].steelAbove;
    if (opts.bitDipole !== false && run.bottom > 0 && lowerBoundaryIsLowest)
      poles.unshift({ x: 0, P: -pL, label: 'Bit end of steel below (dipole, opposite sign)', noDefault: false });
    return { poles: poles, run: run };
  }

  // [1][2] axial interference at sensor position s (m from bit), nT
  function fieldAt(poles, s) {
    var b = 0;
    poles.forEach(function (p) {
      var r = p.x - s; if (r === 0 || !p.P) return;
      var sign = r > 0 ? 1 : -1;            // pole above sensor -> +, below -> −
      b += sign * p.P * 1000 / (4 * Math.PI * r * r);
    });
    return b;
  }
  // [4] azimuth error (deg) — azMag = MAGNETIC azimuth (deg)
  function azError(dBzNT, incDeg, azMagDeg, btNT, dipDeg) {
    return dBzNT * Math.sin(incDeg * D2R) * Math.sin(azMagDeg * D2R) * R2D / (btNT * Math.cos(dipDeg * D2R));
  }
  // ΔBz along the NMDC run (for the sensor-position plot)
  function fieldProfile(poles, run, n) {
    n = n || 200; var out = [];
    for (var k = 1; k < n; k++) { var s = run.bottom + (run.top - run.bottom) * k / n; out.push({ s: s, b: fieldAt(poles, s) }); }
    return out;
  }
  function optimum(poles, run) {
    var best = null; fieldProfile(poles, run, 2000).forEach(function (p) { if (!best || Math.abs(p.b) < Math.abs(best.b)) best = p; });
    return best;
  }


  // ---------------- INDUCED (geometry) — see header -----------------------
  function demagN(m) {                 // Osborn 1945 prolate spheroid, axial
    if (!(m > 1.0001)) return 1 / 3;   // sphere limit (short parts; flagged by caller)
    var s = Math.sqrt(m * m - 1);
    return (m / s * Math.log(m + s) - 1) / (m * m - 1);
  }
  function axialField(btNT, dipDeg, incDeg, azMagDeg) {
    return btNT * (Math.cos(incDeg * D2R) * Math.sin(dipDeg * D2R) + Math.sin(incDeg * D2R) * Math.cos(dipDeg * D2R) * Math.cos(azMagDeg * D2R));
  }
  // rows: [{od,id (in), len (m), material}], bit first. mu: relative permeability (null/Infinity = geometry-limited).
  // Returns poles with P in µWb PER nT of axial field (multiply by B_ax), plus the section list.
  function inducedSections(rows, mu) {
    var IN = 0.0254, secs = [], x = 0, cur = null, warn = [];
    rows.forEach(function (r, i) {
      var x0 = x; x += +r.len;
      if (isNM(r)) { cur = null; return; }
      if (!(r.od > 0) || !(r.id >= 0) || r.id >= r.od) throw new Error('Induced method needs OD > ID on every steel row (row ' + (i + 1) + ').');
      if (!cur) { cur = { bottom: x0, top: x, sumA: 0, sumOD: 0, rows: [] }; secs.push(cur); }
      cur.top = x; cur.sumA += Math.PI / 4 * (Math.pow(r.od * IN, 2) - Math.pow(r.id * IN, 2)) * r.len; cur.sumOD += r.od * IN * r.len; cur.rows.push(i + 1);
    });
    var poles = [];
    secs.forEach(function (c) {
      var Ls = c.top - c.bottom; c.len = Ls; c.A = c.sumA / Ls; c.D = c.sumOD / Ls; c.m = Ls / c.D; c.N = demagN(c.m);
      if (c.m <= 1.0001) warn.push('Steel section rows ' + c.rows.join(',') + ' is shorter than its diameter: N = 1/3 (sphere) used.');
      // Q per nT of axial field, in µWb:  (mu-1) A / (1 + N(mu-1))  ->  A/N  when mu -> inf;  1 nT = 1e-9 T, 1 Wb = 1e6 µWb
      var g = (mu > 1 && isFinite(mu)) ? (mu - 1) * c.A / (1 + c.N * (mu - 1)) : c.A / c.N;
      c.qPerNT = g * 1e-9 * 1e6;
      poles.push({ x: c.bottom, P: c.qPerNT, label: 'Steel rows ' + c.rows.join(',') + ' — bottom end (+)', sec: c });
      poles.push({ x: c.top, P: -c.qPerNT, label: 'Steel rows ' + c.rows.join(',') + ' — top end (−)', sec: c });
    });
    return { sections: secs, poles: poles, warnings: warn };
  }
  // ---------------- SNIPER (legacy) — port of Form1.vb Calcular_DSI() -------
  // Input lengths in metres (SNIPER "CAN" units), converted to ft with SNIPER's
  // own factor. Returns {bmSum (SNIPER units), dBzNT (=1000·bmSum), table, warnings}.
  // Kept verbatim, including: F2/F4 rounding of the displayed grid values that
  // the sums use; pole strength 300·OD/ID of the element BELOW (row i−1) and
  // ABOVE (row i+1) the top row of each non-mag run; all Bm terms added with
  // the same sign and the first run's lower term subtracted at the sensor
  // distance. KNOWN LIMITS (documented, not fixed): P has no published source;
  // for a run of several non-mag rows, "row i−1" is itself non-mag.
  function sniper(rows, sensorM) {
    var r2 = function (v) { return +(+v).toFixed(2); }, r4 = function (v) { return +(+v).toFixed(4); };
    var n = rows.length, warnings = [];
    if (n < 1) throw new Error('No BHA to calculate the DSI.');
    if (isNM(rows[n - 1])) throw new Error("The last element's material of the BHA should be steel.");
    var DNI = Math.abs(sensorM * FT);
    if (DNI <= 0) throw new Error('The Sensor (Bit-Probe) distance cannot be negative nor zero.');
    var total = rows.reduce(function (a, r) { return a + +r.len; }, 0);
    if (DNI >= total * FT) throw new Error('The Sensor (Bit-Probe) distance cannot exceed the BHA length.');
    var cum = [], x = 0; rows.forEach(function (r) { x += +r.len; cum.push(x); });
    var nRuns = 0;
    for (var i = 0; i < n; i++) if (isNM(rows[i]) && !(i + 1 < n && isNM(rows[i + 1]))) nRuns++;
    if (!nRuns) throw new Error('No Non-Mag components in the BHA.');
    var dist = [];
    for (i = 0; i < n; i++) {
      if (i < n - 1 && isNM(rows[i]) !== isNM(rows[i + 1])) {
        var p2b = r2(cum[i] * FT); dist.push({ poleToBit: p2b, z: r2(DNI - p2b) });
      }
    }
    var m = 0, P1 = 0, firstRun = true;
    for (i = 0; i < n; i++) {
      if (!isNM(rows[i]) || (i + 1 < n && isNM(rows[i + 1]))) continue;
      if (i - 1 < 0 || i + 1 >= n) throw new Error('A non-mag row has no element below/above it.');
      if (isNM(rows[i - 1])) warnings.push('Non-mag run ending at row ' + (i + 1) + ' has several non-mag rows: SNIPER takes the "lower pole" OD/ID from row ' + i + ', which is itself non-mag (SNIPER behaviour kept).');
      var below = rows[i - 1], above = rows[i + 1];
      if (firstRun) { P1 = Math.abs(300 * (+below.od / +below.id)); firstRun = false; }
      [below, above].forEach(function (el) {
        if (!dist[m]) throw new Error('Pole/boundary count mismatch (SNIPER requires steel on both sides of every non-mag run).');
        var rel = +el.od / +el.id, P = 300 * rel, Z = dist[m].z;
        dist[m].bm = r4(P / (Z * Z)); dist[m].rel = r2(rel); dist[m].P = r2(P); m++;
      });
    }
    var bm = 0; dist.forEach(function (d) { bm += d.bm || 0; });
    bm = bm - (P1 / (DNI * DNI));
    return { bmSum: bm, dBzNT: 1000 * bm, table: dist, warnings: warnings, sensorFt: DNI };
  }
  // SNIPER Az error: 57300·Bm·sin(Inc)·sin(Az−Dec)/BT/cos(Dip) (BT nT) — [4] with ΔBz = 1000·Bm
  function sniperAzError(bmSum, incDeg, azDeg, decDeg, btNT, dipDeg) {
    return 57300 * bmSum * Math.sin(incDeg * D2R) * Math.sin((azDeg - decDeg) * D2R) / btNT / Math.cos(dipDeg * D2R);
  }

  return { PRESETS: PRESETS, isNM: isNM, boundaries: boundaries, sensorRun: sensorRun, defaultPoles: defaultPoles,
    fieldAt: fieldAt, azError: azError, fieldProfile: fieldProfile, optimum: optimum, sniper: sniper, sniperAzError: sniperAzError,
    demagN: demagN, axialField: axialField, inducedSections: inducedSections };
}));
