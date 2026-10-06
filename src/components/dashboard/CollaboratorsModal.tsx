import { useState, type FormEvent } from 'react'

import Modal from '../ui/Modal'
import { roleEmotes, roleLabels, type BoardRole } from '../../domain/roles'
import type { Board } from '../../services/boards'
import type { BoardInvitation, BoardMember, BoardMemberRole } from '../../services/boardMembers'
import type { Profile } from '../../services/profiles'

interface CollaboratorsModalProps {
  board: Board
  currentUserId: string | undefined
  currentUserEmail: string | undefined
  currentRole: BoardRole
  ownerProfile: Profile | null
  members: BoardMember[]
  invitations: BoardInvitation[]
  error: string
  onInvite: (email: string, role: BoardMemberRole) => Promise<boolean>
  onChangeRole: (member: BoardMember, role: BoardMemberRole) => void
  onRemove: (member: BoardMember) => void
  onCancelInvitation: (invitation: BoardInvitation) => void
  onClose: () => void
}

function Avatar({ name, url }: { name: string; url: string | null | undefined }) {
  return url ? (
    <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-mint)] font-semibold text-[var(--bg-main)]" aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function CollaboratorsModal({
  board,
  currentUserId,
  currentUserEmail,
  currentRole,
  ownerProfile,
  members,
  invitations,
  error,
  onInvite,
  onChangeRole,
  onRemove,
  onCancelInvitation,
  onClose,
}: CollaboratorsModalProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<BoardMemberRole>('viewer')
  const [inviting, setInviting] = useState(false)
  const isOwner = currentRole === 'owner'
  const ownerIsCurrentUser = board.owner_id === currentUserId
  const ownerName = ownerProfile?.display_name ?? ownerProfile?.username ?? (ownerIsCurrentUser ? currentUserEmail : undefined) ?? 'Propietario'
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInviting(true)
    if (await onInvite(email, role)) setEmail('')
    setInviting(false)
  }

  return (
    <Modal
      title={`Compartir «${board.name}»`}
      subtitle={isOwner ? 'Invita personas por correo y define su nivel de acceso.' : `Tu rol: ${roleEmotes[currentRole]} ${roleLabels[currentRole]}`}
      onClose={onClose}
    >
      {isOwner && (
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="persona@empresa.com"
            aria-label="Correo de la persona a invitar"
            className="theme-input min-w-0 rounded-lg px-4 py-3"
            required
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as BoardMemberRole)}
            aria-label="Rol"
            className="theme-input rounded-lg px-4 py-3"
          >
            <option value="viewer">{roleEmotes.viewer} Lector</option>
            <option value="editor">{roleEmotes.editor} Editor</option>
          </select>
          <button type="submit" disabled={inviting} className="btn-mint-primary px-5 py-3 font-semibold disabled:opacity-50">
            {inviting ? 'Invitando...' : 'Invitar'}
          </button>
        </form>
      )}

      {error && <p className="alert-error mt-3 rounded-lg p-3 text-sm" role="alert">{error}</p>}

      <h3 className="mt-6 border-b border-white/10 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Con acceso · {members.length + 1}
      </h3>
      <ul className="divide-y divide-white/10">
        <li className="flex items-center gap-3 py-4">
          <Avatar name={ownerName} url={ownerProfile?.avatar_url} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-white">
              {ownerName} {ownerIsCurrentUser && <span className="text-slate-500">(tú)</span>}
            </p>
            <p className="truncate text-sm text-slate-400">
              {ownerIsCurrentUser ? currentUserEmail : `@${ownerProfile?.username ?? 'sin username'}`}
            </p>
          </div>
          <span className="role-pill">{roleEmotes.owner} {roleLabels.owner}</span>
        </li>

        {members.map((member) => {
          const name = member.profile?.display_name ?? member.profile?.username ?? 'Usuario'
          const isSelf = member.user_id === currentUserId
          return (
            <li key={member.id} className="flex flex-wrap items-center gap-3 py-4">
              <Avatar name={name} url={member.profile?.avatar_url} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">
                  {name} {isSelf && <span className="text-slate-500">(tú)</span>}
                </p>
                <p className="truncate text-sm text-slate-400">@{member.profile?.username ?? 'sin username'}</p>
              </div>
              {isOwner ? (
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <select
                    value={member.role}
                    onChange={(event) => onChangeRole(member, event.target.value as BoardMemberRole)}
                    aria-label={`Rol de ${name}`}
                    className="theme-input flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none"
                  >
                    <option value="viewer">{roleEmotes.viewer} Lector</option>
                    <option value="editor">{roleEmotes.editor} Editor</option>
                  </select>
                  <button type="button" onClick={() => onRemove(member)} className="btn-danger px-3 py-2 text-sm">
                    Quitar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="role-pill">{roleEmotes[member.role]} {roleLabels[member.role]}</span>
                  {isSelf && (
                    <button type="button" onClick={() => onRemove(member)} className="btn-danger px-3 py-2 text-sm">
                      Salir del tablero
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {isOwner && pendingInvitations.length > 0 && (
        <>
          <h3 className="mt-6 border-b border-white/10 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Invitaciones pendientes · {pendingInvitations.length}
          </h3>
          <ul className="divide-y divide-white/10">
            {pendingInvitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-300" aria-hidden="true">✉</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">{invitation.email}</p>
                  <p className="text-sm text-slate-400">
                    Pendiente · {roleEmotes[invitation.role]} {roleLabels[invitation.role]}
                  </p>
                </div>
                <button type="button" onClick={() => onCancelInvitation(invitation)} className="btn-ghost px-3 py-2 text-sm">
                  Cancelar invitación
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}

export default CollaboratorsModal
