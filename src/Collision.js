// Grade de colisao em celulas de meio ladrilho, no espaco (U, V).
// Alem das paredes e moveis fixos, caixas chutaveis ocupam celulas proprias.
export class Collision {
  constructor(data, boxes) {
    this.d = data
    this.rows = data.blocked
    this.boxAt = new Map()                     // "i,j" -> id da caixa
    for (const [id, b] of Object.entries(boxes)) {
      for (const [i, j] of b.cells) this.boxAt.set(`${i},${j}`, id)
    }
  }

  cell(U, V) {
    const { u0, v0, C } = this.d
    return [Math.floor((U - u0) / C), Math.floor((V - v0) / C)]
  }

  wallCell(i, j) {
    const { nu, nv } = this.d
    if (i < 0 || j < 0 || i >= nu || j >= nv) return true
    return this.rows[i][j] === '1'
  }

  freeBox(id) {
    for (const [k, v] of this.boxAt) if (v === id) this.boxAt.delete(k)
  }

  // Testa a pegada do cadeirante (4 cantos). Retorna { wall, boxes }
  probe(U, V, r = 8) {
    const out = { wall: false, boxes: new Set() }
    for (const [dU, dV] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const [i, j] = this.cell(U + dU, V + dV)
      if (this.wallCell(i, j)) out.wall = true
      const b = this.boxAt.get(`${i},${j}`)
      if (b) out.boxes.add(b)
    }
    return out
  }
}
