# Diretrizes do Projeto: Base AR/VR/CV (Mapeamento 2D -> 3D)

## Visão Geral
Aplicação interativa que conecta Visão Computacional (OpenCV em Python) com Realidade Virtual/3D (Three.js e A-Frame no frontend) via WebSockets.

## Arquitetura
- **Backend**: Servidor Python gerenciando captura/processamento de vídeo e streaming via WebSocket.
- **Frontend**: Aplicação web com abas "Visão Computacional", "CV → 3D" e "AR/VR".
- **Fluxo**: Frame de vídeo -> Processamento OpenCV -> Extração de Features -> Mensagem JSON via WebSocket -> Atualização da cena 3D/VR.

## Objetivo da Tarefa Atual (Modo "Rostos")
1. Ativar e aprimorar a detecção de múltiplos rostos no backend usando Haar Cascade (`haarcascade_frontalface_default.xml`).
2. Converter coordenadas 2D da imagem para o espaço 3D (X, Y, Z):
   - X: normalizado de -X a +X a partir do centro da tela.
   - Y: invertido para computação gráfica (positivo para cima) e ajustado na altura dos olhos.
   - Z: calculado por proximidade focal aproximada baseada na largura da bounding box ($Z \propto -1 / w$).
3. Transmitir lista de entidades contendo `id`, `name`, `x`, `y`, `z` e bounding boxes via WebSocket.
4. No frontend 3D/VR (Three.js / A-Frame):
   - Renderizar um avatar (cabeça/corpo geométrico) para cada pessoa detectada.
   - Adicionar uma etiqueta de texto flutuante com o nome/ID acima da cabeça.
   - Fazer o avatar olhar para a câmera do usuário (`lookAt`).
   - Aplicar interpolação linear (`lerp`) para movimentação fluida.
   - Remover avatares quando a pessoa sair do enquadramento.

## Convenções de Código
- Manter o código modular e não quebrar os outros modos já existentes (Bordas, Contornos, Cor, Limiar).
- Otimizar o pipeline para manter taxa de FPS estável via WebSocket.
- Comentários em português explicando a conversão das coordenadas matemáticas.

Regra de versionamento: Ao executar ou sugerir comandos git commit, NUNCA adicione a tag Co-authored-by: na mensagem. Não faça nenhuma menção a IA, Claude, Anthropic ou ao seu próprio nome. O histórico de commits deve conter exclusivamente a minha autoria.