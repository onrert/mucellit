/*
 * learn-lessons.js — stages and steps (order: a binding flow tried by hand):
 * folding → punching → sewing → endpapers → spine (glue → headbands → mull) → cover (with the size of the finished block) →
 * covering → casing-in → press → finished book.
 * Every stage uses a figure; "ready": the steps of the same figure finished in an earlier stage (the figure starts from that state).
 * Texts are in the dictionary: learn.<stage>.name / .summary, learn.<stage>.<step>.title / .description / .button / [.tool] / [.caution].
 * LICENSE NOTE: Mucellit code (MIT, LICENSE at the root); it contains no Colorfigures code. The Colorfigures parts in this
 * folder are MIT licensed (April Zhu, Tolga Cohce), full text: LICENSE.
 * "few": for steps that have no counterpart in this book (e.g. the kettle stitch in a book of 3 signatures), the suffix of
 * the description key (.description_few).
 */
'use strict';
(function (root) {
  const MC = (root.Mucellit = root.Mucellit || {}).learn = root.Mucellit.learn || {};
  MC.lessons = [
    { id: 'folding', figures: 'folding', steps: ['grain', 'impose', 'fold', 'boneFolder', 'press'] },
    { id: 'punching', figures: 'sewing', steps: ['template', 'punch', 'all'] },
    { id: 'sewing', figures: 'sewing', ready: ['template', 'punch', 'all'], steps: ['prepare', 'first', 'second', 'third', 'chain', 'last'],
      few: { second: o => o.N < 2, third: o => o.N < 3, chain: o => o.N < 4 } },
    { id: 'endpapers', figures: 'endpapers', steps: ['fold', 'glue', 'top', 'bottom'] },
    { id: 'spine', figures: 'spine', steps: ['press', 'glue', 'headbands', 'mull'] },
    { id: 'cover', figures: 'cover', steps: ['measure', 'board', 'strip', 'covering'] },
    { id: 'covering', figures: 'covering', steps: ['glue', 'place', 'corner', 'turnIn', 'close'] },
    { id: 'casingIn', figures: 'casingIn', steps: ['dryFit', 'bottom', 'place', 'top', 'close', 'jointGap'] },
    { id: 'press', figures: 'casingIn', ready: ['dryFit', 'bottom', 'place', 'top', 'close', 'jointGap'], steps: ['waxed', 'mist', 'press', 'dry'] },
    { id: 'book', figures: 'book', steps: ['open', 'swap', 'more', 'close'] }
  ];
})(typeof self !== 'undefined' ? self : this);
