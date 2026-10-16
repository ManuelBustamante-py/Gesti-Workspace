import { useEffect, useState } from 'react'

import Modal from './Modal'
import { pendingConfirm, publishConfirm, subscribeConfirm, type ConfirmRequest } from './confirmAction'

/** Monta una sola vez, en la raíz de la app. */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(pendingConfirm)
  useEffect(() => subscribeConfirm(setRequest), [])
  if (!request) return null
  const answer = (value: boolean) => {
    request.resolve(value)
    publishConfirm(null)
  }
  return (
    <Modal
      title={request.title ?? (request.danger ? 'Confirmar eliminación' : 'Confirmar')}
      size="md"
      onClose={() => answer(false)}
      footer={
        <>
          <button type="button" onClick={() => answer(false)} className="btn-ghost px-4 py-2 text-sm">Cancelar</button>
          <button type="button" onClick={() => answer(true)} className={request.danger ? 'btn-danger px-4 py-2 text-sm font-semibold' : 'btn-mint-primary px-4 py-2 text-sm font-semibold'}>
            {request.confirmLabel ?? (request.danger ? 'Eliminar' : 'Continuar')}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line text-sm text-[var(--text-main)]">{request.message}</p>
    </Modal>
  )
}
