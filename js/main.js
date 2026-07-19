/* english.physics.4sh.education — JS */

// ── Hamburger / Mobile Nav ──
const hamburger  = document.querySelector('.hamburger');
const mobileNav  = document.getElementById('mobileNav');
const navOverlay = document.getElementById('navOverlay');
const navClose   = document.querySelector('.mobile-nav-close');
const mobileLinks = document.querySelectorAll('.mobile-link');

function openNav() {
    mobileNav.classList.add('open');
    navOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeNav() {
    mobileNav.classList.remove('open');
    navOverlay.classList.remove('open');
    document.body.style.overflow = '';
}

hamburger?.addEventListener('click', openNav);
navClose?.addEventListener('click', closeNav);
navOverlay?.addEventListener('click', closeNav);
mobileLinks.forEach(link => link.addEventListener('click', closeNav));

// ── Topics dropdown (desktop header) ──
const topicsDropdown = document.getElementById('topicsDropdown');
const topicsToggle   = document.getElementById('topicsToggle');

topicsToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = topicsDropdown.classList.toggle('open');
    topicsToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});
document.addEventListener('click', (e) => {
    if (topicsDropdown?.classList.contains('open') && !topicsDropdown.contains(e.target)) {
        topicsDropdown.classList.remove('open');
        topicsToggle.setAttribute('aria-expanded', 'false');
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && topicsDropdown?.classList.contains('open')) {
        topicsDropdown.classList.remove('open');
        topicsToggle.setAttribute('aria-expanded', 'false');
    }
});
topicsDropdown?.querySelectorAll('.topics-menu a').forEach(a => a.addEventListener('click', () => {
    topicsDropdown.classList.remove('open');
    topicsToggle.setAttribute('aria-expanded', 'false');
}));

// ── Scroll Fade-in ──
const fadeEls = document.querySelectorAll('.fade-in');
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.15 });

fadeEls.forEach(el => observer.observe(el));

// ── Active nav highlight on scroll ──
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.desktop-nav a');

const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            navLinks.forEach(link => link.classList.remove('active'));
            const active = document.querySelector(`.desktop-nav a[href="#${entry.target.id}"]`);
            active?.classList.add('active');
        }
    });
}, { threshold: 0.4 });

sections.forEach(s => sectionObserver.observe(s));

// ── Click-to-WhatsApp CTA click tracking ──
document.querySelectorAll('.btn-whatsapp').forEach(btn => {
    btn.addEventListener('click', () => {
        if (typeof gtag === 'function') {
            gtag('event', 'whatsapp_click', { event_category: 'contact', event_label: btn.closest('section')?.id || 'contact' });
        }
    });
});

// ── Back to top ──
const backToTop = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
    if (window.scrollY > 400) {
        backToTop.classList.add('visible');
    } else {
        backToTop.classList.remove('visible');
    }
}, { passive: true });

backToTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});
