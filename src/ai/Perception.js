// "Visão" do jogo. Devolve detecções no mesmo formato de um YOLO:
// { cls, conf, x, y, w, h }  (caixa em pixels do mundo, canto superior esquerdo)
export const CLASSES = ['cadeirante', 'caixa', 'pessoa', 'cafeteira', 'impressora', 'mesa']

// Fonte 1: estado do jogo (usada enquanto não existe um modelo treinado)
export function groundTruth(scene) {
  const out = []
  const push = (cls, b, conf = 0.97) => out.push({ cls, conf, x: b.x, y: b.y, w: b.width, h: b.height })
  push('cadeirante', scene.player.getBounds(), 0.99)
  for (const b of Object.values(scene.boxes)) if (b.active && !b.kicked) push('caixa', b.getBounds())
  for (const n of scene.npcSprites) push('pessoa', n.getBounds())
  for (const m of scene.data0.targets ? Object.values(scene.data0.targets) : []) {
    const [x, y, w, h] = m.obj
    out.push({ cls: m.cls, conf: 0.95, x: x - scene.off.x, y: y - scene.off.y, w, h })
  }
  return out
}

// Fonte 2: modelo YOLO treinado (TensorFlow.js em Web Worker), igual ao jogo do pato
export class ModelPerception {
  constructor(scene, url) {
    this.scene = scene
    this.last = []
    this.busy = false
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'ready') this.ready = true
      if (data.type === 'detections') { this.last = data.items; this.busy = false }
    }
    this.worker.postMessage({ type: 'load', url, classes: CLASSES })
  }

  // converte a tela do jogo em imagem e pede detecções (sem acumular quadros)
  async request() {
    if (!this.ready || this.busy) return
    this.busy = true
    const canvas = this.scene.game.canvas
    const bmp = await createImageBitmap(canvas)
    this.worker.postMessage({ type: 'predict', image: bmp, cam: this.scene.camSnapshot() }, [bmp])
  }

  get() { return this.last }
}
