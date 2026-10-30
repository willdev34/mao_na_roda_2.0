// Busca de caminho (A*) na grade de celulas do escritório.
// Caixas custam mais (o cadeirante precisa chutar), pessoas e móveis bloqueiam.
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

export class Planner {
  constructor(col) {
    this.col = col
    const { nu, nv, u0, v0, C } = col.d
    this.nu = nu; this.nv = nv
    // célula só é livre se o cadeirante inteiro cabe nela
    this.free = Array.from({ length: nu }, (_, i) =>
      Array.from({ length: nv }, (_, j) => !col.probe(u0 + (i + 0.5) * C, v0 + (j + 0.5) * C).wall))
  }

  cellOf(U, V) { return this.col.cell(U, V) }

  center(i, j) {
    const { u0, v0, C } = this.col.d
    return [u0 + (i + 0.5) * C, v0 + (j + 0.5) * C]
  }

  // extra: Map "i,j" -> custo adicional (caixas) ou Infinity (pessoas)
  plan(from, to, extra) {
    const [si, sj] = this.cellOf(...from)
    let [gi, gj] = this.cellOf(...to)
    if (!this.free[gi]?.[gj]) {                       // acha a célula livre mais próxima do alvo
      let best = null
      for (let i = 0; i < this.nu; i++) for (let j = 0; j < this.nv; j++) {
        if (!this.free[i][j]) continue
        const d = Math.hypot(i - gi, j - gj)
        if (!best || d < best.d) best = { i, j, d }
      }
      if (!best) return null
      gi = best.i; gj = best.j
    }
    const key = (i, j) => i * 100 + j
    const g = new Map([[key(si, sj), 0]]), prev = new Map(), open = [[0, si, sj]], closed = new Set()
    const h = (i, j) => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy) }
    while (open.length) {
      open.sort((a, b) => a[0] - b[0])
      const [, i, j] = open.shift()
      const k = key(i, j)
      if (closed.has(k)) continue
      closed.add(k)
      if (i === gi && j === gj) {
        const path = [[i, j]]
        let c = k
        while (prev.has(c)) { c = prev.get(c); path.push([Math.floor(c / 100), c % 100]) }
        return path.reverse().map(([a, b]) => this.center(a, b))
      }
      for (const [di, dj] of N8) {
        const ni = i + di, nj = j + dj
        if (ni < 0 || nj < 0 || ni >= this.nu || nj >= this.nv) continue
        if (!this.free[ni][nj] && !extra?.has(key(ni, nj))) continue
        if (di && dj && (!this.free[i + di][j] || !this.free[i][j + dj])) continue   // não corta quina
        const add = extra?.get(key(ni, nj)) ?? 0
        if (add === Infinity) continue
        const ng = g.get(k) + (di && dj ? 1.41 : 1) + add
        if (ng < (g.get(key(ni, nj)) ?? Infinity)) {
          g.set(key(ni, nj), ng); prev.set(key(ni, nj), k)
          open.push([ng + h(ni, nj), ni, nj])
        }
      }
    }
    return null
  }
}
