// Projecao isometrica verdadeira (30 graus).
// Mundo logico em (U, V). Tela: x = (V - U) / (2S), y = (U + V) / 2
export const S = Math.tan(Math.PI / 6)

export const toScreen = (U, V) => ({ x: (V - U) / (2 * S), y: (U + V) / 2 })

// Quatro direcoes em (dU, dV). Ordem horaria na tela: SE, SW, NW, NE
export const DIRS = [
  { name: 'se', dU: 0, dV: 1 },
  { name: 'sw', dU: 1, dV: 0 },
  { name: 'nw', dU: 0, dV: -1 },
  { name: 'ne', dU: -1, dV: 0 },
]
