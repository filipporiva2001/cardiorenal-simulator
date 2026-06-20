const SceneBuilder = (() => {

  let scene, camera, renderer;
  let pumpRing = null;
  let pumpRunning = true;
  let valveGroups = {};
  let swappableTubes = {};

  // Drip animation
  let drip = null;
  let dripY = 0;
  let dripSpeed = 0;

  // Measuring cylinder
  let cylinderFluid = null;
  let cylinderFluidLevel = 0;
  let cylinderFluidTarget = 0;
  const cylinderMaxHeight = 2.0;

  // Funnel fluid level
  let funnelFluid = null;
  let funnelLevel = 0;
  let funnelTarget = 0;
  let funnelFilling = false;
  let funnelDraining = false;
  const FUNNEL_FULL   = 0.82;
  const FUNNEL_HEIGHT = 0.9;

  // Water stream from faucet
  let waterStream = null;

  // Faucet handle
  let faucetHandle = null;

  // Valve 5 open state
  let v5IsOpen = true;

  // -----------------------------------------------------------------------
  function makeTube(p1, p2, radius, material) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const length = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, length, 16, 1);
    const mesh = new THREE.Mesh(geo, material);
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    mesh.position.copy(mid);
    const axis = new THREE.Vector3(0, 1, 0);
    mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize()));
    mesh.userData.length = length;
    return mesh;
  }

  function makeElbow(point, radius, material) {
    const geo = new THREE.SphereGeometry(radius * 1.15, 16, 16);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(point);
    return mesh;
  }

  function makeValve(position, tubeRadius, isOpen, colorOverride) {
    const group = new THREE.Group();
    const bodyColor = colorOverride || (isOpen ? 0x5fb88a : 0xd9714e);
    const bodyGeo = new THREE.SphereGeometry(tubeRadius * 1.7, 20, 20);
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.3 });
    group.add(new THREE.Mesh(bodyGeo, bodyMat));
    const handleGeo = new THREE.BoxGeometry(tubeRadius * 0.25, tubeRadius * 2.2, tubeRadius * 0.6);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x1d2530, roughness: 0.4, metalness: 0.5 });
    const handlePivot = new THREE.Group();
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = tubeRadius * 1.1;
    handlePivot.add(handle);
    handlePivot.position.y = tubeRadius * 0.5;
    handlePivot.rotation.y = isOpen ? Math.PI / 2 : 0;
    group.add(handlePivot);
    group.position.copy(position);
    group.userData.bodyMat = bodyMat;
    group.userData.handlePivot = handlePivot;
    return group;
  }

  function setValveOpen(group, isOpen, colorOverride) {
    const openColor  = colorOverride || 0x5fb88a;
    const closeColor = colorOverride ? colorOverride : 0xd9714e;
    group.userData.bodyMat.color.setHex(isOpen ? openColor : closeColor);
    group.userData.handlePivot.rotation.y = isOpen ? Math.PI / 2 : 0;
  }

  function makePump(position) {
    const group = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.45, 0.5, 1.4, 20);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.4, metalness: 0.6 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.z = Math.PI / 2;
    group.add(body);
    const ringGeo = new THREE.TorusGeometry(0.75, 0.13, 12, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xc08a52, roughness: 0.3, metalness: 0.8 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = 0.65;
    group.add(ring);
    group.position.copy(position);
    group.userData.ring = ring;
    return group;
  }

  function makeFunnel(position) {
    const group = new THREE.Group();
    const pvcMat = new THREE.MeshStandardMaterial({ color: 0xece7da, roughness: 0.5, side: THREE.DoubleSide });
    const cupGeo = new THREE.CylinderGeometry(0.42, 0.28, FUNNEL_HEIGHT, 20, 1, true);
    const cup = new THREE.Mesh(cupGeo, pvcMat);
    cup.position.y = FUNNEL_HEIGHT / 2 + 0.15;
    group.add(cup);
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 16), pvcMat));
    const fluidMat = new THREE.MeshStandardMaterial({ color: 0x4fb6e8, transparent: true, opacity: 0.75 });
    funnelFluid = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.001, 16), fluidMat);
    funnelFluid.position.y = 0.16;
    group.add(funnelFluid);
    const redLineY = 0.16 + FUNNEL_FULL * FUNNEL_HEIGHT;
    const redLineR = 0.28 + (0.42 - 0.28) * FUNNEL_FULL;
    const redGeo = new THREE.TorusGeometry(redLineR, 0.018, 8, 24);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd9714e, roughness: 0.4 });
    const redLine = new THREE.Mesh(redGeo, redMat);
    redLine.rotation.x = Math.PI / 2;
    redLine.position.y = redLineY;
    group.add(redLine);
    group.position.copy(position);
    return group;
  }

  function makeFaucet(position) {
    const group = new THREE.Group();
    const pvcMat   = new THREE.MeshStandardMaterial({ color: 0xece7da, roughness: 0.55 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8aa0b0, roughness: 0.3, metalness: 0.7 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 12), pvcMat);
    pipe.position.y = 0.35;
    group.add(pipe);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), metalMat));
    faucetHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xd9714e, roughness: 0.3 })
    );
    faucetHandle.position.y = 0.02;
    group.add(faucetHandle);
    group.position.copy(position);
    return group;
  }

  function makeWaterStream(faucetPos, funnelPos) {
    const streamHeight = faucetPos.y - (funnelPos.y + FUNNEL_HEIGHT * 0.6);
    const geo = new THREE.CylinderGeometry(0.035, 0.025, streamHeight, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4fb6e8, transparent: true, opacity: 0.65 });
    waterStream = new THREE.Mesh(geo, mat);
    waterStream.position.set(faucetPos.x, faucetPos.y - streamHeight / 2, faucetPos.z);
    waterStream.visible = false;
    return waterStream;
  }

  function makeConnector(position, tubeRadius, direction) {
    const group = new THREE.Group();
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc08a52, roughness: 0.25, metalness: 0.85 });
    group.add(new THREE.Mesh(
      new THREE.CylinderGeometry(tubeRadius * 1.5, tubeRadius * 1.5, tubeRadius * 1.6, 16, 1), brassMat));
    group.position.copy(position);
    const axis = new THREE.Vector3(0, 1, 0);
    group.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(axis, direction.clone().normalize()));
    return group;
  }

  function makePortSensor(position, tubeRadius) {
    const group = new THREE.Group();
    const pvcMat = new THREE.MeshStandardMaterial({ color: 0xece7da, roughness: 0.55 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x4fb6e8, roughness: 0.3, metalness: 0.4 });
    const stemH = tubeRadius * 2.6;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(tubeRadius * 0.55, tubeRadius * 0.55, stemH, 12), pvcMat);
    stem.position.y = stemH / 2;
    group.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(tubeRadius * 0.75, 16, 16), capMat);
    cap.position.y = stemH;
    group.add(cap);
    group.position.copy(position);
    return group;
  }

  function makeLabel(text, position, tubeRadius, scaleMult = 3) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1d2530';
    ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eef0f3';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 34);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
    sprite.scale.set(tubeRadius * scaleMult, tubeRadius * scaleMult, 1);
    sprite.position.copy(position).add(new THREE.Vector3(0, tubeRadius * 4, 0));
    return sprite;
  }

  function makeMeasuringCylinder(position) {
    const group = new THREE.Group();
    const r = 0.38, h = cylinderMaxHeight;
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xd0e8f0, roughness: 0.05, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24, 1, true), glassMat);
    glass.position.y = h / 2;
    group.add(glass);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xd0e8f0, transparent: true, opacity: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 0.12, 24), baseMat);
    base.position.y = 0.06;
    group.add(base);
    const markMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4a });
    for (let i = 1; i <= 8; i++) {
      const mark = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, 0.012, 6, 24), markMat);
      mark.rotation.x = Math.PI / 2;
      mark.position.y = (i / 8) * h;
      group.add(mark);
    }
    const fluidMat = new THREE.MeshStandardMaterial({ color: 0x4fb6e8, transparent: true, opacity: 0.75 });
    cylinderFluid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.001, 20), fluidMat);
    cylinderFluid.position.y = 0.0005;
    group.add(cylinderFluid);
    group.position.copy(position);
    return group;
  }

  function makeDrip(startPosition) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4fb6e8, transparent: true, opacity: 0.85 });
    drip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), mat);
    drip.position.copy(startPosition);
    drip.visible = false;
    return drip;
  }

  function setupOrbitControls(canvas) {
    let isDown = false, lastX = 0, lastY = 0;
    let radius = camera.position.length();
    let theta = Math.atan2(camera.position.x, camera.position.z);
    let phi = Math.acos(camera.position.y / radius);
    function update() {
      phi = Math.max(0.2, Math.min(1.4, phi));
      radius = Math.max(6, Math.min(30, radius));
      camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
      camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
      camera.position.y = radius * Math.cos(phi);
      camera.lookAt(0, 0, 0);
    }
    canvas.addEventListener('pointerdown', (e) => { isDown=true; lastX=e.clientX; lastY=e.clientY; });
    window.addEventListener('pointerup', () => { isDown=false; });
    window.addEventListener('pointermove', (e) => {
      if (!isDown) return;
      theta -= (e.clientX-lastX)*0.006; phi -= (e.clientY-lastY)*0.006;
      lastX=e.clientX; lastY=e.clientY; update();
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); radius+=e.deltaY*0.01; update(); }, { passive:false });
    update();
  }

  // -----------------------------------------------------------------------
  function init(canvas) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x23262b);
    camera = new THREE.PerspectiveCamera(45, canvas.clientWidth/canvas.clientHeight, 0.1, 100);
    camera.position.set(13, 11, 16);
    camera.lookAt(0, 0, 0);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    scene.add(new THREE.HemisphereLight(0xb8c6db, 0x2a2a2a, 0.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(8, 12, 8); scene.add(dirLight);

    const tubeRadius = 0.16, w = 4.5, d = 2.75;
    const nodes = {
      topLeft:     new THREE.Vector3(-w, 0, -d),
      topMid:      new THREE.Vector3(0, 0, -d),
      topRight:    new THREE.Vector3(w, 0, -d),
      port1:       new THREE.Vector3(-w*0.4, 0, 0),
      port2:       new THREE.Vector3(w*0.05, 0, 0),
      valve2:      new THREE.Vector3(w*0.55, 0, 0),
      midRight:    new THREE.Vector3(w, 0, 0),
      midLeft:     new THREE.Vector3(-w, 0, 0),
      valve4:      new THREE.Vector3(w, 0, d*0.45),
      valve3:      new THREE.Vector3(-w, 0, d*0.35),
      bottomRight: new THREE.Vector3(w, 0, d),
      port4:       new THREE.Vector3(w*0.78, 0, d),
      valve5:      new THREE.Vector3(0, 0, d),
      port3:       new THREE.Vector3(-w*0.78, 0, d),
      bottomLeft:  new THREE.Vector3(-w, 0, d),
    };
    const branchDrop=0.9, branchWidth=1.3;
    nodes.branchLeftTop     = new THREE.Vector3(-branchWidth, 0, -d);
    nodes.branchLeftBottom  = new THREE.Vector3(-branchWidth, 0, -d+branchDrop);
    nodes.branchRightBottom = new THREE.Vector3(branchWidth, 0, -d+branchDrop);
    nodes.branchRightTop    = new THREE.Vector3(branchWidth, 0, -d);

    const pvcMat = new THREE.MeshStandardMaterial({ color: 0xece7da, roughness: 0.55 });

    const segments = [
      ['topLeft','branchLeftTop'],['branchLeftTop','topMid'],['topMid','branchRightTop'],['branchRightTop','topRight'],
      ['topRight','midRight'],['midRight','valve2'],['valve2','port2'],
      ['port2','port1'],
      ['port1','midLeft'],
      ['topLeft','midLeft'],['midLeft','valve3'],['valve3','bottomLeft'],
      ['midRight','valve4'],['valve4','bottomRight'],
      ['bottomLeft','port3'],
      ['port3','valve5'],
      ['valve5','port4'],
      ['port4','bottomRight'],
      ['branchLeftTop','branchLeftBottom'],['branchLeftBottom','branchRightBottom'],['branchRightBottom','branchRightTop'],
    ];

    const apparatus = new THREE.Group();
    segments.forEach(([a, b]) => {
      const isSwappable = (
        (a==='port3' && b==='valve5') ||
        (a==='valve5' && b==='port4') ||
        (a==='port2' && b==='port1')
      );
      const mat = isSwappable ? pvcMat.clone() : pvcMat;
      const tube = makeTube(nodes[a], nodes[b], tubeRadius, mat);
      if (a==='port3'  && b==='valve5') swappableTubes.afferent = tube;
      if (a==='valve5' && b==='port4')  swappableTubes.efferent = tube;
      if (a==='port2'  && b==='port1')  swappableTubes.middle   = tube;
      apparatus.add(tube);
    });

    const usedNodes = new Set();
    segments.forEach(([a,b]) => { usedNodes.add(a); usedNodes.add(b); });
    usedNodes.forEach(n => apparatus.add(makeElbow(nodes[n], tubeRadius, pvcMat)));

    const valve1Pos = new THREE.Vector3().lerpVectors(nodes.branchLeftBottom, nodes.branchRightBottom, 0.5);
    const v1=makeValve(valve1Pos, tubeRadius, false);
    const v2=makeValve(nodes.valve2, tubeRadius, true);
    const v3=makeValve(nodes.valve3, tubeRadius, true);
    const v4=makeValve(nodes.valve4, tubeRadius, true);
    const v5=makeValve(nodes.valve5, tubeRadius*1.3, true, 0xe7b34b);
    apparatus.add(v1,v2,v3,v4,v5);
    valveGroups = { v1,v2,v3,v4,v5 };

    apparatus.add(makeLabel('1', valve1Pos, tubeRadius));
    apparatus.add(makeLabel('2', nodes.valve2, tubeRadius));
    apparatus.add(makeLabel('3', nodes.valve3, tubeRadius));
    apparatus.add(makeLabel('4', nodes.valve4, tubeRadius));
    apparatus.add(makeLabel('5', nodes.valve5, tubeRadius*1.3));

    apparatus.add(makePortSensor(nodes.port1,tubeRadius)); apparatus.add(makeLabel('P1',nodes.port1,tubeRadius,4.2));
    apparatus.add(makePortSensor(nodes.port2,tubeRadius)); apparatus.add(makeLabel('P2',nodes.port2,tubeRadius,4.2));
    apparatus.add(makePortSensor(nodes.port3,tubeRadius)); apparatus.add(makeLabel('P3',nodes.port3,tubeRadius,4.2));
    apparatus.add(makePortSensor(nodes.port4,tubeRadius)); apparatus.add(makeLabel('P4',nodes.port4,tubeRadius,4.2));

    const collarInset = tubeRadius*3.5;
    function addCollarPair(nA,nB) {
      const dir=new THREE.Vector3().subVectors(nB,nA).normalize();
      apparatus.add(makeConnector(nA.clone().addScaledVector(dir,collarInset),tubeRadius,dir));
      apparatus.add(makeConnector(nB.clone().addScaledVector(dir,-collarInset),tubeRadius,dir));
    }
    addCollarPair(nodes.port3, nodes.valve5);
    addCollarPair(nodes.valve5, nodes.port4);
    addCollarPair(nodes.port2, nodes.port1);

    const pumpPos = new THREE.Vector3().lerpVectors(nodes.branchLeftTop,nodes.topMid,0.5).add(new THREE.Vector3(0,0.35,0));
    const pump = makePump(pumpPos);
    apparatus.add(pump);
    pumpRing = pump.userData.ring;
    scene.add(apparatus);

    const funnelPos = new THREE.Vector3().lerpVectors(nodes.branchRightTop,nodes.topRight,0.6);
    scene.add(makeFunnel(funnelPos));
    const faucetPos = funnelPos.clone().add(new THREE.Vector3(0,1.5,0));
    scene.add(makeFaucet(faucetPos));
    scene.add(makeWaterStream(faucetPos.clone().add(new THREE.Vector3(0,-0.35,0)), funnelPos));

    const cylPos = new THREE.Vector3(nodes.valve5.x,-3.2,nodes.valve5.z);
    scene.add(makeMeasuringCylinder(cylPos));
    const dropTop = new THREE.Vector3(nodes.valve5.x, nodes.valve5.y-0.25, nodes.valve5.z);
    const dropBot = new THREE.Vector3(nodes.valve5.x, cylPos.y+cylinderMaxHeight+0.05, nodes.valve5.z);
    const dropTubeMat = new THREE.MeshStandardMaterial({ color:0xece7da, roughness:0.55, transparent:true, opacity:0.6 });
    scene.add(makeTube(dropTop, dropBot, tubeRadius*0.7, dropTubeMat));
    dripY = cylPos.y + cylinderMaxHeight;
    scene.add(makeDrip(new THREE.Vector3(nodes.valve5.x, dripY, nodes.valve5.z)));

    setupOrbitControls(canvas);
    window.addEventListener('resize', () => onResize(canvas));
    onResize(canvas);
    animate();
  }

  function onResize(canvas) {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth/canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  // -----------------------------------------------------------------------
  // PUBLIC API
  // -----------------------------------------------------------------------

  function setPumpRunning(isRunning) {
    pumpRunning = isRunning;
    if (pumpRing) pumpRing.material.color.setHex(isRunning ? 0xc08a52 : 0x5a4a38);
  }

  function setValve(valveId, isOpen) {
    const group = valveGroups[valveId];
    if (!group) return;
    setValveOpen(group, isOpen, valveId==='v5' ? 0xe7b34b : null);
  }

  function setTapOpen(isOpen) {
    funnelFilling = isOpen;
    if (faucetHandle) faucetHandle.rotation.z = isOpen ? 0 : Math.PI/2;
    if (waterStream) waterStream.visible = isOpen;
  }

  // v3Open, v4Open: return path valves — both closed = no filtrate flow
  function updateFlow(result, v5Open, circuitFull, v3Open, v4Open) {
    v5IsOpen = v5Open;

    // Renal return path: need V3 or V4 open for fluid to exit through V5
    const renalPathOpen = v3Open || v4Open;
    funnelDraining = pumpRunning && result.GFR > 0 && v5Open && renalPathOpen;

    if (!v5Open || !circuitFull || !renalPathOpen) {
      dripSpeed = 0;
      if (drip) drip.visible = false;
      cylinderFluidTarget = cylinderFluidLevel;
      return;
    }

    if (!pumpRunning || result.GFR <= 0) {
      dripSpeed = 0.25;
      if (drip) drip.visible = true;
      return;
    }

    const healthyGFR = 10 * 0.126;
    dripSpeed = Math.max(0.15, Math.min(3.5, (result.GFR / healthyGFR) * 0.8));
    cylinderFluidTarget = Math.min(0.95, cylinderFluidTarget + result.GFR * 0.000008);
    if (drip) drip.visible = true;
  }

  function swapTube(segId, diamKey) {
    const tube = swappableTubes[segId];
    if (!tube) return;
    const baseSceneR = 0.16;
    const diamInches = { small:0.75, medium:1.0, large:1.25, xlarge:1.5 };
    const newRadius = baseSceneR * (diamInches[diamKey] / 1.0);
    tube.geometry.dispose();
    tube.geometry = new THREE.CylinderGeometry(newRadius, newRadius, tube.userData.length, 16, 1);
  }

  function resetCylinder() {
    cylinderFluidLevel = 0; cylinderFluidTarget = 0;
    dripY = -3.2 + cylinderMaxHeight;
    if (drip) { drip.position.y = dripY; drip.visible = false; }
    if (cylinderFluid) { cylinderFluid.scale.y = 0.001; cylinderFluid.position.y = 0.0005; }
  }

  function getFunnelLevel() { return funnelLevel; }

  // -----------------------------------------------------------------------
  function animate() {
    requestAnimationFrame(animate);

    if (pumpRunning && pumpRing) pumpRing.rotation.x += 0.04;

    if (funnelFilling && funnelLevel < 1.0) funnelTarget = Math.min(1.0, funnelTarget+0.004);
    if (funnelDraining && !funnelFilling) funnelTarget = Math.max(0, funnelTarget-0.0008*Math.max(dripSpeed,0.1));
    if (funnelFluid) {
      funnelLevel += (funnelTarget-funnelLevel)*0.05;
      const fh = Math.max(0.001, funnelLevel*FUNNEL_HEIGHT);
      funnelFluid.scale.y = fh/0.001;
      funnelFluid.position.y = 0.16 + fh/2;
    }

    if (waterStream && waterStream.visible) {
      waterStream.material.opacity = 0.5 + 0.2*Math.sin(performance.now()*0.006);
    }

    if (drip && drip.visible && dripSpeed > 0 && v5IsOpen) {
      dripY -= dripSpeed*0.025;
      drip.position.y = dripY;
      const cylBotY = -3.2 + 0.15 + cylinderFluidLevel*cylinderMaxHeight;
      if (dripY < cylBotY+0.1) {
        if (dripSpeed > 0) {
          dripY = -3.2 + cylinderMaxHeight + 0.05;
          drip.position.y = dripY;
          cylinderFluidTarget = Math.min(0.95, cylinderFluidTarget + 0.0008);
        } else {
          drip.visible = false;
        }
      }
    }

    if (cylinderFluid) {
      if (Math.abs(cylinderFluidTarget-cylinderFluidLevel) > 0.0001) {
        cylinderFluidLevel += (cylinderFluidTarget-cylinderFluidLevel)*0.02;
      }
      const fh = Math.max(0.001, cylinderFluidLevel*cylinderMaxHeight);
      cylinderFluid.scale.y = fh/0.001;
      cylinderFluid.position.y = fh/2;
    }

    renderer.render(scene, camera);
  }

  return { init, setPumpRunning, setValve, setTapOpen, updateFlow, swapTube, resetCylinder, getFunnelLevel };
})();