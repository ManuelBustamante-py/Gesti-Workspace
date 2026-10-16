import { roleEmotes, roleLabels } from '../../domain/roles'
import type { BoardInvitation } from '../../services/boardMembers'

interface InvitationRequestsProps {
  invitations: BoardInvitation[]
  /** Invitación que se está respondiendo (sus botones quedan deshabilitados). */
  respondingId: string | null
  onRespond: (invitationId: string, response: 'accept' | 'decline') => void
}

/** Invitaciones recibidas para colaborar en tableros de otras personas. */
function InvitationRequests({ invitations, respondingId, onRespond }: InvitationRequestsProps) {
  return (
    <section className="glass-panel mt-8 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Solicitudes de colaboración</h2>
          <p className="mt-2 text-sm text-slate-400">Revisa las invitaciones recibidas para participar en otros tableros.</p>
        </div>
        <span className="rounded-full bg-[var(--accent-mint)]/10 px-3 py-1 text-xs text-[var(--accent-mint)]">
          {invitations.length} pendiente{invitations.length === 1 ? '' : 's'}
        </span>
      </div>
      {invitations.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">No tienes solicitudes pendientes.</p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium text-white">{invitation.board?.name ?? 'Tablero compartido'}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Te invitaron como {roleEmotes[invitation.role]} {roleLabels[invitation.role].toLowerCase()}.
                  </p>
                </div>
                <span className="text-xs text-slate-500">{new Date(invitation.created_at).toLocaleDateString('es-CL')}</span>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => onRespond(invitation.id, 'decline')} disabled={respondingId === invitation.id} className="btn-ghost px-4 py-2 text-sm disabled:opacity-50">
                  Rechazar
                </button>
                <button type="button" onClick={() => onRespond(invitation.id, 'accept')} disabled={respondingId === invitation.id} className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">
                  {respondingId === invitation.id ? 'Guardando...' : 'Aceptar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default InvitationRequests
