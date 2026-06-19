/* ═══════════════════════════════════════════
   auth.js — Login membre (PIN Firebase), login admin, logout
══════════════════════════════════════════════ */

import { getSettings } from './data.js';

const SESSION_KEY  = "tpl_session";
const LAST_USER_KEY = "tpl_last_user";
const MEMBER_CACHE = "tpl_member_cache";
const PIN_LENGTH   = 4;

export let currentMember = null;
export let isAdmin       = false;

let _pendingMember = null;  /* membre Firebase complet { id, prenom, nom, pin_hash, pin_reset } */

/* ── SHA-256 — async local, zéro Firebase ── */
async function _hashPIN(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ── Session ── */

export function restoreSession(member) {
  currentMember = member;
  isAdmin       = false;
}

/* ── Connexion effective — appelée UNE SEULE FOIS quand membre + PIN validés ── */

function connectMember(member) {
  console.log("[TPL] 3. connectMember() :", member.prenom, member.nom);
  currentMember  = member;
  isAdmin        = false;
  _pendingMember = null;
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    id: member.id, prenom: member.prenom, nom: member.nom,
    is_moderator: !!member.is_moderator,
  }));
  console.log("[TPL] 4. renderMemberScreen()");
  window.renderMemberScreen();
  window.showScreen("screen-member");
  window.maybeShowOnboarding?.(member);
}

/* ── Login admin ── */

export function loginAdmin(pwd) {
  if (!pwd) return { ok: false, error: "Veuillez saisir le mot de passe." };
  const settings = getSettings();
  if (pwd !== settings.admin_pwd) return { ok: false, error: "Mot de passe incorrect." };
  isAdmin       = true;
  currentMember = null;
  return { ok: true };
}

/* ── Logout ── */

export function logout() {
  currentMember  = null;
  isAdmin        = false;
  _pendingMember = null;
  localStorage.removeItem(SESSION_KEY);
}

/* ── Pré-remplissage ── */

function _prefillLogin() {
  const saved = localStorage.getItem(LAST_USER_KEY);
  if (!saved) return false;
  try {
    const { prenom, nom } = JSON.parse(saved);
    if (!prenom && !nom) return false;
    document.getElementById("login-prenom").value = prenom || "";
    document.getElementById("login-nom").value    = nom    || "";
    const hint = document.getElementById("login-prefill-hint");
    if (hint) hint.hidden = false;
    return true;
  } catch { return false; }
}

function _goLogin() {
  window.showScreen("screen-login");
  document.getElementById("login-error").hidden = true;
  const prefilled = _prefillLogin();
  if (prefilled) document.getElementById("login-btn").focus();
  else           document.getElementById("login-prenom").focus();
}

/* ════════════════════════════════════════
   SCREEN LOGIN — UN SEUL appel Firebase
════════════════════════════════════════ */

export function bindLoginScreen() {
  const inputPrenom = document.getElementById("login-prenom");
  const inputNom    = document.getElementById("login-nom");
  const btn         = document.getElementById("login-btn");
  const errEl       = document.getElementById("login-error");
  const adminBtn    = document.getElementById("admin-access-btn");
  const hint        = document.getElementById("login-prefill-hint");

  const prefilled = _prefillLogin();
  if (prefilled) btn.focus();

  [inputPrenom, inputNom].forEach(el => {
    el.addEventListener("input", () => { if (hint) hint.hidden = true; });
  });

  btn.addEventListener("click", () => doLogin());
  [inputPrenom, inputNom].forEach(el => {
    el.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  });

  adminBtn.addEventListener("click", () => {
    errEl.hidden = true;
    window.showScreen("screen-admin-login");
    document.getElementById("admin-pwd").value    = "";
    document.getElementById("admin-error").hidden = true;
    document.getElementById("admin-pwd").focus();
  });

  async function doLogin() {
    errEl.hidden = true;
    const prenom = inputPrenom.value.trim();
    const nom    = inputNom.value.trim();

    if (!prenom || !nom) {
      errEl.textContent = "Veuillez saisir votre prénom et votre nom.";
      errEl.hidden = false;
      inputPrenom.focus();
      return;
    }

    /* Feedback visuel discret pendant l'appel réseau */
    btn.disabled    = true;
    btn.textContent = "Connexion…";

    /* ── 1. UN SEUL appel Firebase — reçoit id, prenom, nom, tel, pin_hash, pin_reset ── */
    let member = null;
    try {
      member = await Promise.race([
        window.fbFunctions?.fbFindMember(prenom, nom) ?? Promise.resolve(null),
        new Promise(r => setTimeout(() => r(null), 8000)),
      ]);
    } catch {}

    /* ── Fallback 1 : dernier membre mis en cache (hors ligne) ── */
    if (!member) {
      try {
        const cached = JSON.parse(localStorage.getItem(MEMBER_CACHE) || "null");
        if (cached &&
            cached.prenom?.toLowerCase() === prenom.toLowerCase() &&
            cached.nom?.toLowerCase()    === nom.toLowerCase()) {
          member = cached;
          console.log("[TPL] Mode hors ligne — cache utilisé");
        }
      } catch {}
    }

    /* ── Fallback 2 : membre présent dans tpl_members (local) mais absent de Firebase ── */
    if (!member) {
      try {
        const p = prenom.toLowerCase().trim();
        const n = nom.toLowerCase().trim();
        const allMembers = JSON.parse(localStorage.getItem("tpl_members") || "[]");
        const found = allMembers.find(m =>
          m.prenom?.toLowerCase().trim() === p &&
          m.nom?.toLowerCase().trim()    === n
        );
        if (found) {
          member = found;
          /* Resync vers Firebase — le membre était manquant */
          window.fbFunctions?.fbAddMember(found);
          console.log("[TPL] Membre absent de Firebase — resync déclenchée pour", found.prenom, found.nom);
        }
      } catch {}
    }

    btn.disabled    = false;
    btn.textContent = "Se connecter";

    if (!member) {
      errEl.textContent = "Nom introuvable. Vérifiez votre saisie ou votre connexion.";
      errEl.hidden = false;
      inputPrenom.focus();
      return;
    }

    console.log("[TPL] 1. Membre trouvé:", member.prenom, member.nom,
      "| pin_hash:", member.pin_hash ? "défini" : "absent",
      "| pin_reset:", member.pin_reset);

    /* ── 2. Mise en cache locale (hors ligne) ── */
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({ prenom: member.prenom, nom: member.nom }));
    localStorage.setItem(MEMBER_CACHE, JSON.stringify(member));
    inputPrenom.value = "";
    inputNom.value    = "";

    _pendingMember = member;

    /* ── 3. Route selon état du PIN ── */
    if (!member.pin_hash || member.pin_reset) {
      console.log("[TPL] → Première connexion ou reset, écran choix PIN");
      _resetChoosePin();
      window.showScreen("screen-choose-pin");
    } else {
      console.log("[TPL] → Écran PIN");
      _resetPinPad();
      window.showScreen("screen-pin");
    }
  }
}

/* ════════════════════════════════════════
   SCREEN PIN — vérification locale, zéro Firebase
════════════════════════════════════════ */

let _pinEntry = "";

function _resetPinPad() {
  _pinEntry = "";
  _renderPinDots();
  document.getElementById("pin-error").hidden      = true;
  document.getElementById("pin-forgot-msg").hidden = true;
  const nameEl = document.getElementById("pin-member-name");
  if (nameEl && _pendingMember) {
    nameEl.textContent = _pendingMember.prenom + " " + _pendingMember.nom;
  }
}

function _renderPinDots() {
  document.querySelectorAll(".pin-dot").forEach((dot, i) => {
    dot.classList.toggle("filled", i < _pinEntry.length);
  });
}

/* Vérification PIN : SHA-256 local contre pin_hash Firebase déjà en mémoire. Zéro appel réseau. */
async function _verifyPINAsync(errEl) {
  console.log("[TPL] 2. Vérification PIN locale (SHA-256, zéro Firebase)");
  try {
    const enteredHash = await _hashPIN(_pinEntry);
    if (enteredHash === _pendingMember.pin_hash) {
      console.log("[TPL] PIN correct");
      connectMember(_pendingMember);
    } else {
      _pinEntry = "";
      _renderPinDots();
      errEl.textContent = "PIN incorrect. Réessayez.";
      errEl.hidden      = false;
      console.log("[TPL] PIN incorrect");
    }
  } catch {
    window.showError();
  }
}

export function bindPinScreen() {
  const pad       = document.getElementById("pin-pad");
  const errEl     = document.getElementById("pin-error");
  const backBtn   = document.getElementById("pin-back-btn");
  const forgotBtn = document.getElementById("pin-forgot-btn");
  const forgotMsg = document.getElementById("pin-forgot-msg");

  pad.addEventListener("click", e => {
    const btn = e.target.closest("[data-digit]");
    if (!btn) return;
    const digit = btn.dataset.digit;

    if (digit === "del") {
      _pinEntry = _pinEntry.slice(0, -1);
      _renderPinDots();
      errEl.hidden = true;
      return;
    }

    if (_pinEntry.length >= PIN_LENGTH) return;
    _pinEntry += digit;
    _renderPinDots();

    if (_pinEntry.length === PIN_LENGTH) {
      _verifyPINAsync(errEl);  /* async SHA-256 local — zéro Firebase */
    }
  });

  backBtn.addEventListener("click", () => {
    _pendingMember = null;
    _pinEntry      = "";
    _goLogin();
  });

  forgotBtn.addEventListener("click", () => {
    forgotMsg.hidden = false;
  });
}

/* ════════════════════════════════════════
   SCREEN CHOISIR PIN — sauvegarde dans Firebase
════════════════════════════════════════ */

function _resetChoosePin() {
  const i1 = document.getElementById("choose-pin-input");
  const i2 = document.getElementById("choose-pin-confirm");
  if (i1) i1.value = "";
  if (i2) i2.value = "";
  document.getElementById("choose-pin-error").hidden = true;
  const nameEl = document.getElementById("choose-pin-name");
  if (nameEl && _pendingMember) {
    nameEl.textContent = _pendingMember.prenom + " " + _pendingMember.nom;
  }
  setTimeout(() => document.getElementById("choose-pin-input")?.focus(), 50);
}

export function bindChoosePinScreen() {
  const input   = document.getElementById("choose-pin-input");
  const confirm = document.getElementById("choose-pin-confirm");
  const btn     = document.getElementById("choose-pin-btn");
  const backBtn = document.getElementById("choose-pin-back");
  const errEl   = document.getElementById("choose-pin-error");

  btn.addEventListener("click", () => doChoosePin());
  [input, confirm].forEach(el => {
    el.addEventListener("keydown", e => { if (e.key === "Enter") doChoosePin(); });
  });

  backBtn.addEventListener("click", () => {
    _pendingMember = null;
    _goLogin();
    errEl.hidden = true;
  });

  async function doChoosePin() {
    const p1 = input.value.trim();
    const p2 = confirm.value.trim();
    errEl.hidden = true;

    if (!/^\d{4}$/.test(p1)) {
      errEl.textContent = "Le PIN doit être composé de 4 chiffres.";
      errEl.hidden = false;
      input.focus();
      return;
    }
    if (p1 !== p2) {
      errEl.textContent = "Les deux codes ne correspondent pas.";
      errEl.hidden = false;
      confirm.focus();
      return;
    }

    btn.disabled = true;
    try {
      /* SHA-256 local */
      const hash = await _hashPIN(p1);

      /* UN appel Firebase — sauvegarde pin_hash + efface pin_reset */
      window.fbFunctions?.fbUpdateMember(_pendingMember.id, {
        pin_hash:  hash,
        pin_reset: false,
      });

      /* Mise à jour du cache local */
      _pendingMember.pin_hash  = hash;
      _pendingMember.pin_reset = false;
      localStorage.setItem(MEMBER_CACHE, JSON.stringify(_pendingMember));

      console.log("[TPL] 2. PIN défini et sauvegardé dans Firebase");
      connectMember(_pendingMember);
    } catch {
      window.showError();
    } finally {
      btn.disabled = false;
    }
  }
}

/* ════════════════════════════════════════
   SCREEN LOGIN ADMIN
════════════════════════════════════════ */

export function bindAdminLoginScreen() {
  const input = document.getElementById("admin-pwd");
  const btn   = document.getElementById("admin-login-btn");
  const back  = document.getElementById("admin-back-btn");
  const errEl = document.getElementById("admin-error");

  btn.addEventListener("click", doAdminLogin);
  input.addEventListener("keydown", e => { if (e.key === "Enter") doAdminLogin(); });

  back.addEventListener("click", () => {
    errEl.hidden = true;
    input.value  = "";
    _goLogin();
  });

  function doAdminLogin() {
    errEl.hidden = true;
    btn.disabled = true;
    try {
      const result = loginAdmin(input.value);
      if (!result.ok) {
        errEl.textContent = result.error;
        errEl.hidden      = false;
        input.focus();
        return;
      }
      input.value = "";
      window.renderAdminScreen();
      window.showScreen("screen-admin");
    } catch {
      window.showError();
    } finally {
      btn.disabled = false;
    }
  }
}

/* ════════════════════════════════════════
   DÉCONNEXION
════════════════════════════════════════ */

export function bindLogoutButtons() {
  function _onLogout() {
    logout();
    _goLogin();
  }
  document.getElementById("member-logout").addEventListener("click", _onLogout);
  document.getElementById("admin-logout").addEventListener("click",  _onLogout);
}
