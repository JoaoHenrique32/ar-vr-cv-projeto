/**
 * arvr.js – Lógica cliente para a interface AR/VR
 *
 * Responsabilidades:
 *  - Conexão Socket.IO com o servidor
 *  - Envio de comandos via painel de controle
 *  - Recepção de eventos e atualização da cena A-Frame
 *  - Avatares 3D das pessoas detectadas pela câmera (evento faces_update)
 */

"use strict";

/* ── Estado local ── */
const localState = { objects: {}, skyColor: "#87CEEB" };
let socket = null;

/* ── Elementos DOM ── */
const statusDot   = document.getElementById("statusDot");
const statusText  = document.getElementById("statusText");
const connInfo    = document.getElementById("connInfo");
const objCountEl  = document.getElementById("objCount");
const objCountBadge = document.getElementById("objCountBadge");
const objectList  = document.getElementById("objectList");
const logPanel    = document.getElementById("logPanel");

/* ── Utilitários ── */
function log(msg, type = "info") {
  const p = document.createElement("p");
  p.className = type;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(p);
  logPanel.scrollTop = logPanel.scrollHeight;
  if (logPanel.children.length > 80) logPanel.removeChild(logPanel.firstChild);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updateCounts() {
  const n = Object.keys(localState.objects).length;
  objCountEl.textContent = n;
  objCountBadge.textContent = `${n} objeto${n !== 1 ? "s" : ""}`;
}

/* ── Cena A-Frame helpers ── */
const SHAPE_MAP = {
  box:          "a-box",
  sphere:       "a-sphere",
  cylinder:     "a-cylinder",
  cone:         "a-cone",
  torus:        "a-torus",
  dodecahedron: "a-dodecahedron",
};

function createAframeEntity(obj) {
  const tag = SHAPE_MAP[obj.type] || "a-box";
  const el = document.createElement(tag);
  el.setAttribute("id", `obj-${obj.id}`);
  el.setAttribute("position", `${obj.position.x} ${obj.position.y} ${obj.position.z}`);
  el.setAttribute("material", { color: obj.color, metalness: 0.2, roughness: 0.7 });
  el.setAttribute("shadow", "cast: true; receive: true");

  // Sombra suave
  if (obj.type === "box")      el.setAttribute("depth", "0.8");
  if (obj.type === "cylinder") el.setAttribute("radius-top", "0.4");
  if (obj.type === "torus")    el.setAttribute("radius-tubular", "0.08");

  if (obj.animation) attachAnimation(el);
  return el;
}

function attachAnimation(el) {
  el.setAttribute("animation", "property: rotation; to: 0 360 0; loop: true; dur: 3000; easing: linear");
}

function removeAnimation(el) {
  el.removeAttribute("animation");
  el.setAttribute("rotation", "0 0 0");
}

/* ── Avatares de rostos ── */

/**
 * Componente A-Frame: move o avatar suavemente (lerp) até a posição alvo e
 * gira o avatar (apenas no eixo Y) para sempre olhar para a câmera do usuário.
 */
AFRAME.registerComponent("face-avatar", {
  schema: {
    target: { type: "vec3" },
    speed: { type: "number", default: 8 },
  },
  init() {
    this.targetVec = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();
  },
  tick(time, dt) {
    if (!dt) return;
    const obj = this.el.object3D;
    const t = this.data.target;
    // Fator de lerp independente do FPS: 1 - e^(-k·dt)
    const alpha = 1 - Math.exp(-this.data.speed * (dt / 1000));
    this.targetVec.set(t.x, t.y, t.z);
    obj.position.lerp(this.targetVec, alpha);

    const cam = this.el.sceneEl.camera;
    if (!cam) return;
    cam.getWorldPosition(this.camPos);
    this.lookPos.set(this.camPos.x, obj.position.y, this.camPos.z);
    obj.lookAt(this.lookPos); // +Z local (olhos) aponta para a câmera
  },
});

const AVATAR_COLORS = ["#ff6584", "#6c63ff", "#43e97b", "#ffb74d", "#00bcd4", "#ba68c8"];
const FACE_SOURCE_TIMEOUT_MS = 3000;
// source (sid da câmera) → { entities: Map(id → {el, entity}), lastSeen }
const faceSources = {};

function createAvatarEntity(ent) {
  const color = AVATAR_COLORS[(ent.track_id - 1) % AVATAR_COLORS.length];
  const { x, y, z } = ent.position;
  const root = document.createElement("a-entity");
  root.setAttribute("position", `${x} ${y} ${z}`); // nasce no lugar certo
  root.setAttribute("face-avatar", { target: { x, y, z } });
  // A origem do avatar é o centro da cabeça; olhos no +Z local
  root.innerHTML = `
    <a-sphere class="avatar-part" radius="0.2" color="#f1c27d" shadow="cast: true"></a-sphere>
    <a-sphere class="avatar-part" radius="0.03" color="#111" position="-0.07 0.04 0.18"></a-sphere>
    <a-sphere class="avatar-part" radius="0.03" color="#111" position="0.07 0.04 0.18"></a-sphere>
    <a-cylinder class="avatar-part" radius="0.22" height="0.75" position="0 -0.62 0"
                material="color: ${color}; roughness: 0.6" shadow="cast: true"></a-cylinder>
    <a-sphere class="avatar-part" radius="0.22" position="0 -0.25 0"
              material="color: ${color}; roughness: 0.6"></a-sphere>
    <a-plane class="face-label-bg" width="0.8" height="0.18" position="0 0.42 0"
             material="color: #000; opacity: 0.6; transparent: true; shader: flat"></a-plane>
    <a-text class="face-label" value="${escHtml(ent.name)}" align="center" color="${color}"
            width="2.2" position="0 0.42 0.01"></a-text>`;
  return root;
}

function updateAvatarEntity(el, ent) {
  const { x, y, z } = ent.position;
  el.setAttribute("face-avatar", "target", { x, y, z });
  // Rosto temporariamente perdido → avatar semitransparente
  if (el.dataset.visible === String(ent.visible)) return; // só atualiza material quando muda
  el.dataset.visible = String(ent.visible);
  const opacity = ent.visible ? 1 : 0.4;
  el.querySelectorAll(".avatar-part").forEach((part) => {
    part.setAttribute("material", { transparent: opacity < 1, opacity });
  });
}

/** Cria/atualiza/remove os avatares de uma câmera (source) conforme as entidades recebidas. */
function syncFaceAvatars(source, entities) {
  const container = document.getElementById("faceAvatars");
  const src = faceSources[source] || (faceSources[source] = { entities: new Map(), lastSeen: 0 });
  src.lastSeen = Date.now();
  const seen = new Set();

  for (const ent of entities) {
    seen.add(ent.id);
    const existing = src.entities.get(ent.id);
    if (existing) {
      existing.entity = ent;
      updateAvatarEntity(existing.el, ent);
    } else {
      const el = createAvatarEntity(ent);
      container.appendChild(el);
      src.entities.set(ent.id, { el, entity: ent });
      log(`Avatar criado: ${ent.name}`);
    }
  }

  for (const [id, { el, entity }] of src.entities) {
    if (!seen.has(id)) {
      el.remove();
      src.entities.delete(id);
      log(`Avatar removido: ${entity.name}`, "warning");
    }
  }

  if (src.entities.size === 0) delete faceSources[source];
  renderFaceList();
}

/** Câmera parou de enviar (aba fechada, câmera parada) → remove seus avatares. */
function pruneStaleFaceSources() {
  const now = Date.now();
  for (const source of Object.keys(faceSources)) {
    if (now - faceSources[source].lastSeen > FACE_SOURCE_TIMEOUT_MS) syncFaceAvatars(source, []);
  }
}

function renderFaceList() {
  const all = Object.values(faceSources).flatMap((s) => [...s.entities.values()].map((e) => e.entity));
  document.getElementById("faceCount").textContent = all.length;
  const faceList = document.getElementById("faceList");
  if (all.length === 0) {
    faceList.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem">Nenhuma pessoa detectada</div>`;
    return;
  }
  faceList.innerHTML = all.map((e) => `
    <div class="object-item">
      <div class="object-item-info">
        <span class="color-dot" style="background:${AVATAR_COLORS[(e.track_id - 1) % AVATAR_COLORS.length]}"></span>
        <span>${escHtml(e.name)}${e.visible ? "" : " (perdido)"}</span>
      </div>
      <span style="font-size:.75rem;color:var(--text-muted)">
        ${e.position.x.toFixed(1)}, ${e.position.y.toFixed(1)}, ${e.position.z.toFixed(1)} · ~${e.position.distance}m
      </span>
    </div>`).join("");
}

/* ── Socket.IO ── */
function initSocket() {
  socket = io({ transports: ["websocket"] });

  socket.on("connect", () => {
    statusDot.classList.add("connected");
    statusText.textContent = "Conectado";
    connInfo.textContent = `ID: ${socket.id}`;
    log("Conectado ao servidor WebSocket.");
    socket.emit("join_arvr");
  });

  socket.on("disconnect", () => {
    statusDot.classList.remove("connected");
    statusText.textContent = "Desconectado";
    connInfo.textContent = "Reconectando…";
    log("Desconectado do servidor.", "warning");
  });

  /* ── Eventos de cena ── */

  socket.on("scene_state", (state) => {
    log(`Estado da cena recebido: ${state.objects.length} objetos.`);
    // Limpa cena e reconstrói
    clearLocalScene();
    document.getElementById("sky").setAttribute("color", state.sky_color);
    localState.skyColor = state.sky_color;
    state.objects.forEach(addObjectToScene);
    updateCounts();
  });

  socket.on("object_added", (obj) => {
    addObjectToScene(obj);
    updateCounts();
    log(`Objeto adicionado: #${obj.id} (${obj.type})`);
  });

  socket.on("object_removed", ({ id }) => {
    removeObjectFromScene(id);
    updateCounts();
    log(`Objeto removido: #${id}`);
  });

  socket.on("sky_changed", ({ color }) => {
    document.getElementById("sky").setAttribute("color", color);
    localState.skyColor = color;
    log(`Cor do céu alterada para ${color}`);
  });

  socket.on("scene_cleared", () => {
    clearLocalScene();
    document.getElementById("sky").setAttribute("color", "#87CEEB");
    updateCounts();
    log("Cena limpa.", "warning");
  });

  socket.on("object_moved", (obj) => {
    const el = document.getElementById(`obj-${obj.id}`);
    if (el) {
      el.setAttribute("position", `${obj.position.x} ${obj.position.y} ${obj.position.z}`);
      if (localState.objects[obj.id]) localState.objects[obj.id].position = obj.position;
    }
    log(`Objeto #${obj.id} movido para (${obj.position.x}, ${obj.position.y}, ${obj.position.z})`);
  });

  socket.on("color_changed", ({ id, color }) => {
    const el = document.getElementById(`obj-${id}`);
    if (el) el.setAttribute("material", { color: color, metalness: 0.2, roughness: 0.7 });
    if (localState.objects[id]) localState.objects[id].color = color;
    renderObjectList();
    log(`Cor do objeto #${id} alterada para ${color}`);
  });

  socket.on("faces_update", ({ source, entities }) => {
    syncFaceAvatars(source, entities || []);
  });

  socket.on("animation_toggled", ({ id, animation }) => {
    const el = document.getElementById(`obj-${id}`);
    if (el) animation ? attachAnimation(el) : removeAnimation(el);
    if (localState.objects[id]) localState.objects[id].animation = animation;
    log(`Animação do objeto #${id}: ${animation ? "ativada" : "desativada"}`);
  });
}

/* ── Manipulação da lista de objetos ── */
function addObjectToScene(obj) {
  localState.objects[obj.id] = obj;
  const container = document.getElementById("sceneObjects");
  const existing = document.getElementById(`obj-${obj.id}`);
  if (existing) existing.remove();
  container.appendChild(createAframeEntity(obj));
  renderObjectList();
}

function removeObjectFromScene(id) {
  const el = document.getElementById(`obj-${id}`);
  if (el) el.remove();
  delete localState.objects[id];
  renderObjectList();
}

function clearLocalScene() {
  document.getElementById("sceneObjects").innerHTML = "";
  Object.keys(localState.objects).forEach(k => delete localState.objects[k]);
  renderObjectList();
}

function renderObjectList() {
  const objs = Object.values(localState.objects);
  if (objs.length === 0) {
    objectList.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:1rem">Nenhum objeto ainda</div>`;
    return;
  }
  objectList.innerHTML = objs.map(obj => `
    <div class="object-item">
      <div class="object-item-info">
        <span class="color-dot" style="background:${escHtml(obj.color)}"></span>
        <span>#${escHtml(obj.id)} ${escHtml(obj.type)}</span>
      </div>
      <div class="flex gap-1">
        <input type="color" value="${escHtml(obj.color)}" title="Mudar cor"
               style="width:24px;height:24px;border:none;border-radius:4px;cursor:pointer;padding:0"
               onchange="changeColor(${Number(obj.id)}, this.value)">
        <button class="btn btn-outline btn-sm" title="${obj.animation ? 'Parar animação' : 'Animar'}"
                onclick="toggleAnimation(${Number(obj.id)})">${obj.animation ? "⏸" : "▶"}</button>
        <button class="btn btn-danger btn-sm" title="Remover"
                onclick="removeObject(${Number(obj.id)})">✕</button>
      </div>
    </div>
  `).join("");
}

/* ── Funções chamadas pelos botões HTML ── */
function sendCommand(command, payload = {}) {
  if (!socket || !socket.connected) {
    log("Não conectado ao servidor!", "error");
    return;
  }
  socket.emit("arvr_command", { command, payload });
}

function addObject(type) {
  const color = document.getElementById("objColor").value;
  sendCommand("add_object", { type, color });
}

function removeObject(id) {
  sendCommand("remove_object", { id });
}

function changeSky() {
  const color = document.getElementById("skyColor").value;
  sendCommand("change_sky", { color });
}

function setSkyPreset(color) {
  document.getElementById("skyColor").value = color;
  sendCommand("change_sky", { color });
}

function clearScene() {
  if (confirm("Limpar toda a cena?")) sendCommand("clear_scene");
}

function changeColor(id, color) {
  sendCommand("change_color", { id, color });
}

function toggleAnimation(id) {
  sendCommand("toggle_animation", { id });
}

/* ── Inicialização ── */
document.addEventListener("DOMContentLoaded", () => {
  initSocket();
  setInterval(pruneStaleFaceSources, 1000);
});
