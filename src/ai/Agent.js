import { Planner } from './Planner.js'
import { MISSIONS } from '../missions.js'
import { S } from '../iso.js'

// Agente do "Modo IA": olha as detecções, planeja o caminho e anda sozinho.
export class Agent {
  constructor(scene) {
    this.s = scene
    this.planner = new Planner(scene.col)
    this.enabled = false
    this.path = null
    this.idx = 0
    this.nextPlan = 0
    this.goal = null
    this.probeT = 0
    this.probePos = [0, 0]
    this.detour = 0
    this.detourDir = [0, 0]
  }

  start() { this.enabled = true; this.path = null; this.nextPlan = 0 }
  stop() { this.enabled = false; this.path = null }

  worldToUV(x, y) {
    const sx = x + this.s.off.x, sy = y + this.s.off.y
    return [sy - S * sx, sy + S * sx]
  }

  // detecções -> custos na grade: caixa custa (chute), pessoa bloqueia
  extraFromDetections(dets) {
    const col = this.s.col, extra = new Map(), mark = (U, V, v) => {
      const [i, j] = col.cell(U, V); const k = i * 100 + j
      if (extra.get(k) !== Infinity) extra.set(k, v)
    }
    for (const d of dets) {
      if (d.cls === 'caixa') {
        for (let x = d.x; x <= d.x + d.w; x += 8) for (let y = d.y + d.h * 0.45; y <= d.y + d.h; y += 8) mark(...this.worldToUV(x, y), 6)
      } else if (d.cls === 'pessoa') {
        const [U, V] = this.worldToUV(d.x + d.w / 2, d.y + d.h - 4)
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) mark(U + a * col.d.C, V + b * col.d.C, Infinity)
      }
    }
    return extra
  }

  nextMission() { return MISSIONS.find((m) => !this.s.done.has(m.id)) }

  // devolve { mU, mV } ou null
  step(dt, now, dets) {
    const m = this.nextMission()
    if (!m) return null
    if (m.id !== this.goal) { this.goal = m.id; this.path = null }
    const s = this.s
    const here = [s.U, s.V]

    if (!this.path || now > this.nextPlan) {
      const t = s.data0.targets[m.id]
      const p = this.planner.plan(here, [t.u, t.v], this.extraFromDetections(dets))
      this.path = p; this.idx = 0; this.nextPlan = now + 1200
      if (!p) return null
    }
    // trava? tenta um desvio curto na lateral
    this.probeT += dt
    if (this.probeT > 0.7) {
      const moved = Math.hypot(here[0] - this.probePos[0], here[1] - this.probePos[1])
      if (moved < 8) { this.detour = 0.5; const a = Math.random() * Math.PI * 2; this.detourDir = [Math.cos(a), Math.sin(a)]; this.nextPlan = 0 }
      this.probePos = here; this.probeT = 0
    }
    if (this.detour > 0) { this.detour -= dt; return { mU: this.detourDir[0], mV: this.detourDir[1] } }

    while (this.idx < this.path.length - 1 && Math.hypot(this.path[this.idx][0] - here[0], this.path[this.idx][1] - here[1]) < 14) this.idx++
    const [wu, wv] = this.path[this.idx]
    const du = wu - here[0], dv = wv - here[1]
    const len = Math.hypot(du, dv)
    if (len < 4) return { mU: 0, mV: 0 }
    return { mU: du / len, mV: dv / len }
  }
}
