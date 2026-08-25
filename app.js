/* ═══════════════════════════════════════════
   app.js — Initialisation, routing, toasts, spinner
   Point d'entrée principal (ES module).
══════════════════════════════════════════════ */

import {
  DEFAULT_SETTINGS,
  initDemoData, generateMissingSlots, getMemberById, getMembers,
} from './data.js';
import {
  restoreSession,
  bindLoginScreen, bindAdminLoginScreen, bindLogoutButtons,
  bindPinScreen, bindChoosePinScreen,
} from './auth.js';
import {
  renderMemberScreen, bindMemberTabs, bindMemberMonthNav, bindModMonthNav,
} from './member.js';
import { maybeShowOnboarding } from './onboarding.js';
import { bindInstallGuide, maybeShowInstallGuide } from './install-guide.js';
import {
  renderAdminScreen,
  bindAdminTabs, bindAdminMonthNav,
  bindCloseSlotModal, openCloseSlotModal,
  bindAddMemberModal, bindImportModal, bindAdminSettings, bindAdminStats,
  bindSyncFirebaseButton,
} from './admin.js';

/* ── Screens ── */

const SCREENS = [
  "screen-login",
  "screen-admin-login",
  "screen-pin",
  "screen-choose-pin",
  "screen-member",
  "screen-admin",
];

function showScreen(id) {
  SCREENS.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.hidden = (s !== id);
  });
}

/* ── Toasts ── */

function showToast(message, type) {
  const container = document.getElementById("toast-container");
  const toast     = document.createElement("div");
  toast.className = "toast";
  if (type === "error") toast.style.background = "var(--red, #ef4444)";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, 2500);
}

function showError() {
  showToast("Une erreur est survenue. Réessayez.", "error");
}

/* ── Spinner ── */

function showSpinner() {
  let s = document.getElementById("app-spinner");
  if (!s) {
    s = document.createElement("div");
    s.id = "app-spinner";
    s.style.cssText = [
      "position:fixed;inset:0;display:flex;align-items:center",
      "justify-content:center;background:rgba(255,255,255,.75)",
      "z-index:9999;font-size:1rem;color:var(--text2,#666);",
    ].join(";");
    s.textContent = "Chargement…";
    document.body.appendChild(s);
  }
  s.hidden = false;
}

function hideSpinner() {
  const s = document.getElementById("app-spinner");
  if (s) s.hidden = true;
}

/* ── Exposition globale des fonctions UI ──
   auth.js, member.js, admin.js y accèdent via window.*
   car les imports circulaires sont impossibles. */

window.showScreen           = showScreen;
window.showToast            = showToast;
window.showError            = showError;
window.showSpinner          = showSpinner;
window.hideSpinner          = hideSpinner;
window.renderMemberScreen   = renderMemberScreen;
window.renderAdminScreen    = renderAdminScreen;
window.openCloseSlotModal   = openCloseSlotModal;
window.maybeShowOnboarding  = maybeShowOnboarding;

/* ── Sync Firebase → localStorage (arrière-plan, non-bloquant) ── */

async function syncFromFirebase() {
  const fb = window.fbFunctions;
  if (!fb) return;

  try {
    const [membersResult, settingsResult] = await Promise.allSettled([
      fb.fbGetMembers(),
      fb.fbGetSettings(),
    ]);

    const members  = membersResult.value  || [];
    const settings = settingsResult.value || {};

    /* Premier lancement : Firestore est vide → on le peuple depuis localStorage */
    if (members.length === 0 && Object.keys(settings).length === 0) {
      fb.fbSeedIfEmpty(getMembers(), DEFAULT_SETTINGS);
      return;
    }

    if (members.length > 0) {
      localStorage.setItem("tpl_members", JSON.stringify(members));
    }
    if (Object.keys(settings).length > 0) {
      const cur = JSON.parse(localStorage.getItem("tpl_settings") || "{}");
      localStorage.setItem("tpl_settings", JSON.stringify({ ...cur, ...settings }));
    }
  } catch {}
}

/* ── Service Worker (PWA) ──
   updateViaCache:'none' force le navigateur à toujours vérifier le
   fichier service-worker.js sur le réseau (jamais via son cache HTTP) —
   sinon une mise à jour peut mettre des heures à être détectée. Dès
   qu'une nouvelle version prend le contrôle, on recharge une seule
   fois pour que l'appli affiche immédiatement le nouveau code, sans
   que l'utilisateur ait à vider le cache manuellement. */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
      .then(reg => reg.update())
      .catch(err => console.warn('Service Worker:', err));
  });

  let _swRefreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_swRefreshed) return;
    _swRefreshed = true;
    window.location.reload();
  });
}

/* ── DOMContentLoaded — initialisation synchrone ── */

document.addEventListener("DOMContentLoaded", () => {

  /* 1. Données de démo au premier lancement */
  initDemoData();

  /* 2. Génère les créneaux manquants (localStorage) */
  try { generateMissingSlots(); } catch (e) { console.warn("generateMissingSlots:", e); }

  /* 3. Restauration de session */
  const saved = localStorage.getItem("tpl_session");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const member = getMemberById(parsed.id);
      if (member) {
        restoreSession(member);
        renderMemberScreen();
        showScreen("screen-member");
      } else {
        localStorage.removeItem("tpl_session");
        showScreen("screen-login");
        document.getElementById("login-prenom").focus();
      }
    } catch (e) {
      restoreSession(null);
      localStorage.removeItem("tpl_session");
      showScreen("screen-login");
      document.getElementById("login-prenom").focus();
    }
  } else {
    showScreen("screen-login");
    document.getElementById("login-prenom").focus();
  }

  /* 4. Binding des composants UI */
  bindLoginScreen();
  bindAdminLoginScreen();
  bindLogoutButtons();
  bindPinScreen();
  bindChoosePinScreen();
  bindMemberTabs();
  bindMemberMonthNav();
  bindModMonthNav();
  bindAdminTabs();
  bindAdminMonthNav();
  bindCloseSlotModal();
  bindAddMemberModal();
  bindImportModal();
  bindAdminSettings();
  bindAdminStats();
  bindSyncFirebaseButton();
  bindInstallGuide();

  /* 5. Sync Firebase en arrière-plan, après affichage de l'écran */
  syncFromFirebase();

  /* 6. Guide d'installation — une seule fois, si l'app n'est pas déjà
     installée. Léger délai pour laisser le premier écran s'afficher. */
  setTimeout(() => maybeShowInstallGuide(), 400);
});
