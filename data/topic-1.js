// Placeholder chapter data for js/quiz-engine.js — externalizes what was
// previously hardcoded inline in quiz-test.html (question/option text, the
// QUESTIONS correct-answer list, the eyebrow/chapter-label strings, and the
// solution walkthrough). Real per-question content is still blocked on the
// external .tex build pipeline (see todos.html) — this defines the *shape*
// real content will need, filled with the same Lorem-ipsum placeholder text
// already used on the page today. No new content is invented here.
//
// Loaded via a plain <script> tag before js/quiz-engine.js (this site has no
// build step and no fetch/JSON pattern — see js/main.js for the convention),
// so it just needs to set window.QUIZ_DATA before the engine script runs.

window.QUIZ_DATA = {
    subject: "Mathematics",
    chapterLabel: "(L0) Foundations",
    chapterEyebrow: "Mathematics • Logarithms",
    homeHref: "index.html#topic-1",

    questions: [
        { correct: 'D' }, { correct: 'B' }, { correct: 'A' }, { correct: 'C' }, { correct: 'D' },
        { correct: 'A' }, { correct: 'B' }, { correct: 'C' }, { correct: 'D' }, { correct: 'B' },
    ].map(q => ({
        ...q,
        question: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua? Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat?",
        options: {
            A: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
            B: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Curabitur pretium tincidunt lacus.",
            C: "Nulla quis lorem ut libero malesuada feugiat. Vivamus suscipit tortor eget felis porttitor volutpat. Praesent sapien massa, convallis a pellentesque nec, egestas non nisi.",
            D: "Pellentesque in ipsum id orci porta dapibus. Vestibulum ac diam sit amet quam vehicula elementum sed sit amet dui. Curabitur non nulla sit amet nisl tempus convallis quis ac lectus.",
        },
        solution: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Curabitur pretium tincidunt lacus, et ultricies elit convallis quis. Nulla quis lorem ut libero malesuada feugiat, vivamus suscipit tortor eget felis porttitor volutpat. Praesent sapien massa, convallis a pellentesque nec, egestas non nisi. Pellentesque in ipsum id orci porta dapibus, vestibulum ac diam sit amet quam vehicula elementum sed sit amet dui. Curabitur non nulla sit amet nisl tempus convallis quis ac lectus, quisque velit nisi, pretium ut lacinia in, elementum id enim. Donec rutrum congue leo eget malesuada, cras ultricies ligula sed magna dictum porta, proin eget tortor risus.",
    })),
};
