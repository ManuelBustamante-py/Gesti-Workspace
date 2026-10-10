import type { LivePatch } from '../../domain/uml/liveSync'
import type { VisualModel } from '../../domain/uml/visualModel'
import type { LivePeer } from '../../hooks/useDiagramLive'
import type { Diagram } from '../../services/diagrams'

/** Lo que los editores reciben de la colaboración en vivo (ver useDiagramLive). */
export type LiveConnection = {
  peers: LivePeer[]
  remotePatch: { patch: LivePatch; stamp: number } | null
  remoteSource: { source: string; from: string; stamp: number } | null
  publishModel: (model: VisualModel) => void
  setBaseline: (model: VisualModel) => void
  publishSelection: (id: string | null) => void
  publishSaved: (diagram: Diagram) => void
  publishSource: (source: string) => void
}
