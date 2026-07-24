// Se carga ANTES que app.js. Verifica si hay sesion iniciada; si no, muestra
// una pantalla de login/creacion de contraseña que cubre toda la interfaz y
// solo cuando el login es exitoso arranca el resto de la aplicacion
// (import('./app.js')). Un solo password compartido por todo el equipo,
// sin cuentas individuales (fuera de alcance para un equipo de 4 personas).

function renderOverlay(firstRun, onSuccess) {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.className = 'fixed inset-0 z-[200] bg-background flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="w-full max-w-sm bg-surface rounded-xl shadow-xl border border-outline-variant p-8">
      <div class="flex flex-col items-center mb-6">
        <div class="w-12 h-12 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-bold text-lg mb-3">SF</div>
        <h1 class="text-headline-md font-headline-md font-extrabold text-primary text-center">SalesForce CRM</h1>
        <p class="text-body-sm font-body-sm text-on-surface-variant text-center mt-1">
          ${firstRun ? 'Crea la contraseña del equipo para empezar a usar el sistema.' : 'Ingresa la contraseña del equipo para continuar.'}
        </p>
      </div>
      <form id="auth-form" class="space-y-4">
        <div>
          <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">
            ${firstRun ? 'Nueva contraseña' : 'Contraseña'}
          </label>
          <input id="auth-password" type="password" required minlength="4" autocomplete="${firstRun ? 'new-password' : 'current-password'}"
            class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
        </div>
        ${firstRun ? `
        <div>
          <label class="block text-label-bold font-label-bold text-on-surface-variant mb-1 uppercase tracking-wider">Confirmar contraseña</label>
          <input id="auth-password-confirm" type="password" required minlength="4" autocomplete="new-password"
            class="w-full p-2.5 bg-surface-container-lowest border border-outline-variant rounded-md text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
        </div>` : ''}
        <p id="auth-error" class="text-body-sm font-body-sm text-error hidden"></p>
        <button type="submit" class="w-full py-3 bg-primary text-on-primary rounded-md font-label-bold text-label-bold hover:bg-on-primary-fixed-variant transition-colors">
          ${firstRun ? 'CREAR CONTRASEÑA E INGRESAR' : 'INGRESAR'}
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#auth-form');
  const errorEl = overlay.querySelector('#auth-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const password = overlay.querySelector('#auth-password').value;
    if (firstRun) {
      const confirm = overlay.querySelector('#auth-password-confirm').value;
      if (password !== confirm) {
        errorEl.textContent = 'Las contraseñas no coinciden';
        errorEl.classList.remove('hidden');
        return;
      }
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorEl.textContent = data.error || 'No se pudo iniciar sesión';
        errorEl.classList.remove('hidden');
        return;
      }
      overlay.remove();
      onSuccess();
    } catch {
      errorEl.textContent = 'No se pudo conectar con el servidor';
      errorEl.classList.remove('hidden');
    }
  });
}

let booted = false;
export function bootApp() {
  if (booted) return;
  booted = true;
  import('./app.js');
}

// Expuesto para que api.js pueda forzar la vuelta a la pantalla de login
// cuando cualquier peticion responda 401 (p.ej. la sesion expiro).
export function showLoginOverlay() {
  if (document.getElementById('auth-overlay')) return;
  booted = false;
  renderOverlay(false, () => {
    booted = true;
    location.reload();
  });
}
window.__novaShowLogin = showLoginOverlay;

async function init() {
  let session = { authenticated: false, firstRun: true };
  try {
    const res = await fetch('/api/auth/session');
    session = await res.json();
  } catch {
    /* si el servidor no responde, se muestra login igual y fallara al enviar */
  }

  if (session.authenticated) {
    bootApp();
    return;
  }

  renderOverlay(!!session.firstRun, bootApp);
}

init();
