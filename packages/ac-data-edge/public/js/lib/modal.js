/** @typedef {{ id: string; onBackdrop?: boolean }} ModalConfig */

let confirmResolve = null;

export function showConfirm(title, message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOk').textContent = okLabel;
    document.getElementById('confirmModal').classList.remove('hidden');
  });
}

/** @param {boolean} result */
export function hideConfirm(result) {
  document.getElementById('confirmModal').classList.add('hidden');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

/** @param {string} id */
export function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

/** @param {string} id */
export function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

/** @param {string} id */
export function isModalOpen(id) {
  return !document.getElementById(id)?.classList.contains('hidden');
}

/**
 * @param {ModalConfig} config
 * @param {() => void} onClose
 */
export function bindModal(config, onClose) {
  const overlay = document.getElementById(config.id);
  if (!overlay) return;

  overlay.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', onClose);
  });

  if (config.onBackdrop !== false) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) onClose();
    });
  }
}

/** @param {Array<{ id: string; close: () => void }>} stack */
export function bindEscapeStack(stack) {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const modal of stack) {
      if (isModalOpen(modal.id)) {
        modal.close();
        return;
      }
    }
  });
}

export function bindConfirmModal() {
  document.getElementById('confirmCancel')?.addEventListener('click', () => hideConfirm(false));
  document.getElementById('confirmOk')?.addEventListener('click', () => hideConfirm(true));
  bindModal({ id: 'confirmModal' }, () => hideConfirm(false));
}

export function showUploadOverlay(message) {
  document.getElementById('uploadingStatus').textContent = message;
  openModal('uploadOverlay');
}

export function hideUploadOverlay() {
  closeModal('uploadOverlay');
}
