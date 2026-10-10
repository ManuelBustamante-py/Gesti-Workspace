import { sanitizeSvg, svgSize } from '../domain/diagramSvg'

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadPlantUml(source: string, fileName: string) {
  downloadBlob(new Blob([source], { type: 'text/plain;charset=utf-8' }), fileName)
}

export function downloadSvg(svg: string, fileName: string) {
  downloadBlob(new Blob([sanitizeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }), fileName)
}

/** PNG al doble de resolución, con fondo blanco (el SVG de PlantUML puede ser transparente). */
export async function downloadPng(svg: string, fileName: string, scale = 2) {
  const { width, height } = svgSize(svg)
  const image = new Image()
  image.decoding = 'async'
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeSvg(svg))}`
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no permite generar la imagen PNG.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo generar la imagen PNG.')
  downloadBlob(blob, fileName)
}
