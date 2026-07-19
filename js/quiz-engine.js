// Quiz engine — extracted from quiz-test.html's inline <script>, generalized to
// read question/option/solution/chapter content from window.QUIZ_DATA (set by a
// chapter data file loaded just before this script — see data/topic-1.js and
// quiz.html) instead of hardcoded HTML/constants. The state machine itself
// (screens, timer, chart, bar graph, recommendation) is otherwise unchanged.
//
// Requires window.QUIZ_DATA to already be set before this file runs.

const COUNT_FROM      = 59;   // countdown length, seconds — covers reading + answering, clock starts immediately
const QUESTION_TOTAL  = QUIZ_DATA.questions.length;
const RESULTS_DELAY_MS = 1000; // pause on the graded answer before the results screen appears
const RT_MEDIAN_SEC = 20;              // seconds — placeholder cohort median response time; will come from real telemetry later
const RT_SIGMA      = 0.5;             // log-space spread; controls how long the right tail is
const RT_MU         = Math.log(RT_MEDIAN_SEC); // log-normal's own "mean" parameter, derived so its median lands exactly on RT_MEDIAN_SEC

const timerCol     = document.getElementById('timerCol');
const timerLabel   = document.getElementById('timerLabel');
const globe        = document.getElementById('timerRing');
const timerNum     = document.getElementById('timerNum');
const options      = document.querySelectorAll('.quiz-option');
const submitBtn    = document.getElementById('submitBtn');
const questionCount = document.getElementById('questionCount');
const quizQuestionEl  = document.getElementById('quizQuestion');
const quizEyebrowEl   = document.getElementById('quizEyebrow');
const chapterLabelEl  = document.getElementById('chapterLabel');

let CORRECT_OPTION = null; // set per-question by startQuestion()

let selectedOption = null;
let submitted = false;
let lastAnswerCorrect = false;
let countdownStart = null; // performance.now() timestamp the response clock started
let rafId = null;
let responseTimeMs = null; // the one number this whole page exists to measure

// Session-wide state, accumulated across all of QUESTION_TOTAL questions.
let currentQuestionIndex = 1;
let attemptedCount = 0; // Y — questions attempted so far
let correctCount   = 0; // X — of those, how many correct
const issueTally = {
    'language-issue':    0,
    'newness-issue':     0,
    'retention-issue':   0,
    'strategy-issue':    0,
    'calculation-issue': 0,
};
const ISSUE_LABELS = {
    'language-issue':    'Language issue',
    'newness-issue':     'Newness issue',
    'retention-issue':   'Retention issue',
    'strategy-issue':    'Strategy issue',
    'calculation-issue': 'Calculation issue',
};
// Fixed per-issue advice for the session-complete recommendation — keyed to
// match ISSUE_LABELS/issueTally so renderRecommendation can look both up together.
const ISSUE_ADVICE = {
    'language-issue':    "You're facing challenges with English. That's completely normal. You don't need to master English overnight. You only need to master the English used in exams. If you'd like help, feel free to contact me.",
    'newness-issue':     "You're simply new to the topic. Keep practising consistently, and you'll improve quickly. Contact me if you need lots of practice questions.",
    'retention-issue':   "This isn't a big deal. You just need to work harder and revise regularly. No need to contact me for this.",
    'strategy-issue':    "You need to improve clarity of thinking rather than memorising steps. You must contact me for help.",
    'calculation-issue': "Keep a journal of the silly mistakes you make, and review it regularly. Simply becoming aware of your mistakes will help you eliminate them. Contact me if you need lots of practice questions.",
};

// ── Chapter-level content, set once from QUIZ_DATA (not per-question) ──
quizEyebrowEl.textContent = QUIZ_DATA.chapterEyebrow;
chapterLabelEl.textContent = QUIZ_DATA.chapterLabel;
document.querySelectorAll('.quiz-home-btn').forEach(a => { a.href = QUIZ_DATA.homeHref; });

// ── localStorage persistence ──
// Keyed by homeHref so different chapters (different data files) never collide.
// Saved only at question boundaries (see reflectNextBtn below) — a dropped
// connection mid-timer loses at most the in-progress question, never earlier
// progress. Cleared once the session actually finishes.
const STORAGE_KEY = `quiz-progress::${QUIZ_DATA.homeHref}`;

function saveProgress(resumeIndex) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ resumeIndex, attemptedCount, correctCount, issueTally }));
    } catch { /* localStorage unavailable (private mode, quota, etc.) — progress just won't persist */ }
}
function loadProgress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
function clearProgress() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// Effective elapsed time since the response clock started.
// Always derived from real timestamps (performance.now), never from
// accumulated tick counts, so it can't drift.
function effectiveElapsedMs() {
    if (countdownStart === null) return 0;
    return performance.now() - countdownStart;
}

function formatSeconds(ms) {
    return (ms / 1000).toFixed(3) + 's';
}

options.forEach(btn => {
    btn.addEventListener('click', () => {
        if (submitted) return;
        options.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedOption = btn.dataset.option;
        submitBtn.disabled = false;
    });
});

submitBtn.addEventListener('click', () => {
    if (!selectedOption || submitted) return;
    submitted = true;
    responseTimeMs = effectiveElapsedMs(); // captured once, precisely, right here
    cancelAnimationFrame(rafId);

    const isCorrect = selectedOption === CORRECT_OPTION;
    lastAnswerCorrect = isCorrect;
    globe.classList.remove('running', 'warning', 'overtime');
    globe.classList.add(isCorrect ? 'correct' : 'incorrect');

    options.forEach(b => {
        b.disabled = true;
        if (b.dataset.option === CORRECT_OPTION) {
            b.classList.add('correct');
        } else if (b.dataset.option === selectedOption) {
            b.classList.add('incorrect');
        }
    });
    submitBtn.disabled = true;
    timerLabel.textContent = 'Response Time';
    timerNum.textContent = formatSeconds(responseTimeMs);

    setTimeout(() => goToResultsScreen(isCorrect, responseTimeMs / 1000), RESULTS_DELAY_MS);
});

const MAX_OVERTIME_MS = 999000; // display floor only; the captured response time is never clamped

function renderFrame() {
    if (countdownStart !== null && !submitted) {
        const elapsedMs = effectiveElapsedMs();
        let remainingMs = COUNT_FROM * 1000 - elapsedMs;
        const atFloor = remainingMs <= -MAX_OVERTIME_MS;
        if (atFloor) remainingMs = -MAX_OVERTIME_MS;
        timerNum.textContent = formatSeconds(remainingMs);

        if (remainingMs < 0) {
            if (!globe.classList.contains('overtime')) {
                globe.classList.remove('running', 'warning');
                globe.classList.add('overtime');
            }
        } else if (elapsedMs >= (COUNT_FROM * 1000) / 2) {
            if (!globe.classList.contains('warning')) {
                globe.classList.remove('running');
                globe.classList.add('warning');
            }
        }

        if (atFloor) return; // nothing left to animate once the floor is hit
    }
    rafId = requestAnimationFrame(renderFrame);
}

// Keep the globe's top edge aligned with the top of the first option,
// regardless of how much space the question text above it takes up.
// Note: .quiz-wrap uses flex-wrap: wrap-reverse, which swaps the cross-axis
// start/end, so it's margin-bottom (not margin-top) that actually moves a
// flex-start-aligned item here.
// Below the mobile breakpoint the timer col is a fixed bottom bar instead
// (see the @media block), so this alignment doesn't apply there.
const mobileQuery = window.matchMedia('(max-width: 760px)');

function alignGlobeTop() {
    timerCol.style.marginBottom = '0px';
    if (mobileQuery.matches) return;
    const firstOption = document.querySelector('#quizOptions li');
    if (!firstOption) return;
    const diff = globe.getBoundingClientRect().top - firstOption.getBoundingClientRect().top;
    timerCol.style.marginBottom = diff + 'px';
}

window.addEventListener('load', alignGlobeTop);
window.addEventListener('resize', alignGlobeTop);

// ── Results / diagnostics / session-complete screens ────────────

const quizWrap        = document.getElementById('quizWrap');
const resultsWrap     = document.getElementById('resultsWrap');
const resultsHeadline = document.getElementById('resultsHeadline');
const resultsCaption  = document.getElementById('resultsCaption');
const chartWrap       = document.getElementById('chartWrap');
const solutionQuestion = document.getElementById('solutionQuestion');
const solutionBody     = document.getElementById('solutionBody');
const reflectCheckboxes = document.querySelectorAll('#reflectOptions input[type="checkbox"]');
const reflectNextBtn  = document.getElementById('reflectNextBtn');

const diagnosticsWrap    = document.getElementById('diagnosticsWrap');
const diagnosticsCaption = document.getElementById('diagnosticsCaption');
const diagnosticsBarGraph = document.getElementById('diagnosticsBarGraph');
const nextQuestionBtn    = document.getElementById('nextQuestionBtn');

const sessionCompleteWrap    = document.getElementById('sessionCompleteWrap');
const sessionCompleteCaption = document.getElementById('sessionCompleteCaption');
const sessionCompleteBarGraph = document.getElementById('sessionCompleteBarGraph');
const recommendSection = document.getElementById('recommendSection');

// Abramowitz-Stegun approximation — accurate to ~1e-7, plenty for a rank display.
function erf(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

function normalCDF(x, mean, sd) {
    return 0.5 * (1 + erf((x - mean) / (sd * Math.sqrt(2))));
}

// Response times are strictly positive and right-skewed (a long tail of slow
// answers, a hard floor at 0) — log-normal fits that shape far better than a
// symmetric gaussian, and reuses the same erf machinery via ln(x).
function lognormalPDF(x, mu, sigma) {
    if (x <= 0) return 0;
    const z = (Math.log(x) - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI));
}

function lognormalCDF(x, mu, sigma) {
    if (x <= 0) return 0;
    return normalCDF(Math.log(x), mu, sigma);
}

// Fixed seed so the "noisy" cohort curve looks the same on every load —
// it should read as one fixed dataset, not something that reshuffles on refresh.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Builds the noisy response-time chart as an SVG string. Population shape
// comes from the log-normal RT_MU/RT_SIGMA; the per-sample jitter is what
// keeps it reading as real (noisy) data rather than a textbook curve.
function buildChartSVG(responseTimeSec) {
    const W = 640, H = 260;
    const marginLeft = 30, marginRight = 30, marginTop = 26, marginBottom = 40;
    const plotW = W - marginLeft - marginRight;
    const plotH = H - marginTop - marginBottom;
    const baseline = marginTop + plotH;
    const domainMax = Math.max(60, Math.ceil((responseTimeSec + 8) / 10) * 10);
    const mapX = t => marginLeft + (t / domainMax) * plotW;

    const rand = mulberry32(20260711);
    const STEPS = 90;
    const rawPoints = [];
    for (let i = 0; i <= STEPS; i++) {
        const t = (i / STEPS) * domainMax;
        const pdf = lognormalPDF(t, RT_MU, RT_SIGMA);
        const noise = 1 + (rand() - 0.5) * 0.4; // ±20% jitter — enough to read as sampled, not theoretical
        rawPoints.push({ t, v: Math.max(0, pdf * noise) });
    }
    const maxV = Math.max(...rawPoints.map(p => p.v));
    const mapY = v => baseline - (v / maxV) * plotH * 0.86;

    const linePts = rawPoints.map(p => `${mapX(p.t).toFixed(1)},${mapY(p.v).toFixed(1)}`).join(' L ');
    const areaPath = `M ${mapX(0).toFixed(1)},${baseline.toFixed(1)} L ${linePts} L ${mapX(domainMax).toFixed(1)},${baseline.toFixed(1)} Z`;
    const linePath = `M ${linePts}`;

    // P10/P25/P75 keep their dashed reference lines but not a text label — with
    // four labels crammed into a ~26px-tall strip they crowded each other and
    // the "YOU ARE HERE" callout; only the median is called out by name now.
    const percentiles = [
        { label: 'P10',    z: -1.2816 },
        { label: 'P25',    z: -0.6745 },
        { label: 'Median', z: 0 },
        { label: 'P75',    z: 0.6745 },
    ].map(p => ({ ...p, t: Math.exp(RT_MU + p.z * RT_SIGMA) }));

    const pctLines = percentiles.map(p => {
        const x = mapX(p.t).toFixed(1);
        const label = p.label === 'Median'
            ? `<text class="pct-label" x="${x}" y="${marginTop + 11}" text-anchor="middle">${p.label} · ${p.t.toFixed(0)}s</text>`
            : '';
        return `<line class="pct-line" x1="${x}" y1="${marginTop}" x2="${x}" y2="${baseline}"></line>${label}`;
    }).join('');

    const ticks = [];
    for (let t = 0; t <= domainMax; t += 10) ticks.push(t);
    const tickMarks = ticks.map(t => {
        const x = mapX(t).toFixed(1);
        return `<line class="axis-tick" x1="${x}" y1="${baseline}" x2="${x}" y2="${baseline + 5}"></line>` +
            `<text class="tick-label" x="${x}" y="${baseline + 18}" text-anchor="middle">${t}s</text>`;
    }).join('');

    const dotT = Math.min(Math.max(responseTimeSec, 0), domainMax);
    const dotX = mapX(dotT);
    const dotY = mapY(lognormalPDF(dotT, RT_MU, RT_SIGMA));
    // The label needs to clear two things: the median-label strip near the top
    // (marginTop..marginTop+28), and the curve line itself, which can rise
    // steeply right next to the dot — an 18px leader wasn't enough clearance
    // and the label text ended up brushing the curve. 34px leaves real air.
    const LEADER_LEN = 34;
    const labelAbove = dotY > marginTop + 28 + LEADER_LEN + 12;
    const leaderEndY = labelAbove ? dotY - LEADER_LEN : dotY + LEADER_LEN;
    const labelY = labelAbove ? leaderEndY - 8 : leaderEndY + 14;
    // "YOU ARE HERE" is centered on the dot by default, but a fast (near-zero)
    // or very slow response time lands the dot right at a chart edge — anchor
    // the label to that edge instead so it can't run outside the viewBox and clip.
    const nearLeftEdge = dotX < marginLeft + 55;
    const nearRightEdge = dotX > (W - marginRight) - 55;
    const labelAnchor = nearLeftEdge ? 'start' : nearRightEdge ? 'end' : 'middle';
    const labelX = nearLeftEdge ? marginLeft : nearRightEdge ? (W - marginRight) : dotX;

    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Distribution of response times across all students, with your response time marked">
        <defs>
            <linearGradient id="curveFillGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(165,28,48,0.16)"></stop>
                <stop offset="100%" stop-color="rgba(165,28,48,0.015)"></stop>
            </linearGradient>
        </defs>
        <path class="curve-area" d="${areaPath}"></path>
        <path class="curve-line" d="${linePath}"></path>
        ${pctLines}
        <line class="axis-line" x1="${marginLeft}" y1="${baseline.toFixed(1)}" x2="${W - marginRight}" y2="${baseline.toFixed(1)}"></line>
        ${tickMarks}
        <text class="axis-caption" x="${W / 2}" y="${H - 4}" text-anchor="middle">Response time</text>
        <line class="you-leader" x1="${dotX.toFixed(1)}" y1="${leaderEndY.toFixed(1)}" x2="${dotX.toFixed(1)}" y2="${dotY.toFixed(1)}"></line>
        <circle class="you-dot" cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="7"></circle>
        <text class="you-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${labelAnchor}">YOU ARE HERE</text>
    </svg>`;
}

function renderResults(isCorrect, responseTimeSec) {
    // Math.max(60, NaN) is NaN, not 60 — a bad responseTimeSec (NaN/undefined/
    // negative) would otherwise poison domainMax in buildChartSVG and every
    // coordinate downstream, collapsing the curve to an invalid SVG path (it
    // silently fails to render, leaving only the flat axis-line behind — reads
    // as "the chart turned into a straight line"). Clamped once here so every
    // caller downstream (chart + rank) is guaranteed a valid, non-negative number.
    if (!Number.isFinite(responseTimeSec) || responseTimeSec < 0) responseTimeSec = 0;

    resultsHeadline.textContent = isCorrect ? 'Correct! See your response time.' : 'Wrong! See your response time.';
    resultsHeadline.classList.toggle('correct', isCorrect);
    resultsHeadline.classList.toggle('incorrect', !isCorrect);

    if (isCorrect) {
        const rank = Math.min(100, Math.max(1, Math.round(100 * lognormalCDF(responseTimeSec, RT_MU, RT_SIGMA))));
        resultsCaption.innerHTML = `Your rank is <strong>${rank}</strong>/100`;
        resultsCaption.classList.remove('warn');
    } else {
        resultsCaption.textContent = 'Your response time has no meaning as you got it wrong.';
        resultsCaption.classList.add('warn');
    }

    chartWrap.innerHTML = buildChartSVG(responseTimeSec);

    // Copied live from the current question's data rather than duplicated,
    // so the two can't drift.
    const currentQuestion = QUIZ_DATA.questions[currentQuestionIndex - 1];
    solutionQuestion.textContent = currentQuestion.question;
    solutionBody.textContent = currentQuestion.solution;
}

// Fades fromEl out, then swaps [hidden]/is-visible so toEl fades in — the one
// transition primitive used for all four screens (quiz/results/diagnostics/
// session-complete). body's professional (non-photo) background stays on for
// every screen except the quiz itself. onShown (optional) fires once toEl is
// actually visible — used to delay starting the next question's timer until
// the student can see the screen it's counting down on.
function switchScreen(fromEl, toEl, onShown) {
    fromEl.classList.add('is-hiding');
    setTimeout(() => {
        fromEl.hidden = true;
        fromEl.classList.remove('is-hiding', 'is-visible');
        toEl.hidden = false;
        document.body.classList.toggle('results-active', toEl !== quizWrap);
        window.scrollTo(0, 0); // the previous screen may have been scrolled; the new one starts at its own top
        void toEl.offsetWidth; // force a reflow so the opacity transition below actually runs
        toEl.classList.add('is-visible');
        if (onShown) onShown();
    }, 400); // matches .screen's opacity transition duration
}

function goToResultsScreen(isCorrect, responseTimeSec) {
    renderResults(isCorrect, responseTimeSec);
    switchScreen(quizWrap, resultsWrap);
}

// Five separate horizontal bars, 100%-normalized against total non-random-click
// diagnoses logged so far (each checked box is one full vote — see the plan).
// Shared by both the per-question diagnostics screen and the final summary.
function renderBarGraph(container, tally) {
    const totalVotes = Object.values(tally).reduce((a, b) => a + b, 0);
    container.innerHTML = Object.keys(ISSUE_LABELS).map(key => {
        const pct = totalVotes === 0 ? 0 : Math.round(100 * tally[key] / totalVotes);
        return `
            <div class="bar-row">
                <span class="bar-label">${ISSUE_LABELS[key]}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
                <span class="bar-pct">${pct}%</span>
            </div>`;
    }).join('');
}

function renderDiagnostics() {
    diagnosticsCaption.textContent =
        `You got ${correctCount} out of ${attemptedCount} correct. Let's talk about your speed diagnostics based on non-random clicks.`;
    renderBarGraph(diagnosticsBarGraph, issueTally);
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const BULLET_LETTERS = ['a', 'b', 'c', 'd', 'e'];

// Picks the issue(s) with the highest vote count (ties included — a student
// can genuinely be equally weak in two areas) and writes the fixed advice for
// each. Left blank if no non-random-click diagnosis was ever logged, since
// there's nothing to base a recommendation on.
function renderRecommendation(container, tally) {
    const totalVotes = Object.values(tally).reduce((a, b) => a + b, 0);
    if (totalVotes === 0) {
        container.innerHTML = '';
        return;
    }

    const maxVotes = Math.max(...Object.values(tally));
    const topIssues = Object.keys(ISSUE_LABELS).filter(key => tally[key] === maxVotes);
    const names = topIssues.map(key => ISSUE_LABELS[key]);

    let namesText;
    if (names.length === 1) {
        namesText = names[0];
    } else if (names.length === 2) {
        namesText = `${names[0]} and ${names[1]}`;
    } else {
        namesText = `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
    }

    const intro = names.length === 1
        ? `Your biggest issue is ${namesText}. I suggest you do the following:`
        : `Your ${NUMBER_WORDS[names.length]} biggest issues are ${namesText}. I suggest you do the following:`;

    const bullets = names.length === 1
        ? `<p class="recommend-bullet">${ISSUE_ADVICE[topIssues[0]]}</p>`
        : topIssues.map((key, i) => `<p class="recommend-bullet">${BULLET_LETTERS[i]}) ${ISSUE_ADVICE[key]}</p>`).join('');

    container.innerHTML = `
        <p class="recommend-heading">Recommended for you</p>
        <p class="recommend-intro">${intro}</p>
        ${bullets}`;
}

function renderSessionComplete() {
    sessionCompleteCaption.textContent = `You got ${correctCount} out of ${attemptedCount} correct.`;
    renderBarGraph(sessionCompleteBarGraph, issueTally);
    renderRecommendation(recommendSection, issueTally);
    clearProgress(); // finished — a later visit should start fresh, not resume into a completed state
}

// Resets the quiz screen for question `index` and starts its timer. Called once
// on page load (index = 1, or a resumed index — see the bottom of this file)
// and again from the Next Question button — every reset here undoes something
// the submit/reflect flow changed for the previous question, so this list only
// grows if a future field starts persisting state that shouldn't carry over.
function startQuestion(index) {
    currentQuestionIndex = index;
    const q = QUIZ_DATA.questions[index - 1];
    CORRECT_OPTION = q.correct;
    quizQuestionEl.textContent = q.question;
    options.forEach(btn => {
        btn.textContent = `${btn.dataset.option}. ${q.options[btn.dataset.option]}`;
    });
    questionCount.textContent = `Question ${index} of ${QUESTION_TOTAL}`;

    selectedOption = null;
    submitted = false;
    lastAnswerCorrect = false;
    responseTimeMs = null;

    options.forEach(b => {
        b.disabled = false;
        b.classList.remove('selected', 'correct', 'incorrect');
    });
    submitBtn.disabled = true;

    globe.classList.remove('correct', 'incorrect', 'warning', 'overtime');
    globe.classList.add('running');
    timerLabel.textContent = 'Time Left';
    timerNum.textContent = formatSeconds(COUNT_FROM * 1000);

    cancelAnimationFrame(rafId);
    countdownStart = performance.now(); // clock starts immediately, no reading grace period
    rafId = requestAnimationFrame(renderFrame);

    reflectCheckboxes.forEach(cb => {
        cb.checked = false;
        cb.closest('.reflect-option').classList.remove('is-checked');
    });
    reflectNextBtn.disabled = true;

    alignGlobeTop();
}

reflectCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
        cb.closest('.reflect-option').classList.toggle('is-checked', cb.checked);
        reflectNextBtn.disabled = !Array.from(reflectCheckboxes).some(c => c.checked);
    });
});

reflectNextBtn.addEventListener('click', () => {
    if (reflectNextBtn.disabled) return;

    attemptedCount += 1;
    if (lastAnswerCorrect) correctCount += 1;
    reflectCheckboxes.forEach(cb => {
        if (cb.checked && cb.value !== 'random-click') {
            issueTally[cb.value] += 1;
        }
    });

    // Saved as the *next* question to resume at (not the one just completed) —
    // reloading on the diagnostics screen shouldn't re-run the question whose
    // diagnosis was already recorded.
    saveProgress(currentQuestionIndex + 1);

    renderDiagnostics();
    switchScreen(resultsWrap, diagnosticsWrap);
});

nextQuestionBtn.addEventListener('click', () => {
    if (currentQuestionIndex < QUESTION_TOTAL) {
        switchScreen(diagnosticsWrap, quizWrap, () => startQuestion(currentQuestionIndex + 1));
    } else {
        renderSessionComplete();
        switchScreen(diagnosticsWrap, sessionCompleteWrap);
    }
});

// ── Boot ──
// Resume mid-session if a saved attempt exists for this chapter, otherwise
// start fresh at question 1. A saved resumeIndex beyond QUESTION_TOTAL means
// the last question's diagnosis was recorded but "Next Question" was never
// clicked through to session-complete — land there directly instead of
// attempting to start a question that doesn't exist.
const saved = loadProgress();
if (saved) {
    attemptedCount = saved.attemptedCount;
    correctCount = saved.correctCount;
    Object.assign(issueTally, saved.issueTally);
}
if (saved && saved.resumeIndex > QUESTION_TOTAL) {
    quizWrap.hidden = true;
    document.body.classList.add('results-active');
    renderSessionComplete();
    sessionCompleteWrap.hidden = false;
    void sessionCompleteWrap.offsetWidth;
    sessionCompleteWrap.classList.add('is-visible');
} else {
    startQuestion(saved ? saved.resumeIndex : 1);
}
