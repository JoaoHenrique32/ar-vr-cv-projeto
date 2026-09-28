# Apresentação – Pessoas reais como avatares no mundo virtual

> Roteiro de apresentação da atividade descrita em [`requisitos.md`](requisitos.md).
> Detalhes técnicos de execução estão no [`README.md`](README.md).

---

## 1. O que construímos

Um sistema de **Realidade Mista (MR)**. O mundo real (a câmera do celular) alimenta um mundo
virtual (cena VR) em tempo real:

```
📱 Câmera do celular        🐍 Servidor Python                     🥽 Cena VR (professor)
   captura o frame  ──▶  1. detecta rostos (Haar Cascade)   ──▶   avatar por pessoa,
   (JPEG via WebSocket)   2. rastreia quem é quem (ID)              nome flutuante,
                          3. converte pixel → posição X,Y,Z          olha para o usuário,
                          4. envia JSON pelo WebSocket               movimento suave
```

- **Mundo real:** câmera do celular na página `/cv3d`, modo **Rostos**.
- **Mundo virtual:** cena Three.js em `/cv3d` e cena A-Frame/WebXR em `/arvr`. O professor pode
  entrar em modo VR na segunda.
- **Integração:** Socket.IO (WebSocket). Cada frame processado gera uma lista de entidades 3D.

---

## 2. Checklist dos requisitos técnicos

| Requisito | Status | Como foi feito |
|-----------|:------:|----------------|
| Usar o projeto base fornecido | ✅ | Estendemos `server.py`, `cv3d.js`, `arvr.js` e `arvr.html` sem quebrar os outros modos |
| Capturar imagem da câmera do celular | ✅ | `getUserMedia` na página `/cv3d`, servida por HTTPS via túnel (localtunnel/cloudflared) |
| Detectar rostos em tempo real | ✅ | Haar Cascade `haarcascade_frontalface_default.xml`, carregado uma única vez |
| Extrair coordenadas (X, Y) dos rostos | ✅ | Centro do retângulo `(x + w/2, y + h/2)`, normalizado pelo tamanho do frame |
| Enviar informações ao ambiente virtual | ✅ | Evento `cv3d_result` (campo `geometry.entities`) e evento `faces_update` para a sala `arvr` |
| Renderizar um objeto para cada pessoa | ✅ | Um avatar (cabeça, olhos e corpo) por entidade detectada |
| Atualizar a posição em tempo real | ✅ | Posição-alvo atualizada a cada frame, com interpolação suave (lerp) |
| Exibir identificação (nome ou ID) | ✅ | "Pessoa N" flutuando acima da cabeça (Sprite no Three.js, `a-text` no A-Frame) |

### Desafios e explorações

| Item | Status | Observação |
|------|:------:|------------|
| 🟡 **Desafio Master:** avatar sempre olha para o usuário | ✅ | `lookAt` da câmera do observador, só no eixo Y |
| 🟡 **Desafio Master:** nome flutuando acima da cabeça | ✅ | Etiqueta presa ao avatar; ela também fica voltada para o observador |
| 🌍 Simular profundidade (Z) pelo tamanho do rosto | ✅ | `Z ∝ −1 / largura_do_rosto` (modelo pinhole) |
| Identidade estável entre frames | ✅ | Rastreador por centroide (`FaceTracker`) |
| 🧠 Reconhecimento facial (nome real da pessoa) | ⏳ | Hoje o sistema **identifica** a pessoa com um ID ("Pessoa 1"), mas não **reconhece** quem ela é. Veja a seção 6 |
| 👁️ Detectar olhos/boca para animar o avatar | ⏳ | Não implementado |
| 🔴 Desafio Expert: máscara 3D e orientação da cabeça | ⏳ | Não implementado (o Haar não fornece a orientação do rosto) |

---

## 3. Conceitos obrigatórios

### 3.1 Como o sistema sabe onde está cada pessoa?

1. O celular envia um frame (imagem JPEG) ao servidor.
2. O servidor converte a imagem para tons de cinza e equaliza o histograma, o que ajuda com
   iluminação ruim.
3. O **Haar Cascade** percorre a imagem em várias escalas procurando o padrão claro/escuro típico
   de um rosto frontal (olhos mais escuros que a testa, nariz mais claro que as laterais etc.).
4. Para cada rosto encontrado, ele devolve um **retângulo em pixels**: `(x, y, w, h)`.
5. O **rastreador** compara esses retângulos com os do frame anterior. O rosto mais próximo de
   onde a "Pessoa 1" estava continua sendo a "Pessoa 1". Assim cada pessoa mantém o próprio avatar,
   mesmo que o detector devolva os rostos em outra ordem.

> O sistema sabe **onde** há um rosto na imagem. Ele não sabe **quem** é a pessoa; isso seria
> reconhecimento facial.

### 3.2 Como transformar coordenadas da câmera em posição no VR?

Usamos o centro do rosto e o tamanho dele. O código está em `server.py` → `_face_to_world()`:

| Eixo | Fórmula | Ideia |
|------|---------|-------|
| **X** | `(cx/largura − 0.5) × 2 × 2.0` | Centro da imagem = 0. Esquerda = −2, direita = +2 |
| **Y** | `1.6 + (0.5 − cy/altura) × 2 × 0.6` | Na imagem o Y cresce **para baixo**; no 3D cresce **para cima**, então invertemos. O centro fica na altura dos olhos (1,6 m) |
| **Z** | `−(0.15 × 0.9 × largura) / w × 2` | Modelo pinhole: distância = (largura real do rosto × focal) / largura em pixels. **Rosto grande = perto, rosto pequeno = longe**. O sinal negativo coloca o avatar à frente do observador |

Exemplo em um frame de 640×480:

| Largura do rosto (px) | Distância estimada | Z no VR |
|----------------------:|-------------------:|--------:|
| 200 | 0,43 m | −0,86 |
| 150 | 0,58 m | −1,15 |
| 100 | 0,86 m | −1,73 |
| 60 | 1,44 m | −2,88 |
| 30 (mínimo detectável) | 2,88 m | −5,76 |

Depois, no navegador:
- **Pessoa nova:** o avatar é criado já na posição calculada.
- **Pessoa que se moveu:** o avatar "caminha" até a nova posição com **lerp** (interpolação
  linear), o que evita saltos.
- **Pessoa que saiu da imagem:** depois de 5 frames sem detecção, o avatar é removido.

### 3.3 Qual a dificuldade de mapear profundidade (distância)?

Uma câmera comum gera uma imagem **2D**, então a profundidade se perde na projeção. Não há
medição direta de distância; nós **estimamos** Z pelo tamanho aparente do rosto. Essa estimativa
tem limitações:

- **Rostos têm tamanhos diferentes.** Adultos, crianças e rostos mais largos parecem mais perto
  ou mais longe do que realmente estão. Usamos uma média de 15 cm.
- **O retângulo do Haar "oscila".** A largura `w` varia alguns pixels de um frame para o outro,
  mesmo com a pessoa parada. Como Z depende de `1/w`, **para quem está longe um erro pequeno
  em pixels vira um erro grande em metros**.
- **A focal da câmera é desconhecida.** Cada celular tem um campo de visão diferente. Usamos uma
  aproximação (focal ≈ 0,9 × largura do frame), que deveria ser calibrada por aparelho.
- **Rosto de lado ou inclinado** muda a largura detectada e distorce a distância.
- **X não é corrigido pela profundidade.** No mundo real, a mesma distância em pixels vale mais
  metros para quem está longe. Nós usamos X normalizado, que é mais simples, mas menos fiel.

Soluções mais precisas: câmera estéreo ou de profundidade (LiDAR, Kinect), modelos de estimativa
de profundidade monocular, ou calibração da câmera com tabuleiro de xadrez (`cv2.calibrateCamera`).

### 3.4 Pixel × Coordenada × Objeto 3D

| Conceito | Onde vive | Unidade | Exemplo no nosso sistema |
|----------|-----------|---------|--------------------------|
| **Pixel** | Imagem 2D da câmera | Pixels inteiros; origem no canto **superior esquerdo**, Y para baixo | Rosto em `x=270, y=190, w=150, h=150` |
| **Coordenada** | Espaço 3D do mundo virtual | Metros (float); origem no chão, Y para cima, −Z para frente | `position: {x: 0.156, y: 1.538, z: −1.152}` |
| **Objeto 3D** | Cena Three.js/A-Frame | Malha com geometria, material, rotação e escala | Avatar "Pessoa 1": esfera (cabeça) + corpo + nome, posicionado na coordenada acima |

> O **pixel** é o que a câmera vê, a **coordenada** é onde a pessoa está no mundo virtual e o
> **objeto 3D** é o que o usuário do VR enxerga naquela coordenada.

---

## 4. Investigação obrigatória

> ⚠️ Os resultados dos testes devem ser **preenchidos pelo grupo** depois de testar com o celular.
> Abaixo estão o que a teoria e o código preveem e uma tabela para registrar o que foi observado.

### 📏 Distância
- **Previsão:** o Haar usa `minSize=(30, 30)`. Em 640×480, isso corresponde a cerca de **2,9 m**
  de distância. Além disso o rosto não é detectado. Perto do limite, a detecção fica instável e o
  Z oscila mais, porque cada pixel de erro pesa mais.
- **Efeito no VR:** pessoas longe aparecem mais ao fundo (Z mais negativo) e o avatar tende a
  "tremer" em profundidade. O lerp suaviza esse tremor.

| Distância real | Detectou? | Z no VR | Estável? |
|---------------:|:---------:|--------:|:--------:|
| 0,5 m | | | |
| 1 m | | | |
| 2 m | | | |
| 3 m | | | |

### 😷 Acessórios
- **Previsão:** o Haar frontal depende do contraste entre olhos, testa, nariz e boca.
  - **Óculos escuros:** a região dos olhos continua escura, então tende a funcionar.
  - **Máscara:** esconde nariz e boca. Tende a **falhar** ou detectar com menos frequência.
  - **Boné:** a aba sombreia a testa e os olhos. Pode reduzir a detecção, dependendo da luz.

| Acessório | Detectou? | Observação |
|-----------|:---------:|------------|
| Sem acessório | | |
| Óculos de grau | | |
| Óculos escuros | | |
| Máscara | | |
| Boné | | |

### 🔄 Movimento
- **O objeto acompanha?** Sim. A cada frame processado a posição-alvo muda e o avatar desliza até
  ela.
- **Existe atraso?** Sim. O atraso vem de várias partes:
  1. **Intervalo de captura:** o controle deslizante de FPS em `/cv3d` vai de 1 a 10 (padrão 3,
     ou seja, 1 frame a cada ~333 ms).
  2. **Envio pela rede, processamento e resposta:** só um frame fica "em voo" por vez
     (`waitingResult`), o que evita fila e acúmulo de atraso.
  3. **Lerp:** com velocidade 8, o avatar percorre ~63% do caminho em 125 ms e ~95% em ~375 ms.
     É uma troca intencional: menos tremor, um pouco mais de atraso.
- **Movimentos rápidos:** se a pessoa andar muito entre dois frames (mais de 20% do quadro), o
  rastreador pode tratá-la como uma pessoa nova e criar um novo ID.

| FPS configurado | Atraso percebido | Observação |
|----------------:|-----------------:|------------|
| 3 | | |
| 10 | | |

### 👥 Múltiplas pessoas
- **Previsão:** o código não limita o número de rostos. `detectMultiScale` devolve todos, e cada
  um ganha um ID e um avatar. Com 6 ou mais pessoas as cores dos avatares se repetem (há 6 cores),
  mas os nomes continuam únicos.
- **Limites práticos:** tamanho mínimo do rosto (distância), oclusão (uma pessoa na frente da
  outra) e custo de processamento, que cresce com a resolução.

| Nº de pessoas na câmera | Nº detectado | Nº de avatares no VR |
|------------------------:|-------------:|---------------------:|
| 1 | | |
| 3 | | |
| 5+ | | |

### 🔁 Sincronização
- **O movimento real é fiel ao virtual?** Na **direção**, sim: esquerda/direita e perto/longe
  seguem a pessoa. Na **escala**, é aproximado: X vai de −2 a +2 independentemente da distância,
  e Z é exagerado 2× para ficar visível.
- **Espelhamento:** a imagem não é espelhada. Quem está à esquerda **da câmera** aparece à esquerda
  no VR. Isso vale para um observador olhando na mesma direção que a câmera.
- **Várias telas ao mesmo tempo:** `/cv3d` e `/arvr` recebem as mesmas entidades pelo WebSocket.
  Quem abre o VR depois recebe na entrada os avatares que já existem.
- **Queda da câmera:** se a câmera desconectar ou parar de enviar por 3 s, os avatares dela somem
  do VR.

---

## 5. Roteiro de demonstração (≈ 5 min)

1. **Abrir o túnel HTTPS:** `npx localtunnel --port 5000` (ou `cloudflared tunnel --url http://localhost:5000`).
2. **Celular:** abrir `https://<túnel>/cv3d`, escolher **Rostos** e **Iniciar câmera**.
3. **Notebook/óculos (professor):** abrir `https://<túnel>/arvr` e entrar no VR.
4. **Demonstrar:**
   - uma pessoa → aparece "Pessoa 1";
   - andar para os lados → o avatar acompanha em X;
   - aproximar/afastar da câmera → o avatar vem para frente ou vai para trás (Z);
   - o observador anda pela cena (WASD) → os avatares giram para olhar para ele;
   - entram mais pessoas → surgem "Pessoa 2", "Pessoa 3"…;
   - uma pessoa sai do quadro → o avatar some depois de alguns frames.
5. **Mostrar o código:** `_face_to_world()` (a matemática) e `updateAvatars()` / componente
   `face-avatar` (lerp + lookAt).

---

## 6. Limitações e próximos passos

| Limitação | Próximo passo |
|-----------|---------------|
| Só **detecta** e identifica por ID; não **reconhece** quem é | Reconhecimento facial com `cv2.face.LBPHFaceRecognizer` (opencv-contrib) ou embeddings (`face_recognition`/`dlib`), cadastrando uma foto por aluno para exibir o nome real |
| Haar só detecta rosto frontal e é sensível à luz | Trocar por MediaPipe Face Detection ou um detector DNN do OpenCV (mais robustos a ângulo e oclusão) |
| Profundidade estimada, sem calibração | Calibrar a câmera (`cv2.calibrateCamera`) ou usar estimativa de profundidade monocular |
| Avatar não replica a orientação da cabeça | MediaPipe Face Mesh para obter yaw/pitch e aplicar ao avatar (Desafio Expert) |
| IDs podem trocar em movimentos muito rápidos | Rastreador com previsão (filtro de Kalman) ou IoU entre retângulos |

---

## 7. Mensagem final

> Transformar uma pessoa real em um avatar virtual passa por três etapas: **perceber** (visão
> computacional encontra o rosto em pixels), **interpretar** (a matemática converte pixels em uma
> posição no espaço) e **representar** (a computação gráfica desenha um objeto 3D ali). Cada etapa
> perde ou aproxima informação, e o maior desafio é a **profundidade**, que uma câmera comum não
> mede diretamente.
