/*
 * app.js — tabs and start-up. Loaded last.
 * i18n.js writes the static labels itself as soon as it loads; the language picker is also filled right away here
 * (the interface has text even when platform.ready is rejected). start() applies the labels again (the Tauri language
 * sync may have changed the language). When i18n.js did not run at all (no MC.i18n) the interface keeps the static
 * English of index.html and the start-up error is reported in English.
 */
(function (root) {
  'use strict';
  var MC = root.Mucellit = root.Mucellit || {};
  var O = MC.common, $ = O.$, D = MC.i18n;
  var TAB_KEY = 'mucellit.tab';
  var TABS = ['impose', 'projects', 'calculator', 'learn']; // 4th tab Learn (View > Learn ⌘4)

  /**
   * When the Learn tab opens, the guide is set up (the first time) or its figure is set up again; when another tab
   * is opened, "from start to finish" stops and the figure is unmounted (no animation/rAF in a hidden tab). hide is
   * called AFTER the tab is hidden, show AFTER it is shown (the figure is measured in the visible panel).
   */
  function learnTab() { return MC.learn && MC.learn.tab ? MC.learn.tab : null; }

  function openTab(name) {
    if (TABS.indexOf(name) < 0) name = 'impose';
    TABS.forEach(function (s) {
      $('tab-' + s).hidden = s !== name;
      $('tab-button-' + s).setAttribute('aria-selected', s === name ? 'true' : 'false');
    });
    O.writeLocal(TAB_KEY, name);
    var og = learnTab();
    if (og) {
      try { if (name === 'learn') og.show(); else og.hide(); }
      catch (e) { // the tab switch is not left half done; the error is reported and not swallowed (it also shows in the console)
        O.notify(D.t('learn.openFailed', { error: e && e.message ? e.message : e }), 'error');
        setTimeout(function () { throw e; }, 0);
      }
    }
  }

  function start() {
    var missing = [];
    if (!root.PDFLib) missing.push('pdf-lib');
    if (!root.pdfjsLib) missing.push('pdf.js');
    if (missing.length) {
      O.notify(D.t('app.no_library', { names: missing.join(D.t('app.and')), hint: MC.platform.text.libraryHint }), 'error');
    }
    D.apply(document);
    if (O.setupNumberFields) O.setupNumberFields(document); // number fields with the language's decimal separator
    fillLanguagePicker();
    var tabs = document.querySelectorAll('nav [role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) { openTab(e.currentTarget.getAttribute('data-tab')); });
    }
    MC.projects.start();
    MC.impose.start();
    MC.calculator.start();
    openTab(O.readLocal(TAB_KEY) || 'impose');
    document.documentElement.setAttribute('data-ready', 'yes');
  }

  // ---------------------------------------------------------------- language choice
  /**
   * The language a choice stands for: 'system' → the system language (in Tauri the one reported by Rust, the same
   * source as "System Language (X)" in the menu; navigator.languages in the browser). The Apple rule is in i18n.js.
   */
  function languageForChoice(choice) { return D.isSupported(choice) ? choice : D.systemCode(); }

  /** The options of the language picker (can be called again: after the Tauri sync the name of the system language may change). */
  function fillLanguagePicker() {
    var select = $('i18n-select');
    if (!select) return;
    // the hint is not static (no title in index.html): after a reload "Language" is not shown in the old language; every
    // fill (start-up, start after the Tauri sync) writes it in the selected language.
    if (typeof select.setAttribute === 'function') select.setAttribute('title', D.t('language.label'));
    if (typeof select.appendChild !== 'function') return;
    select.textContent = '';
    var options = [['system', D.t('language.system', { name: D.name(languageForChoice('system')) })]].concat(D.languages().map(function (k) { return [k, D.name(k)]; }));
    options.forEach(function (s) { select.appendChild(O.el('option', { value: s[0], text: s[1], lang: s[0] === 'system' ? null : s[0] })); });
    select.value = D.readChoice() || 'system';
  }

  /** Language picker: filled right away, the change listener is bound once. */
  function setupLanguagePicker() {
    var select = $('i18n-select');
    fillLanguagePicker();
    if (!select || typeof select.appendChild !== 'function') return;
    select.addEventListener('change', function () {
      var requested = select.value;
      select.value = D.readChoice() || 'system'; // the change shows once changeLanguage has been confirmed
      changeLanguage(requested);
    });
  }

  /**
   * Changes the interface language: choice 'system' | 'en' | 'tr'. The choice is stored (localStorage; in Tauri Rust
   * also rebuilds the menu and backs the choice up); when the visible language changes the page is reloaded (asking
   * for confirmation first when a document is open). Promise<boolean>: whether it changed.
   */
  function changeLanguage(choice) {
    if (choice !== 'system' && !D.isSupported(choice)) return Promise.resolve(false);
    var previous = D.readChoice() || 'system';
    if (choice === previous) return Promise.resolve(false);
    var target = languageForChoice(choice);
    var needsReload = target !== D.code();
    var hasDocument = !!(MC.impose && MC.impose.summary && MC.impose.summary().pageCount > 0);
    var ask = needsReload && hasDocument ? MC.platform.ask(D.t('language.refresh_confirm')) : Promise.resolve(true);
    return ask.then(function (ok) {
      if (!ok) return false;
      // Rust first (Tauri: menu + backup); when that fails the choice does not change.
      return Promise.resolve(MC.platform.notifyLanguage ? MC.platform.notifyLanguage(target, choice) : null).then(function () {
        D.writeChoice(choice === 'system' ? null : choice);
        var select = $('i18n-select');
        if (select) select.value = choice;
        if (needsReload) root.location.reload();
        return true;
      });
    }).catch(function (e) {
      O.notify(D.t('language.set_failed', { error: e && e.message ? e.message : e }), 'error');
      return false;
    });
  }

  MC.app = { openTab: openTab, changeLanguage: changeLanguage };
  // the picker is filled right away (ready is not awaited); without i18n.js the picker is empty and the static English stays.
  try { if (D) setupLanguagePicker(); } catch (e) { /* start-up continues; the error shows again in start */ }
  function prepareAndStart() {
    // .catch: a rejected platform.ready and an error thrown inside start() both go to the notice. When the language layer is
    // missing (i18n.js failed to load/threw) the notice uses the en dictionary text (the static interface is English too).
    MC.platform.ready.then(start).catch(function (e) {
      var error = e && e.message ? e.message : e;
      O.notify(D ? D.t('app.startFailed', { error: error }) : "The app couldn't start: " + error, 'error');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepareAndStart);
  else prepareAndStart();
})(typeof self !== 'undefined' ? self : this);
