// Interpreta descripciones largas (por ejemplo, historias de usuario pegadas
// desde una plantilla) en bloques legibles:
//   ▌TÍTULO  o  ## Título   → sección
//   ─────── o  ---           → separador (se omite)
//   • texto  o  - texto      → viñeta
//   1. texto                 → paso numerado
// Cualquier otra línea es un párrafo. Sin marcas, el texto se muestra tal cual.

export type DescriptionBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; number: string; text: string }

export type DescriptionSection = {
  title: string | null
  blocks: DescriptionBlock[]
}

const SECTION_PATTERN = /^\s*(?:▌|#{1,3}\s)\s*(.+)$/
const SEPARATOR_PATTERN = /^\s*(?:[─━—=_-]\s*){3,}$/
const BULLET_PATTERN = /^\s*[•·*-]\s+(.+)$/
const NUMBERED_PATTERN = /^\s*(\d{1,2})[.)]\s+(.+)$/

export function parseDescription(text: string): DescriptionSection[] {
  const sections: DescriptionSection[] = []
  let current: DescriptionSection = { title: null, blocks: [] }

  const pushCurrent = () => {
    if (current.title || current.blocks.length > 0) sections.push(current)
  }

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line || SEPARATOR_PATTERN.test(line)) continue

    const section = SECTION_PATTERN.exec(line)
    if (section) {
      pushCurrent()
      current = { title: section[1].trim(), blocks: [] }
      continue
    }

    const bullet = BULLET_PATTERN.exec(line)
    if (bullet) {
      current.blocks.push({ type: 'bullet', text: bullet[1].trim() })
      continue
    }

    const numbered = NUMBERED_PATTERN.exec(line)
    if (numbered) {
      current.blocks.push({ type: 'numbered', number: numbered[1], text: numbered[2].trim() })
      continue
    }

    const previous = current.blocks[current.blocks.length - 1]
    // Las líneas cortadas a mitad de frase continúan el bloque anterior.
    if (previous && previous.type !== 'paragraph' && /^[a-záéíóúñ(]/.test(line)) {
      previous.text = `${previous.text} ${line}`
      continue
    }
    current.blocks.push({ type: 'paragraph', text: line })
  }

  pushCurrent()
  return sections
}

export type RawSection = { title: string | null; body: string }

/** Divide el texto en secciones conservando las líneas originales (sin separadores). */
export function splitDescriptionSections(text: string): RawSection[] {
  const sections: Array<{ title: string | null; lines: string[] }> = []
  let current: { title: string | null; lines: string[] } = { title: null, lines: [] }

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (SEPARATOR_PATTERN.test(trimmed)) continue
    const section = SECTION_PATTERN.exec(trimmed)
    if (section) {
      sections.push(current)
      current = { title: section[1].trim(), lines: [] }
      continue
    }
    current.lines.push(line)
  }
  sections.push(current)

  return sections
    .map((section) => ({ title: section.title, body: section.lines.join('\n').trim() }))
    .filter((section) => section.title !== null || section.body !== '')
}

/** Inversa de splitDescriptionSections: texto libre inicial + secciones «▌Título». */
export function composeDescription(intro: string, sections: Array<[string, string]>) {
  return [
    intro.trim(),
    ...sections
      .filter(([, body]) => body.trim() !== '')
      .map(([title, body]) => `▌${title.trim()}\n${body.trim()}`),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Texto breve para la tarjeta: primeras líneas con contenido, sin títulos ni separadores. */
export function descriptionSummary(text: string, maxLength = 160) {
  const firstSection = parseDescription(text).find((section) => section.blocks.length > 0)
  const summary = (firstSection?.blocks ?? []).map((block) => block.text).join(' ')
  return summary.length > maxLength ? `${summary.slice(0, maxLength - 1).trimEnd()}…` : summary
}

/** Busca un valor corto dentro de una sección (p. ej. "Sprint" → "Sprint 1"). */
export function descriptionField(text: string, sectionTitle: string) {
  const section = parseDescription(text).find((item) =>
    item.title?.toLowerCase().startsWith(sectionTitle.toLowerCase()),
  )
  const firstBlock = section?.blocks[0]
  return firstBlock && firstBlock.text.length <= 40 ? firstBlock.text : null
}
