/*
 * storage.js — süreç verisini tarayıcıda saklar (localStorage, try/catch ile).
 * Saklama kullanılamazsa (gizli pencere, engellenmiş site verisi) veri yalnız
 * bu oturumda bellekte durur ve kullanıcı uyarılır; JSON yedeği her zaman çalışır.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var KEY = 'mucellit.projects';
  var memory = null;
  var persistent = true;

  var corruptRecord = false;

  function memoryCopy() { return JSON.parse(JSON.stringify(memory)); }

  function read() {
    // Son kalıcı yazım başarısızsa (kota dolu, saklama kapalı) localStorage'daki kayıt ESKİDİR;
    // en yeni veri bellektedir.
    if (!persistent && memory) return memoryCopy();
    var raw;
    try {
      raw = root.localStorage.getItem(KEY);
    } catch {
      persistent = false;
      return memory ? JSON.parse(JSON.stringify(memory)) : MC.projectModel.emptyData();
    }
    if (!raw) return memory ? JSON.parse(JSON.stringify(memory)) : MC.projectModel.emptyData();
    try {
      var data = JSON.parse(raw);
      if (MC.migrate) data = MC.migrate.projects(data); // data saved by an earlier version
      MC.projectModel.validate(data);
      return data;
    } catch {
      // Bozuk kayıt: üzerine yazılmadan önce ayrı anahtara yedeklenir, kullanıcı uyarılır.
      corruptRecord = true;
      try { root.localStorage.setItem(KEY + '.corrupt', raw); } catch { /* yer yok */ }
      return MC.projectModel.emptyData();
    }
  }

  function write(data) {
    memory = JSON.parse(JSON.stringify(data));
    try {
      root.localStorage.setItem(KEY, JSON.stringify(data));
      persistent = true;
      corruptRecord = false; // başarılı yazım bozuk kaydın üzerine yazdı; uyarı artık geçerli değil
      return true;
    } catch {
      persistent = false;
      return false;
    }
  }

  function clear() {
    // Bellek BOŞ veri olur (null değil): removeItem başarısız olursa oku() localStorage'daki eski kaydı döndürmesin.
    memory = MC.projectModel.emptyData();
    corruptRecord = false;
    try { root.localStorage.removeItem(KEY); persistent = true; } catch { persistent = false; /* silinemedi: bellek geçerli */ }
  }

  MC.storage = { read: read, write: write, clear: clear, isPersistent: function () { return persistent; }, isCorrupt: function () { return corruptRecord; }, KEY: KEY };
})(typeof self !== 'undefined' ? self : this);
