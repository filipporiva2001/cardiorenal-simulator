/* ============================================================
   PRESSURE CHART — Live P1/P2/P3/P4 vs Time
   Canvas-based, rolling buffer, pan + zoom interactive.
   Only appends new points while the pump is running.
   ============================================================ */

const PressureChart = (() => {

  let canvas, ctx;
  let dpr = 1;

  // Data buffer: array of {t, p1, p2, p3, p4}
  let buffer = [];
  let startTime = null;
  let running = false;

  // View window (seconds) — what's currently visible
  const DEFAULT_WINDOW = 18; // matches reference screenshots (~15-20s)
  let viewStart = 0;   // seconds, left edge of visible window
  let viewWindow = DEFAULT_WINDOW; // width of visible window in seconds
  let followLive = true; // auto-scroll to latest data

  // Pan/zoom interaction state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartViewStart = 0;

  // Colors per line
  const COLORS = {
    p1: '#4fb6e8', // blue
    p2: '#e7b34b', // amber
    p3: '#5fb88a', // green
    p4: '#d9714e', // orange/red
  };

  const PADDING = { top: 18, right: 16, bottom: 28, left: 46 };

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    resize();
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousedown', onDragStart);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onDragEnd);

    canvas.addEventListener('wheel', onWheel, { passive: false });

    draw();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    draw();
  }

  // --- Public control --------------------------------------------------

  function start() {
    if (!running) {
      running = true;
      if (startTime === null) startTime = performance.now();
    }
  }

  function stop() {
    running = false;
  }

  function isRunning() { return running; }

  // Push a new sample — called every frame from app.js while pump runs
  function pushSample(p1, p2, p3, p4) {
    if (!running) return;
    const t = (performance.now() - startTime) / 1000;
    buffer.push({ t, p1, p2, p3, p4 });
    // Cap buffer length to avoid unbounded memory growth (10 min @ ~20Hz)
    if (buffer.length > 12000) buffer.shift();

    if (followLive) {
      viewStart = Math.max(0, t - viewWindow);
    }
    draw();
  }

  function clearChart() {
    buffer = [];
    startTime = null;
    running = false;
    viewStart = 0;
    viewWindow = DEFAULT_WINDOW;
    followLive = true;
    draw();
  }

  function resetView() {
    followLive = true;
    viewWindow = DEFAULT_WINDOW;
    const latestT = buffer.length ? buffer[buffer.length - 1].t : 0;
    viewStart = Math.max(0, latestT - viewWindow);
    draw();
  }

  // --- Interaction --------------------------------------------------

  function onDragStart(e) {
    isDragging = true;
    followLive = false;
    dragStartX = e.clientX;
    dragStartViewStart = viewStart;
  }
  function onDragMove(e) {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - PADDING.left - PADDING.right;
    const dx = e.clientX - dragStartX;
    const dtPerPx = viewWindow / plotW;
    viewStart = Math.max(0, dragStartViewStart - dx * dtPerPx);
    draw();
  }
  function onDragEnd() { isDragging = false; }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    isDragging = true;
    followLive = false;
    dragStartX = e.touches[0].clientX;
    dragStartViewStart = viewStart;
  }
  function onTouchMove(e) {
    if (!isDragging || e.touches.length !== 1) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - PADDING.left - PADDING.right;
    const dx = e.touches[0].clientX - dragStartX;
    const dtPerPx = viewWindow / plotW;
    viewStart = Math.max(0, dragStartViewStart - dx * dtPerPx);
    draw();
  }

  function onWheel(e) {
    e.preventDefault();
    followLive = false;
    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
    const newWindow = Math.min(120, Math.max(3, viewWindow * zoomFactor));

    // Zoom centered on mouse position
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - PADDING.left - PADDING.right;
    const mouseX = e.clientX - rect.left - PADDING.left;
    const mouseFrac = Math.min(1, Math.max(0, mouseX / plotW));
    const mouseTime = viewStart + mouseFrac * viewWindow;

    viewWindow = newWindow;
    viewStart = Math.max(0, mouseTime - mouseFrac * viewWindow);
    draw();
  }

  // --- Drawing --------------------------------------------------

  function niceStep(range, targetTicks) {
    const raw = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * mag;
  }

  function draw() {
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.scale(dpr, dpr);
    const cw = canvas.width / dpr, ch = canvas.height / dpr;

    ctx.clearRect(0, 0, cw, ch);

    const plotX = PADDING.left;
    const plotY = PADDING.top;
    const plotW = cw - PADDING.left - PADDING.right;
    const plotH = ch - PADDING.top - PADDING.bottom;

    // Background
    ctx.fillStyle = '#1c1e22';
    ctx.fillRect(0, 0, cw, ch);

    // Determine visible data slice
    const tMin = viewStart;
    const tMax = viewStart + viewWindow;
    const visible = buffer.filter(d => d.t >= tMin - 0.5 && d.t <= tMax + 0.5);

    // Y-axis range: auto-fit to visible data, with padding
    let yMin = 0, yMax = 6;
    if (visible.length) {
      let lo = Infinity, hi = -Infinity;
      visible.forEach(d => {
        [d.p1, d.p2, d.p3, d.p4].forEach(v => {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        });
      });
      if (isFinite(lo) && isFinite(hi)) {
        const pad = Math.max(0.2, (hi - lo) * 0.15);
        yMin = Math.max(0, lo - pad);
        yMax = hi + pad;
        if (yMax - yMin < 0.5) { yMax = yMin + 0.5; }
      }
    }

    function xPix(t) { return plotX + ((t - tMin) / (tMax - tMin)) * plotW; }
    function yPix(v) { return plotY + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

    // Grid lines — Y
    ctx.strokeStyle = '#33373f';
    ctx.lineWidth = 1;
    ctx.font = '10px IBM Plex Mono, monospace';
    ctx.fillStyle = '#9aa1ad';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yStep = niceStep(yMax - yMin, 5);
    for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
      const py = yPix(v);
      ctx.beginPath();
      ctx.moveTo(plotX, py);
      ctx.lineTo(plotX + plotW, py);
      ctx.stroke();
      ctx.fillText(v.toFixed(1), plotX - 6, py);
    }

    // Grid lines — X (time, 1s steps when zoomed in, wider when zoomed out)
    const xStep = niceStep(viewWindow, 8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = Math.ceil(tMin / xStep) * xStep; t <= tMax; t += xStep) {
      const px = xPix(t);
      ctx.beginPath();
      ctx.moveTo(px, plotY);
      ctx.lineTo(px, plotY + plotH);
      ctx.stroke();
      ctx.fillText(t.toFixed(xStep < 1 ? 1 : 0) + 's', px, plotY + plotH + 6);
    }

    // Axis border
    ctx.strokeStyle = '#3d4148';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Draw lines
    function drawLine(key, color) {
      if (visible.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      let started = false;
      visible.forEach(d => {
        const px = xPix(d.t), py = yPix(d[key]);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    drawLine('p1', COLORS.p1);
    drawLine('p2', COLORS.p2);
    drawLine('p3', COLORS.p3);
    drawLine('p4', COLORS.p4);

    // Legend
    const legendItems = [
      { key: 'P1', color: COLORS.p1 },
      { key: 'P2', color: COLORS.p2 },
      { key: 'P3', color: COLORS.p3 },
      { key: 'P4', color: COLORS.p4 },
    ];
    let lx = plotX + 8;
    const ly = plotY + 8;
    ctx.font = 'bold 11px IBM Plex Mono, monospace';
    legendItems.forEach(item => {
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, ly, 10, 10);
      ctx.fillStyle = '#eef0f3';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.key, lx + 14, ly);
      lx += ctx.measureText(item.key).width + 30;
    });

    // "Paused" indicator when not running and buffer has data
    if (!running && buffer.length > 0) {
      ctx.fillStyle = 'rgba(217,113,78,0.85)';
      ctx.font = 'bold 11px IBM Plex Mono, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('⏸ PAUSED — drag to inspect, scroll to zoom', plotX + plotW - 4, ly);
    } else if (running) {
      ctx.fillStyle = 'rgba(95,184,138,0.85)';
      ctx.font = 'bold 11px IBM Plex Mono, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('● LIVE', plotX + plotW - 4, ly);
    }

    if (buffer.length === 0) {
      ctx.fillStyle = '#9aa1ad';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Start the pump to begin recording', plotX + plotW/2, plotY + plotH/2);
    }

    ctx.restore();
  }

  return { init, start, stop, isRunning, pushSample, clearChart, resetView, draw };
})();