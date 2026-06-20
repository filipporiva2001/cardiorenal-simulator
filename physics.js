/* ============================================================
   PHYSICS MODULE — Renal-CV Flow Bench Digital Twin

   Positive-displacement pump → Q = 15 mL/s FIXED

   Activity 1 (middle tube, P1-P2), V2 fully open (v2=1.0):
     ¾ in  → ΔP1 = 5.10 psi  (vasoconstriction)
     1 in  → ΔP1 = 2.00 psi  (healthy baseline)
     1¼ in → ΔP1 = 0.82 psi  (vasodilation)
     1½ in → ΔP1 = 0.35 psi  (strong vasodilation)

   Activity 2 (Valve 1 open — parallel branch):
     Any tube → ΔP1 drops to ~0.10-0.12 psi

   Activity 3 (afferent/efferent tubes, P3-P4), V2 closed (v2<0.05):
     Requires V3 or V4 open (return path) AND V5 open
     Healthy (1in+1in):     ΔP2 = 2.00 psi, GFR = 48 mL/min → 8 mL/10s
     Aff vasoconstr (¾in):  ΔP2 = 3.55 psi, GFR = 29 mL/min → 4.9 mL/10s
     Eff vasodilation (1¼): ΔP2 = 1.41 psi, GFR = 28 mL/min → 4.6 mL/10s
     Aff vasodilation (1¼): ΔP2 = 1.41 psi, GFR = 68 mL/min → 11.3 mL/10s
     Eff vasoconstr (¾in):  ΔP2 = 3.55 psi, GFR = 78 mL/min → 13.0 mL/10s
     Nephrolithiasis:        ΔP2 barely drops, GFR = 4.6 mL/min → 0.8 mL/10s

   If V2 < 0.05 (effectively closed): ΔP1 = 0 (matches old binary "closed" behaviour)
   If V3 AND V4 are both closed: ΔP2 = 0, GFR = 0 (no return path)

   Activity 5 — Compensatory mechanism support:
     V2 is now a continuous 0-1 fraction (like V5), not boolean.
     This lets the "Afferent Vasoconstriction Response" partially
     close V2 to the black mark (~0.5) or "Nephrolithiasis Response"
     close it to the red mark (~0.18), simulating the heart's
     compensatory tightening — WITHOUT changing any Activity 1-4
     behaviour, since v2=1.0 (fully open) and v2≈0 (fully closed)
     reproduce the exact same numbers as the old boolean model.
   ============================================================ */

const Physics = (() => {

  const ETA          = 0.0010;
  const PSI_PER_PA   = 1 / 6894.76;
  const MMHG_PER_PSI = 51.7149;
  const L_SEGMENT    = 0.45;
  const L_RENAL      = 0.2250;
  const Q_FIXED_MLS  = 15.0;
  const Q_FIXED_M3S  = Q_FIXED_MLS * 1e-6;

  const EFFECTIVE_R = {
    small:  8.362e-4,
    medium: 1.0566e-3,
    large:  1.3205e-3,
    xlarge: 1.6337e-3,
  };

  const DIAMETERS = {
    small:  { label: '¾ in',  inches: 0.75 },
    medium: { label: '1 in',  inches: 1.0  },
    large:  { label: '1¼ in', inches: 1.25 },
    xlarge: { label: '1½ in', inches: 1.5  },
  };

  // Unified-loop tube length — used ONLY when V1 is closed and V2, V3, V4
  // are ALL open simultaneously (Activity 5's exact configuration). In
  // that case there is truly one continuous series loop, so ΔP1 and ΔP2
  // must be equal (same shared pressure drop), not independently
  // calibrated. Calibrated so healthy gives exactly 2.00 psi.
  const L_UNIFIED = 0.1233;
  function R_unified(r_m) { return (8*ETA*L_UNIFIED) / (Math.PI * Math.pow(r_m, 4)); }

  // Compensatory mechanism GFR targets — partial restoration toward the
  // 125 mL/min healthy baseline, reflecting the heart's compensatory
  // response (used only in unified-loop / Activity 5 mode).
  const COMPENSATED_GFR = {
    'small_medium':  115.0, // afferent vasoconstriction + compensation
    'large_medium':  130.0, // afferent vasodilation + compensation (gentle relief, GFR settles near healthy)
    'small_small':    34.0, // nephrolithiasis + compensation (barely helps)
  };

  const GFR_TABLE = {
    'medium_medium': 125,   // healthy: 125 mL/min (standard textbook baseline)
    'small_medium':   75,   // aff vasoconstriction: ↓ glomerular pressure → ↓ GFR
    'medium_large':   80,   // eff vasodilation: ↓ pressure retention → ↓ GFR
    'large_medium':  175,   // aff vasodilation: ↑ glomerular pressure → ↑ GFR
    'medium_small':  160,   // eff vasoconstriction: ↑ pressure retention → ↑ GFR
    'small_small':    18,   // nephrolithiasis base (both constricted): very low GFR
    'large_large':   195,
    'small_large':    55,
    'large_small':   210,
    'xlarge_medium': 200,
    'medium_xlarge':  60,
    'xlarge_small':  220,
    'small_xlarge':   45,
    'xlarge_xlarge': 205,
    'xlarge_large':  200,
    'large_xlarge':  185,
  };

  function getGFR(affKey, effKey, v5) {
    const key = affKey + '_' + effKey;
    const baseGFR = GFR_TABLE[key] !== undefined ? GFR_TABLE[key] : 125;
    return baseGFR * v5;
  }

  const KF_BENCH     = 12.6 / 100;
  const PI_GLOM_MMHG = 28;
  const PI_BS_MMHG   = 0;

  function R_cv(r_m)  { return (8*ETA*L_SEGMENT) / (Math.PI * Math.pow(r_m, 4)); }
  function R_ren(r_m) { return (8*ETA*L_RENAL)   / (Math.PI * Math.pow(r_m, 4)); }

  function parallelR(...rs) {
    const valid = rs.filter(r => r > 0 && r !== Infinity);
    if (!valid.length) return Infinity;
    return 1 / valid.reduce((s, r) => s + 1 / r, 0);
  }

  const _ns = {};
  function jitter(key, trueValue, noise = 0.006) {
    if (!_ns[key] || Math.abs(_ns[key].anchor - trueValue) > Math.abs(trueValue) * 0.08) {
      _ns[key] = { cur: trueValue, tgt: trueValue, anchor: trueValue };
    }
    const s = _ns[key];
    s.anchor = trueValue;
    if (Math.random() < 0.15) s.tgt = trueValue + (Math.random() - 0.5) * 2 * noise;
    s.cur += (s.tgt - s.cur) * 0.12;
    return s.cur;
  }

  function resetJitter() { Object.keys(_ns).forEach(k => delete _ns[k]); }

  const BASELINE = (() => {
    const R_MID  = R_cv(EFFECTIVE_R.medium);
    const R_back = R_MID * 0.05;
    const R_cv_b = R_MID + R_back;
    const dP_mid = Q_FIXED_M3S * R_MID * PSI_PER_PA;
    const P1 = Q_FIXED_M3S * R_cv_b * PSI_PER_PA * 0.55;
    const P2 = Math.max(0, P1 - dP_mid);

    // V2 partial-close resistance model — calibrated so:
    //   v2=1.0 (fully open)  -> 0 extra resistance (matches Activity 1)
    //   v2≈0.05 (closed)     -> same magnitude as old binary penalty (matches Activity 3's ΔP1=0 path)
    const penaltyR  = R_cv(EFFECTIVE_R.small) * 0.5; // old binary "V2 closed" penalty
    const v2ClosedEquiv = 0.05;
    const R_v2_base = penaltyR / ((1 / Math.pow(v2ClosedEquiv, 4)) - 1);

    return {
      R_mid: R_MID,
      R_cv:  R_cv_b,
      R_branch: (8*ETA*L_SEGMENT) / (Math.PI * Math.pow(EFFECTIVE_R.medium * 2.0, 4)),
      dP_mid_psi: dP_mid,
      dPglomMinusPBS: (P1 - P2) * MMHG_PER_PSI,
      R_v2_base,
    };
  })();

  // Smooth V2 resistance contribution — 0 at fully open, rises steeply as it closes
  function R_v2_extra(v2frac) {
    const v2 = Math.max(v2frac, 0.02);
    return BASELINE.R_v2_base * ((1 / Math.pow(v2, 4)) - 1);
  }

  // V2 throttle specifically for unified-loop mode (Activity 5) — tuned
  // to give a clearly visible pressure rise when V2 partially closes
  // (e.g. ~30% open during compensation), unlike the Activity 1/3
  // R_v2_extra() which is calibrated for the binary near-fully-closed case.
  const R_v2_base_unified = 1234324; // calibrated: 30% open adds ~0.6x one segment's R
  function R_v2_extra_unified(v2frac) {
    const v2 = Math.max(v2frac, 0.02);
    return R_v2_base_unified * ((1 / Math.pow(v2, 4)) - 1);
  }

  function solve(config) {
    const safeKey = k => (EFFECTIVE_R[k] ? k : 'medium');
    const midKey = safeKey(config.middle   || 'medium');
    const affKey = safeKey(config.afferent || 'medium');
    const effKey = safeKey(config.efferent || 'medium');

    // V2 — now a continuous fraction (0-1). Booleans still work:
    // JS coerces `true`→1, `false`→0, so existing Activity 1-4 calls
    // that pass config.v2 as true/false behave identically to before.
    const v2frac = (config.v2 === true) ? 1.0
                 : (config.v2 === false) ? 0.0
                 : (typeof config.v2 === 'number' ? config.v2 : 1.0);
    const v2Open = v2frac > 0.05; // "open enough" for flow purposes

    const renalActive = config.v3 || config.v4;
    const v5 = Math.max(config.v5Opening, 0.0);

    // --- UNIFIED LOOP MODE (Activity 5) -----------------------------------
    // Active only when V1 closed, V2 fully open, AND both V3+V4 open —
    // AND the afferent or efferent tube has been changed away from medium
    // (i.e. the student is actually running an Activity 5 scenario, not
    // just Activity 1's default healthy setup which also has all these
    // valves in this exact state but never touches afferent/efferent).
    // Applies universally whenever V1 is closed and V2, V3, V4 are ALL
    // open simultaneously — that configuration is physically ONE
    // continuous loop, so ΔP1 must equal ΔP2 regardless of which tubes
    // are selected. Activity 1's procedure keeps V3/V4 CLOSED, so it
    // never triggers this branch; Activity 3's procedure keeps V2
    // CLOSED, so it never triggers this branch either. Only Activity 5's
    // "all valves except possibly V1 open" configuration reaches here.
    // V1 CAN be open here too (afferent vasodilation compensatory
    // response) — it adds a mild parallel bypass on the middle segment,
    // still keeping everything as one connected pressure system.
    const unifiedLoopMode = v2Open && config.v3 && config.v4;

    if (unifiedLoopMode) {
      let R_mid_u = R_unified(EFFECTIVE_R[midKey]) + R_v2_extra_unified(v2frac);
      // Mild parallel bypass when V1 is open — represents the heart's
      // relief valve during afferent vasodilation compensation. Tuned
      // weaker than Activity 2's branch so the pressure drop is gentle
      // ("a little bit"), not the dramatic ~95% drop used elsewhere.
      if (config.v1) {
        const R_branch_mild = (8*ETA*L_UNIFIED) / (Math.PI * Math.pow(EFFECTIVE_R.medium * 0.8, 4));
        R_mid_u = parallelR(R_mid_u, R_branch_mild);
      }
      const R_aff_u = R_unified(EFFECTIVE_R[affKey]);
      const R_eff_u = R_unified(EFFECTIVE_R[effKey]);
      const R_glom_u = (8*ETA*0.08) / (Math.PI * Math.pow(EFFECTIVE_R.medium, 4));
      const R_total_u = R_mid_u + R_aff_u + R_glom_u + R_eff_u;
      const sharedDeltaP = Q_FIXED_M3S * R_total_u * PSI_PER_PA;

      // GFR: use compensation table if this matches a known compensatory
      // scenario (afferent tube non-medium + V2 partially closed OR V1
      // open), else fall back to the standard table (plain healthy run
      // or uncompensated single-tube-change stage).
      const compKey = affKey + '_' + effKey;
      const isCompensating = v2frac < 0.95 || config.v1;
      let gfrU;
      if (isCompensating && COMPENSATED_GFR[compKey] !== undefined) {
        gfrU = COMPENSATED_GFR[compKey] * v5;
      } else {
        gfrU = getGFR(affKey, effKey, v5);
      }

      const sfxU = `_unified_${midKey}_${affKey}_${effKey}_v${Math.round(v5*10)}_v2${Math.round(v2frac*10)}_v1${config.v1?1:0}`;
      const P1u = sharedDeltaP * 1.5; // reference upstream level (arbitrary but consistent)
      const P2u = P1u - sharedDeltaP;
      const P3u = P1u; // same shared pressure system — P3 starts at same level
      const P4u = P3u - sharedDeltaP;

      return {
        R_total: R_total_u, R_cv: R_total_u, R_relative: R_total_u / (3 * R_unified(EFFECTIVE_R.medium) + R_glom_u),
        Q_mLs: Q_FIXED_MLS,
        deltaP_mid_psi:  jitter('dp1u'+sfxU, sharedDeltaP, 0.006),
        deltaP2_psi:     jitter('dp2u'+sfxU, sharedDeltaP, 0.006),
        deltaP_main_psi: jitter('dpmu'+sfxU, sharedDeltaP, 0.006),
        overallPressure_psi: jitter('opru'+sfxU, sharedDeltaP * 2, 0.006),
        P1_psi: jitter('P1u'+sfxU, P1u, 0.004),
        P2_psi: jitter('P2u'+sfxU, P2u, 0.004),
        P3_psi: jitter('P3u'+sfxU, P3u, 0.004),
        P4_psi: jitter('P4u'+sfxU, P4u, 0.004),
        Pglom_mmHg: Math.max(0, P3u * MMHG_PER_PSI),
        PBS_mmHg:   Math.max(0, P4u * MMHG_PER_PSI),
        piGlom: PI_GLOM_MMHG, piBS: PI_BS_MMHG,
        Pnet_mmHg: gfrU / KF_BENCH / 10,
        GFR: gfrU,
        v5, v2: v2frac,
      };
    }
    // --- END UNIFIED LOOP MODE ----------------------------------------------

    // Activity 1: middle tube
    const R_MID  = R_cv(EFFECTIVE_R[midKey]);
    const R_BACK = BASELINE.R_mid * 0.05;
    const R_V2   = R_v2_extra(v2frac);

    // Activity 3: renal path
    const R_AFF = R_ren(EFFECTIVE_R[affKey]);
    const R_EFF = R_ren(EFFECTIVE_R[effKey]);

    // Total circuit resistance
    const R_glom_cv = (8*ETA*0.08) / (Math.PI * Math.pow(EFFECTIVE_R.medium, 4));
    let R_series = R_MID + R_V2 + R_AFF + R_glom_cv + R_EFF + R_BACK;

    const R_branch = BASELINE.R_branch;
    let R_total = config.v1 ? parallelR(R_series, R_branch) : R_series;

    const penalty = (config.v3?0:1) + (config.v4?0:1); // v2 handled via R_V2 now
    if (penalty >= 2) R_total *= 500;
    else if (penalty > 0) R_total += penalty * R_cv(EFFECTIVE_R.small) * 0.5;

    const Q_mLs = Q_FIXED_MLS;

    // ΔP1 (P1-P2) — across the middle tube, including V2 throttling effect
    const deltaP1_TRUE = config.v1
      ? Q_FIXED_M3S * parallelR(R_MID + R_V2 + R_BACK, R_branch) * PSI_PER_PA
      : Q_FIXED_M3S * (R_MID + R_V2) * PSI_PER_PA;
    // Explicit zero-out when V2 is fully closed — preserves Activity 3 exactly
    const dp1_final = v2Open ? deltaP1_TRUE : 0.0;

    // ΔP2 (P3-P4) — zero if no return path
    const dP2_base = Q_FIXED_M3S * (R_AFF + R_EFF) * PSI_PER_PA;
    const bypass_factor = v5 * 0.15;
    const deltaP2_TRUE = renalActive ? dP2_base * (1 - bypass_factor) : 0.0;

    // R_relative — reflects ONLY the cardiovascular branch (middle tube,
    // V1 bypass, V2 throttling). V3/V4 are renal-path valves and must
    // NOT affect this number, since R is displayed alongside ΔP1 as a
    // pure CV-circuit metric.
    let R_cv_eff = R_MID + R_V2 + R_BACK;
    if (config.v1) R_cv_eff = parallelR(R_cv_eff, R_branch);
    // R_relative — only meaningful when the CV branch (middle tube) is
    // actively carrying flow, i.e. V2 open. When V2 is closed (Activity 3
    // renal mode), this CV-specific metric doesn't apply — show 0 rather
    // than a stale/misleading number.
    const R_relative = v2Open ? (R_cv_eff / BASELINE.R_cv) : 0;

    // Pressures
    // P3/P4 reference pressure — uses a FIXED baseline pump head,
    // independent of V2's resistance contribution, with enough headroom
    // for the largest possible ΔP2 (~4.3 psi at small+small, V5 open)
    // so P4 never clips at zero and P3-P4 always equals deltaP2_TRUE exactly.
    // P1/P2 reference pressure — uses a FIXED baseline pump head,
    // independent of V3/V4 penalty contamination. Physically, P1/P2
    // sit on the CV/middle-tube branch which is not affected by
    // V3/V4 closing (those only penalise the renal return path).
    const REFERENCE_HEAD_CV_PA = Q_FIXED_M3S * BASELINE.R_cv * 4; // generous headroom
    const REFERENCE_HEAD_PA = Q_FIXED_M3S * BASELINE.R_cv * 4; // generous headroom
    const PUMP_HEAD_PA = Q_FIXED_M3S * R_total;
    const P1_psi = v2Open ? (REFERENCE_HEAD_CV_PA * PSI_PER_PA * 0.45 + dp1_final) : 0.0;
    const P2_psi = v2Open ? (P1_psi - dp1_final) : 0.0;
    const P3_psi = renalActive ? (REFERENCE_HEAD_PA * PSI_PER_PA * 0.45 + deltaP2_TRUE) : 0.0;
    const P4_psi = renalActive ? (P3_psi - deltaP2_TRUE) : 0.0;

    // GFR
    const GFR_mLmin = (v5 > 0.05 && renalActive) ? getGFR(affKey, effKey, v5) : 0;
    const Pnet_mmHg = GFR_mLmin / KF_BENCH / 10;

    // Overall system pressure — used for Activity 5 compensatory comparison
    // Sum of the two measurable deltas in the circuit
    const overallPressure_psi = dp1_final + deltaP2_TRUE;

    const sfx = `_${midKey}_${affKey}_${effKey}_v${Math.round(v5*10)}_v1${config.v1?1:0}_v2${Math.round(v2frac*10)}_v3${config.v3?1:0}_v4${config.v4?1:0}`;

    return {
      R_total, R_cv: R_cv_eff, R_relative,
      Q_mLs,
      deltaP_mid_psi:  jitter('dp1'+sfx, dp1_final,     0.006),
      deltaP2_psi:     jitter('dp2'+sfx, deltaP2_TRUE,  0.006),
      deltaP_main_psi: jitter('dpm'+sfx, PUMP_HEAD_PA*PSI_PER_PA, 0.006),
      overallPressure_psi: jitter('opr'+sfx, overallPressure_psi, 0.006),
      P1_psi: jitter('P1'+sfx, P1_psi, 0.004),
      P2_psi: jitter('P2'+sfx, P2_psi, 0.004),
      P3_psi: jitter('P3'+sfx, P3_psi, 0.004),
      P4_psi: jitter('P4'+sfx, P4_psi, 0.004),
      Pglom_mmHg: Math.max(0, P3_psi * MMHG_PER_PSI),
      PBS_mmHg:   Math.max(0, P4_psi * MMHG_PER_PSI),
      piGlom: PI_GLOM_MMHG, piBS: PI_BS_MMHG,
      Pnet_mmHg,
      GFR: GFR_mLmin,
      v5, v2: v2frac,
    };
  }

  return {
    DIAMETERS, EFFECTIVE_R, solve, resetJitter,
    BASELINE, MMHG_PER_PSI, KF_BENCH, Q_FIXED_MLS,
  };
})();