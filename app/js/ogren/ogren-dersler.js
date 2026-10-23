/*
 * ogren-dersler.js — aşamalar ve adımlar (sıra: elle denenmiş ciltleme akışı):
 * katlama → delme → dikiş → forza → sırt (tutkal → kapital → sırt bezi) → kapak (bitmiş bloğun ölçüsüyle) → kaplama →
 * takma → pres → bitmiş kitap.
 * Her aşama bir figür (sekil) kullanır; "hazir": aynı figürün önceki aşamada biten adımları (figür o durumdan başlar).
 * Metinler sözlükte: ogren.<aşama>.ad / .ozet, ogren.<aşama>.<adım>.baslik / .aciklama / .dugme / [.arac] / [.dikkat].
 * LİSANS NOTU: Mücellit kodu (MIT, kökteki LICENSE); Colorfigures kodu içermez. Bu klasördeki Colorfigures parçaları MIT lisanslı
 * (April Zhu, Tolga Cohce), tam metin: LICENSE.
 * "az": figürün o kitapta karşılığı olmayan adımlar için (ör. 3 formalı kitapta zincir) açıklama anahtarının son eki.
 */
'use strict';
(function (kok) {
  const KC = (kok.KitapCilt = kok.KitapCilt || {}).ogren = kok.KitapCilt.ogren || {};
  KC.dersler = [
    { id: 'katlama', sekil: 'katlama', adimlar: ['lif', 'diz', 'katla', 'kemik', 'pres'] },
    { id: 'delme', sekil: 'dikis', adimlar: ['sablon', 'del', 'tumu'] },
    { id: 'dikis', sekil: 'dikis', hazir: ['sablon', 'del', 'tumu'], adimlar: ['hazirla', 'ilk', 'ikinci', 'ucuncu', 'zincir', 'son'],
      az: { ikinci: o => o.N < 2, ucuncu: o => o.N < 3, zincir: o => o.N < 4 } },
    { id: 'forza', sekil: 'forza', adimlar: ['katla', 'tutkal', 'ust', 'alt'] },
    { id: 'sirt', sekil: 'sirt', adimlar: ['pres', 'tutkal', 'kapital', 'mull'] },
    { id: 'kapak', sekil: 'kapak', adimlar: ['olc', 'mukavva', 'serit', 'kaplama'] },
    { id: 'kaplama', sekil: 'kaplama', adimlar: ['tutkal', 'yerlestir', 'kose', 'kivir', 'kapat'] },
    { id: 'takma', sekil: 'takma', adimlar: ['kuru', 'alt', 'yerlestir', 'ust', 'kapat', 'mafsal'] },
    { id: 'pres', sekil: 'takma', hazir: ['kuru', 'alt', 'yerlestir', 'ust', 'kapat', 'mafsal'], adimlar: ['mumlu', 'sis', 'pres', 'kurut'] },
    { id: 'kitap', sekil: 'kitap', adimlar: ['ac', 'cevir', 'daha', 'kapat'] }
  ];
})(typeof self !== 'undefined' ? self : this);
