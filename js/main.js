/* english.physics.4sh.education — JS */

// ── Hamburger / Mobile Nav ──
const hamburger  = document.querySelector('.hamburger');
const mobileNav  = document.getElementById('mobileNav');
const navOverlay = document.getElementById('navOverlay');
const navClose   = document.querySelector('.mobile-nav-close');
const mobileLinks = mobileNav?.querySelectorAll('a') ?? [];

function openNav() {
    mobileNav.classList.add('open');
    navOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    hamburger?.setAttribute('aria-expanded', 'true');
    hamburger?.setAttribute('aria-label', 'Close menu');
}
function closeNav() {
    mobileNav.classList.remove('open');
    navOverlay.classList.remove('open');
    document.body.style.overflow = '';
    hamburger?.setAttribute('aria-expanded', 'false');
    hamburger?.setAttribute('aria-label', 'Open menu');
}

hamburger?.addEventListener('click', () => {
    if (mobileNav.classList.contains('open')) {
        closeNav();
    } else {
        openNav();
    }
});
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
        topicsToggle?.setAttribute('aria-expanded', 'false');
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && topicsDropdown?.classList.contains('open')) {
        topicsDropdown.classList.remove('open');
        topicsToggle?.setAttribute('aria-expanded', 'false');
    }
});
topicsDropdown?.querySelectorAll('.topics-menu a').forEach(a => a.addEventListener('click', () => {
    topicsDropdown.classList.remove('open');
    topicsToggle?.setAttribute('aria-expanded', 'false');
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

// ── Lazy KaTeX hydration ──
// Math is pre-rendered to static HTML at build time (tools/build-katex.js),
// but stashed inside a <template class="katex-tpl"> per chapter instead of
// being inlined directly -- template content is parsed but not part of the
// live DOM/render tree, so it costs nothing until cloned in. Each chapter's
// prose carries lightweight <span class="katex-lazy">$raw latex$</span>
// placeholders in the meantime. This only ever swaps in already-computed
// nodes (no LaTeX parsing happens here, just a DOM clone), spreading that
// cost across the scroll session the same way the site's math rendering
// always has, instead of paying for all 35 chapters' worth of markup on
// first paint.
function hydrateMath(section) {
  if (!section || section.dataset.mathHydrated) return;
  const template = section.querySelector('template.katex-tpl');
  if (!template) { section.dataset.mathHydrated = 'true'; return; }
  const rendered = [...template.content.children];
  const placeholders = section.querySelectorAll('.katex-lazy');
  placeholders.forEach((placeholder, i) => {
    if (rendered[i]) placeholder.replaceWith(rendered[i]);
  });
  template.remove();
  section.dataset.mathHydrated = 'true';
  mathObserver.unobserve(section);
}

const mathObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) hydrateMath(entry.target);
  });
}, { rootMargin: '600px 0px' });
document.querySelectorAll('.topic-slab').forEach(el => mathObserver.observe(el));

// Every in-page anchor link (nav, dropdown, footer sitemap) must land on a
// destination whose math is already hydrated -- otherwise the section's
// height can still change right after landing (a visible flash).
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', () => {
    const id = link.getAttribute('href').slice(1);
    const target = id && document.getElementById(id);
    if (target) hydrateMath(target);
  });
});

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
        backToTop?.classList.add('visible');
    } else {
        backToTop?.classList.remove('visible');
    }
}, { passive: true });

backToTop?.addEventListener('click', () => {
    // Instant, not smooth -- an animated scroll from deep in the page back to
    // the top would pass through every intervening (possibly still
    // unrendered) chapter, risking the same lazy-math-render pile-up that
    // caused real navigation crashes on chapter jumps. See css/style.css's
    // note on why scroll-behavior: smooth is not used anywhere on this page.
    window.scrollTo({ top: 0 });
});
