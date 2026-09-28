🎯 Objetivo

Desenvolver uma aplicação baseada no projeto:

🔗 https://github.com/henning-nr/base-project-arvrcv

Onde:
A câmera do celular captura o ambiente real
Rostos são detectados e identificados
Cada pessoa é representada dentro de um ambiente virtual
Um avatar (ou objeto) será renderizado na posição correspondente no espaço real
O professor (em VR) verá todos vocês como entidades virtais dentro da cena
🧠 Descrição da Atividade

Vocês deverão desenvolver um sistema onde:

📷 Visão Computacional (Mundo Real)

A câmera captura o ambiente com múltiplas pessoas
O sistema detecta rostos usando Haar Cascade ou outra abordagem
(Desafio) Implementar reconhecimento facial simples (nome da pessoa)

🧍 Mapeamento Espacial

Cada rosto detectado deve gerar uma posição aproximada no espaço
Essa posição será usada para posicionar um objeto no mundo virtual

🕶️ Realidade Virtual (Mundo Virtual)

No ambiente VR (A-Frame do projeto base), cada pessoa detectada vira:
Um avatar OU
Um objeto (ex: boneco, cubo, marcador visual)

🔄 Integração

O mundo real alimenta o mundo virtual em tempo real
Quando alguém se move → o objeto no VR também se move

📖 Conceitos Importantes
🔹 O que é Mapeamento do Mundo Real para o Virtual?

É transformar coordenadas da câmera (2D) em posições dentro de um ambiente 3D.

👉 Exemplo:

Pessoa à esquerda da câmera → objeto à esquerda no VR
Pessoa perto → objeto maior ou mais próximo


🔹 Detecção vs Reconhecimento
Detecção: “Tem um rosto aqui”
Reconhecimento: “Esse rosto é o João”

👉 Vocês devem tentar evoluir de detecção para identificação.

🔹 Realidade Aumentada vs Realidade Virtual
AR (Realidade Aumentada): mistura real + virtual
VR (Realidade Virtual): mundo totalmente simulado

👉 Essa atividade mistura os dois → isso é chamado de Realidade Mista (MR)

🛠️ Requisitos Técnicos

O sistema deve obrigatoriamente:

✔ Usar o projeto base fornecido
✔ Capturar imagem da câmera do celular
✔ Detectar rostos em tempo real
✔ Extrair coordenadas (X, Y) dos rostos
✔ Enviar essas informações para o ambiente virtual
✔ Renderizar um objeto para cada pessoa detectada
✔ Atualizar a posição em tempo real
✔ Exibir identificação (nome ou ID) no mundo virtual

🔄 Conceitos Obrigatórios (Apresentação)

Durante a apresentação, vocês devem explicar:
Como o sistema sabe onde está cada pessoa?
Como transformar coordenadas da câmera em posição no VR?
Qual a dificuldade de mapear profundidade (distância)?
Diferença entre:
Pixel (imagem)
Coordenada (posição)
Objeto 3D (VR)
🧪 Investigação Obrigatória

Testem e documentem:

📏 Distância
O sistema consegue detectar pessoas longe?
Como isso afeta o posicionamento no VR?

😷 Acessórios
Óculos escuros funcionam?
Máscara interfere?
Boné atrapalha?

🔄 Movimento
O objeto acompanha corretamente?
Existe atraso (delay)?

👥 Múltiplas Pessoas
Quantas pessoas o sistema consegue detectar ao mesmo tempo?
O VR consegue representar todas?

🔁 Sincronização
O movimento no mundo real é fiel no virtual?




🧩 Liberdade de Exploração

🎨 Personalização:

Trocar os objetos (bonecos, shapes, modelos 3D)
Mudar cores e estilos

👁️ Detecção Avançada:

Detectar olhos ou boca
Usar isso para animar o avatar

🧠 Reconhecimento Facial:

Associar nomes aos rostos

🌍 Melhor Mapeamento:

Simular profundidade (Z)
Usar tamanho do rosto como referência de distância


🚀 Desafios


🟡 Desafio Master

Criar um avatar que:

Sempre olha para o usuário em VR
Tem nome flutuando acima da cabeça
🔴 Desafio Expert

Criar um sistema onde:

O rosto real é “substituído” por um modelo (máscara 3D)
O avatar replica movimentos básicos (posição + orientação)

👉 Isso se aproxima de tecnologias usadas em jogos e no metaverso

💡 Dica do Professor

Esse projeto não é só sobre código.

É sobre entender:

Como o mundo real pode ser digitalizado
Como sistemas interpretam pessoas
Como experiências imersivas são construídas