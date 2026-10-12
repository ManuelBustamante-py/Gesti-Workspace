/**
 * Normalización de nombres para proponer correspondencias entre diagramas.
 * No decide identidades: produce términos comparables (sin tildes, en
 * singular, con sinónimos español/inglés unificados) y separa los términos de
 * rol técnico (controller, service, view…) de los de dominio.
 */

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'a', 'al', 'un', 'una', 'para', 'por', 'con', 'the', 'of', 'and', 'for', 'to', 'an', 'se', 'su', 'sus'])

/**
 * Sinónimos frecuentes: cada término se lleva a una forma canónica.
 * Ampliable: solo debe incluir equivalencias de uso general, no del dominio
 * de un proyecto (esas se confirman como equivalencias en la configuración).
 */
const SYNONYMS: Record<string, string> = {
  user: 'usuario', usuaria: 'usuario',
  customer: 'cliente', client: 'cliente',
  order: 'pedido', orden: 'pedido',
  product: 'producto', item: 'articulo',
  board: 'tablero', task: 'tarea', column: 'columna', comment: 'comentario',
  payment: 'pago', invoice: 'factura', cart: 'carrito', account: 'cuenta',
  server: 'servidor', database: 'basedatos', db: 'basedatos', bd: 'basedatos',
  controller: 'controlador', ctrl: 'controlador',
  service: 'servicio', repository: 'repositorio', repo: 'repositorio',
  view: 'vista', screen: 'pantalla', page: 'pagina', form: 'formulario',
  model: 'modelo', manager: 'gestor', handler: 'manejador',
  login: 'sesion', session: 'sesion', auth: 'autenticacion', authentication: 'autenticacion',
  notification: 'notificacion', message: 'mensaje', report: 'reporte', informe: 'reporte',
  member: 'miembro', project: 'proyecto', team: 'equipo', file: 'archivo', document: 'documento',
  create: 'crear', add: 'agregar', anadir: 'agregar', register: 'registrar', update: 'actualizar', edit: 'editar',
  modificar: 'editar', delete: 'eliminar', remove: 'eliminar', borrar: 'eliminar', get: 'obtener', find: 'buscar',
  search: 'buscar', list: 'listar', save: 'guardar', send: 'enviar', pay: 'pagar', buy: 'comprar',
}

/** Términos de rol técnico (capa o patrón), ya canónicos. */
export const ROLE_TERMS = new Set(['controlador', 'servicio', 'repositorio', 'dao', 'vista', 'pantalla', 'pagina', 'formulario', 'modelo', 'gestor', 'manejador', 'impl', 'ui', 'api', 'dto', 'entidad', 'entity'])

/** Verbos habituales en casos de uso: no identifican conceptos del dominio. */
export const ACTION_TERMS = new Set([
  'crear', 'registrar', 'agregar', 'editar', 'actualizar', 'eliminar', 'consultar', 'ver', 'buscar', 'listar', 'gestionar',
  'administrar', 'manejar', 'iniciar', 'cerrar', 'pagar', 'comprar', 'generar', 'enviar', 'asignar', 'mover', 'exportar',
  'importar', 'invitar', 'aprobar', 'rechazar', 'comentar', 'obtener', 'guardar', 'validar', 'cancelar', 'revisar',
  'descargar', 'subir', 'cargar', 'mostrar', 'seleccionar', 'confirmar', 'solicitar', 'recibir', 'procesar', 'notificar',
  'compartir', 'configurar', 'definir', 'calcular', 'imprimir', 'recuperar', 'cambiar', 'completar', 'realizar',
])

/** Palabras que describen el diagrama, no su contenido («Diagrama de secuencia: Login»). */
const DIAGRAM_WORDS = new Set(['diagrama', 'secuencia', 'sequence', 'flujo', 'escenario', 'caso', 'uso', 'cu', 'uc', 'diagram', 'scenario', 'interaccion'])

export function stripAccents(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Texto principal de un nombre: sin estereotipos, sin tecnología entre corchetes, sin extensión de archivo. */
export function baseName(name: string) {
  return name
    .split('\n')[0]
    .replace(/<<[^>]*>>|«[^»]*»/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\.(jar|war|ear|js|mjs|ts|exe|dll|zip|py|apk|ipa|html|sql|bin|so|dockerfile|tar|gz)\b/gi, ' ')
    .trim()
}

/**
 * Separa el detalle entre paréntesis (tecnología, descripción) del nombre:
 * «AlertController (Express)» → «AlertController» + «express».
 */
export function splitQualifier(name: string) {
  const base = baseName(name)
  const qualifiers = [...base.matchAll(/\(([^)]*)\)/g)].map((match) => match[1])
  const core = base.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  return { core: core || base, qualifier: stripAccents(qualifiers.join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
}

/** Forma comparable de un nombre completo: «Base de Datos» → «base de datos». */
export function normalizeName(name: string) {
  return stripAccents(baseName(name)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Raíz comparable (no es una lematización): lo que importa es que singular y
 * plural den lo mismo. «servidor/servidores», «detalle/detalles» y
 * «red/redes» coinciden porque se quita la -s final y una -e tras r, l, n o d.
 */
function stem(word: string) {
  if (word.length <= 3 || /\d/.test(word)) return word
  let value = word
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`
  if (value.endsWith('s') && !/(ss|us|is)$/.test(value)) value = value.slice(0, -1)
  if (value.length > 3 && /[rlnd]e$/.test(value)) value = value.slice(0, -1)
  return value
}

/** Términos canónicos de un nombre: «TaskService» → [tarea, servicio]. */
export function terms(name: string): string[] {
  const words = stripAccents(baseName(name))
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const result: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    // «base de datos» es un solo concepto.
    if (word === 'base' && words[index + 1] === 'de' && words[index + 2] === 'datos') {
      result.push('basedatos')
      index += 2
      continue
    }
    if (STOPWORDS.has(word)) continue
    const root = stem(word)
    result.push(SYNONYMS[word] ?? SYNONYMS[root] ?? root)
  }
  return result
}

export const domainTerms = (name: string) => terms(name).filter((term) => !ROLE_TERMS.has(term))
export const subjectTerms = (name: string) => terms(name).filter((term) => !DIAGRAM_WORDS.has(term))

export function sameTermSet(a: string[], b: string[]) {
  const left = new Set(a)
  const right = new Set(b)
  return left.size > 0 && left.size === right.size && [...left].every((term) => right.has(term))
}

export function jaccard(a: string[], b: string[]) {
  const left = new Set(a)
  const right = new Set(b)
  if (!left.size || !right.size) return 0
  const shared = [...left].filter((term) => right.has(term)).length
  return shared / new Set([...left, ...right]).size
}

/** Nombre de operación comparable: «agregar_tarea», «agregarTarea» y «AgregarTarea» son iguales. */
export const operationKey = (name: string) => terms(name).join(' ')

/** Tipo comparable: «List<Tarea>», «Tarea[]» y «tareas» no se igualan; solo se limpian espacios y mayúsculas. */
export const typeKey = (type: string) => stripAccents(type).replace(/\s+/g, '').toLowerCase()

export const quote = (text: string) => `«${text.replace(/\s*\n\s*/g, ' ').trim() || 'sin nombre'}»`
export const listText = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
