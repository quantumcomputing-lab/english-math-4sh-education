/* english.math.4sh.education — JS */

// ── Shared modal helpers: iOS-safe scroll lock + Tab focus trap ──
// position:fixed + a negative top offset (not plain overflow:hidden) is
// required to actually stop the page rubber-band-scrolling behind a
// fixed overlay on iOS Safari -- overflow:hidden alone doesn't reliably
// prevent it there. Used by every modal-like UI piece below (mobile nav
// drawer, consult modal, image lightbox, video modal) instead of each
// reimplementing its own (previously inconsistent) lock.
let _scrollLockY = 0;
function lockBodyScroll() {
    _scrollLockY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${_scrollLockY}px`;
    document.body.style.width = '100%';
}
function unlockBodyScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, _scrollLockY);
}

// Returns a keydown handler that cycles Tab/Shift+Tab within `container`'s
// focusable elements, so focus can never escape to the page behind an
// open modal -- add it as a keydown listener on open, remove on close.
function trapFocus(container) {
    return function (e) {
        if (e.key !== 'Tab') return;
        const focusable = container.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
}

// ── Hamburger / Mobile Nav ──
const hamburger  = document.querySelector('.hamburger');
const mobileNav  = document.getElementById('mobileNav');
const navOverlay = document.getElementById('navOverlay');
const navClose   = document.querySelector('.mobile-nav-close');
const mobileLinks = mobileNav?.querySelectorAll('a') ?? [];
const mobileNavFocusTrap = mobileNav ? trapFocus(mobileNav) : null;

function openNav() {
    mobileNav.classList.add('open');
    navOverlay.classList.add('open');
    lockBodyScroll();
    hamburger?.setAttribute('aria-expanded', 'true');
    hamburger?.setAttribute('aria-label', 'Close menu');
    if (mobileNavFocusTrap) document.addEventListener('keydown', mobileNavFocusTrap);
}
function closeNav() {
    mobileNav.classList.remove('open');
    navOverlay.classList.remove('open');
    unlockBodyScroll();
    hamburger?.setAttribute('aria-expanded', 'false');
    hamburger?.setAttribute('aria-label', 'Open menu');
    if (mobileNavFocusTrap) document.removeEventListener('keydown', mobileNavFocusTrap);
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
document.querySelectorAll('.slab-full').forEach(el => mathObserver.observe(el));

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

// ── Schedule-consultation CTA click tracking ──
document.querySelectorAll('.btn-schedule').forEach(btn => {
    btn.addEventListener('click', () => {
        if (typeof gtag === 'function') {
            gtag('event', 'consultation_mailto_click', { event_category: 'contact', event_label: btn.closest('section')?.id || 'contact' });
        }
    });
});

// ── Book preview carousel (ported from Foundation_Site's infographic
//    carousel: bookend arrow buttons + click-and-drag scrolling) ──
const carouselTrack = document.getElementById('bookCarousel');
const carouselPrev  = document.getElementById('carouselPrev');
const carouselNext  = document.getElementById('carouselNext');

if (carouselTrack && carouselPrev && carouselNext) {
    const cardStep = () => {
        const card = carouselTrack.querySelector('.carousel-item');
        if (!card) return carouselTrack.clientWidth * 0.8;
        const gap = parseFloat(getComputedStyle(carouselTrack).gap) || 0;
        return card.getBoundingClientRect().width + gap;
    };

    carouselPrev.addEventListener('click', () => {
        carouselTrack.scrollBy({ left: -cardStep(), behavior: 'smooth' });
    });
    carouselNext.addEventListener('click', () => {
        carouselTrack.scrollBy({ left: cardStep(), behavior: 'smooth' });
    });

    const updateArrowState = () => {
        const max = carouselTrack.scrollWidth - carouselTrack.clientWidth - 1;
        carouselPrev.classList.toggle('is-disabled', carouselTrack.scrollLeft <= 0);
        carouselNext.classList.toggle('is-disabled', carouselTrack.scrollLeft >= max);
    };

    carouselTrack.addEventListener('scroll', updateArrowState, { passive: true });
    window.addEventListener('resize', updateArrowState);
    updateArrowState();

    // ── Click-and-drag scrolling with the mouse (touch already works natively) ──
    let isDragging = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartScroll = 0;

    carouselTrack.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragMoved = false;
        dragStartX = e.pageX;
        dragStartScroll = carouselTrack.scrollLeft;
        carouselTrack.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.pageX - dragStartX;
        if (Math.abs(dx) > 4) dragMoved = true;
        carouselTrack.scrollLeft = dragStartScroll - dx;
    });

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        carouselTrack.classList.remove('dragging');
    };
    window.addEventListener('mouseup', endDrag);
    carouselTrack.addEventListener('mouseleave', endDrag);

    // ── Lightbox — open the clicked card's image full size in place.
    //    Suppress the open if the mouse actually dragged (same guard the
    //    Foundation_Site carousel uses to stop a drag-release from
    //    triggering its card's link). ──
    const lightbox    = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxClose = document.getElementById('lightboxClose');
    let lastFocused = null;
    const lightboxFocusTrap = trapFocus(lightbox);

    function openLightbox(fullSrc, alt) {
        lightboxImg.src = fullSrc;
        lightboxImg.alt = alt || '';
        lightbox.classList.add('open');
        lightbox.setAttribute('aria-hidden', 'false');
        lockBodyScroll();
        lastFocused = document.activeElement;
        lightboxClose.focus();
        document.addEventListener('keydown', lightboxFocusTrap);
    }
    function closeLightbox() {
        lightbox.classList.remove('open');
        lightbox.setAttribute('aria-hidden', 'true');
        unlockBodyScroll();
        document.removeEventListener('keydown', lightboxFocusTrap);
        lightboxImg.src = '';
        lastFocused?.focus();
    }

    carouselTrack.addEventListener('click', (e) => {
        if (dragMoved) {
            e.preventDefault();
            e.stopPropagation();
            dragMoved = false;
            return;
        }
        const card = e.target.closest('.carousel-item');
        if (card) openLightbox(card.dataset.full, card.dataset.alt);
    }, true);

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('open')) closeLightbox();
    });
}

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

// ── Match the founder video-card's height to the credentials column ──
// CSS alone (grid stretch feeding an aspect-ratio calc) turned out to be
// an unpredictable circular dependency -- this measures the real
// rendered height directly and sets it as an explicit inline px value,
// which aspect-ratio can then cleanly derive the card's width from (a
// well-defined case). Below the 900px breakpoint where .slab-inner
// stacks to one column (see css/style.css), the columns aren't
// side-by-side any more, so the inline height is cleared and the card
// falls back to its own CSS (width-capped, height from aspect-ratio).
(function () {
    const card = document.getElementById('founderVideoCard');
    const textCol = document.querySelector('#founder .slab-text');
    if (!card || !textCol) return;

    function syncHeight() {
        if (window.innerWidth <= 900) {
            card.style.height = '';
            return;
        }
        card.style.height = textCol.offsetHeight + 'px';
    }

    syncHeight();
    window.addEventListener('resize', syncHeight);
    window.addEventListener('load', syncHeight); // re-check once webfonts/images settle text height
})();

// ── Founder intro video modal ──
// Single-video fullscreen popup, ported from Bengali_Career_Strategy's
// bookshelf video modal (same YouTube IFrame API approach -- not a raw
// iframe -- so a blocked/removed/private video shows a clear message
// instead of a silent blank box). No grid here, just one trigger button.
(function () {
    const FOUNDER_VIDEO_ID = 'gwIuTEmreyk'; // https://youtube.com/shorts/gwIuTEmreyk

    const trigger = document.getElementById('founderVideoCard');
    const modal = document.getElementById('videoModal');
    const modalFrame = document.getElementById('videoModalFrame');
    const modalClose = document.getElementById('videoModalClose');
    if (!trigger || !modal || !modalFrame || !modalClose) return;

    let ytApiPromise = null;
    let currentPlayer = null;
    let currentReadyTimeout = null;
    let openSessionId = 0;
    let lastFocusedElement = null;
    const videoModalFocusTrap = trapFocus(modal);

    function loadYouTubeApi() {
        if (ytApiPromise) return ytApiPromise;
        ytApiPromise = new Promise((resolve, reject) => {
            const failTimer = setTimeout(() => reject(new Error('yt-api-timeout')), 6000);
            window.onYouTubeIframeAPIReady = () => { clearTimeout(failTimer); resolve(window.YT); };
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.onerror = () => { clearTimeout(failTimer); reject(new Error('yt-api-script-error')); };
            document.head.appendChild(script);
        }).catch(err => {
            ytApiPromise = null; // don't cache a failed load -- let the next click retry from scratch
            throw err;
        });
        return ytApiPromise;
    }

    function errorMessageFor(code) {
        switch (code) {
            case 2:   return "This video link isn't valid.";
            case 5:   return "This video can't be played in this browser right now.";
            case 100: return 'This video was removed or made private.';
            case 101:
            case 150: return "The video owner has disabled playback on other websites.";
            default:  return "This video can't be played right now.";
        }
    }

    function showModalError(ytId, message) {
        if (currentReadyTimeout) { clearTimeout(currentReadyTimeout); currentReadyTimeout = null; }
        currentPlayer = null;
        modalFrame.innerHTML = `
            <div class="video-modal-error">
                <p>${message}</p>
                <a href="https://www.youtube.com/watch?v=${ytId}" target="_blank" rel="noopener">Watch on YouTube instead</a>
            </div>`;
    }

    function openVideoModal(ytId, triggerEl) {
        if (!modal.hidden) return;
        const mySession = ++openSessionId;

        lastFocusedElement = triggerEl || document.activeElement;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        lockBodyScroll();
        modalClose.focus();
        document.addEventListener('keydown', videoModalFocusTrap);

        if (!ytId || ytId === 'REPLACE_WITH_YOUTUBE_ID') {
            modalFrame.innerHTML = `<div class="video-modal-placeholder">Video coming soon.</div>`;
            return;
        }

        modalFrame.innerHTML = `<div class="video-modal-spinner"></div><div id="founder-yt-player-target"></div>`;

        currentReadyTimeout = setTimeout(() => {
            if (mySession !== openSessionId) return;
            showModalError(ytId, "This is taking longer than usual to load — it may be a slow connection, an ad blocker, or a network restriction.");
        }, 9000);

        loadYouTubeApi().then(YT => {
            if (mySession !== openSessionId) return;
            try {
                currentPlayer = new YT.Player('founder-yt-player-target', {
                    videoId: ytId,
                    playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
                    events: {
                        onReady: () => {
                            if (mySession !== openSessionId) return;
                            if (currentReadyTimeout) { clearTimeout(currentReadyTimeout); currentReadyTimeout = null; }
                            const spinner = modalFrame.querySelector('.video-modal-spinner');
                            if (spinner) spinner.remove();
                        },
                        onError: e => {
                            if (mySession !== openSessionId) return;
                            showModalError(ytId, errorMessageFor(e.data));
                        }
                    }
                });
            } catch (err) {
                if (mySession !== openSessionId) return;
                showModalError(ytId, "This video can't be played right now.");
            }
        }, () => {
            if (mySession !== openSessionId) return;
            showModalError(ytId, "This is taking longer than usual to load — it may be a slow connection, an ad blocker, or a network restriction.");
        });
    }

    function closeVideoModal() {
        openSessionId++;
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        unlockBodyScroll();
        document.removeEventListener('keydown', videoModalFocusTrap);
        if (currentReadyTimeout) { clearTimeout(currentReadyTimeout); currentReadyTimeout = null; }
        if (currentPlayer && typeof currentPlayer.destroy === 'function') {
            currentPlayer.destroy();
        }
        currentPlayer = null;
        modalFrame.innerHTML = '';
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
        lastFocusedElement = null;
    }

    trigger.addEventListener('click', () => openVideoModal(FOUNDER_VIDEO_ID, trigger));
    modalClose.addEventListener('click', closeVideoModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeVideoModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeVideoModal(); });
})();

// ── Founder CV modal — "Connect with me" opens a career-journey summary
//    in place instead of handing off to LinkedIn. Same open/close pattern
//    as the video modal above, minus the YouTube plumbing. ──
(function () {
    const trigger = document.getElementById('openCvModal');
    const modal = document.getElementById('cvModal');
    const modalClose = document.getElementById('cvModalClose');
    if (!trigger || !modal || !modalClose) return;

    let lastFocusedElement = null;
    const cvModalFocusTrap = trapFocus(modal);

    function openCvModal() {
        lastFocusedElement = trigger;
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        lockBodyScroll();
        modalClose.focus();
        document.addEventListener('keydown', cvModalFocusTrap);
    }
    function closeCvModal() {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        unlockBodyScroll();
        document.removeEventListener('keydown', cvModalFocusTrap);
        lastFocusedElement?.focus();
        lastFocusedElement = null;
    }

    trigger.addEventListener('click', openCvModal);
    modalClose.addEventListener('click', closeCvModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeCvModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeCvModal(); });
})();
