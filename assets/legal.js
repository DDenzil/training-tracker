// Fills the Privacy / Terms pages from config.js (no sign-in needed)
(function () {
  var C = window.OTT_CONFIG || {};
  document.querySelectorAll('[data-c]').forEach(function (el) {
    var v = C[el.getAttribute('data-c')];
    if (!v) return;
    el.textContent = v;
    if (el.hasAttribute('data-mail') && v.indexOf('@') > 0) el.href = 'mailto:' + v;
  });
  if (C.APP_NAME) document.title = document.title.replace('Training Tracker', C.APP_NAME);
})();
