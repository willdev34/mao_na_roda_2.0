# Mão na Roda (remake)

Remake do jogo de 2014 (Construct 2) que mostra as dificuldades de um cadeirante num escritório.

**Jogue online:** https://mao-na-roda-five.vercel.app

Créditos do original: Game Design Anderson Mansera, Ilustração e animação Emerson Lopes, Programação William de Paula.

## Rodar (PowerShell)

```powershell
npm install
npm run dev
```

Abra http://localhost:5173

## Controles

- Modo cadeira (padrão no PC): ◀ ▶ giram 90 graus, ▲ ▼ avançam e recuam
- Modo direto (padrão no celular): cada seta anda numa direção isométrica
- Encoste numa caixa e o cadeirante chuta ela para fora da tela
- Tecla C ou o botão no topo alternam os modos. O D-pad no canto esquerdo funciona com toque.

## Missões

Pegar o café, buscar na impressora e chegar à mesa de trabalho (a mesa só conta depois das outras duas).

## Estrutura

- `src/OfficeScene.js` cena principal, movimento e câmera
- `src/Collision.js` grade de colisão (célula de meio ladrilho, no espaço U,V)
- `src/iso.js` projeção isométrica de 30 graus
- `public/assets/collision.json` grade gerada por `tools/build_map.py`
- `src/missions.js` textos e ordem das missões
- `tools/cut_dynamic.py` recorta caixas e NPCs do mapa e limpa o chão
- `tools/build_scene.py` gera `office.png`, a grade de colisão, os alvos das missões e as peças de primeiro plano (oclusão)
- `tools/make_chair_frames.py` gera os quadros do braço empurrando a roda

## Próximos passos

1. Diálogos, piso molhado e mais missões
2. Polimento visual (HD, sombras, luz, interface)
3. Treinar o YOLO com o dataset auto-rotulado (Colab) e converter para TF.js


## Modo IA

Teste direto no link online: clique em "Modo IA" e veja o cadeirante completar as missões sozinho.

- Botão "Modo IA" (canto superior direito): o agente planeja com A* e anda sozinho, na ordem café, impressora, mesa. Qualquer seta/toque devolve o controle.
- Visão: se existir `public/models/mao-na-roda/model.json`, usa o YOLO (TensorFlow.js em Web Worker, como no jogo do pato). Sem modelo, as detecções vêm do estado do jogo no mesmo formato (caixa, classe, confiança). O caminho com modelo ainda não foi testado com um modelo real.
- Dataset: abra `/?dataset=1`, clique Capturar, depois Baixar ZIP (imagens + rótulos YOLO). Treine com `tools/treino_yolo.ipynb` no Colab.

## Deploy

Publicado na Vercel (preset Vite, `npm run build`, saída em `dist`). Cada push na `main` gera uma nova versão.
