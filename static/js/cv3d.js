/**
 * cv3d.js – CV → 3D Bridge
 *
 * Conecta detecções de visão computacional (OpenCV) a uma cena 3D (Three.js).
 * Cada pipeline CV gera objetos 3D correspondentes:
 *   - contours → formas extrudadas
 *   - faces    → avatares 3D (cabeça + corpo + nome) rastreados e suavizados
 *   - edges    → wireframe / pontos
 *   - color    → nuvem de pontos colorida
 *   - threshold→ pontos binários
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* ═══════════════════════════════════════════════════════════════════════
   Estado
   ═══════════════════════════════════════════════════════════════════════ */
let socket = null;
let camStream = null;
let captureTimer = null;
let currentPipeline = "edges";
let frameCount = 0;
let lastFpsTime = Date.now();
let waitingResult = false;
let broadcasting = false;
let gridVisible = true;

/* ═══════════════════════════════════════════════════════════════════════
   DOM
   ═══════════════════════════════════════════════════════════════════════ */
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const logPanel = document.getElementById("logPanel");
const webcamVideo = document.getElementById("webcamVideo");
const captureCanvas = document.getElementById("captureCanvas");
const uploadedImg = document.getElementById("uploadedImg");
const noSignal = document.getElementById("noSignal");
const resultImg = document.getElementById("resultImg");
const noResult = document.getElementById("noResult");
const fpsBadge = document.getElementById("fpsBadge");
const fpsRange = document.getElementById("fpsRange");
const fpsVal = document.getElementById("fpsVal");
const detectionsList = document.getElementById("detectionsList");
const detCount = document.getElementById("detCount");
const btnStartCam = document.getElementById("btnStartCam");
const btnStopCam = document.getElementById("btnStopCam");
const objCount3d = document.getElementById("objCount3d");
const mappingInfo = document.getElementById("mappingInfo");
const broadcastBadge = document.getElementById("broadcastBadge");
const receivingBadge = document.getElementById("receivingBadge");

/* ═══════════════════════════════════════════════════════════════════════
   Utilitários
   ═══════════════════════════════════════════════════════════════════════ */
function log(msg, type = "info") {
  const p = document.createElement("p");
  p.className = type;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(p);
  logPanel.scrollTop = logPanel.scrollHeight;
  if (logPanel.children.length > 80) logPanel.removeChild(logPanel.firstChild);
}

function escHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

fpsRange.addEventListener("input", () => {
  fpsVal.textContent = fpsRange.value;
  if (captureTimer) restartCaptureLoop();
});

/* ═══════════════════════════════════════════════════════════════════════
   Three.js Scene Manager
   ═══════════════════════════════════════════════════════════════════════ */
let scene, camera, renderer, controls, gridHelper, axesHelper;
let cvGroup; // grupo para objetos gerados pelo CV (limpos a cada frame)
let avatarGroup; // grupo dos avatares de rostos (persistem entre frames)
const avatars = new Map(); // id da entidade → { group, target }
const clock = new THREE.Clock();

function initThreeScene() {
  const container = document.getElementById("threejsContainer");
  const w = container.clientWidth;
  const h = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 20, 50);

  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
  camera.position.set(0, 5, 12);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.insertBefore(renderer.domElement, container.firstChild);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1, 0);
  controls.update();

  // Luzes
  const ambient = new THREE.AmbientLight(0x445566, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 8, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 30;
  dirLight.shadow.camera.left = -10;
  dirLight.shadow.camera.right = 10;
  dirLight.shadow.camera.top = 10;
  dirLight.shadow.camera.bottom = -10;
  scene.add(dirLight);

  // Chão
  const groundGeo = new THREE.PlaneGeometry(30, 30);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    metalness: 0.3,
    roughness: 0.8,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid
  gridHelper = new THREE.GridHelper(20, 20, 0x333355, 0x222244);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // Eixos
  axesHelper = new THREE.AxesHelper(3);
  axesHelper.position.y = 0.02;
  scene.add(axesHelper);

  // Grupo para objetos CV
  cvGroup = new THREE.Group();
  cvGroup.name = "cvObjects";
  scene.add(cvGroup);

  // Grupo para avatares de rostos
  avatarGroup = new THREE.Group();
  avatarGroup.name = "faceAvatars";
  scene.add(avatarGroup);

  // Resize
  const ro = new ResizeObserver(() => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.setSize(cw, ch);
  });
  ro.observe(container);

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  controls.update();
  updateAvatars(dt);
  renderer.render(scene, camera);
}

/* ═══════════════════════════════════════════════════════════════════════
   CV → 3D Mapper
   ═══════════════════════════════════════════════════════════════════════ */

const PIPELINE_COLORS = {
  edges: 0x43e97b,
  contours: 0x6c63ff,
  faces: 0xff6584,
  color: 0xffeb3b,
  threshold: 0x00bcd4,
};

function clearCVGroup() {
  while (cvGroup.children.length > 0) {
    const child = cvGroup.children[0];
    cvGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  }
}

/**
 * Mapeia coordenadas de pixel (imagem) para coordenadas 3D.
 * Imagem → [-rangeX, rangeX] em X, [rangeY, -rangeY] em Y (invertido), Z = zBase.
 */
function pixelToWorld(px, py, imgW, imgH, rangeX = 5, rangeY = 4, zBase = 0) {
  const x = (px / imgW - 0.5) * 2 * rangeX;
  const y = (0.5 - py / imgH) * 2 * rangeY + 1; // +1 to lift above ground
  return new THREE.Vector3(x, y, zBase);
}

function mapGeometry(geometry) {
  clearCVGroup();
  // Avatares só existem no modo "faces"; em outro modo, remove todos
  if (geometry.type !== "faces") syncFaceAvatars([]);

  const { type, width, height } = geometry;
  let elementCount = 0;

  if (type === "contours" && geometry.shapes) {
    elementCount = mapContours(geometry.shapes, width, height);
  } else if (type === "faces" && geometry.entities) {
    elementCount = syncFaceAvatars(geometry.entities);
  } else if (type === "faces" && geometry.faces) {
    elementCount = mapFaces(geometry.faces, width, height);
  } else if (type === "edges" && geometry.points) {
    elementCount = mapEdgesWireframe(geometry.points, width, height);
  } else if (type === "color" && geometry.points) {
    elementCount = mapColorCloud(geometry.points, geometry.colors || [], width, height);
  } else if (type === "threshold" && geometry.points) {
    elementCount = mapThresholdPoints(geometry.points, width, height);
  }

  objCount3d.textContent = `${elementCount} elementos`;
  return elementCount;
}

function mapContours(shapes, imgW, imgH) {
  const rangeX = 5, rangeY = 4;

  for (const shape of shapes) {
    if (shape.points.length < 3) continue;

    // Criar THREE.Shape a partir dos pontos do contorno
    const threeShape = new THREE.Shape();
    const pts = shape.points.map(([px, py]) => {
      const x = (px / imgW - 0.5) * 2 * rangeX;
      const y = (0.5 - py / imgH) * 2 * rangeY;
      return new THREE.Vector2(x, y);
    });

    threeShape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      threeShape.lineTo(pts[i].x, pts[i].y);
    }
    threeShape.lineTo(pts[0].x, pts[0].y);

    // Extrude com profundidade proporcional à área (normalizada)
    const depth = Math.min(Math.max(Math.sqrt(shape.area) / (imgW * 0.5) * 3, 0.1), 2);
    const extrudeSettings = {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 1,
    };

    const geo = new THREE.ExtrudeGeometry(threeShape, extrudeSettings);
    const mat = new THREE.MeshStandardMaterial({
      color: PIPELINE_COLORS.contours,
      metalness: 0.3,
      roughness: 0.6,
      transparent: true,
      opacity: 0.8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 1;
    mesh.castShadow = true;
    cvGroup.add(mesh);
  }

  updateMappingInfo("contours", shapes.length, `${shapes.length} contornos → formas 3D extrudadas`);
  return shapes.length;
}

function mapFaces(faces, imgW, imgH) {
  for (const face of faces) {
    const cx = face.x + face.w / 2;
    const cy = face.y + face.h / 2;
    const pos = pixelToWorld(cx, cy, imgW, imgH);

    // Raio baseado no tamanho da face
    const radius = Math.max((face.w / imgW) * 3, 0.2);
    const geo = new THREE.SphereGeometry(radius, 24, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: PIPELINE_COLORS.faces,
      metalness: 0.4,
      roughness: 0.5,
      emissive: 0xff6584,
      emissiveIntensity: 0.15,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    cvGroup.add(mesh);

    // Anel ao redor da esfera para indicar detecção
    const ringGeo = new THREE.TorusGeometry(radius * 1.4, 0.04, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.rotation.x = Math.PI / 2;
    cvGroup.add(ring);
  }

  updateMappingInfo("faces", faces.length, `${faces.length} rosto(s) → esferas 3D`);
  return faces.length;
}

/* ═══════════════════════════════════════════════════════════════════════
   Avatares de rostos (entidades 3D rastreadas)
   ═══════════════════════════════════════════════════════════════════════ */
const AVATAR_COLORS = [0xff6584, 0x6c63ff, 0x43e97b, 0xffb74d, 0x00bcd4, 0xba68c8];
const LERP_SPEED = 8; // quanto maior, mais rápido o avatar alcança a posição alvo

function makeLabelSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 56, 16);
  ctx.fill();
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // depthTest desligado: o nome fica sempre visível, mesmo atrás de outro avatar
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(0.8, 0.2, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Cria um avatar: a origem do grupo fica no centro da cabeça. */
function createAvatar(entity) {
  const color = AVATAR_COLORS[(entity.track_id - 1) % AVATAR_COLORS.length];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.7 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 24), skinMat);
  head.castShadow = true;
  group.add(head);

  // Olhos no +Z local: é o lado que o lookAt() aponta para a câmera
  for (const ex of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), eyeMat);
    eye.position.set(ex, 0.04, 0.18);
    group.add(eye);
  }

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 8, 16), bodyMat);
  body.position.y = -0.72;
  body.castShadow = true;
  group.add(body);

  const label = makeLabelSprite(entity.name, color);
  label.position.y = 0.45;
  group.add(label);

  group.userData.label = label;
  return group;
}

function disposeAvatar(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  });
}

/**
 * Sincroniza os avatares com a lista de entidades recebida do servidor:
 * cria os novos, atualiza a posição alvo dos existentes e remove os que sumiram.
 */
function syncFaceAvatars(entities) {
  const seen = new Set();

  for (const ent of entities) {
    seen.add(ent.id);
    const target = new THREE.Vector3(ent.position.x, ent.position.y, ent.position.z);
    let avatar = avatars.get(ent.id);
    if (!avatar) {
      const group = createAvatar(ent);
      group.position.copy(target); // nasce direto no lugar (sem "voar" da origem)
      avatarGroup.add(group);
      avatar = { group, target };
      avatars.set(ent.id, avatar);
      log(`Avatar criado: ${ent.name}`);
    }
    avatar.target.copy(target);
    // Rosto temporariamente perdido (tolerância do rastreador) → semitransparente
    avatar.group.traverse((obj) => {
      if (obj.material) {
        obj.material.transparent = true;
        obj.material.opacity = ent.visible ? 1 : 0.4;
      }
    });
  }

  for (const [id, avatar] of avatars) {
    if (!seen.has(id)) {
      avatarGroup.remove(avatar.group);
      disposeAvatar(avatar.group);
      avatars.delete(id);
      log(`Avatar removido: ${id}`, "warning");
    }
  }

  if (entities.length || avatars.size === 0) {
    updateMappingInfo("faces", entities.length, `${entities.length} pessoa(s) → avatares 3D`);
  }
  return entities.length;
}

/** Chamado a cada frame de renderização: lerp da posição + olhar para a câmera. */
function updateAvatars(dt) {
  // Fator de lerp independente do FPS: 1 - e^(-k·dt)
  const alpha = 1 - Math.exp(-LERP_SPEED * dt);
  const lookTarget = new THREE.Vector3();
  for (const { group, target } of avatars.values()) {
    group.position.lerp(target, alpha);
    // Olha para a câmera apenas no plano horizontal (o corpo não inclina)
    lookTarget.set(camera.position.x, group.position.y, camera.position.z);
    group.lookAt(lookTarget);
  }
}

function mapEdgesWireframe(points, imgW, imgH) {
  if (points.length === 0) return 0;

  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i];
    const pos = pixelToWorld(px, py, imgW, imgH);
    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: PIPELINE_COLORS.edges,
    size: 0.06,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  });

  const pointCloud = new THREE.Points(geo, mat);
  cvGroup.add(pointCloud);

  updateMappingInfo("edges", points.length, `${points.length} pontos de borda → wireframe 3D`);
  return points.length;
}

function mapColorCloud(points, colors, imgW, imgH) {
  if (points.length === 0) return 0;

  const positions = new Float32Array(points.length * 3);
  const vertexColors = new Float32Array(points.length * 3);
  const hasColors = colors.length === points.length;

  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i];
    const pos = pixelToWorld(px, py, imgW, imgH);
    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;

    if (hasColors) {
      vertexColors[i * 3] = colors[i][0] / 255;
      vertexColors[i * 3 + 1] = colors[i][1] / 255;
      vertexColors[i * 3 + 2] = colors[i][2] / 255;
    } else {
      vertexColors[i * 3] = 1;
      vertexColors[i * 3 + 1] = 0.92;
      vertexColors[i * 3 + 2] = 0.23;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.1,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
  });

  const cloud = new THREE.Points(geo, mat);
  cvGroup.add(cloud);

  updateMappingInfo("color", points.length, `${points.length} pixels de cor → nuvem de pontos 3D`);
  return points.length;
}

function mapThresholdPoints(points, imgW, imgH) {
  if (points.length === 0) return 0;

  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i];
    const pos = pixelToWorld(px, py, imgW, imgH);
    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: PIPELINE_COLORS.threshold,
    size: 0.07,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
  });

  const cloud = new THREE.Points(geo, mat);
  cvGroup.add(cloud);

  updateMappingInfo("threshold", points.length, `${points.length} pixels → pontos 3D binários`);
  return points.length;
}

function updateMappingInfo(pipeline, count, text) {
  const pipelineLabels = {
    edges: "🟢 Bordas → Wireframe",
    contours: "🟣 Contornos → Formas Extrudadas",
    faces: "🔴 Rostos → Avatares 3D",
    color: "🟡 Cor → Nuvem de Pontos",
    threshold: "🔵 Limiar → Pontos Binários",
  };
  const label = pipelineLabels[pipeline] || pipeline;
  mappingInfo.innerHTML = `
    <p style="color:var(--text);font-weight:600;margin-bottom:.3rem">${label}</p>
    <p>${escHtml(text)}</p>
    <p style="margin-top:.2rem;font-size:.75rem;">Pipeline: <code>${escHtml(pipeline)}</code> | Elementos: ${Number(count)}</p>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════
   Pipelines
   ═══════════════════════════════════════════════════════════════════════ */
function setPipeline(btn) {
  document.querySelectorAll(".pipeline-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentPipeline = btn.dataset.pipeline;
  log(`Pipeline: ${currentPipeline}`);
  if (!camStream && uploadedImg.style.display !== "none") {
    sendImageFromElement(uploadedImg);
  }
}
// Expose globally for onclick
window.setPipeline = setPipeline;

/* ═══════════════════════════════════════════════════════════════════════
   Câmera
   ═══════════════════════════════════════════════════════════════════════ */
async function startCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    webcamVideo.srcObject = camStream;
    webcamVideo.style.display = "block";
    uploadedImg.style.display = "none";
    noSignal.style.display = "none";
    fpsBadge.style.display = "block";
    btnStartCam.disabled = true;
    btnStopCam.disabled = false;
    log("Câmera iniciada.");
    startCaptureLoop();
  } catch (err) {
    log(`Erro ao acessar câmera: ${err.message}`, "error");
  }
}

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
  clearInterval(captureTimer);
  captureTimer = null;
  webcamVideo.style.display = "none";
  webcamVideo.srcObject = null;
  noSignal.style.display = "flex";
  fpsBadge.style.display = "none";
  btnStartCam.disabled = false;
  btnStopCam.disabled = true;
  log("Câmera parada.");
}

function startCaptureLoop() {
  const fps = parseInt(fpsRange.value, 10);
  captureTimer = setInterval(captureAndSend, Math.floor(1000 / fps));
}

function restartCaptureLoop() {
  clearInterval(captureTimer);
  startCaptureLoop();
}

function captureAndSend() {
  if (!socket || !socket.connected || waitingResult) return;
  if (!camStream || webcamVideo.readyState < 2) return;

  const ctx = captureCanvas.getContext("2d");
  captureCanvas.width = webcamVideo.videoWidth || 640;
  captureCanvas.height = webcamVideo.videoHeight || 480;
  ctx.drawImage(webcamVideo, 0, 0, captureCanvas.width, captureCanvas.height);

  const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.7);
  sendFrame(dataUrl);
}

// Expose globally
window.startCamera = startCamera;
window.stopCamera = stopCamera;

/* ═══════════════════════════════════════════════════════════════════════
   Upload
   ═══════════════════════════════════════════════════════════════════════ */
function loadImageFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImg.src = e.target.result;
    uploadedImg.style.display = "block";
    webcamVideo.style.display = "none";
    noSignal.style.display = "none";
    fpsBadge.style.display = "none";
    log(`Imagem carregada: ${file.name}`);
    sendImageFromElement(uploadedImg);
  };
  reader.readAsDataURL(file);
}

function sendImageFromElement(imgEl) {
  const offscreen = document.createElement("canvas");
  offscreen.width = imgEl.naturalWidth || imgEl.width || 640;
  offscreen.height = imgEl.naturalHeight || imgEl.height || 480;
  const ctx = offscreen.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, offscreen.width, offscreen.height);
  const dataUrl = offscreen.toDataURL("image/jpeg", 0.85);
  sendFrame(dataUrl);
}

window.loadImageFile = loadImageFile;

/* ═══════════════════════════════════════════════════════════════════════
   Envio e recepção
   ═══════════════════════════════════════════════════════════════════════ */
function sendFrame(dataUrl) {
  if (!socket || !socket.connected) return;
  waitingResult = true;
  socket.emit("cv3d_frame", { image: dataUrl, pipeline: currentPipeline });
}

/* ═══════════════════════════════════════════════════════════════════════
   Broadcast
   ═══════════════════════════════════════════════════════════════════════ */
function toggleBroadcast() {
  broadcasting = !broadcasting;
  const btn = document.getElementById("btnBroadcast");
  btn.classList.toggle("active", broadcasting);
  broadcastBadge.style.display = broadcasting ? "block" : "none";
  log(broadcasting ? "Broadcast ativado." : "Broadcast desativado.");
}
window.toggleBroadcast = toggleBroadcast;

/* ═══════════════════════════════════════════════════════════════════════
   Three.js helpers expostos
   ═══════════════════════════════════════════════════════════════════════ */
function resetThreeCamera() {
  camera.position.set(0, 5, 12);
  controls.target.set(0, 1, 0);
  controls.update();
  log("Câmera 3D resetada.");
}
window.resetThreeCamera = resetThreeCamera;

function toggleGrid() {
  gridVisible = !gridVisible;
  gridHelper.visible = gridVisible;
  axesHelper.visible = gridVisible;
  log(gridVisible ? "Grid visível." : "Grid oculto.");
}
window.toggleGrid = toggleGrid;

/* ═══════════════════════════════════════════════════════════════════════
   Socket.IO
   ═══════════════════════════════════════════════════════════════════════ */
function initSocket() {
  socket = io({ transports: ["websocket"] });

  socket.on("connect", () => {
    statusDot.classList.add("connected");
    statusText.textContent = "Conectado";
    log("Conectado ao servidor WebSocket.");
    socket.emit("join_cv3d");
  });

  socket.on("disconnect", () => {
    statusDot.classList.remove("connected");
    statusText.textContent = "Desconectado";
    log("Desconectado do servidor.", "warning");
  });

  socket.on("cv3d_ready", ({ message }) => {
    log(`Servidor: ${message}`);
  });

  socket.on("cv3d_result", (data) => {
    waitingResult = false;

    if (data.error) {
      log(`Erro: ${data.error}`, "error");
      return;
    }

    // Exibe imagem resultado
    resultImg.src = data.image;
    resultImg.style.display = "block";
    noResult.style.display = "none";

    // Detecções
    renderDetections(data.detections || []);

    // Mapear geometria para 3D
    if (data.geometry) {
      const count = mapGeometry(data.geometry);
      // Se broadcasting, enviar dados geométricos para outros clientes
      if (broadcasting) {
        socket.emit("cv3d_broadcast", {
          geometry: data.geometry,
          pipeline: data.pipeline,
        });
      }
    }

    // FPS
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
      fpsBadge.textContent = `${frameCount} fps`;
      frameCount = 0;
      lastFpsTime = now;
    }
  });

  // Receber cena de outro cliente (broadcast)
  socket.on("cv3d_scene_update", (data) => {
    if (data.geometry) {
      receivingBadge.style.display = "block";
      mapGeometry(data.geometry);
      setTimeout(() => {
        receivingBadge.style.display = "none";
      }, 1000);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Detecções
   ═══════════════════════════════════════════════════════════════════════ */
const DETECTION_ICONS = {
  info: "ℹ️",
  contours: "🔷",
  faces: "😊",
  color: "🎨",
};

function renderDetections(detections) {
  detCount.textContent = detections.length;
  if (detections.length === 0) {
    detectionsList.innerHTML = `<div style="color:var(--text-muted);font-size:.8rem;padding:.3rem">Nenhuma detecção.</div>`;
    return;
  }
  detectionsList.innerHTML = detections
    .map((det) => {
      const icon = DETECTION_ICONS[det.type] || "📌";
      const countBadge =
        det.count !== undefined
          ? `<span class="det-count">${Number(det.count)}</span>`
          : "";
      return `
      <div class="detection-item">
        <span class="det-icon">${icon}</span>
        <span class="det-text">${escHtml(det.text)}</span>
        ${countBadge}
      </div>`;
    })
    .join("");
}

/* ═══════════════════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  initThreeScene();
  initSocket();
});
