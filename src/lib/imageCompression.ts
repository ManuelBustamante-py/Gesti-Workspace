// Comprime imágenes en el navegador antes de subirlas: reduce el lado mayor y
// las convierte a WebP (o JPEG si el navegador no sabe generar WebP, como
// algunas versiones de Safari). Así cada adjunto pesa decenas o cientos de KB.

export const MAX_IMAGE_DIMENSION = 1600
export const MAX_IMAGE_BYTES = 1024 * 1024 // Igual que el límite del bucket.
export const MAX_ATTACHMENTS = 4
const QUALITY_STEPS = [0.82, 0.72, 0.6, 0.5]

export type CompressedImage = {
  blob: Blob
  type: 'image/webp' | 'image/jpeg'
  width: number
  height: number
}

/** Escala (ancho, alto) para que el lado mayor no supere `max`, sin agrandar. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_DIMENSION) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

async function decode(file: File) {
  try {
    // Respeta la orientación EXIF de las fotos de móvil.
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`«${file.name}» no es una imagen que el navegador pueda abrir.`)
  }
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`«${file.name}» no es una imagen.`)
  }

  const bitmap = await decode(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no permite procesar imágenes.')
  // Fondo blanco para que las transparencias no queden negras en JPEG.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  for (const quality of QUALITY_STEPS) {
    let blob = await canvasToBlob(canvas, 'image/webp', quality)
    // toBlob devuelve PNG cuando no soporta WebP: se usa JPEG en su lugar.
    if (!blob || blob.type !== 'image/webp') {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    }
    if (blob && blob.size <= MAX_IMAGE_BYTES) {
      return { blob, type: blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg', width, height }
    }
  }

  throw new Error(`«${file.name}» sigue pesando más de ${formatBytes(MAX_IMAGE_BYTES)} tras comprimirla.`)
}
