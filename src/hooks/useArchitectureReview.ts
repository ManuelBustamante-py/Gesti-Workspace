import { useCallback, useEffect, useMemo, useState } from 'react'

import { defaultSettings, evaluateArchitecture, type ArchitectureSettings, type DiagramInput } from '../domain/uml/coherence'
import { getArchitectureSettings, saveArchitectureSettings } from '../services/architectureSettings'
import { listDiagramsForAnalysis } from '../services/diagrams'

/**
 * Evaluación de coherencia de un tablero: carga los diagramas con su contenido
 * y la configuración, y calcula el informe en el navegador (determinista).
 */
export function useArchitectureReview(boardId: string | undefined, canEdit: boolean) {
  const [diagrams, setDiagrams] = useState<DiagramInput[] | null>(null)
  const [settings, setSettings] = useState<ArchitectureSettings>(defaultSettings)
  const [settingsAvailable, setSettingsAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    if (!boardId) return
    try {
      const [rows, stored] = await Promise.all([listDiagramsForAnalysis(boardId), getArchitectureSettings(boardId)])
      setDiagrams(rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, mode: row.mode, source: row.source ?? '', model: row.model })))
      setSettings(stored.settings)
      setSettingsAvailable(stored.available)
      setLoadedAt(new Date())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los diagramas para analizarlos.')
    } finally {
      setLoading(false)
    }
  }, [boardId])

  useEffect(() => {
    void load()
  }, [load])

  const reload = useCallback(() => {
    setLoading(true)
    void load()
  }, [load])

  const report = useMemo(() => (diagrams ? evaluateArchitecture(diagrams, settings) : null), [diagrams, settings])

  /** Aplica el cambio de inmediato (el análisis se recalcula) y lo guarda si se puede. */
  const updateSettings = useCallback(
    async (next: ArchitectureSettings) => {
      const previous = settings
      setSettings(next)
      setSaveError('')
      if (!canEdit || !boardId) return
      if (!settingsAvailable) {
        setSaveError('La configuración se aplicó solo en esta sesión: falta la migración 20261012120000_board_architecture_settings.sql.')
        return
      }
      setSaving(true)
      try {
        setSettings(await saveArchitectureSettings(boardId, next))
      } catch (err) {
        setSettings(previous)
        setSaveError(err instanceof Error ? err.message : 'No se pudo guardar la configuración.')
      } finally {
        setSaving(false)
      }
    },
    [boardId, canEdit, settings, settingsAvailable],
  )

  return { report, diagrams, settings, settingsAvailable, loading, error, saveError, saving, loadedAt, reload, updateSettings }
}
