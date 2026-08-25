/* ═══════════════════════════════════════════
   install-guide.js — Guide "Ajouter à l'écran d'accueil"
   Affiché une seule fois au premier lancement (si pas déjà
   installée en PWA), et rouvrable à tout moment depuis la
   barre de navigation.
══════════════════════════════════════════════ */

const SEEN_KEY = "tpl_install_guide_seen";

/* ── Détection ── */

function _isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
         window.navigator.standalone === true; /* iOS Safari */
}

function _detectOS() {
  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1); /* iPadOS 13+ se déclare "Mac" */
  return isIOS ? "ios" : "android";
}

/* ── Onglets iPhone / Android ── */

function _selectTab(os) {
  document.querySelectorAll("#ig-tabs .ig-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.os === os);
  });
  document.getElementById("ig-panel-ios").hidden     = (os !== "ios");
  document.getElementById("ig-panel-android").hidden = (os !== "android");
}

/* ── Ouverture / fermeture ── */

function _openInstallGuide() {
  _selectTab(_detectOS());
  document.getElementById("modal-install-guide").hidden = false;
}

function _closeInstallGuide() {
  document.getElementById("modal-install-guide").hidden = true;
  localStorage.setItem(SEEN_KEY, "1");
}

/* ── API publique ── */

export function bindInstallGuide() {
  const overlay = document.getElementById("modal-install-guide");
  if (!overlay) return;

  document.getElementById("ig-tabs").addEventListener("click", e => {
    const btn = e.target.closest("[data-os]");
    if (!btn) return;
    _selectTab(btn.dataset.os);
  });

  document.getElementById("ig-close-btn").addEventListener("click", _closeInstallGuide);
  document.getElementById("ig-close-x").addEventListener("click", _closeInstallGuide);

  overlay.addEventListener("click", e => {
    if (e.target === e.currentTarget) _closeInstallGuide();
  });

  document.querySelectorAll('[data-action="show-install-guide"]').forEach(btn => {
    btn.addEventListener("click", _openInstallGuide);
  });
}

/* À appeler une fois au démarrage de l'app. N'affiche rien si l'app
   tourne déjà en mode installé (standalone) ou si déjà vu. */
export function maybeShowInstallGuide() {
  if (_isStandalone()) return;
  if (localStorage.getItem(SEEN_KEY)) return;
  _openInstallGuide();
}
