/* ═══════════════════════════════════════════
   admin.js — Vue admin (calendrier, membres, paramètres)
══════════════════════════════════════════════ */

import {
  getAvatarColorIndex, getInitials, fullName, getAvatarBgColor,
  dateToKey, keyToDate, lastDayOfMonth, getSettings,
  generateMissingSlots, getSlotsWithRegistrations,
  getMembers, getMemberUpcomingCount,
  addMember, deleteMember, setModerator, importMembers,
  updateSetting, updateFutureSlotsPlaces, closeSlot, openSlot, deleteRegistration,
  patchSlotFromFirebase, _load,
} from './data.js';
import {
  renderCalendarGrid, refreshDots, weekRangeLabel,
  buildAdminBadge, buildInscritRow, DAYS_FR,
  buildMonthWeeks,
} from './calendar.js';

const adminState = {
  year:         0,
  month:        0,
  selectedWeek: null,
  slotsMap:     {},
  settings:     {},
};

let _closeSlotCallback = null;

/* ── Listeners temps réel ── */

let adminListeners = [];

function clearAdminListeners() {
  adminListeners.forEach(fn => { try { fn(); } catch {} });
  adminListeners = [];
}
window.clearAdminListeners = clearAdminListeners;

function setupAdminWeekListeners(mondayKey) {
  if (!window.fbFunctions?.fbListenDay) return;
  const monday = keyToDate(mondayKey);
  for (let i = 0; i < 5; i++) {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = dateToKey(day);
    const unsub = window.fbFunctions.fbListenDay(key, (slotDate, regs, slotDoc) => {
      const slot = adminState.slotsMap[slotDate];
      if (!slot) return;
      const allMembers = getMembers();
      slot.inscrits = regs.map(r => {
        const m = allMembers.find(mb => mb.id === r.member_id);
        return m || { id: r.member_id, prenom: r.member_prenom, nom: r.member_nom, tel: r.member_tel };
      });
      if (slotDoc.places !== undefined && slotDoc.places !== slot.places) {
        slot.places = slotDoc.places;
        patchSlotFromFirebase(slotDate, { places: slotDoc.places });
      }
      if (adminState.selectedWeek !== mondayKey) return;
      refreshDots(document.getElementById("admin-cal-body"),
        adminState.year, adminState.month, null, adminState.slotsMap);
      renderAdminWeekDetail(mondayKey);
    });
    adminListeners.push(unsub);
  }
}

/* ════════════════════════════════════════
   POINT D'ENTRÉE
════════════════════════════════════════ */

export function renderAdminScreen() {
  const today       = new Date();
  adminState.year   = today.getFullYear();
  adminState.month  = today.getMonth();
  adminState.selectedWeek = null;
  adminState.settings = getSettings();
  renderAdminCalendar();
  switchAdminTab("admin-calendar");
}

/* ════════════════════════════════════════
   ONGLETS ADMIN
════════════════════════════════════════ */

export function bindAdminTabs() {
  document.getElementById("admin-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    switchAdminTab(btn.dataset.tab);
  });
}

function switchAdminTab(tabId) {
  clearAdminListeners();
  document.querySelectorAll("#admin-tabs .tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.getElementById("tab-admin-calendar").hidden = (tabId !== "admin-calendar");
  document.getElementById("tab-admin-members").hidden  = (tabId !== "admin-members");
  document.getElementById("tab-admin-settings").hidden = (tabId !== "admin-settings");
  document.getElementById("tab-admin-stats").hidden    = (tabId !== "admin-stats");

  if (tabId !== "admin-members") {
    const searchEl = document.getElementById("members-search");
    if (searchEl) searchEl.value = "";
  }

  if (tabId === "admin-members")  renderAdminMembers();
  if (tabId === "admin-settings") renderAdminSettings();
  if (tabId === "admin-stats")    renderAdminStats();
  if (tabId === "admin-calendar" && adminState.selectedWeek) setupAdminWeekListeners(adminState.selectedWeek);
}

/* ════════════════════════════════════════
   NAVIGATION MOIS — ADMIN
════════════════════════════════════════ */

export function bindAdminMonthNav() {
  document.getElementById("admin-prev-month").addEventListener("click", () => shiftAdminMonth(-1));
  document.getElementById("admin-next-month").addEventListener("click", () => shiftAdminMonth(+1));
}

function getAdminMonthBounds() {
  const today    = new Date();
  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();

  let minYear = curYear, minMonth = curMonth - 2;
  while (minMonth < 0) { minMonth += 12; minYear--; }

  let maxYear = curYear, maxMonth = curMonth + 2;
  while (maxMonth > 11) { maxMonth -= 12; maxYear++; }

  return { minYear, minMonth, maxYear, maxMonth };
}

function shiftAdminMonth(delta) {
  let { year, month } = adminState;
  month += delta;
  if (month < 0)  { month = 11; year--; }
  if (month > 11) { month = 0;  year++; }

  const { minYear, minMonth, maxYear, maxMonth } = getAdminMonthBounds();
  if (year < minYear || (year === minYear && month < minMonth)) return;
  if (year > maxYear || (year === maxYear && month > maxMonth)) return;

  adminState.year = year; adminState.month = month; adminState.selectedWeek = null;
  clearAdminListeners();
  try { generateMissingSlots(); } catch {}
  renderAdminCalendar();
}

/* ════════════════════════════════════════
   CALENDRIER ADMIN
════════════════════════════════════════ */

function renderAdminCalendar() {
  const { year, month } = adminState;

  const label = new Date(year, month, 1)
    .toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  document.getElementById("admin-month-label").textContent =
    label.charAt(0).toUpperCase() + label.slice(1);

  const { minYear, minMonth, maxYear, maxMonth } = getAdminMonthBounds();
  document.getElementById("admin-prev-month").disabled =
    (year < minYear || (year === minYear && month <= minMonth));
  document.getElementById("admin-next-month").disabled =
    (year > maxYear || (year === maxYear && month >= maxMonth));

  const firstDate = dateToKey(new Date(year, month, 1));
  const lastDate  = dateToKey(lastDayOfMonth(year, month));
  adminState.slotsMap = getSlotsWithRegistrations(firstDate, lastDate);

  const calBody = document.getElementById("admin-cal-body");

  function handleWeekClick(mondayKey) {
    adminState.selectedWeek = mondayKey;
    clearAdminListeners();
    renderCalendarGrid(calBody, year, month, null, mondayKey, handleWeekClick, adminState.slotsMap);
    renderAdminWeekDetail(mondayKey);
    setupAdminWeekListeners(mondayKey);
    setTimeout(() => document.getElementById("admin-week-detail")
      .scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  renderCalendarGrid(calBody, year, month, null, adminState.selectedWeek, handleWeekClick, adminState.slotsMap);
  if (!adminState.selectedWeek) document.getElementById("admin-week-detail").hidden = true;
  else {
    renderAdminWeekDetail(adminState.selectedWeek);
    setupAdminWeekListeners(adminState.selectedWeek);
  }
}

/* ════════════════════════════════════════
   DÉTAIL SEMAINE — ADMIN
════════════════════════════════════════ */

function renderAdminWeekDetail(mondayKey) {
  const detail = document.getElementById("admin-week-detail");
  const title  = document.getElementById("admin-week-title");
  const cards  = document.getElementById("admin-day-cards");

  detail.hidden = false;
  title.textContent = weekRangeLabel(mondayKey);
  cards.innerHTML   = "";

  const slotsMap = adminState.slotsMap;
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const monday   = keyToDate(mondayKey);

  for (let i = 0; i < 5; i++) {
    const day  = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key  = dateToKey(day);
    const slot = slotsMap[key] || { id: null, date: key, inscrits: [], is_closed: false, close_reason: null, places: 2 };
    const isPast = day < today;

    const card = document.createElement("div");
    card.className = "day-card";

    const hdrClass  = slot.is_closed ? "closed-header" : isPast ? "past-header" : "";
    const badge     = buildAdminBadge(slot);
    const timeLabel = slot.heure_debut && slot.heure_fin
      ? `${slot.heure_debut.slice(0,5)} – ${slot.heure_fin.slice(0,5)}` : "07:00 – 09:00";
    const lieuLabel = slot.lieu || "Gare d'Agen";

    card.innerHTML = `
      <div class="day-card-header ${hdrClass}">
        <div>
          <div class="day-card-name">${DAYS_FR[i]}</div>
          <div class="day-card-time">${timeLabel} · ${lieuLabel}</div>
        </div>
        ${badge}
      </div>`;

    if (slot.is_closed && slot.close_reason) {
      const r = document.createElement("div");
      r.className = "slot-closed-reason";
      r.innerHTML = `<i class="ti ti-alert-triangle"></i> ${slot.close_reason}`;
      card.appendChild(r);
    }

    const body = document.createElement("div");
    body.className = "day-card-body";

    if (!slot.inscrits || slot.inscrits.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText = "font-size:.82rem;color:var(--text3);padding:.2rem 0;";
      empty.textContent = "Aucun inscrit";
      body.appendChild(empty);
    } else {
      slot.inscrits.forEach(m => { body.innerHTML += buildInscritRow(m, false, true, slot.id); });
    }

    card.appendChild(body);

    if (!isPast && slot.id) {
      const actionDiv = document.createElement("div");
      actionDiv.className = "day-card-action";
      if (slot.is_closed) {
        actionDiv.innerHTML = `
          <button class="btn btn-outline-green btn-sm" data-action="reopen" data-slot-id="${slot.id}">Réouvrir</button>`;
      } else {
        actionDiv.innerHTML = `
          <button class="btn btn-outline-red btn-sm" data-action="close" data-slot-id="${slot.id}">Fermer ce créneau</button>`;
      }
      card.appendChild(actionDiv);
    }

    cards.appendChild(card);
  }

  cards.onclick = (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action   = btn.dataset.action;
    const slotId   = btn.dataset.slotId;
    const memberId = btn.dataset.memberId;

    if (action === "close") {
      openCloseSlotModal((reason) => {
        closeSlot(slotId, reason);
        window.showToast("Créneau fermé.");
        _refreshAdminCalendar();
      });
    }
    if (action === "reopen") adminReopenSlot(slotId);
    if (action === "remove") adminRemoveInscrit(slotId, memberId);
  };
}

/* ════════════════════════════════════════
   FERMER / RÉOUVRIR UN CRÉNEAU
════════════════════════════════════════ */

export function bindCloseSlotModal() {
  document.getElementById("modal-close-cancel").addEventListener("click", closeCloseSlotModal);
  document.getElementById("modal-close-confirm").addEventListener("click", confirmCloseSlot);
  document.getElementById("modal-close-slot").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeCloseSlotModal();
  });
}

export function openCloseSlotModal(onConfirm) {
  _closeSlotCallback = onConfirm;
  document.getElementById("close-reason").value      = "";
  document.getElementById("modal-close-slot").hidden = false;
  document.getElementById("close-reason").focus();
}

function closeCloseSlotModal() {
  _closeSlotCallback = null;
  document.getElementById("modal-close-slot").hidden = true;
}

function confirmCloseSlot() {
  if (!_closeSlotCallback) return;
  const reason = document.getElementById("close-reason").value.trim();
  const action = _closeSlotCallback;
  closeCloseSlotModal();
  try {
    action(reason);
  } catch (e) { window.showError(); }
}

function adminReopenSlot(slotId) {
  try {
    openSlot(slotId);
    window.showToast("Créneau réouvert.");
    _refreshAdminCalendar();
  } catch (e) { window.showError(); }
}

function adminRemoveInscrit(slotId, memberId) {
  try {
    deleteRegistration(slotId, memberId);
    window.showToast("Inscrit retiré.");
    _refreshAdminCalendar();
  } catch (e) { window.showError(); }
}

function _refreshAdminCalendar() {
  const { year, month } = adminState;
  const firstDate = dateToKey(new Date(year, month, 1));
  const lastDate  = dateToKey(lastDayOfMonth(year, month));
  adminState.slotsMap = getSlotsWithRegistrations(firstDate, lastDate);
  refreshDots(document.getElementById("admin-cal-body"), year, month, null, adminState.slotsMap);
  if (adminState.selectedWeek) renderAdminWeekDetail(adminState.selectedWeek);
}

/* ════════════════════════════════════════
   MEMBRES — ADMIN
════════════════════════════════════════ */

function renderAdminMembers() {
  const countEl  = document.getElementById("members-count");
  const listEl   = document.getElementById("members-list");
  const searchEl = document.getElementById("members-search");
  listEl.innerHTML = "";

  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener("input", () => renderAdminMembers());
  }

  const rawQuery  = searchEl ? searchEl.value.trim() : "";
  const normalize = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q         = normalize(rawQuery);

  const allMembers = getMembers();
  const members    = q
    ? allMembers.filter(m => normalize(fullName(m)).includes(q) || normalize(m.tel || "").includes(q))
    : allMembers;

  countEl.textContent = `${allMembers.length} membre${allMembers.length > 1 ? "s" : ""}`;

  if (members.length === 0) {
    listEl.innerHTML = rawQuery
      ? `<div class="empty-state" style="padding:2rem 1.25rem;">
           <i class="ti ti-search-off"></i>
           Aucun membre trouvé pour « ${rawQuery} »
         </div>`
      : `<div class="empty-state" style="padding:2rem 1.25rem;">
           <i class="ti ti-users-off"></i>
           Aucun membre enregistré.
         </div>`;
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "members-wrap";

  for (const member of members) {
    const idx   = getAvatarColorIndex(member.id);
    const init  = getInitials(fullName(member));
    const count = getMemberUpcomingCount(member.id);

    const modBadge = member.is_moderator
      ? `<span style="background:#f59e0b;color:#fff;font-size:.62rem;font-weight:700;padding:.1rem .35rem;border-radius:.25rem;margin-left:.4rem;vertical-align:middle;">Modérateur</span>`
      : "";

    const toggleLabel = member.is_moderator ? "Retirer modération" : "Rendre modérateur";
    const toggleClass = member.is_moderator ? "btn-outline-red" : "btn-ghost";

    const card = document.createElement("div");
    card.className = "member-card";
    card.innerHTML = `
      <div class="member-avatar-lg av-${idx}" style="background:${getAvatarBgColor(idx)}">${init}</div>
      <div class="member-info">
        <div class="member-name">${fullName(member)}${modBadge}</div>
        <div class="member-meta">
          ${member.tel
            ? `<a href="tel:${member.tel.replace(/\s/g,"")}" class="inscrit-tel">${member.tel}</a>`
            : ""}
          <span class="member-slots-count">${count} créneau${count !== 1 ? "x" : ""} à venir</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-end;">
        <button class="btn btn-sm ${toggleClass}"
                data-mod-toggle="${member.id}"
                data-mod-value="${!member.is_moderator}"
                style="font-size:.75rem;white-space:nowrap;">${toggleLabel}</button>
        <button class="btn btn-sm btn-ghost"
                data-reset-pin="${member.id}"
                style="font-size:.72rem;white-space:nowrap;color:var(--orange);">Réinitialiser PIN</button>
        <button class="btn-delete" data-member-id="${member.id}" title="Supprimer ${fullName(member)}">
          <i class="ti ti-trash"></i>
        </button>
      </div>`;
    wrap.appendChild(card);
  }

  listEl.appendChild(wrap);

  wrap.addEventListener("click", e => {
    const pinResetBtn = e.target.closest("[data-reset-pin]");
    if (pinResetBtn) {
      const memberId = pinResetBtn.dataset.resetPin;
      const member   = members.find(m => m.id === memberId);
      if (!confirm(`Réinitialiser le PIN de ${fullName(member)} ?\nLe membre devra choisir un nouveau code à sa prochaine connexion.`)) return;
      window.fbFunctions?.fbSetPinReset(memberId);
      window.showToast(`PIN de ${fullName(member)} réinitialisé.`);
      return;
    }

    const modBtn = e.target.closest("[data-mod-toggle]");
    if (modBtn) {
      const memberId = modBtn.dataset.modToggle;
      const newValue = modBtn.dataset.modValue === "true";
      const member   = members.find(m => m.id === memberId);
      try {
        setModerator(memberId, newValue);
        window.showToast(newValue
          ? `${fullName(member)} est maintenant modérateur.`
          : `Modération retirée pour ${fullName(member)}.`);
        renderAdminMembers();
      } catch { window.showError(); }
      return;
    }

    const deleteBtn = e.target.closest("[data-member-id]");
    if (deleteBtn) {
      const member = members.find(m => m.id === deleteBtn.dataset.memberId);
      if (member) adminDeleteMember(member);
    }
  });
}

function adminDeleteMember(member) {
  if (!confirm(`Supprimer ${fullName(member)} ?\n\nCette action est irréversible.`)) return;
  try {
    deleteMember(member.id);
    window.showToast(`${fullName(member)} supprimé.`);
    renderAdminMembers();
  } catch { window.showError(); }
}

/* ════════════════════════════════════════
   SYNC FIREBASE
════════════════════════════════════════ */

export function bindSyncFirebaseButton() {
  document.getElementById("sync-firebase-btn").addEventListener("click", async () => {
    const members = getMembers();
    if (members.length === 0) { window.showToast("Aucun membre à synchroniser."); return; }
    const btn = document.getElementById("sync-firebase-btn");
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader"></i> Sync…';
    try {
      await Promise.allSettled(members.map(m => window.fbFunctions?.fbAddMember(m)));
      window.showToast(`${members.length} membre${members.length > 1 ? "s" : ""} synchronisé${members.length > 1 ? "s" : ""} vers Firebase.`);
    } catch {
      window.showToast("Erreur lors de la synchronisation.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-cloud-upload"></i> Sync';
    }
  });
}

/* ════════════════════════════════════════
   MODAL AJOUT MEMBRE
════════════════════════════════════════ */

export function bindAddMemberModal() {
  document.getElementById("add-member-btn").addEventListener("click", () => {
    ["new-member-prenom","new-member-nom","new-member-tel"].forEach(id => {
      document.getElementById(id).value = "";
    });
    document.getElementById("add-member-error").hidden = true;
    document.getElementById("modal-add-member").hidden = false;
    document.getElementById("new-member-prenom").focus();
  });

  document.getElementById("modal-member-cancel").addEventListener("click", () => {
    document.getElementById("modal-add-member").hidden = true;
  });

  document.getElementById("modal-add-member").addEventListener("click", e => {
    if (e.target === e.currentTarget)
      document.getElementById("modal-add-member").hidden = true;
  });

  document.getElementById("modal-member-confirm").addEventListener("click", () => {
    const prenom = document.getElementById("new-member-prenom").value.trim();
    const nom    = document.getElementById("new-member-nom").value.trim();
    const tel    = document.getElementById("new-member-tel").value.trim();
    const errEl  = document.getElementById("add-member-error");
    errEl.hidden = true;

    if (!prenom || !nom) {
      errEl.textContent = "Le prénom et le nom sont obligatoires.";
      errEl.hidden = false; return;
    }

    try {
      addMember({ prenom, nom, tel });
      document.getElementById("modal-add-member").hidden = true;
      renderAdminMembers();
      window.showToast(`${prenom} ${nom} ajouté.`);
    } catch {
      errEl.textContent = "Erreur lors de l'ajout. Réessayez.";
      errEl.hidden = false;
    }
  });
}

/* ════════════════════════════════════════
   MODAL CODE INVITATION
════════════════════════════════════════ */

export function bindInviteCodeModal() {
  document.getElementById("modal-close-invite").addEventListener("click", () => {
    document.getElementById("modal-invite-code").hidden = true;
  });
  document.getElementById("modal-invite-code").addEventListener("click", e => {
    if (e.target === e.currentTarget) document.getElementById("modal-invite-code").hidden = true;
  });
  document.getElementById("modal-copy-invite").addEventListener("click", () => {
    const code = document.getElementById("modal-invite-code-value").textContent;
    navigator.clipboard?.writeText(code)
      .then(() => window.showToast("Code copié !"))
      .catch(() => window.showToast("Code : " + code));
  });
}

/* ════════════════════════════════════════
   PARAMÈTRES — ADMIN
════════════════════════════════════════ */

function renderAdminSettings() {
  adminState.settings = getSettings();
  const s = adminState.settings;
  document.getElementById("banner-text").value   = s.banner || "";
  document.getElementById("places-input").value  = s.places_default || 2;
  document.getElementById("urgence-jc-tel").value = s.urgence_jc_tel || "";
  document.getElementById("urgence-kb-tel").value = s.urgence_kb_tel || "";
  document.getElementById("new-pwd").value       = "";
  document.getElementById("confirm-pwd").value   = "";
  document.getElementById("pwd-error").hidden    = true;
}

export function bindAdminSettings() {
  document.getElementById("save-pwd-btn").addEventListener("click", () => {
    const pwd1  = document.getElementById("new-pwd").value;
    const pwd2  = document.getElementById("confirm-pwd").value;
    const errEl = document.getElementById("pwd-error");
    errEl.hidden = true;

    if (!pwd1 || !pwd2) {
      errEl.textContent = "Veuillez remplir les deux champs.";
      errEl.hidden = false; return;
    }
    if (pwd1 !== pwd2) {
      errEl.textContent = "Les mots de passe ne correspondent pas.";
      errEl.hidden = false; return;
    }
    try {
      updateSetting("admin_pwd", pwd1);
      document.getElementById("new-pwd").value     = "";
      document.getElementById("confirm-pwd").value = "";
      window.showToast("Mot de passe mis à jour.");
    } catch { window.showError(); }
  });

  document.getElementById("save-banner-btn").addEventListener("click", () => {
    const text = document.getElementById("banner-text").value.trim();
    try {
      updateSetting("banner", text);
      adminState.settings.banner = text;
      window.showToast("Bannière enregistrée.");
    } catch { window.showError(); }
  });

  document.getElementById("save-places-btn").addEventListener("click", () => {
    const val = parseInt(document.getElementById("places-input").value, 10);
    if (isNaN(val) || val < 1 || val > 10) { window.showToast("Valeur invalide (1 à 10)."); return; }
    try {
      updateSetting("places_default", val);
      const count = updateFutureSlotsPlaces(val);
      adminState.settings.places_default = String(val);
      window.showToast(`${count} créneau${count > 1 ? "x" : ""} mis à jour avec ${val} place${val > 1 ? "s" : ""}.`);
    } catch { window.showError(); }
  });

  document.getElementById("save-urgence-btn").addEventListener("click", () => {
    const jcTel = document.getElementById("urgence-jc-tel").value.trim();
    const kbTel = document.getElementById("urgence-kb-tel").value.trim();
    try {
      updateSetting("urgence_jc_tel", jcTel);
      updateSetting("urgence_kb_tel", kbTel);
      adminState.settings.urgence_jc_tel = jcTel;
      adminState.settings.urgence_kb_tel = kbTel;
      window.showToast("Contacts d'urgence enregistrés.");
    } catch { window.showError(); }
  });
}

/* ════════════════════════════════════════
   IMPORT MEMBRES (SheetJS)
════════════════════════════════════════ */

let _importRows    = [];
let _importHeaders = [];

const _ALIASES = {
  prenom: ["prénom", "prenom", "firstname", "first name", "first_name"],
  nom:    ["nom", "lastname", "last name", "last_name", "surname", "name"],
  tel:    ["tel", "téléphone", "telephone", "phone", "mobile"],
};

export function bindImportModal() {
  const fileInput = document.getElementById("import-file-input");

  document.getElementById("import-members-btn").addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileInput.value = "";
    await _openImportModal(file);
  });

  document.getElementById("import-preview-btn").addEventListener("click", () => {
    try {
      _buildImportPreview();
    } catch {
      window.showToast("Erreur lors de la prévisualisation.", "error");
    }
  });

  document.getElementById("import-back-btn").addEventListener("click", () => {
    document.getElementById("import-mapping-section").hidden = false;
    document.getElementById("import-preview-section").hidden = true;
    document.getElementById("modal-import-confirm").hidden   = true;
  });

  document.getElementById("modal-import-cancel").addEventListener("click", _closeImportModal);
  document.getElementById("modal-import-members").addEventListener("click", e => {
    if (e.target === e.currentTarget) _closeImportModal();
  });

  document.getElementById("modal-import-confirm").addEventListener("click", _doImport);
}

async function _openImportModal(file) {
  try {
    const ab   = await file.arrayBuffer();
    const wb   = XLSX.read(ab, { type: "array" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    if (!json || json.length < 2) {
      window.showToast("Le fichier est vide ou ne contient pas de données.", "error");
      return;
    }

    _importHeaders = json[0].map(h => String(h).trim());
    _importRows    = json.slice(1).filter(row => row.some(c => String(c).trim() !== ""));

    if (_importRows.length === 0) {
      window.showToast("Aucune ligne de données trouvée dans le fichier.", "error");
      return;
    }

    _populateMappingSelects();

    document.getElementById("import-mapping-section").hidden = false;
    document.getElementById("import-preview-section").hidden = true;
    document.getElementById("modal-import-confirm").hidden   = true;
    document.getElementById("modal-import-members").hidden   = false;
  } catch {
    window.showToast("Impossible de lire ce fichier.", "error");
  }
}

function _populateMappingSelects() {
  ["prenom", "nom", "tel"].forEach(field => {
    const sel = document.getElementById(`map-${field}`);
    sel.innerHTML = "";

    const none = document.createElement("option");
    none.value = ""; none.textContent = "— Ne pas importer —";
    sel.appendChild(none);

    _importHeaders.forEach((h, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = h || `Colonne ${i + 1}`;
      sel.appendChild(opt);
    });

    const hit = _importHeaders.findIndex(h =>
      _ALIASES[field].includes(h.toLowerCase().trim())
    );
    if (hit !== -1) sel.value = hit;
  });
}

function _buildImportPreview() {
  const prenomIdx = _getColIdx("map-prenom");
  const nomIdx    = _getColIdx("map-nom");

  if (prenomIdx === null || nomIdx === null) {
    window.showToast("Veuillez sélectionner au moins les colonnes Prénom et Nom.", "error");
    return;
  }

  const telIdx = _getColIdx("map-tel");

  const existing    = getMembers();
  const existingSet = new Set(
    existing.map(m => `${m.prenom.toLowerCase().trim()}|${m.nom.toLowerCase().trim()}`)
  );

  const tbody = document.getElementById("import-preview-body");
  tbody.innerHTML = "";
  let validCount = 0;

  _importRows.forEach((row, idx) => {
    const prenom = String(row[prenomIdx] ?? "").trim();
    const nom    = String(row[nomIdx]    ?? "").trim();
    const tel    = telIdx !== null ? String(row[telIdx] ?? "").trim() : "";

    if (!prenom && !nom) return;

    const isIncomplete = !prenom || !nom;
    const isDup = !isIncomplete &&
      existingSet.has(`${prenom.toLowerCase()}|${nom.toLowerCase()}`);

    if (!isDup && !isIncomplete) validCount++;

    const status = isDup
      ? `<span style="font-size:.78rem;color:var(--text3);">Doublon</span>`
      : isIncomplete
        ? `<span style="font-size:.78rem;color:#f59e0b;">Incomplet</span>`
        : `<span style="font-size:.78rem;color:#10b981;">Nouveau</span>`;

    const tr = document.createElement("tr");
    tr.style.cssText = (isDup || isIncomplete) ? "opacity:.5;" : "";
    tr.innerHTML = `
      <td style="padding:.35rem .5rem;text-align:center;">
        <input type="checkbox" data-row="${idx}"
          ${(!isDup && !isIncomplete) ? "checked" : ""}
          ${(isDup || isIncomplete) ? "disabled" : ""}>
      </td>
      <td style="padding:.35rem .5rem;">${prenom || `<em style="color:var(--text3)">—</em>`}</td>
      <td style="padding:.35rem .5rem;">${nom    || `<em style="color:var(--text3)">—</em>`}</td>
      <td style="padding:.35rem .5rem;">${tel}</td>
      <td style="padding:.35rem .5rem;">${status}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById("import-preview-info").textContent =
    `${_importRows.length} ligne${_importRows.length > 1 ? "s" : ""} lue${_importRows.length > 1 ? "s" : ""} — ` +
    `${validCount} nouveau${validCount !== 1 ? "x" : ""} membre${validCount !== 1 ? "s" : ""}`;

  document.getElementById("import-count").textContent    = validCount;
  document.getElementById("modal-import-confirm").hidden = (validCount === 0);

  document.getElementById("import-mapping-section").hidden = true;
  document.getElementById("import-preview-section").hidden = false;
}

function _doImport() {
  const prenomIdx = _getColIdx("map-prenom");
  const nomIdx    = _getColIdx("map-nom");
  const telIdx    = _getColIdx("map-tel");

  const checked  = document.querySelectorAll("#import-preview-body input[type=checkbox]:checked");
  const toImport = [];

  checked.forEach(cb => {
    const row    = _importRows[parseInt(cb.dataset.row)];
    if (!row) return;
    const prenom = String(row[prenomIdx] ?? "").trim();
    const nom    = String(row[nomIdx]    ?? "").trim();
    const tel    = telIdx !== null ? String(row[telIdx] ?? "").trim() : "";
    if (prenom && nom) toImport.push({ prenom, nom, tel });
  });

  if (toImport.length === 0) return;

  try {
    const result = importMembers(toImport);
    _closeImportModal();
    const imp = result.imported;
    const ign = result.ignored;
    let msg = imp > 0
      ? `${imp} membre${imp > 1 ? "s" : ""} importé${imp > 1 ? "s" : ""}`
      : "Aucun membre importé";
    if (ign > 0) msg += `, ${ign} ignoré${ign > 1 ? "s" : ""} (doublon${ign > 1 ? "s" : ""})`;
    window.showToast(msg + ".");
    renderAdminMembers();
  } catch {
    window.showToast("Erreur lors de l'import.", "error");
  }
}

function _closeImportModal() {
  document.getElementById("modal-import-members").hidden = true;
  _importRows = []; _importHeaders = [];
}

function _getColIdx(selectId) {
  const val = document.getElementById(selectId).value;
  return val === "" ? null : parseInt(val);
}

/* ════════════════════════════════════════
   STATISTIQUES
════════════════════════════════════════ */

const MONTHS_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
const MONTHS_LONG  = [
  "janvier","février","mars","avril","mai","juin",
  "juillet","août","septembre","octobre","novembre","décembre"
];

const statsState = {
  year:  new Date().getFullYear(),
  month: new Date().getMonth(),
};

let _monthChart    = null;
let _yearChart     = null;
let _fbStatsCache  = null; // { year, regs: [{slot_date, ...}] }

export function bindAdminStats() {
  document.getElementById("stats-prev-month").addEventListener("click", () => shiftStatsMonth(-1));
  document.getElementById("stats-next-month").addEventListener("click", () => shiftStatsMonth(+1));
}

function shiftStatsMonth(delta) {
  statsState.month += delta;
  if (statsState.month < 0)  { statsState.month = 11; statsState.year--; }
  if (statsState.month > 11) { statsState.month = 0;  statsState.year++; }
  renderAdminStats();
}

function renderAdminStats() {
  _renderStatsUI();           // rendu immédiat avec données locales
  _syncStatsFromFirebase();   // async : re-render avec données Firebase fraîches
}

/* ── Sync Firebase pour les stats (fire-and-forget) ── */

async function _syncStatsFromFirebase() {
  const { year } = statsState;
  if (!window.fbFunctions?.fbGetRegistrationsPeriod) return;

  // Cache valide pour l'année en cours → re-render direct sans nouvel appel
  if (_fbStatsCache?.year === year) {
    _renderStatsUI();
    return;
  }

  const dateStart = `${year}-01-01`;
  const dateEnd   = `${year}-12-31`;
  console.log("[TPL Stats] Sync Firebase — période:", dateStart, "→", dateEnd);

  try {
    const regs = await window.fbFunctions.fbGetRegistrationsPeriod(dateStart, dateEnd);
    console.log("[TPL Stats] Registrations Firebase reçues:", regs.length);
    _fbStatsCache = { year, regs };
    _renderStatsUI();
  } catch (e) {
    console.warn("[TPL Stats] Sync Firebase échouée, données locales utilisées:", e);
  }
}

/* ── Rendu des stats (KPI + graphiques) ── */

function _renderStatsUI() {
  const { year, month } = statsState;

  const label = `${MONTHS_LONG[month].charAt(0).toUpperCase()}${MONTHS_LONG[month].slice(1)} ${year}`;
  document.getElementById("stats-month-label").textContent = label;

  const monthData  = _computeMonthSlots(year, month);
  const weekGroups = _groupByWeek(monthData, year, month);

  const totalMonth  = monthData.length;
  const filledMonth = monthData.filter(s => s.filled).length;
  const emptyMonth  = totalMonth - filledMonth;
  const fillRate    = totalMonth > 0 ? Math.round(filledMonth / totalMonth * 100) : 0;

  const bestWeek = weekGroups.reduce((best, w, idx) => {
    if (w.total === 0) return best;
    if (!best || w.rate > best.rate) return { label: `Sem. ${idx + 1}`, rate: w.rate };
    return best;
  }, null);

  document.getElementById("stats-total-month").textContent = totalMonth || "—";
  document.getElementById("stats-fill-rate").textContent   = totalMonth ? `${fillRate} %` : "—";
  document.getElementById("stats-best-week").textContent   = bestWeek ? `${bestWeek.label} (${bestWeek.rate} %)` : "—";
  document.getElementById("stats-empty-count").textContent = totalMonth ? emptyMonth : "—";

  _renderMonthChart(weekGroups, label);

  const yearData    = _computeYearSlots(year);
  const monthGroups = _groupByMonth(yearData);
  _renderYearChart(monthGroups, year);
}

/* ── Calcul des slots du mois avec état rempli/vide ── */

function _computeMonthSlots(year, month) {
  const first = dateToKey(new Date(year, month, 1));
  const last  = dateToKey(lastDayOfMonth(year, month));

  // Slots depuis localStorage (date toujours cohérente)
  const slots = _load("tpl_slots", []).filter(s => s.date >= first && s.date <= last);

  // Registrations : Firebase (jointure par slot_date) si cache dispo, sinon local (slot_id)
  const useFirebase = _fbStatsCache?.year === year;
  const regs        = useFirebase ? _fbStatsCache.regs : _load("tpl_registrations", []);

  console.log(`[TPL Stats] Période: ${first} → ${last} | slots: ${slots.length} | regs ${useFirebase ? "Firebase" : "local"}: ${regs.length}`);

  const result = slots.map(s => ({
    date:   s.date,
    filled: useFirebase
      ? regs.some(r => r.slot_date === s.date)   // jointure par date (Firebase)
      : regs.some(r => r.slot_id  === s.id),      // jointure par UUID local
  }));

  console.log(`[TPL Stats] Slots avec inscrits: ${result.filter(s => s.filled).length} / ${result.length}`);
  return result;
}

/* ── Calcul des slots de l'année avec état rempli/vide ── */

function _computeYearSlots(year) {
  const first = `${year}-01-01`;
  const last  = `${year}-12-31`;

  const slots       = _load("tpl_slots", []).filter(s => s.date >= first && s.date <= last);
  const useFirebase = _fbStatsCache?.year === year;
  const regs        = useFirebase ? _fbStatsCache.regs : _load("tpl_registrations", []);

  console.log(`[TPL Stats] Année ${year} | slots: ${slots.length} | regs ${useFirebase ? "Firebase" : "local"}: ${regs.length}`);

  return slots.map(s => ({
    date:   s.date,
    month:  keyToDate(s.date).getMonth(),
    filled: useFirebase
      ? regs.some(r => r.slot_date === s.date)
      : regs.some(r => r.slot_id  === s.id),
  }));
}

/* ── Groupement par semaine ── */

function _groupByWeek(monthSlots, year, month) {
  const weeks = buildMonthWeeks(year, month);
  return weeks.map((weekDays, idx) => {
    const dates = weekDays
      .filter(d => d.getDay() >= 1 && d.getDay() <= 5)
      .map(d => dateToKey(d));
    const ws     = monthSlots.filter(s => dates.includes(s.date));
    const filled = ws.filter(s => s.filled).length;
    const empty  = ws.length - filled;
    return {
      label: `Sem. ${idx + 1}`,
      filled, empty,
      total: ws.length,
      rate:  ws.length > 0 ? Math.round(filled / ws.length * 100) : 0,
    };
  });
}

/* ── Groupement par mois ── */

function _groupByMonth(yearSlots) {
  return Array.from({ length: 12 }, (_, m) => {
    const ms     = yearSlots.filter(s => s.month === m);
    const filled = ms.filter(s => s.filled).length;
    const empty  = ms.length - filled;
    return {
      filled, empty,
      total: ms.length,
      rate:  ms.length > 0 ? Math.round(filled / ms.length * 100) : 0,
    };
  });
}

/* ── Rendu graphique mensuel ── */

function _renderMonthChart(weekGroups, monthLabel) {
  const ctx = document.getElementById("stats-month-chart");
  if (!ctx || typeof Chart === "undefined") return;

  if (_monthChart) { _monthChart.destroy(); _monthChart = null; }

  const labels  = weekGroups.map(w => w.label);
  const filled  = weekGroups.map(w => w.filled);
  const empty   = weekGroups.map(w => w.empty);
  const rates   = weekGroups.map(w => w.total > 0 ? w.rate : null);
  console.log(`[TPL Stats] Graphique mensuel (${monthLabel}) :`, { filled, empty, rates });

  _monthChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type:            "bar",
          label:           "Remplis",
          data:            filled,
          backgroundColor: "#2e6da4",
          stack:           "slots",
          order:           2,
          borderRadius:    3,
        },
        {
          type:            "bar",
          label:           "Vides",
          data:            empty,
          backgroundColor: "#e8eaed",
          stack:           "slots",
          order:           2,
          borderRadius:    3,
        },
        {
          type:               "line",
          label:              "Taux (%)",
          data:               rates,
          borderColor:        "#b45309",
          backgroundColor:    "transparent",
          pointBackgroundColor: "#b45309",
          yAxisID:            "yRate",
          tension:            0.35,
          pointRadius:        4,
          pointHoverRadius:   6,
          borderWidth:        2,
          order:              1,
          spanGaps:           true,
        },
      ],
    },
    options: _chartOptions(`Participation — ${monthLabel}`, false),
  });
}

/* ── Rendu graphique annuel ── */

function _renderYearChart(monthGroups, year) {
  const ctx = document.getElementById("stats-year-chart");
  if (!ctx || typeof Chart === "undefined") return;

  if (_yearChart) { _yearChart.destroy(); _yearChart = null; }

  const filled = monthGroups.map(m => m.filled);
  const empty  = monthGroups.map(m => m.empty);
  const rates  = monthGroups.map(m => m.total > 0 ? m.rate : null);
  console.log(`[TPL Stats] Graphique annuel (${year}) :`, { filled, empty, rates });

  _yearChart = new Chart(ctx, {
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        {
          type:            "bar",
          label:           "Remplis",
          data:            filled,
          backgroundColor: "#2e6da4",
          stack:           "slots",
          order:           2,
          borderRadius:    3,
        },
        {
          type:            "bar",
          label:           "Vides",
          data:            empty,
          backgroundColor: "#e8eaed",
          stack:           "slots",
          order:           2,
          borderRadius:    3,
        },
        {
          type:               "line",
          label:              "Taux (%)",
          data:               rates,
          borderColor:        "#b45309",
          backgroundColor:    "transparent",
          pointBackgroundColor: "#b45309",
          yAxisID:            "yRate",
          tension:            0.35,
          pointRadius:        4,
          pointHoverRadius:   6,
          borderWidth:        2,
          order:              1,
          spanGaps:           true,
        },
      ],
    },
    options: _chartOptions(`Participation — ${year}`, true),
  });
}

/* ── Options communes Chart.js ── */

function _chartOptions(titleText, hideYLabel) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        labels: { boxWidth: 12, font: { size: 11 }, padding: 12 },
      },
      title: {
        display: true,
        text:    titleText,
        font:    { size: 13, weight: "600" },
        color:   "#1a1a2e",
        padding: { bottom: 12 },
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            if (ctx.dataset.yAxisID === "yRate") return ` Taux : ${ctx.parsed.y} %`;
            return ` ${ctx.dataset.label} : ${ctx.parsed.y}`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: { font: { size: 11 } },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { stepSize: 1, precision: 0, font: { size: 11 } },
        title: { display: !hideYLabel, text: "Créneaux", font: { size: 11 } },
        grid: { color: "rgba(0,0,0,.06)" },
      },
      yRate: {
        position: "right",
        min: 0,
        max: 100,
        ticks: {
          callback: v => v + " %",
          stepSize: 25,
          font: { size: 11 },
        },
        grid: { display: false },
      },
    },
  };
}
