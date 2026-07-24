export function openModal({ title, render, wide = false }) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4';

  const box = document.createElement('div');
  box.className = `bg-surface rounded-xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`;
  box.innerHTML = `
    <div class="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
      <h3 class="text-headline-sm font-headline-sm font-bold text-primary">${title}</h3>
      <button id="nova-modal-close" class="text-on-surface-variant hover:text-primary">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div id="nova-modal-body" class="p-6"></div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  box.querySelector('#nova-modal-close').addEventListener('click', close);

  const body = box.querySelector('#nova-modal-body');
  render(body, { close });

  return close;
}

export function confirmModal({ title, message, confirmLabel = 'Confirmar', danger = false, requirePhrase = null }) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
      close();
    };

    const close = openModal({
      title,
      render: (body, { close: closeModal }) => {
        body.innerHTML = `
          <p class="text-body-md font-body-md text-on-surface-variant mb-4">${message}</p>
          ${requirePhrase ? `
            <label class="block text-label-bold font-label-bold uppercase tracking-wide text-on-surface-variant mb-1">
              Escribe <span class="text-error">${requirePhrase}</span> para confirmar
            </label>
            <input id="nova-confirm-input" type="text" class="w-full p-2.5 border border-outline-variant rounded-md mb-4 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none" />
          ` : ''}
          <div class="flex justify-end gap-2">
            <button id="nova-confirm-cancel" class="px-4 py-2 rounded-lg border border-outline-variant text-on-surface hover:bg-surface-container-low">Cancelar</button>
            <button id="nova-confirm-ok" class="px-4 py-2 rounded-lg text-white font-bold ${danger ? 'bg-error hover:bg-error/90' : 'bg-primary hover:bg-on-primary-fixed-variant'}">${confirmLabel}</button>
          </div>
        `;
        body.querySelector('#nova-confirm-cancel').addEventListener('click', () => finish(false));
        const okBtn = body.querySelector('#nova-confirm-ok');
        okBtn.addEventListener('click', () => {
          if (requirePhrase) {
            const val = body.querySelector('#nova-confirm-input').value.trim();
            if (val !== requirePhrase) return;
          }
          finish(true);
        });
        // cerrar con la X o clic afuera tambien cuenta como cancelar
        void closeModal;
        overlayCloseHook(body, () => finish(false));
      },
    });
  });
}

// Cuando el usuario cierra el modal con la X o clic afuera, debe resolver como "false".
function overlayCloseHook(bodyEl, onExternalClose) {
  const overlay = bodyEl.closest('.fixed');
  if (!overlay) return;
  const closeBtn = overlay.querySelector('#nova-modal-close');
  closeBtn?.addEventListener('click', onExternalClose, { once: true });
  overlay.addEventListener(
    'click',
    (e) => {
      if (e.target === overlay) onExternalClose();
    },
    { once: true }
  );
}
