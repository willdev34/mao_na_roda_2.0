// Gerador de dataset: tira prints do próprio jogo e já grava os rótulos no formato YOLO.
// Abra o jogo com  http://localhost:5173/?dataset=1
import Phaser from 'phaser'
import { CLASSES, groundTruth } from './Perception.js'

export class Dataset {
  constructor(scene) {
    this.s = scene
    this.files = []
    this.on = false
    this.t = 0
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;right:10px;top:56px;z-index:20;background:rgba(0,0,0,.65);color:#fff;padding:10px;border-radius:10px;font:13px system-ui;display:flex;gap:8px;align-items:center'
    box.innerHTML = '<button id="ds-go">Capturar</button><button id="ds-zip">Baixar ZIP</button><span id="ds-n">0 imagens</span>'
    document.body.appendChild(box)
    box.querySelector('#ds-go').onclick = (e) => { this.on = !this.on; e.target.textContent = this.on ? 'Parar' : 'Capturar' }
    box.querySelector('#ds-zip').onclick = () => this.zip()
    this.label = box.querySelector('#ds-n')
  }

  update(dt) {
    if (!this.on) return
    this.t += dt
    if (this.t < 0.6) return
    this.t = 0
    const s = this.s, free = s.agent.planner.free, { u0, v0, C, nu, nv } = s.data0
    // sorteia uma posição livre, direção e zoom para variar bastante os quadros
    for (let n = 0; n < 40; n++) {
      const i = Phaser.Math.Between(1, nu - 2), j = Phaser.Math.Between(1, nv - 2)
      if (free[i][j]) { s.U = u0 + (i + 0.5) * C; s.V = v0 + (j + 0.5) * C; break }
    }
    s.facing = Phaser.Math.Between(0, 3); s.refreshSprite()
    s.cameras.main.setZoom(Phaser.Math.FloatBetween(0.75, 1.25))
    s.cameras.main.centerOn(s.player.x, s.player.y)
    s.game.events.once(Phaser.Core.Events.POST_RENDER, () => this.grab())
  }

  grab() {
    const s = this.s, cam = s.cameras.main, canvas = s.game.canvas
    const W = canvas.width, H = canvas.height, ratio = W / cam.width
    const lines = []
    for (const d of groundTruth(s)) {
      let x0 = (d.x - cam.worldView.x) * cam.zoom * ratio, y0 = (d.y - cam.worldView.y) * cam.zoom * ratio
      let x1 = x0 + d.w * cam.zoom * ratio, y1 = y0 + d.h * cam.zoom * ratio
      const area = (x1 - x0) * (y1 - y0)
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1)
      if (x1 - x0 < 8 || y1 - y0 < 8 || (x1 - x0) * (y1 - y0) < 0.5 * area) continue      // quase fora da tela
      const c = CLASSES.indexOf(d.cls)
      lines.push(`${c} ${((x0 + x1) / 2 / W).toFixed(6)} ${((y0 + y1) / 2 / H).toFixed(6)} ${((x1 - x0) / W).toFixed(6)} ${((y1 - y0) / H).toFixed(6)}`)
    }
    if (!lines.length) return
    const name = `img_${String(this.files.length).padStart(5, '0')}`
    this.files.push({ name, jpg: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], txt: lines.join('\n') })
    this.label.textContent = `${this.files.length} imagens`
  }

  async zip() {
    if (!this.files.length) return
    const JSZip = (await import('jszip')).default
    const z = new JSZip()
    const cut = Math.floor(this.files.length * 0.85)
    this.files.forEach((f, n) => {
      const part = n < cut ? 'train' : 'val'
      z.file(`images/${part}/${f.name}.jpg`, f.jpg, { base64: true })
      z.file(`labels/${part}/${f.name}.txt`, f.txt)
    })
    z.file('data.yaml', `path: ./dataset\ntrain: images/train\nval: images/val\nnc: ${CLASSES.length}\nnames: ${JSON.stringify(CLASSES)}\n`)
    const blob = await z.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dataset-mao-na-roda.zip'; a.click()
  }
}
