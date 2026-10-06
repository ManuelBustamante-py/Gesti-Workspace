import Modal from '../ui/Modal'
import { roleDescriptions, roleEmotes, roleLabels, type BoardRole } from '../../domain/roles'

interface SecurityInfoDialogProps {
  onClose: () => void
}

const roles: BoardRole[] = ['owner', 'editor', 'viewer']

/**
 * Explica cómo se protegen los datos. Solo afirma lo que la arquitectura
 * realmente hace; lo que depende del proveedor se atribuye a él.
 */
function SecurityInfoDialog({ onClose }: SecurityInfoDialogProps) {
  return (
    <Modal title="🔒 Seguridad y privacidad" subtitle="Cómo se protege la información de tus proyectos." onClose={onClose}>
      <div className="space-y-5 text-sm leading-relaxed text-[var(--text-main)]">
        <section>
          <h3 className="security-heading">Dónde se guardan los datos</h3>
          <p>
            Los tableros, columnas, tareas y perfiles se almacenan en una base de datos PostgreSQL gestionada por{' '}
            <strong>Supabase</strong>. La aplicación web se sirve desde GitHub Pages y no guarda información de
            tus proyectos en servidores propios.
          </p>
        </section>

        <section>
          <h3 className="security-heading">Cifrado</h3>
          <ul className="security-list">
            <li><strong>En tránsito:</strong> toda la comunicación entre tu navegador, la aplicación y la base de datos viaja por HTTPS (TLS).</li>
            <li><strong>En reposo:</strong> según la documentación de Supabase, los datos almacenados se cifran en disco (AES-256).</li>
            <li><strong>Contraseñas:</strong> las gestiona Supabase Auth, que guarda solo un hash de la contraseña, nunca el texto original.</li>
          </ul>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Los datos no tienen cifrado de extremo a extremo: el servicio puede leerlos para mostrártelos, y los
            administradores del proyecto en Supabase tienen acceso técnico a la base de datos.
          </p>
        </section>

        <section>
          <h3 className="security-heading">Quién puede ver y modificar un tablero</h3>
          <p>
            El acceso se controla en la propia base de datos con <strong>Row Level Security</strong>: cada consulta
            se filtra según tu sesión, así que nadie puede leer un tablero al que no fue invitado aunque conozca su
            dirección.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {roles.map((role) => (
              <li key={role} className="role-card">
                <span className="text-lg" aria-hidden="true">{roleEmotes[role]}</span>
                <strong className="block">{roleLabels[role]}</strong>
                <span className="text-xs text-[var(--text-muted)]">{roleDescriptions[role]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="security-heading">Buenas prácticas</h3>
          <ul className="security-list">
            <li>Invita solo a personas con cuenta registrada y elige el rol mínimo necesario.</li>
            <li>El propietario puede cambiar roles o quitar el acceso en cualquier momento desde «Colaboradores».</li>
            <li>Los archivos XLSX exportados quedan fuera de esta protección: compártelos con cuidado.</li>
          </ul>
        </section>
      </div>
    </Modal>
  )
}

export default SecurityInfoDialog
