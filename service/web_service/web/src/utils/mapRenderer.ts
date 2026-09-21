export type MapIcon = { type?: number; x?: number; z?: number; direction?: number; displayName?: string }
export type MosaicRegion = { x: number; y: number; width: number; height: number }

// Minecraft map color IDs use four brightness variants for each base color.
const baseColors = [0x000000, 0x7fb238, 0xf7e9a3, 0xc7c7c7, 0xff0000, 0xa0a0ff, 0xa7a7a7, 0x007c00, 0xffffff, 0xa4a8b8, 0x976d4d, 0x707070, 0x4040ff, 0x8f7748, 0xfffcf5, 0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19, 0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919, 0xfaee4d, 0x5cdbd5, 0x4a80ff, 0x00d93a, 0x815631, 0x700200, 0xd1b1a1, 0x9f5224, 0x95576c, 0x706c8a, 0xba8524, 0x677535, 0xa04d4e, 0x392923, 0x876b62, 0x575c5c, 0x7a4958, 0x4c3e5c, 0x4c3223, 0x4c522a, 0x8e3c2e, 0x251610, 0xbd3031, 0x943f61, 0x5c191d, 0x167e86, 0x3a8e8c, 0x562c3e, 0x14b485, 0x646464, 0xd8af93, 0x7fa796, 0]
const brightness = [180, 220, 255, 135]

export function decodeMapPixels(base64: string) {
  const decoded = atob(base64)
  const pixels = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++) pixels[index] = decoded.charCodeAt(index)
  if (pixels.length !== 128 * 128) throw new Error('地图像素数据不完整')
  return pixels
}

function color(id: number): [number, number, number, number] {
  if (!id) return [0, 0, 0, 0]
  const rgb = baseColors[Math.floor(id / 4)] || 0
  const factor = (brightness[id & 3] ?? 255) / 255
  return [Math.round(((rgb >> 16) & 255) * factor), Math.round(((rgb >> 8) & 255) * factor), Math.round((rgb & 255) * factor), 255]
}

export function mapCanvas(
  base64: string,
  icons: MapIcon[] = [],
  scale = 2,
  mosaic = false,
  mosaicRegions: MosaicRegion[] = [],
) {
  const pixels = decodeMapPixels(base64)
  const source = document.createElement('canvas')
  source.width = 128; source.height = 128
  const context = source.getContext('2d')!
  const image = context.createImageData(128, 128)
  for (let index = 0; index < pixels.length; index++) {
    const [red, green, blue, alpha] = color(pixels[index] ?? 0)
    image.data.set([red, green, blue, alpha], index * 4)
  }
  context.putImageData(image, 0, 0)
  if (mosaic) {
    const mosaicSource = document.createElement('canvas')
    mosaicSource.width = 16; mosaicSource.height = 16
    const mosaicContext = mosaicSource.getContext('2d')!
    mosaicContext.imageSmoothingEnabled = false
    mosaicContext.drawImage(source, 0, 0, 16, 16)
    context.clearRect(0, 0, 128, 128)
    context.imageSmoothingEnabled = false
    context.drawImage(mosaicSource, 0, 0, 128, 128)
  }
  const canvas = document.createElement('canvas')
  canvas.width = 128 * scale; canvas.height = 128 * scale
  const output = canvas.getContext('2d')!
  output.imageSmoothingEnabled = false
  output.drawImage(source, 0, 0, canvas.width, canvas.height)
  output.fillStyle = '#ef4444'; output.strokeStyle = '#fff'; output.lineWidth = Math.max(1, scale)
  for (const icon of icons) {
    if (typeof icon.x !== 'number' || typeof icon.z !== 'number') continue
    const x = Math.round((icon.x + 128) / 2) * scale
    const y = Math.round((icon.z + 128) / 2) * scale
    output.beginPath(); output.arc(x, y, Math.max(2, scale * 2), 0, Math.PI * 2); output.fill(); output.stroke()
  }
  for (const region of mosaicRegions) {
    const x = Math.max(0, Math.round(region.x * scale))
    const y = Math.max(0, Math.round(region.y * scale))
    const width = Math.min(canvas.width - x, Math.max(1, Math.round(region.width * scale)))
    const height = Math.min(canvas.height - y, Math.max(1, Math.round(region.height * scale)))
    if (width <= 0 || height <= 0) continue
    const pixels = Math.max(1, Math.min(16, Math.floor(Math.min(width, height) / 8)))
    const mosaicSource = document.createElement('canvas')
    mosaicSource.width = pixels; mosaicSource.height = pixels
    const mosaicContext = mosaicSource.getContext('2d')!
    mosaicContext.imageSmoothingEnabled = false
    mosaicContext.drawImage(canvas, x, y, width, height, 0, 0, pixels, pixels)
    output.imageSmoothingEnabled = false
    output.drawImage(mosaicSource, 0, 0, pixels, pixels, x, y, width, height)
  }
  return canvas
}

export function mergeMapCanvases(
  items: Array<{ base64: string; icons?: MapIcon[]; x: number; y: number; rotation?: number; mirror?: boolean }>,
  scale = 2,
  mosaicRegions: MosaicRegion[] = [],
) {
  const minX = Math.min(...items.map(item => item.x)), maxX = Math.max(...items.map(item => item.x))
  const minY = Math.min(...items.map(item => item.y)), maxY = Math.max(...items.map(item => item.y))
  const canvas = document.createElement('canvas')
  canvas.width = (maxX - minX + 1) * 128 * scale; canvas.height = (maxY - minY + 1) * 128 * scale
  const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false
  for (const item of items) {
    const tile = mapCanvas(item.base64, item.icons, scale)
    const x = (item.x - minX) * 128 * scale, y = (item.y - minY) * 128 * scale
    const rotation = 'rotation' in item && typeof item.rotation === 'number' ? item.rotation : 0
    context.save()
    context.translate(x + tile.width / 2, y + tile.height / 2)
    context.rotate(rotation * Math.PI / 180)
    if (item.mirror) context.scale(-1, 1)
    context.drawImage(tile, -tile.width / 2, -tile.height / 2)
    context.restore()
  }
  for (const region of mosaicRegions) {
    const x = Math.max(0, Math.round(region.x * scale))
    const y = Math.max(0, Math.round(region.y * scale))
    const width = Math.min(canvas.width - x, Math.max(1, Math.round(region.width * scale)))
    const height = Math.min(canvas.height - y, Math.max(1, Math.round(region.height * scale)))
    if (width <= 0 || height <= 0) continue
    const pixels = Math.max(1, Math.min(16, Math.floor(Math.min(width, height) / 8)))
    const source = document.createElement('canvas')
    source.width = pixels; source.height = pixels
    const sourceContext = source.getContext('2d')!
    sourceContext.imageSmoothingEnabled = false
    sourceContext.drawImage(canvas, x, y, width, height, 0, 0, pixels, pixels)
    context.imageSmoothingEnabled = false
    context.drawImage(source, 0, 0, pixels, pixels, x, y, width, height)
  }
  return canvas
}
