SceneBuilder.init(document.getElementById('scene'));
PressureChart.init(document.getElementById('pressure-chart'));

(function () {

  const state = {
    afferent:  'medium',
    efferent:  'medium',
    middle:    'medium',
    v5Opening: 1.0,
    v1: false,
    v2: 1.0,
    v3: true, v4: true,
  };

  const ARTERIOLE_MAP = {
    small:  { cls: 'active-constriction' },
    medium: { cls: 'active-healthy'      },
    large:  { cls: 'active-dilation'     },
  };

  // Helper — set a tube diameter AND update its button highlighting,
  // usable both from manual clicks and from compensatory mechanisms
  function setTube(stateKey, key) {
    state[stateKey] = key;
    const containerId = stateKey === 'middle' ? 'middle-btns'
                       : stateKey === 'afferent' ? 'afferent-btns'
                       : 'efferent-btns';
    const container = document.getElementById(containerId);
    container.querySelectorAll('button').forEach(b => {
      b.classList.remove('active-healthy','active-constriction','active-dilation');
      if (b.dataset.key === key) b.classList.add(ARTERIOLE_MAP[key].cls);
    });
    SceneBuilder.swapTube(stateKey, key);
  }

  function setupArterioleButtons(containerId, stateKey) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        setTube(stateKey, btn.dataset.key);
        Physics.resetJitter();
        recompute();
      });
    });
  }

  setupArterioleButtons('middle-btns',   'middle');
  setupArterioleButtons('afferent-btns', 'afferent');
  setupArterioleButtons('efferent-btns', 'efferent');

  // --- Valve 5 -----------------------------------------------------------
  const v5Slider = document.getElementById('v5-slider');
  const v5ValEl  = document.getElementById('v5-val');
  const v5Btn    = document.getElementById('v5-btn');

  function applyV5(f) {
    state.v5Opening = f;
    v5Slider.value = Math.round(f * 100);
    v5ValEl.textContent = Math.round(f * 100) + '%';
    const open = f > 0.05;
    v5Btn.textContent = open ? 'Valve 5: Open (click to close)' : 'Valve 5: Closed (click to open)';
    v5Btn.classList.toggle('closed', !open);
    SceneBuilder.setValve('v5', open);
    Physics.resetJitter();
    if (open && simulationRunning) startCollection();
    if (!open) stopCollection();
    recompute();
  }
  v5Slider.addEventListener('input', () => applyV5(parseInt(v5Slider.value, 10) / 100));
  v5Btn.addEventListener('click',    () => applyV5(state.v5Opening > 0.05 ? 0 : 1));

  // --- Branch valves -------------------------------------------------------
  function bindToggle(id, key) {
    const el = document.getElementById(id);
    el.addEventListener('change', () => {
      state[key] = el.checked;
      SceneBuilder.setValve(key, el.checked);
      Physics.resetJitter();
      recompute();
    });
  }
  bindToggle('v1-toggle','v1');
  bindToggle('v3-toggle','v3');
  bindToggle('v4-toggle','v4');

  const v2Toggle = document.getElementById('v2-toggle');
  v2Toggle.addEventListener('change', () => {
    state.v2 = v2Toggle.checked ? 1.0 : 0.0;
    SceneBuilder.setValve('v2', v2Toggle.checked);
    Physics.resetJitter();
    recompute();
  });

  function setV1(open) {
    state.v1 = open;
    document.getElementById('v1-toggle').checked = open;
    SceneBuilder.setValve('v1', open);
  }

  function setV2Fraction(frac) {
    state.v2 = frac;
    v2Toggle.checked = frac > 0.05;
    SceneBuilder.setValve('v2', frac > 0.05);
  }

  // --- Pump toggle -----------------------------------------------------------
  let pumpRunning = false;
  const pumpBtn   = document.getElementById('pump-toggle');
  const circuitStatus = document.getElementById('circuit-status');

  function setPump(running) {
    if (running && SceneBuilder.getFunnelLevel() < 0.4) {
      circuitStatus.textContent = '⚠ Fill the circuit before starting the pump';
      circuitStatus.className = 'low';
      return;
    }
    pumpRunning = running;
    SceneBuilder.setPumpRunning(running);
    pumpBtn.textContent = running
      ? 'Pump: Running (click to stop)'
      : 'Pump: Stopped (click to start)';
    pumpBtn.classList.toggle('off', !running);
    if (!running) stopCollection();
    recompute();
  }

  pumpBtn.classList.add('off');
  pumpBtn.textContent = 'Pump: Stopped (click to start)';
  SceneBuilder.setPumpRunning(false);
  pumpBtn.addEventListener('click', () => setPump(!pumpRunning));

  (function checkDryRun() {
    if (pumpRunning && SceneBuilder.getFunnelLevel() < 0.05) {
      setPump(false);
      circuitStatus.textContent = '⚠ Circuit empty — pump stopped';
      circuitStatus.className = 'low';
    }
    requestAnimationFrame(checkDryRun);
  })();

  // --- Tap toggle ------------------------------------------------------------
  let tapOpen = false;
  const tapBtn = document.getElementById('tap-toggle');
  tapBtn.addEventListener('click', () => {
    tapOpen = !tapOpen;
    SceneBuilder.setTapOpen(tapOpen);
    tapBtn.textContent = tapOpen ? 'Tap: Open (click to close)' : 'Open tap to fill circuit';
    tapBtn.classList.toggle('closed', !tapOpen);
  });

  // --- START / STOP SIMULATION ------------------------------------------
  let simulationRunning = false;
  const simBtn    = document.getElementById('sim-start-btn');
  const simStatus = document.getElementById('sim-status');

  function setSimulation(running) {
    simulationRunning = running;
    simBtn.textContent = running ? '⏸ Stop Simulation' : '▶ Start Simulation';
    simBtn.classList.toggle('running', running);

    if (running) {
      PressureChart.start();
      simStatus.textContent = '● Recording — chart and collection active';
      simStatus.className = 'running';
      if (state.v5Opening > 0.05) startCollection();
    } else {
      PressureChart.stop();
      stopCollection();
      simStatus.textContent = '⏸ Simulation paused — setup remains active';
      simStatus.className = 'paused';
    }
  }

  simBtn.addEventListener('click', () => setSimulation(!simulationRunning));

  // --- Chart reset-to-live button ------------------------------------------
  document.getElementById('chart-reset-btn').addEventListener('click', () => {
    PressureChart.resetView();
  });

  // --- Reset — clears measurements + chart + simulation state --------------
  document.getElementById('reset-btn').addEventListener('click', () => {
    SceneBuilder.resetCylinder();
    resetCollection();
    PressureChart.clearChart();
    simulationRunning = false;
    simBtn.textContent = '▶ Start Simulation';
    simBtn.classList.remove('running');
    simStatus.textContent = 'Setup mode — adjust valves and tubes freely';
    simStatus.className = '';
  });

  // --- Activity 5: Compensatory Mechanism -----------------------------------
  // Each button now sets BOTH the relevant tube diameter(s) AND the
  // valve response, so the live measurements and chart actually reflect
  // the physiological scenario — not just a valve change in isolation.
  let activeMechanism = null;

  const compButtons = document.querySelectorAll('.comp-btns button');

  function applyMechanism(mech) {
    // Reset to baseline first (medium tubes, V1 closed, V2 fully open)
    setTube('afferent', 'medium');
    setTube('efferent', 'medium');
    setV1(false);
    setV2Fraction(1.0);

    if (mech === 'aff_constr') {
      // Afferent vasoconstriction: small afferent tube + V2 closes to 30% open
      setTube('afferent', 'small');
      setV2Fraction(0.30);
    } else if (mech === 'aff_dilat') {
      // Afferent vasodilation: large afferent tube + V1 opens (bypass relief)
      setTube('afferent', 'large');
      setV1(true);
    } else if (mech === 'nephro') {
      // Nephrolithiasis: both tubes constricted + V2 closes to 70% open... 
      // wait — "closes to 70%" means 70% CLOSED = 30% open (more severe)
      setTube('afferent', 'small');
      setTube('efferent', 'small');
      setV2Fraction(0.30); // 70% closed = 30% open (severe obstruction)
    }

    activeMechanism = mech;
    compButtons.forEach(b => b.classList.toggle('active', b.dataset.mech === mech));

    Physics.resetJitter();
    recompute();
  }

  compButtons.forEach(btn => {
    btn.addEventListener('click', () => applyMechanism(btn.dataset.mech));
  });

  document.getElementById('comp-clear-btn').addEventListener('click', () => {
    activeMechanism = null;
    compButtons.forEach(b => b.classList.remove('active'));

    setTube('middle', 'medium');
    setTube('afferent', 'medium');
    setTube('efferent', 'medium');
    setV1(false);
    setV2Fraction(1.0);

    Physics.resetJitter();
    recompute();
  });

  // --- Collection --------------------------------------------------------
  let collecting=false, collectStart=null, pausedElapsed=0,
      volumeCollected=0, lastGFR=0, lastTick=null;

  const timerEl       = document.getElementById('timer-val');
  const volumeEl      = document.getElementById('volume-val');
  const gfrLiveEl     = document.getElementById('gfr-live');
  const cylPctEl      = document.getElementById('cyl-pct');
  const collectStatus = document.getElementById('collect-status');

  function fmt(s){ return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0'); }

  function startCollection() {
    if (!simulationRunning) return;
    if (collecting) return;
    collecting=true; collectStart=performance.now(); lastTick=collectStart;
    collectStatus.textContent='Collecting filtrate...'; collectStatus.className='active';
  }
  function stopCollection() {
    if (!collecting) return;
    collecting=false; pausedElapsed+=(performance.now()-collectStart)/1000;
    collectStatus.textContent='Paused — reopen Valve 5 to resume';
    collectStatus.className='idle';
  }
  function resetCollection() {
    collecting=false; collectStart=null; pausedElapsed=0; volumeCollected=0;
    timerEl.textContent='0:00'; volumeEl.textContent='0.0'; cylPctEl.textContent='0';
    collectStatus.textContent='Open Valve 5 to start collecting'; collectStatus.className='idle';
  }

  (function tick() {
    if (collecting) {
      const now = performance.now();
      timerEl.textContent = fmt(pausedElapsed+(now-collectStart)/1000);
      const dt = (now-lastTick)/1000/60;
      volumeCollected += lastGFR * dt;
      lastTick = now;
      volumeEl.textContent = volumeCollected.toFixed(2);
      cylPctEl.textContent = Math.min(95, Math.round((volumeCollected/200)*100));
    }
    requestAnimationFrame(tick);
  })();

  // --- Circuit status ----------------------------------------------------
  const funnelBar = document.getElementById('funnel-bar');
  const funnelPct = document.getElementById('funnel-pct');

  (function updateCircuit() {
    const level = SceneBuilder.getFunnelLevel();
    const pct   = Math.round(level*100);
    funnelBar.style.width = pct+'%';
    funnelPct.textContent = pct+'%';
    funnelBar.classList.toggle('low',  level < 0.25);
    funnelBar.classList.toggle('full', level >= 0.82);
    if (tapOpen && level < 0.82) {
      circuitStatus.textContent='Filling circuit... ('+pct+'%)'; circuitStatus.className='filling';
    } else if (level >= 0.82) {
      circuitStatus.textContent='✓ Circuit full — ready to run'; circuitStatus.className='full';
    } else if (pumpRunning && level < 0.25) {
      circuitStatus.textContent='⚠ Low fluid — open tap'; circuitStatus.className='low';
    } else if (level < 0.05) {
      circuitStatus.textContent='Empty — open tap to fill first'; circuitStatus.className='';
    } else {
      circuitStatus.textContent='Partially filled ('+pct+'%) — keep filling'; circuitStatus.className='filling';
    }
    requestAnimationFrame(updateCircuit);
  })();

  // --- Live measurements readouts -----------------------------------------
  const liveDp1   = document.getElementById('live-dp1');
  const liveQ     = document.getElementById('live-q');
  const liveR     = document.getElementById('live-r');
  const liveDp2   = document.getElementById('live-dp2');
  const liveGfr2  = document.getElementById('live-gfr2');
  const liveFrate = document.getElementById('live-frate');

  // --- Main recompute ----------------------------------------------------
  function recompute() {
    const result = Physics.solve({
      middle:    state.middle,
      afferent:  state.afferent,
      efferent:  state.efferent,
      v5Opening: state.v5Opening,
      v1: state.v1, v2: state.v2, v3: state.v3, v4: state.v4,
    });

    if (!pumpRunning) {
      liveDp1.textContent  = '—';
      liveQ.textContent    = '—';
      liveR.textContent    = '—';
      liveDp2.textContent  = '—';
      liveGfr2.textContent = '—';
      liveFrate.textContent= '—';
      gfrLiveEl.textContent = '0.0'; lastGFR = 0;
      SceneBuilder.updateFlow(
        { GFR:0, Q_mLs:0 },
        state.v5Opening > 0.05 && simulationRunning,
        SceneBuilder.getFunnelLevel() > 0.35,
        state.v3, state.v4
      );
      PressureChart.draw();
      return;
    }

    liveDp1.textContent = result.deltaP_mid_psi.toFixed(2);
    liveQ.textContent   = result.Q_mLs.toFixed(1);
    liveR.textContent   = result.R_relative.toFixed(2);
    liveDp2.textContent  = result.deltaP2_psi.toFixed(2);
    liveGfr2.textContent = result.GFR.toFixed(1);
    liveFrate.textContent = (result.GFR / 60 * 10).toFixed(2);

    lastGFR = result.GFR;
    gfrLiveEl.textContent = result.GFR.toFixed(1);

    SceneBuilder.updateFlow(
      result,
      state.v5Opening > 0.05 && simulationRunning,
      SceneBuilder.getFunnelLevel() > 0.35,
      state.v3, state.v4
    );

    if (simulationRunning) {
      PressureChart.pushSample(result.P1_psi, result.P2_psi, result.P3_psi, result.P4_psi);
    }
  }

  (function frameLoop() {
    recompute();
    requestAnimationFrame(frameLoop);
  })();

})();