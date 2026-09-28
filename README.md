# base-project-arvrcv – Pessoas reais como avatares em VR

Aplicação de **Realidade Mista** desenvolvida sobre o projeto base das disciplinas de
**Realidade Aumentada/Virtual** e **Visão Computacional**.

A câmera (do celular ou do notebook) captura o ambiente real, o servidor detecta os
rostos com **OpenCV (Haar Cascade)**, converte cada rosto de **pixel 2D → posição 3D**
e envia as entidades por **WebSocket**. No ambiente virtual (Three.js e A-Frame/WebXR),
cada pessoa vira um **avatar 3D com o nome flutuando acima da cabeça**, que se move
junto com a pessoa real e **sempre olha para o observador**.

```
 📱 Câmera ──frame JPEG──▶ 🐍 Servidor (OpenCV) ──JSON (entidades 3D)──▶ 🥽 Cena VR
   /cv3d  (Socket.IO)       Haar → rastreio → X,Y,Z     (Socket.IO)       /cv3d  /arvr
```

> As respostas para os questionamentos da atividade estão em
> [`APRESENTACAO.md`](APRESENTACAO.md). O enunciado está em [`requisitos.md`](requisitos.md).

---

## Sumário

- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Como rodar](#como-rodar)
- [Testando com a câmera do celular (HTTPS)](#testando-com-a-câmera-do-celular-https)
- [Como funciona o modo Rostos](#como-funciona-o-modo-rostos)
- [Calibração](#calibração)
- [API WebSocket](#api-websocket)
- [Docker / Coolify](#docker--coolify)
- [Autenticação](#autenticação)
- [Solução de problemas](#solução-de-problemas)

---

## Funcionalidades

### 😊 Rostos → Avatares 3D (funcionalidade principal)
- Detecção de **múltiplos rostos** em tempo real (Haar Cascade `haarcascade_frontalface_default.xml`).
- Conversão de cada rosto em coordenadas **X, Y, Z** no mundo virtual:
  - **X** – posição horizontal relativa ao centro do frame (−2.0 a +2.0);
  - **Y** – eixo invertido e calibrado na altura dos olhos (~1.6 m);
  - **Z** – profundidade estimada, **inversamente proporcional à largura do rosto**.
- **Rastreamento** por centroide: cada pessoa mantém o mesmo ID/nome (`Pessoa 1`, `Pessoa 2`…) entre frames.
- **Avatar** com cabeça, olhos e corpo + **nome flutuante** (Sprite no Three.js, `a-text` no A-Frame).
- Avatar **olha para a câmera do usuário** (rotação no eixo Y).
- **Interpolação suave (lerp)** da posição, independente do FPS.
- Tolerância a falhas: um rosto perdido por poucos frames fica semitransparente em vez de sumir;
  depois de 5 frames sem detecção o avatar é **removido da cena**.
- A mesma detecção alimenta **as duas cenas**: `/cv3d` (Three.js) e `/arvr` (A-Frame, com modo VR).

### Demais interfaces do projeto base
| Rota | Interface | Descrição |
|------|-----------|-----------|
| `/` | Início | Links para todas as interfaces |
| `/cv` | Visão Computacional | Pipelines OpenCV: bordas, contornos, rostos, cor, desfoque, limiar, mãos e pose (MediaPipe) |
| `/cv3d` | CV → 3D | Feed original, resultado CV e cena Three.js lado a lado |
| `/arvr` | AR/VR | Cena A-Frame (WebXR) com objetos, céu e **avatares das pessoas detectadas** |
| `/worldgen` | AI World Gen | Geração de cenas 3D a partir de texto (OpenAI) |

---

## Tecnologias

| Camada     | Tecnologia |
|------------|-----------|
| Backend    | Python 3.10+, Flask, Flask-SocketIO, gevent |
| CV         | OpenCV (Haar Cascade), NumPy, MediaPipe (mãos/pose) |
| Frontend   | HTML5, CSS3, JavaScript (ES6+) |
| 3D / VR    | [Three.js r160](https://threejs.org/), [A-Frame 1.6](https://aframe.io/) (WebXR) |
| Tempo real | Socket.IO v4 (WebSocket) |
| IA (opcional) | OpenAI API – apenas para `/worldgen` |

---

## Estrutura do projeto

```
base-project-arvrcv/
├── server.py              # Flask + Socket.IO + pipelines de CV + mapeamento 2D→3D
├── requirements.txt       # Dependências Python
├── README.md              # Este arquivo
├── APRESENTACAO.md        # Roteiro/respostas para a apresentação
├── requisitos.md          # Enunciado da atividade
├── Dockerfile / docker-compose.yml / .env.example
├── static/
│   ├── css/style.css
│   ├── js/
│   │   ├── cv3d.js        # Cena Three.js + avatares (Sprite, lerp, lookAt)
│   │   ├── arvr.js        # Cena A-Frame + componente "face-avatar"
│   │   ├── cv.js          # Cliente de Visão Computacional
│   │   └── worldgen*.js   # AI World Gen
│   └── vendor/            # Three.js, OrbitControls, A-Frame, Socket.IO (locais)
└── templates/             # index, cv, cv3d, arvr, worldgen, login
```

Pontos principais do código:

| Onde | O quê |
|------|-------|
| `server.py` → `_detect_faces()` | Haar Cascade (carregado uma vez) + equalização de histograma |
| `server.py` → `_face_to_world()` | Conversão pixel → X, Y, Z (comentada passo a passo) |
| `server.py` → `FaceTracker` | Mantém IDs estáveis entre frames e remove rostos perdidos |
| `server.py` → `_process_faces()` | Pipeline completo + envio de `faces_update` para a sala `arvr` |
| `static/js/cv3d.js` → `syncFaceAvatars()` / `updateAvatars()` | Cria/atualiza/remove avatares; lerp + lookAt |
| `static/js/arvr.js` → componente `face-avatar` | Lerp + lookAt no A-Frame; lista "Pessoas detectadas" |

---

## Como rodar

### 1) Pré-requisitos
- Python 3.10+ e `pip`
- Navegador moderno (Chrome/Edge/Firefox). Para VR: navegador com WebXR (ex.: Meta Quest Browser)
- Linux/WSL: dependências nativas do OpenCV/MediaPipe

```bash
sudo apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgles2 libegl1
```

### 2) Ambiente virtual e dependências

**Windows (PowerShell)**
```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

**Linux/macOS**
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Executar

```bash
python server.py
```

Acesse **http://localhost:5000** (a porta pode ser alterada com a variável `PORT`).
Na primeira execução os modelos do MediaPipe são baixados para `models/`.

### 4) Testar o modo Rostos no próprio computador
1. Abra **http://localhost:5000/cv3d**, selecione **Rostos** e clique em **Iniciar câmera**.
2. Os avatares aparecem no painel Three.js (arraste com o mouse para orbitar).
3. Em outra aba/dispositivo, abra **http://localhost:5000/arvr**: os mesmos avatares aparecem na
   cena A-Frame. Navegue com **WASD + mouse** ou entre em VR pelo botão 🥽.

> A aba `/cv` no modo **Detecção de Rostos** também alimenta a cena `/arvr`.

---

## Testando com a câmera do celular (HTTPS)

Navegadores só liberam a câmera em **HTTPS** (ou `localhost`). Para usar o celular, exponha a
porta 5000 com um túnel:

```bash
# Opção 1 – localtunnel (precisa de Node.js)
npx localtunnel --port 5000
# → your url is: https://<nome-aleatorio>.loca.lt
# Na primeira visita o site pede a "Tunnel Password" = IP público da máquina:
curl https://loca.lt/mytunnelpassword

# Opção 2 – Cloudflare (sem senha de túnel)
cloudflared tunnel --url http://localhost:5000
```

Fluxo sugerido para a apresentação:
- **Celular** (câmera): `https://<túnel>/cv3d` → **Rostos** → **Iniciar câmera**.
- **Professor** (VR / notebook): `https://<túnel>/arvr` → cada aluno aparece como avatar.

> ⚠️ O link do túnel é público. Se for deixá-lo aberto, defina `APP_ACCESS_PASSWORD`
> (veja [Autenticação](#autenticação)).

---

## Como funciona o modo Rostos

### 1. Detecção (pixel)
O cliente envia um frame JPEG em base64 (`cv3d_frame`). O servidor converte para tons de cinza,
equaliza o histograma e roda `detectMultiScale`, obtendo um retângulo `(x, y, w, h)` por rosto.

### 2. Mapeamento 2D → 3D (coordenada)

```python
cx_norm = (x + w/2) / largura_frame          # 0..1
cy_norm = (y + h/2) / altura_frame           # 0..1

X = (cx_norm - 0.5) * 2 * 2.0                # -2.0 .. +2.0 (centro do frame = 0)
Y = 1.6 + (0.5 - cy_norm) * 2 * 0.6          # eixo invertido + altura dos olhos
distancia = (0.15 * 0.9 * largura_frame) / w # modelo pinhole: largura real do rosto × focal / w
Z = -distancia * 2.0                         # negativo = à frente do observador
```

- **Y invertido**: na imagem o Y cresce para baixo; em computação gráfica, para cima.
- **Z ∝ −1/w**: rosto grande = pessoa perto; rosto pequeno = pessoa longe.
- Valores limitados: `Y ≥ 1.0` e `−8 ≤ Z ≤ −0.5`.

### 3. Rastreamento (identidade entre frames)
O `FaceTracker` associa cada rosto novo ao rosto mais próximo do frame anterior (distância entre
centros normalizados < 0.2). Assim a `Pessoa 1` continua sendo a `Pessoa 1` mesmo que o Haar
devolva os rostos em outra ordem. Rostos sem par ganham um novo ID; rostos que somem por mais de
5 frames são descartados.

### 4. Mensagem JSON (WebSocket)

```json
{
  "type": "faces",
  "source": "<sid da câmera>",
  "entities": [
    {
      "id": "aB3dE9-1",
      "track_id": 1,
      "name": "Pessoa 1",
      "bbox": {"x": 270, "y": 190, "w": 150, "h": 150},
      "position": {"x": 0.156, "y": 1.538, "z": -1.152, "distance": 0.58},
      "visible": true
    }
  ]
}
```

### 5. Renderização (objeto 3D)
- **Novo ID** → cria avatar já na posição correta.
- **ID existente** → atualiza só a posição-alvo; a cada quadro o avatar anda até ela com
  `lerp(alvo, 1 − e^(−8·dt))` (suave e independente do FPS).
- **ID ausente** → avatar removido (memória liberada).
- **lookAt**: o avatar gira para a câmera do observador apenas no plano horizontal.
- Se a câmera parar de enviar por 3 s (ou desconectar), os avatares dela somem da cena `/arvr`.

---

## Calibração

Constantes no topo da seção **"Rostos"** em `server.py`:

| Constante | Padrão | Efeito |
|-----------|--------|--------|
| `FACE_X_RANGE` | 2.0 | Largura (m) do espaço horizontal no VR |
| `FACE_Y_RANGE` | 0.6 | Variação vertical em torno da altura dos olhos |
| `FACE_EYE_HEIGHT` | 1.6 | Altura dos olhos (m) |
| `FACE_REAL_WIDTH` | 0.15 | Largura média de um rosto (m) |
| `FACE_FOCAL_RATIO` | 0.9 | Focal ≈ 0.9 × largura do frame (FOV ~60°) |
| `FACE_DEPTH_SCALE` | 2.0 | Exagera a profundidade para ficar visível na cena |
| `FACE_MATCH_DIST` | 0.2 | Distância máxima para considerar "o mesmo rosto" |
| `FACE_MAX_MISSING` | 5 | Frames tolerados sem detecção antes de remover |

No frontend, `LERP_SPEED` (`cv3d.js`) e `speed` do componente `face-avatar` (`arvr.js`) controlam
a suavidade do movimento.

---

## API WebSocket

### Sala `cv3d`
| Evento | Direção | Payload |
|--------|---------|---------|
| `join_cv3d` | cliente → servidor | — |
| `cv3d_frame` | cliente → servidor | `{image: base64, pipeline}` |
| `cv3d_result` | servidor → cliente | `{image, pipeline, detections[], geometry}` |
| `cv3d_broadcast` | cliente → servidor | `{geometry, pipeline}` (retransmite para a sala) |
| `cv3d_scene_update` | servidor → clientes | `{geometry, pipeline}` |

`geometry` por pipeline:
- `faces`: `{entities: [...], faces: [{x, y, w, h}]}` – entidades 3D (formato acima) + bounding boxes
- `contours`: `{shapes: [{x, y, w, h, area, points}]}`
- `edges` / `threshold`: `{points: [[x, y]...]}`
- `color`: `{points, colors, total_pixels}`

### Sala `arvr`
| Evento | Direção | Payload |
|--------|---------|---------|
| `join_arvr` | cliente → servidor | — (recebe `scene_state` + `faces_update` atuais) |
| `arvr_command` | cliente → servidor | `{command, payload}` – `add_object`, `remove_object`, `change_sky`, `clear_scene`, `move_object`, `change_color`, `toggle_animation` |
| **`faces_update`** | servidor → sala | `{type: "faces", source, entities[]}` – avatares das pessoas |
| `scene_state`, `object_added`, `object_removed`, `object_moved`, `color_changed`, `animation_toggled`, `sky_changed`, `scene_cleared` | servidor → sala | estado da cena |

### Sala `cv`
| Evento | Direção | Payload |
|--------|---------|---------|
| `join_cv` / `cv_frame` | cliente → servidor | `{image, pipeline}` – `edges`, `contours`, `faces`, `color`, `blur`, `threshold`, `hands`, `pose` |
| `cv_result` | servidor → cliente | `{image, pipeline, detections[]}` |

No pipeline `faces`, `cv_frame` também publica `faces_update` na sala `arvr`.

### Sala `worldgen`
`join_worldgen`, `worldgen_generate {prompt, model, engine}`, `worldgen_share` →
`worldgen_ready`, `worldgen_status`, `worldgen_result`, `worldgen_new_scene`, `worldgen_shared_scene`.
Requer `OPENAI_API_KEY`.

---

## Docker / Coolify

```bash
cp .env.example .env    # defina APP_ACCESS_PASSWORD e FLASK_SECRET_KEY
docker compose up -d --build
docker compose logs -f app
docker compose down
```

- O serviço escuta na porta `5000` (externa configurável por `HOST_PORT`).
- `models/` é montado como volume para não baixar os modelos MediaPipe a cada reinício.
- No Coolify: recurso **Docker Compose** apontando para o repositório, com as variáveis
  `APP_ACCESS_PASSWORD`, `FLASK_SECRET_KEY`, `SESSION_COOKIE_SECURE=true` e, opcionalmente,
  `OPENAI_API_KEY`.

---

## Autenticação

Quando `APP_ACCESS_PASSWORD` está definida, todas as páginas exigem login em `/login` e conexões
Socket.IO sem sessão são recusadas. Rotas públicas: `/login`, `/healthz`, `/static/*`.
Para sair: `/logout`.

Com `DEBUG=false`, o servidor só inicia se `APP_ACCESS_PASSWORD` e `FLASK_SECRET_KEY` estiverem definidas.

```powershell
$env:APP_ACCESS_PASSWORD="minha-senha"; $env:FLASK_SECRET_KEY="chave-forte"; python server.py
```

---

## Solução de problemas

| Problema | Solução |
|----------|---------|
| Câmera não abre no celular | Use HTTPS (túnel) – `http://IP:5000` é bloqueado pelo navegador |
| Status "Desconectado" pelo túnel | Recarregue a página; se persistir, troque localtunnel por `cloudflared` |
| Avatar "pisca" ou some | Melhore a iluminação, fique de frente para a câmera, aumente o FPS |
| Profundidade exagerada/pequena | Ajuste `FACE_DEPTH_SCALE` / `FACE_FOCAL_RATIO` |
| `ImportError: libGL.so.1` | `sudo apt-get install libgl1 libglib2.0-0` |
| `OSError: libGLESv2.so.2` | `sudo apt-get install libgles2 libegl1` |
| Porta 5000 ocupada | Defina outra: `PORT=5001 python server.py` |
| World Gen sem resposta | Defina `OPENAI_API_KEY` no terminal atual |
