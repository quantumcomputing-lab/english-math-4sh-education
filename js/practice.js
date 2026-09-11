/* quadratic_equations.html — 51-row practice grid + reveal modal.
   Every card's content already sits pre-rendered (KaTeX pre-baked at
   build time, see tools/build-katex-practice.js) inside an inert
   <template>, so opening a card is just a DOM clone -- no LaTeX ever
   parses in the browser. Reuses lockBodyScroll/trapFocus from main.js. */
(function () {
    const modal = document.getElementById('practiceModal');
    const modalClose = document.getElementById('practiceModalClose');
    const modalTitle = document.getElementById('practiceModalTitle');
    const modalBody = document.getElementById('practiceModalBody');
    const cards = document.querySelectorAll('.practice-card');
    if (!modal || !modalClose || !cards.length) return;

    let lastFocusedElement = null;
    const modalFocusTrap = trapFocus(modal);

    function openPracticeModal(triggerEl) {
        const template = document.getElementById(triggerEl.dataset.template);
        if (!template) return;
        lastFocusedElement = triggerEl;
        modalTitle.textContent = triggerEl.dataset.modalTitle || '';
        modalBody.innerHTML = '';
        modalBody.appendChild(template.content.cloneNode(true));
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        lockBodyScroll();
        modalClose.focus();
        document.addEventListener('keydown', modalFocusTrap);
    }
    function closePracticeModal() {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        unlockBodyScroll();
        document.removeEventListener('keydown', modalFocusTrap);
        lastFocusedElement?.focus();
        lastFocusedElement = null;
    }

    cards.forEach((card) => {
        card.addEventListener('click', () => openPracticeModal(card));
    });
    modalClose.addEventListener('click', closePracticeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closePracticeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closePracticeModal(); });
})();
