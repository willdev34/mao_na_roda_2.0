// Worker de visão: YOLOv5n convertido para TensorFlow.js (mesmo caminho do jogo do pato).
import * as tf from '@tensorflow/tfjs'

const SIZE = 640
const CONF = 0.4, IOU = 0.5
let model = null, classes = []

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    await tf.setBackend('webgl'); await tf.ready()
    model = await tf.loadGraphModel(data.url)
    classes = data.classes
    // aquecimento: a primeira inferência é lenta
    tf.tidy(() => model.execute(tf.zeros([1, SIZE, SIZE, 3])))
    postMessage({ type: 'ready' })
    return
  }
  if (data.type !== 'predict' || !model) { data.image?.close(); return }
  const { image, cam } = data
  const input = tf.tidy(() => {
    const t = tf.browser.fromPixels(image)
    return tf.image.resizeBilinear(t, [SIZE, SIZE]).div(255).expandDims(0)
  })
  const raw = await model.executeAsync(input)
  const out = Array.isArray(raw) ? raw[0] : raw
  const arr = await out.array()                                  // [1, N, 5 + nc]
  tf.dispose([input, raw])
  const items = decode(arr[0], image.width, image.height, cam)
  image.close()
  postMessage({ type: 'detections', items })
}

function decode(rows, W, H, cam) {
  const boxes = []
  for (const r of rows) {
    const obj = r[4]
    if (obj < CONF) continue
    let best = 0, bs = 0
    for (let c = 5; c < r.length; c++) if (r[c] > bs) { bs = r[c]; best = c - 5 }
    const conf = obj * bs
    if (conf < CONF) continue
    // o export do YOLOv5 para tfjs entrega xywh normalizado (0..1); aceita pixels também
    const norm = Math.max(r[0], r[1], r[2], r[3]) <= 2
    const sx = norm ? W : W / SIZE, sy = norm ? H : H / SIZE
    const w = r[2] * sx, h = r[3] * sy
    boxes.push({ cls: classes[best], conf, x: r[0] * sx - w / 2, y: r[1] * sy - h / 2, w, h })
  }
  boxes.sort((a, b) => b.conf - a.conf)
  const keep = []
  for (const b of boxes) if (keep.every((k) => k.cls !== b.cls || iou(k, b) < IOU)) keep.push(b)
  // tela -> mundo
  return keep.map((b) => ({ ...b, x: cam.x + b.x / cam.zoom, y: cam.y + b.y / cam.zoom, w: b.w / cam.zoom, h: b.h / cam.zoom }))
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}
