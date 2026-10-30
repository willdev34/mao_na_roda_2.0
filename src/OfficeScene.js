import Phaser from 'phaser'
import { toScreen, DIRS } from './iso.js'
import { Collision } from './Collision.js'
import { MISSIONS } from './missions.js'
import { Agent } from './ai/Agent.js'
import { CLASSES, groundTruth, ModelPerception } from './ai/Perception.js'
import { Dataset } from './ai/Dataset.js'

const SPEED = 150          // unidades de (U,V) por segundo
const SPRITE_SCALE = 0.85  // ajusta o cadeirante ao tamanho dos ladrilhos
const FRAME_MS = 130       // tempo de cada quadro do braço
const KICK_DIST = 3200     // quanto a caixa viaja (em U,V) até sair da tela

const $ = (id) => document.getElementById(id)

export class OfficeScene extends Phaser.Scene {
  constructor() { super('office') }

  preload() {
    this.load.image('office', 'assets/office.png')
    this.load.json('collision', 'assets/collision.json')
    this.load.json('dynamic', 'assets/dynamic.json')
    for (const d of DIRS) for (let k = 0; k < 4; k++) this.load.image(`chair_${d.name}_${k}`, `assets/chair_${d.name}_${k}.png`)
    const dyn = this.cache.json.get('dynamic')
    void dyn
    // sprites dinâmicos e páginas de primeiro plano são listados depois do JSON carregar
    this.load.once('filecomplete-json-dynamic', () => {
      const d = this.cache.json.get('dynamic')
      for (const g of [d.boxes, d.npcs]) for (const v of Object.values(g)) this.load.image(v.file, `assets/${v.file}`)
    })
    this.load.once('filecomplete-json-collision', () => {
      const c = this.cache.json.get('collision')
      for (const p of c.fg) this.load.image(p.file, `assets/${p.file}`)
    })
  }

  create() {
    const data = this.cache.json.get('collision')
    const dyn = this.cache.json.get('dynamic')
    this.data0 = data
    this.off = { x: data.offsetX, y: data.offsetY }
    this.col = new Collision(data, dyn.boxes)

    this.add.image(0, 0, 'office').setOrigin(0).setDepth(-1)
    this.buildForeground(data)
    this.buildNpcs(dyn.npcs)
    this.buildBoxes(dyn.boxes)
    this.buildMissions(data)

    this.U = data.start[0]
    this.V = data.start[1]
    this.facing = 0
    this.frame = 0
    this.animT = 0
    this.paused = false
    this.touch = window.matchMedia('(pointer: coarse)').matches
    this.chairMode = !this.touch

    const p = this.worldPos()
    this.player = this.add.sprite(p.x, p.y, 'chair_se_0').setOrigin(0.5, 0.86).setScale(SPRITE_SCALE)
    this.refreshSprite()

    const cam = this.cameras.main
    cam.setBounds(-200, -200, data.width + 400, data.height + 400)
    cam.startFollow(this.player, true, 0.12, 0.12)
    this.fitZoom()
    this.scale.on('resize', () => this.fitZoom())

    this.keys = this.input.keyboard.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D',
    })
    this.pad = { up: false, down: false, left: false, right: false }
    this.turnLock = { left: false, right: false }
    document.querySelectorAll('#pad button').forEach((b) => {
      const k = b.dataset.key
      const on = (e) => { e.preventDefault(); this.pad[k] = true; b.classList.add('on') }
      const off = (e) => { e.preventDefault(); this.pad[k] = false; b.classList.remove('on') }
      b.addEventListener('pointerdown', on)
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, off)
      b.addEventListener('contextmenu', (e) => e.preventDefault())
    })
    const toggle = () => { this.chairMode = !this.chairMode; this.updateModeLabel() }
    this.input.keyboard.on('keydown-C', toggle)
    $('mode').addEventListener('click', toggle)
    $('m-ok').addEventListener('click', () => this.closeModal())
    this.updateModeLabel()
    this.setupAI()
    this.setupMenu()
    window.__scene = this        // atalho para depuração no console
  }

  // ---------- Tela inicial ----------
  setupMenu() {
    this.paused = true
    const panels = { 'b-tut': 'p-tut', 'b-cred': 'p-cred' }
    for (const [b, p] of Object.entries(panels)) {
      $(b).addEventListener('click', () => {
        const open = $(p).classList.contains('show')
        Object.values(panels).forEach((id) => $(id).classList.remove('show'))
        if (!open) $(p).classList.add('show')
      })
    }
    document.querySelectorAll('#menu .close').forEach((c) => c.addEventListener('click', () => Object.values(panels).forEach((id) => $(id).classList.remove('show'))))
    $('start').addEventListener('click', () => { $('menu').classList.add('hide'); this.paused = false })
  }

  // ---------- Modo IA ----------
  setupAI() {
    this.agent = new Agent(this)
    this.dbg = this.add.graphics().setDepth(1e9)
    this.dbgText = Array.from({ length: 16 }, () => this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: '#000', backgroundColor: '#ffffffcc' }).setDepth(1e9 + 1).setVisible(false))
    this.model = null
    // se existir um modelo treinado, usa a visão do YOLO; senão, as detecções vêm do estado do jogo
    fetch('models/mao-na-roda/model.json', { method: 'HEAD' }).then((r) => {
      const ct = r.headers.get('content-type') || ''
      if (r.ok && !ct.includes('html')) this.model = new ModelPerception(this, 'models/mao-na-roda/model.json')
      this.updateAiLabel()
    }).catch(() => {})
    $('ai').addEventListener('click', () => this.toggleAI())
    if (new URLSearchParams(location.search).has('dataset')) this.dataset = new Dataset(this)
    this.updateAiLabel()
  }

  camSnapshot() { const c = this.cameras.main; return { x: c.worldView.x, y: c.worldView.y, zoom: c.zoom } }

  detections() {
    if (this.model?.ready && this.model.get().length) return this.model.get()
    return groundTruth(this)
  }

  toggleAI(force) {
    const on = force ?? !this.agent.enabled
    if (on) { this.closeModal(); this.agent.start() } else { this.agent.stop(); this.dbg.clear(); this.dbgText.forEach((t) => t.setVisible(false)) }
    this.updateAiLabel()
  }

  updateAiLabel() {
    const b = $('ai')
    b.textContent = this.agent?.enabled ? 'Modo IA: ligado' : 'Modo IA'
    b.classList.toggle('on', !!this.agent?.enabled)
    b.title = this.model?.ready ? 'Visão: modelo YOLO treinado' : 'Visão: detecções do estado do jogo (sem modelo treinado ainda)'
  }

  drawOverlay() {
    const g = this.dbg; g.clear()
    const colors = { cadeirante: 0x00e5ff, caixa: 0xff9800, pessoa: 0xe91e63, cafeteira: 0x8bc34a, impressora: 0x8bc34a, mesa: 0x8bc34a }
    const dets = this.lastDets || []
    dets.forEach((d, n) => {
      g.lineStyle(2, colors[d.cls] ?? 0xffffff, 1).strokeRect(d.x, d.y, d.w, d.h)
      const t = this.dbgText[n]
      if (t) { t.setText(`${d.cls} ${d.conf.toFixed(2)}`).setPosition(d.x, d.y - 15).setVisible(true) }
    })
    for (let n = dets.length; n < this.dbgText.length; n++) this.dbgText[n].setVisible(false)
    const p = this.agent.path
    if (p) {
      g.lineStyle(3, 0xffeb3b, 0.9).beginPath()
      p.forEach(([U, V], n) => { const q = toScreen(U, V); const x = q.x - this.off.x, y = q.y - this.off.y; n ? g.lineTo(x, y) : g.moveTo(x, y) })
      g.strokePath()
    }
  }

  // ---------- cenário ----------
  buildForeground(data) {
    // pedaços do mapa que ficam NA FRENTE do cadeirante (móveis altos, vidro)
    for (const page of data.fg) {
      const tex = this.textures.get(page.file)
      page.items.forEach(([sx, sy, w, h, x0, y0, depth], n) => {
        const name = `${page.file}#${n}`
        tex.add(name, 0, sx, sy, w, h)
        this.add.image(x0 - this.off.x, y0 - this.off.y, page.file, name).setOrigin(0).setDepth(depth - this.off.y)
      })
    }
  }

  buildNpcs(npcs) {
    this.npcSprites = []
    // Os NPCs continuam desenhados no mapa. O sprite se mexe por cima, em passos pequenos.
    const cfg = {
      men:  { sy: [1, 1.012], ang: 0.7, dx: 0, dur: 1500 },
      maid: { sy: [1, 1.01], ang: 3.2, dx: 4, dur: 850 },
      r1:   { sy: [1, 1.014], ang: 0.9, dx: 1, dur: 1700 },
      r2:   { sy: [1, 1.012], ang: 1.1, dx: 1.5, dur: 1300 },
    }
    for (const [k, n] of Object.entries(npcs)) {
      const c = cfg[k]
      const x = n.x - this.off.x + n.w / 2, y = n.y - this.off.y + n.h
      const s = this.add.image(x, y, n.file).setOrigin(0.5, 1).setDepth(y)
      this.npcSprites.push(s)
      this.tweens.add({ targets: s, scaleY: c.sy[1], duration: c.dur, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
      this.tweens.add({ targets: s, angle: { from: -c.ang, to: c.ang }, duration: c.dur * 1.6, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
      if (c.dx) this.tweens.add({ targets: s, x: x + c.dx, duration: c.dur * 1.3, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
    }
  }

  buildBoxes(boxes) {
    this.boxes = {}
    for (const [id, b] of Object.entries(boxes)) {
      const x = b.x - this.off.x + b.w / 2, y = b.y - this.off.y + b.h
      this.boxes[id] = this.add.image(x, y, b.file).setOrigin(0.5, 1).setDepth(y - 2)
    }
  }

  buildMissions(data) {
    this.done = new Set()
    this.markers = {}
    for (const m of MISSIONS) {
      const t = data.targets[m.id]
      const x = t.px[0] - this.off.x, y = t.px[1] - this.off.y
      const ring = this.add.ellipse(x, y, 96, 54).setStrokeStyle(4, 0xffc400, 1).setFillStyle(0xffc400, 0.18).setDepth(0)
      const icon = this.add.text(x, y - 18, m.emoji, { fontSize: '34px' }).setOrigin(0.5, 1).setDepth(999999)
      this.tweens.add({ targets: ring, scale: 1.18, alpha: 0.55, duration: 800, yoyo: true, repeat: -1 })
      this.tweens.add({ targets: icon, y: y - 30, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
      this.markers[m.id] = [ring, icon]
    }
  }

  fitZoom() {
    const { width, height } = this.scale
    this.cameras.main.setZoom(Phaser.Math.Clamp(Math.min(width / 1000, height / 620), 0.5, 1.6))
  }

  // ---------- interface ----------
  updateModeLabel() {
    $('mode').textContent = this.chairMode ? 'Controle: cadeira (toque para trocar)' : 'Controle: direto (toque para trocar)'
  }

  toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('show')
    clearTimeout(this._toast); this._toast = setTimeout(() => t.classList.remove('show'), 2600)
  }

  openModal(m, final) {
    this.paused = true
    for (const k of Object.keys(this.pad)) { this.pad[k] = false }
    document.querySelectorAll('#pad button.on').forEach((b) => b.classList.remove('on'))
    $('m-emoji').textContent = m.emoji
    $('m-title').textContent = final ? 'Todas as missões concluídas!' : 'Missão concluída!'
    $('m-text').textContent = m.message
    $('modal').classList.add('show')
    if (this.agent?.enabled && !final) { clearTimeout(this._aiClose); this._aiClose = setTimeout(() => this.closeModal(), 1600) }
    if (final && this.agent?.enabled) this.toggleAI(false)
  }

  closeModal() { $('modal').classList.remove('show'); this.paused = false }

  completeMission(m) {
    this.done.add(m.id)
    document.querySelectorAll(`[data-m="${m.id}"]`).forEach((e) => e.classList.add('done'))
    this.markers[m.id].forEach((o) => o.setVisible(false))
    this.openModal(m, this.done.size === MISSIONS.length)
  }

  checkMissions() {
    for (const m of MISSIONS) {
      if (this.done.has(m.id)) continue
      const t = this.data0.targets[m.id]
      if (Math.hypot(this.U - t.u, this.V - t.v) > t.r) continue
      if (m.last && this.done.size < MISSIONS.length - 1) {
        if (!this._lastWarn || this.time.now - this._lastWarn > 4000) {
          this._lastWarn = this.time.now
          this.toast('Antes de sentar, faltam outras missões.')
        }
        continue
      }
      this.completeMission(m)
      break
    }
  }

  // ---------- jogador ----------
  worldPos() {
    const s = toScreen(this.U, this.V)
    return { x: s.x - this.off.x, y: s.y - this.off.y }
  }

  refreshSprite() { this.player.setTexture(`chair_${DIRS[this.facing].name}_${this.frame}`) }

  held(name) {
    const k = this.keys
    const map = {
      up: k.up.isDown || k.w.isDown, down: k.down.isDown || k.s.isDown,
      left: k.left.isDown || k.a.isDown, right: k.right.isDown || k.d.isDown,
    }
    return map[name] || this.pad[name]
  }

  turn(step) { this.facing = (this.facing + step + 4) % 4; this.refreshSprite() }

  kick(id, dU, dV) {
    const box = this.boxes[id]
    if (!box || box.kicked) return
    box.kicked = true
    this.col.freeBox(id)
    const len = Math.hypot(dU, dV) || 1
    const to = toScreen((dU / len) * KICK_DIST, (dV / len) * KICK_DIST)
    box.setDepth(1e7)
    this.tweens.killTweensOf(box)
    this.tweens.add({
      targets: box, x: box.x + to.x, y: box.y + to.y, angle: 720 * (dU + dV >= 0 ? 1 : -1),
      duration: 1500, ease: 'Cubic.easeIn', onComplete: () => box.destroy(),
    })
    this.cameras.main.shake(90, 0.004)
    this.say('SAI DAQUI!')
  }

  // balão de fala que acompanha o cadeirante
  say(text, ms = 1300) {
    if (!this.bubble) {
      const g = this.add.graphics()
      const t = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: '900', color: '#1b2430' }).setOrigin(0.5)
      this.bubble = { g, t }
    }
    const { g, t } = this.bubble
    t.setText(text.toUpperCase())
    const w = t.width + 24, h = t.height + 14
    g.clear().fillStyle(0xffffff, 1).lineStyle(3, 0x1b2430, 1)
    g.fillRoundedRect(-w / 2, -h, w, h, 10).strokeRoundedRect(-w / 2, -h, w, h, 10)
    g.fillTriangle(-8, 0, 8, 0, 0, 12).lineBetween(-8, 0, 0, 12).lineBetween(8, 0, 0, 12)
    g.fillStyle(0xffffff, 1).fillRect(-7, -2, 14, 4)
    this.bubble.until = this.time.now + ms
    g.setVisible(true); t.setVisible(true)
  }

  updateBubble() {
    const bb = this.bubble
    if (!bb) return
    if (this.time.now > bb.until) { bb.g.setVisible(false); bb.t.setVisible(false); return }
    const x = this.player.x, y = this.player.y - this.player.displayHeight * 0.86 - 14
    bb.g.setPosition(x, y).setDepth(1e8)
    bb.t.setPosition(x, y - bb.t.height / 2 - 7).setDepth(1e8 + 1)
  }

  tryMove(dU, dV, dirU, dirV) {
    const hit = this.col.probe(this.U + dU, this.V + dV)
    if (hit.boxes.size) for (const id of hit.boxes) this.kick(id, dirU, dirV)
    if (!hit.wall) { this.U += dU; this.V += dV; return true }
    // desliza pelas paredes, um eixo por vez
    if (dU && !this.col.probe(this.U + dU, this.V).wall) { this.U += dU; return true }
    if (dV && !this.col.probe(this.U, this.V + dV).wall) { this.V += dV; return true }
    return false
  }

  update(_, delta) {
    if (this.paused) return
    const dt = delta / 1000
    let mU = 0, mV = 0, dirSign = 1
    this.dataset?.update(dt)

    if (this.agent.enabled) {
      if (['up', 'down', 'left', 'right'].some((k) => this.held(k))) this.toggleAI(false)      // tecla assume o controle
    }
    if (this.agent.enabled) {
      this.model?.request()
      this.lastDets = this.detections()
      const cmd = this.agent.step(dt, this.time.now, this.lastDets)
      if (cmd) {
        mU = cmd.mU; mV = cmd.mV
        if (mU || mV) {                       // vira o sprite para o eixo dominante
          const f = Math.abs(mV) >= Math.abs(mU) ? (mV > 0 ? 0 : 2) : (mU > 0 ? 1 : 3)
          if (f !== this.facing) { this.facing = f; this.refreshSprite() }
        }
      }
      this.drawOverlay()
    } else if (this.chairMode) {
      // ◀ ▶ giram 90° (um toque), ▲ ▼ avançam e recuam
      for (const side of ['left', 'right']) {
        const down = this.held(side)
        if (down && !this.turnLock[side]) this.turn(side === 'right' ? 1 : -1)
        this.turnLock[side] = down
      }
      const f = DIRS[this.facing]
      const dir = (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0)
      mU = f.dU * dir; mV = f.dV * dir; dirSign = dir || 1
    } else {
      // direto: cada seta anda numa direção isométrica (NW, NE, SE, SW)
      const dirMap = { up: 2, right: 3, down: 0, left: 1 }
      const active = Object.keys(dirMap).filter((k) => this.held(k))
      for (const k of active) { const f = DIRS[dirMap[k]]; mU += f.dU; mV += f.dV }
      if (active.length) {
        const last = dirMap[active[active.length - 1]]
        if (last !== this.facing) { this.facing = last; this.refreshSprite() }
      }
    }

    let moved = false
    if (mU || mV) {
      const len = Math.hypot(mU, mV)
      moved = this.tryMove((mU / len) * SPEED * dt, (mV / len) * SPEED * dt, mU, mV)
    }

    // braço empurrando a roda
    if (moved) {
      this.animT += delta * dirSign
      const n = ((Math.floor(this.animT / FRAME_MS) % 4) + 4) % 4
      if (n !== this.frame) { this.frame = n; this.refreshSprite() }
    } else if (this.frame !== 0) {
      this.frame = 0; this.refreshSprite()
    }

    const p = this.worldPos()
    this.player.setPosition(p.x, p.y).setDepth(p.y)
    this.updateBubble()
    this.checkMissions()
  }
}
