import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { supabase } from '../lib/supabase'
import { applyPatch, diffModels, type LivePatch } from '../domain/uml/liveSync'
import type { VisualModel } from '../domain/uml/visualModel'
import type { Diagram } from '../services/diagrams'

export type LivePeer = { key: string; name: string; color: string; selection: string | null }

const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d']
const colorFor = (seed: string) => PALETTE[[...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length]
const THROTTLE_MS = 120

type Options = {
  diagram: Diagram
  userId: string
  userName: string
  /** Solo quien puede editar envía cambios (los lectores solo ven y aparecen como presentes). */
  canEdit: boolean
}

/**
 * Colaboración en vivo de un diagrama con Supabase Realtime (canal privado:
 * solo los participantes del tablero pueden conectarse; ver migración
 * 20261012090000). Envía solo lo que cambió y mantiene la presencia.
 */
export function useDiagramLive({ diagram, userId, userName, canEdit }: Options) {
  const [peers, setPeers] = useState<LivePeer[]>([])
  const [remotePatch, setRemotePatch] = useState<{ patch: LivePatch; stamp: number } | null>(null)
  const [remoteSaved, setRemoteSaved] = useState<Diagram | null>(null)
  const [remoteSource, setRemoteSource] = useState<{ source: string; from: string; stamp: number } | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastSent = useRef<VisualModel | null>(null)
  const pending = useRef<VisualModel | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selection = useRef<string | null>(null)
  const presence = useRef({ name: userName, color: colorFor(userId), selection: null as string | null })

  useEffect(() => {
    // Identifica esta pestaña en la presencia (una misma persona puede abrir varias).
    const clientKey = `${userId}:${crypto.randomUUID().slice(0, 8)}`
    const channel = supabase.channel(`diagram:${diagram.id}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: clientKey } },
    })
    channelRef.current = channel
    const syncPeers = () => {
      const state = channel.presenceState<{ name: string; color: string; selection: string | null }>()
      setPeers(
        Object.entries(state)
          .filter(([key]) => key !== clientKey)
          .map(([key, entries]) => ({ key, name: entries[0]?.name ?? 'Alguien', color: entries[0]?.color ?? '#64748b', selection: entries[0]?.selection ?? null })),
      )
    }
    channel
      .on('presence', { event: 'sync' }, syncPeers)
      .on('broadcast', { event: 'patch' }, ({ payload }) => {
        const patch = payload.patch as LivePatch
        // Lo recibido también es la nueva base: el próximo envío solo lleva lo propio.
        if (lastSent.current) lastSent.current = applyPatch(lastSent.current, patch)
        setRemotePatch({ patch, stamp: Date.now() })
      })
      .on('broadcast', { event: 'saved' }, ({ payload }) => setRemoteSaved(payload.diagram as Diagram))
      .on('broadcast', { event: 'source' }, ({ payload }) => setRemoteSource({ source: payload.source as string, from: payload.from as string, stamp: Date.now() }))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track(presence.current)
      })
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (sourceTimer.current) clearTimeout(sourceTimer.current)
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [diagram.id, userId])

  /** Envía el modelo propio (solo las diferencias), como mucho cada 120 ms. */
  const publishModel = useCallback((model: VisualModel) => {
    if (!canEdit) return
    pending.current = model
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      const next = pending.current
      const channel = channelRef.current
      if (!next || !channel) return
      const patch = lastSent.current ? diffModels(lastSent.current, next) : { replace: next }
      lastSent.current = next
      if (patch) void channel.send({ type: 'broadcast', event: 'patch', payload: { patch } })
    }, THROTTLE_MS)
  }, [canEdit])

  /** Punto de partida común (al abrir o tras guardar): los envíos posteriores son diferencias sobre él. */
  const setBaseline = useCallback((model: VisualModel) => {
    lastSent.current = model
  }, [])

  const publishSelection = useCallback((id: string | null) => {
    if (selection.current === id) return
    selection.current = id
    presence.current = { ...presence.current, selection: id }
    void channelRef.current?.track(presence.current)
  }, [])

  const publishSaved = useCallback((saved: Diagram) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'saved', payload: { diagram: saved } })
  }, [])

  /** Modo código: comparte el texto completo (el último en escribir gana), como mucho cada 250 ms. */
  const publishSource = useCallback((source: string) => {
    if (!canEdit) return
    if (sourceTimer.current) clearTimeout(sourceTimer.current)
    sourceTimer.current = setTimeout(() => {
      void channelRef.current?.send({ type: 'broadcast', event: 'source', payload: { source, from: presence.current.name } })
    }, 250)
  }, [canEdit])

  return { peers, remotePatch, remoteSaved, remoteSource, publishModel, setBaseline, publishSelection, publishSaved, publishSource }
}
