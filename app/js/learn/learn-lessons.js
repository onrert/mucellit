/*
 * learn-lessons.js — aşamalar ve adımlar (sıra: elle denenmiş ciltleme akışı):
 * katlama → delme → dikiş → forza → sırt (tutkal → kapital → sırt bezi) → kapak (bitmiş bloğun ölçüsüyle) → kaplama →
 * takma → pres → bitmiş kitap.
 * Her aşama bir figür (sekil) kullanır; "hazir": aynı figürün önceki aşamada biten adımları (figür o durumdan başlar).
 * Metinler sözlükte: ogren.<aşama>.ad / .ozet, ogren.<aşama>.<adım>.baslik / .aciklama / .dugme / [.arac] / [.dikkat].
 * LİSANS NOTU: Mücellit kodu (MIT, kökteki LICENSE); Colorfigures kodu içermez. Bu klasördeki Colorfigures parçaları MIT lisanslı
 * (April Zhu, Tolga Cohce), tam metin: LICENSE.
 * "az": figürün o kitapta karşılığı olmayan adımlar için (ör. 3 formalı kitapta zincir) açıklama anahtarının son eki.
 */
'use strict';
(function (root) {
  const MC = (root.Mucellit = root.Mucellit || {}).learn = root.Mucellit.learn || {};
  MC.lessons = [
    { id: 'folding', figures: 'folding', steps: ['grain', 'impose', 'fold', 'boneFolder', 'press'] },
    { id: 'punching', figures: 'sewing', steps: ['template', 'del', 'all'] },
    { id: 'sewing', figures: 'sewing', ready: ['template', 'del', 'all'], steps: ['prepare', 'first', 'second', 'third', 'chain', 'last'],
      az: { second: o => o.N < 2, third: o => o.N < 3, chain: o => o.N < 4 } },
    { id: 'endpapers', figures: 'endpapers', steps: ['fold', 'glue', 'top', 'bottom'] },
    { id: 'spine', figures: 'spine', steps: ['press', 'glue', 'headbands', 'mull'] },
    { id: 'cover', figures: 'cover', steps: ['measure', 'board', 'strip', 'covering'] },
    { id: 'covering', figures: 'covering', steps: ['glue', 'place', 'corner', 'turnIn', 'close'] },
    { id: 'casingIn', figures: 'casingIn', steps: ['dryFit', 'bottom', 'place', 'top', 'close', 'jointGap'] },
    { id: 'press', figures: 'casingIn', ready: ['dryFit', 'bottom', 'place', 'top', 'close', 'jointGap'], steps: ['waxed', 'mist', 'press', 'dry'] },
    { id: 'book', figures: 'book', steps: ['open', 'swap', 'more', 'close'] }
  ];
})(typeof self !== 'undefined' ? self : this);
