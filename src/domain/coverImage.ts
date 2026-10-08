import type { CSSProperties } from 'react'

export const MAX_COVER_URL_LENGTH = 2048

/**
 * Valida la URL de la imagen de fondo de un tablero. Vacía → null (sin fondo).
 * Solo https: evita contenido mixto y esquemas como javascript: o data:.
 */
export function normalizeCoverUrl(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('La imagen de fondo debe ser una URL completa (https://…).')
  }
  if (url.protocol !== 'https:') {
    throw new Error('La imagen de fondo debe usar https://.')
  }
  const normalized = url.href
  if (normalized.length > MAX_COVER_URL_LENGTH) {
    throw new Error('La URL de la imagen es demasiado larga.')
  }
  return normalized
}

/**
 * Variable CSS --board-cover con la imagen. JSON.stringify deja la URL como
 * cadena entre comillas con todo escapado: no puede cerrar url() ni inyectar CSS.
 */
export function coverStyle(url: string | null | undefined): CSSProperties | undefined {
  if (!url) return undefined
  return { '--board-cover': `url(${JSON.stringify(url)})` } as CSSProperties
}
