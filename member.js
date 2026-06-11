/* ═══════════════════════════════════════════
   member.js — Vue membre + modérateur
══════════════════════════════════════════════ */

import {
  dateToKey, keyToDate, lastDayOfMonth,
  getSettings, generateMissingSlots, getSlotsWithRegistrations,
  getMemberUpcomingRegistrations, getMemberUpcomingCount,
  addRegistration, deleteRegistration, closeSlot, openSlot,
  incrementQuota, decrementQuota, getQuotaState,
  getInitials, fullName, getAvatarColorIndex, getAvatarBgColor,
  getMembers, patchSlotFromFirebase,
} from './data.js';
import { currentMember } from './auth.js';
import {
  isMonthAccessibleForMember, lockedMonthMessage, renderCalendarGrid, refreshDots,
  weekRangeLabel, buildMemberBadge, buildAdminBadge, buildInscritRow, DAYS_FR,
} from './calendar.js';
import { openCloseSlotModal } from './admin.js';

const memberState = {
  year:         0,
  month:        0,
  selectedWeek: null,
  slotsMap:     {},
  settings:     {},
};

const modState = {
  year:         0,
  month:        0,
  selectedWeek: null,
  slotsMap:     {},
};

/* ── Listeners temps réel ── */

let activeListeners = [];

function clearListeners() {
  activeListeners.forEach(fn => { try { fn(); } catch {} });
  activeListeners = [];
}
window.clearMemberListeners = clearListeners;

function setupMemberWeekListeners(mondayKey) {
  if (!window.fbFunctions?.fbListenDay) return;
  const monday = keyToDate(mondayKey);

  const makeHandler = () => (slotDate, regs, slotDoc) => {
    const slot = memberState.slotsMap[slotDate];
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
    if (memberState.selectedWeek !== mondayKey) return;
    refreshDots(document.getElementById("member-cal-body"),
      memberState.year, memberState.month, currentMember?.id, memberState.slotsMap);
    renderMemberWeekDetail(mondayKey);
  };

  for (let i = 0; i < 5; i++) {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = dateToKey(day);
    activeListeners.push(window.fbFunctions.fbListenDay(key, makeHandler()));
    if (i === 0 || i === 4) {
      activeListeners.push(window.fbFunctions.fbListenDay(key + "_17h", makeHandler()));
    }
  }
}

function setupModWeekListeners(mondayKey) {
  if (!window.fbFunctions?.fbListenDay) return;
  const monday = keyToDate(mondayKey);

  const makeHandler = () => (slotDate, regs, slotDoc) => {
    const slot = modState.slotsMap[slotDate];
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
    if (modState.selectedWeek !== mondayKey) return;
    refreshDots(document.getElementById("mod-cal-body"),
      modState.year, modState.month, null, modState.slotsMap);
    renderModWeekDetail(mondayKey);
  };

  for (let i = 0; i < 5; i++) {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = dateToKey(day);
    activeListeners.push(window.fbFunctions.fbListenDay(key, makeHandler()));
    if (i === 0 || i === 4) {
      activeListeners.push(window.fbFunctions.fbListenDay(key + "_17h", makeHandler()));
    }
  }
}

/* ════════════════════════════════════════
   POINT D'ENTRÉE
════════════════════════════════════════ */

export function renderMemberScreen() {
  const member = currentMember;
  if (!member) return;

  const avatarEl = document.getElementById("member-avatar");
  const idx      = getAvatarColorIndex(member.id);
  avatarEl.textContent      = getInitials(fullName(member));
  avatarEl.style.background = getAvatarBgColor(idx);

  document.getElementById("mod-badge").hidden   = !member.is_moderator;
  document.getElementById("mod-tab-btn").hidden = !member.is_moderator;

  const today = new Date();
  memberState.year         = today.getFullYear();
  memberState.month        = today.getMonth();
  memberState.selectedWeek = null;

  if (member.is_moderator) {
    modState.year         = today.getFullYear();
    modState.month        = today.getMonth();
    modState.selectedWeek = null;
  }

  memberState.settings = getSettings();
  renderMemberBanner();
  renderQuotaBar();
  renderMemberCalendar();
  switchMemberTab("calendar");
}

/* ════════════════════════════════════════
   BANNIÈRE
════════════════════════════════════════ */

function renderMemberBanner() {
  const settings = memberState.settings;
  const bannerEl = document.getElementById("member-banner");
  const textEl   = document.getElementById("member-banner-text");

  if (settings.banner && settings.banner.trim()) {
    textEl.textContent = settings.banner.trim();
    bannerEl.hidden    = false;
  } else {
    bannerEl.hidden = true;
  }
}

/* ════════════════════════════════════════
   QUOTA
════════════════════════════════════════ */

function renderQuotaBar() {
  const member = currentMember;
  if (!member) return;
  const state  = getQuotaState(member.id);
  const dotsEl = document.getElementById("quota-dots");
  const textEl = document.getElementById("quota-text");

  dotsEl.innerHTML = "";
  for (let i = 0; i < state.max; i++) {
    const dot = document.createElement("div");
    dot.className = "quota-dot " + (i < state.count ? "filled" : "empty");
    dotsEl.appendChild(dot);
  }

  if (!state.canSignup) {
    textEl.textContent = `Disponible ${state.nextResetLabel}`;
    textEl.style.color = "var(--orange)";
  } else {
    const rem = state.max - state.count;
    textEl.textContent = `${rem} réservation${rem > 1 ? "s" : ""} restante${rem > 1 ? "s" : ""}`;
    textEl.style.color = "var(--text2)";
  }
}

/* ════════════════════════════════════════
   ONGLETS MEMBRE
════════════════════════════════════════ */

export function bindMemberTabs() {
  document.getElementById("member-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    switchMemberTab(btn.dataset.tab);
  });
}

function switchMemberTab(tabId) {
  clearListeners();
  document.querySelectorAll("#member-tabs .tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.getElementById("tab-calendar").hidden   = (tabId !== "calendar");
  document.getElementById("tab-my-slots").hidden   = (tabId !== "my-slots");
  document.getElementById("tab-urgences").hidden   = (tabId !== "urgences");
  document.getElementById("tab-moderation").hidden = (tabId !== "moderation");

  if (tabId === "my-slots")   renderMySlots();
  if (tabId === "urgences")   renderUrgences();
  if (tabId === "moderation") renderModCalendar();
  if (tabId === "calendar" && memberState.selectedWeek) setupMemberWeekListeners(memberState.selectedWeek);
}

/* ════════════════════════════════════════
   NAVIGATION MOIS — MEMBRE
════════════════════════════════════════ */

export function bindMemberMonthNav() {
  document.getElementById("member-prev-month").addEventListener("click", () => shiftMemberMonth(-1));
  document.getElementById("member-next-month").addEventListener("click", () => shiftMemberMonth(+1));
}

function shiftMemberMonth(delta) {
  let { year, month } = memberState;
  month += delta;
  if (month < 0)  { month = 11; year--; }
  if (month > 11) { month = 0;  year++; }

  const today    = new Date();
  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();

  if (year < curYear || (year === curYear && month < curMonth)) return;

  memberState.year = year; memberState.month = month; memberState.selectedWeek = null;
  clearListeners();
  renderMemberCalendar();
}

/* ════════════════════════════════════════
   CALENDRIER MEMBRE
════════════════════════════════════════ */

function renderMemberCalendar() {
  const { year, month } = memberState;
  const member = currentMember;

  const label = new Date(year, month, 1)
    .toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  document.getElementById("member-month-label").textContent =
    label.charAt(0).toUpperCase() + label.slice(1);

  const today    = new Date();
  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();

  document.getElementById("member-prev-month").disabled = (year === curYear && month === curMonth);
  document.getElementById("member-next-month").disabled = false;

  const locked     = !isMonthAccessibleForMember(year, month);
  const grid       = document.getElementById("member-calendar-grid");
  const overlay    = document.getElementById("member-cal-overlay");
  const weekDetail = document.getElementById("member-week-detail");

  grid.classList.toggle("cal-grid-locked", locked);
  overlay.hidden = !locked;
  if (locked) {
    document.getElementById("member-locked-text").textContent = lockedMonthMessage(year, month);
    weekDetail.hidden = true;
  }

  const firstDate = dateToKey(new Date(year, month, 1));
  const lastDate  = dateToKey(lastDayOfMonth(year, month));
  memberState.slotsMap = getSlotsWithRegistrations(firstDate, lastDate);

  const calBody = document.getElementById("member-cal-body");

  function handleWeekClick(mondayKey) {
    memberState.selectedWeek = mondayKey;
    clearListeners();
    renderCalendarGrid(calBody, year, month, member.id, mondayKey, handleWeekClick, memberState.slotsMap);
    renderMemberWeekDetail(mondayKey);
    setupMemberWeekListeners(mondayKey);
    setTimeout(() => document.getElementById("member-week-detail")
      .scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  renderCalendarGrid(calBody, year, month, member.id, locked ? null : memberState.selectedWeek, handleWeekClick, locked ? {} : memberState.slotsMap);
  if (!memberState.selectedWeek || locked) weekDetail.hidden = true;
  else renderMemberWeekDetail(memberState.selectedWeek);
}

/* ════════════════════════════════════════
   DÉTAIL SEMAINE — MEMBRE
════════════════════════════════════════ */

function renderMemberWeekDetail(mondayKey) {
  const member  = currentMember;
  const detail  = document.getElementById("member-week-detail");
  const title   = document.getElementById("member-week-title");
  const cards   = document.getElementById("member-day-cards");

  detail.hidden = false;
  title.textContent = weekRangeLabel(mondayKey);
  cards.innerHTML   = "";

  const slotsMap = memberState.slotsMap;
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const monday   = keyToDate(mondayKey);

  const appendCard = (slot, dayLabel, isPast) => {
    const card      = document.createElement("div");
    card.className  = "day-card";
    const hdrClass  = slot.is_closed ? "closed-header" : isPast ? "past-header" : "";
    const badge     = buildMemberBadge(slot, member.id);
    const timeLabel = slot.heure_debut && slot.heure_fin
      ? `${slot.heure_debut.slice(0,5)} – ${slot.heure_fin.slice(0,5)}` : "07:00 – 09:00";
    const lieuLabel = slot.lieu || "Gare d'Agen";

    card.innerHTML = `
      <div class="day-card-header ${hdrClass}">
        <div>
          <div class="day-card-name">${dayLabel}</div>
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
      if (!isPast && !slot.is_closed) {
        const pl = document.createElement("div");
        pl.className = "places-libres";
        pl.innerHTML = `<i class="ti ti-users"></i> ${slot.places} place${slot.places > 1 ? "s" : ""} disponible${slot.places > 1 ? "s" : ""}`;
        body.appendChild(pl);
      } else {
        const empty = document.createElement("p");
        empty.style.cssText = "font-size:.82rem;color:var(--text3);padding:.2rem 0;";
        empty.textContent = "Aucun inscrit";
        body.appendChild(empty);
      }
    } else {
      slot.inscrits.forEach(m => { body.innerHTML += buildInscritRow(m, m.id === member.id, false, slot.id); });
      const free = slot.places - slot.inscrits.length;
      if (free > 0 && !slot.is_closed && !isPast) {
        const pl = document.createElement("div");
        pl.className = "places-libres";
        pl.innerHTML = `<i class="ti ti-users"></i> ${free} place${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}`;
        body.appendChild(pl);
      }
    }

    card.appendChild(body);

    if (!isPast && !slot.is_closed && slot.id) {
      const actionDiv  = document.createElement("div");
      actionDiv.className = "day-card-action";
      const isInscrit  = slot.inscrits && slot.inscrits.some(m => m.id === member.id);
      const isFull     = slot.inscrits && slot.inscrits.length >= slot.places;
      if (isInscrit) {
        actionDiv.innerHTML = `<button class="btn btn-outline-red btn-sm" data-action="desister" data-slot-id="${slot.id}">Se désister</button>`;
      } else if (!isFull) {
        actionDiv.innerHTML = `<button class="btn btn-primary btn-sm" data-action="inscrire" data-slot-id="${slot.id}">S'inscrire</button>`;
      }
      card.appendChild(actionDiv);
    }

    cards.appendChild(card);
  };

  for (let i = 0; i < 5; i++) {
    const day    = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key    = dateToKey(day);
    const isPast = day < today;
    const label  = DAYS_FR[i];

    const morningSlot = slotsMap[key] || { id: null, date: key, inscrits: [], is_closed: false, close_reason: null, places: 2, heure_debut: null, heure_fin: null };
    appendCard(morningSlot, label, isPast);

    const eveningSlot = slotsMap[key + "_17h"];
    if (eveningSlot) appendCard(eveningSlot, label, isPast);
  }

  cards.onclick = (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "inscrire") doSignup(btn.dataset.slotId);
    if (btn.dataset.action === "desister") doWithdraw(btn.dataset.slotId);
  };
}

/* ════════════════════════════════════════
   INSCRIPTION / DÉSISTEMENT
════════════════════════════════════════ */

function doSignup(slotId) {
  const member = currentMember;
  let quotaUsed = false;
  try {
    const canSignup = incrementQuota(member.id);
    if (!canSignup) {
      const state = getQuotaState(member.id);
      window.showToast(`Quota atteint — disponible ${state.nextResetLabel}`);
      renderQuotaBar();
      return;
    }
    quotaUsed = true;
    addRegistration(slotId, member.id);
    window.showToast("Inscription confirmée !");
    _refreshMemberCalendar();
    renderQuotaBar();
  } catch (e) {
    if (quotaUsed) try { decrementQuota(member.id); } catch {}
    window.showError();
  }
}

function doWithdraw(slotId) {
  const member = currentMember;
  if (!member?.id) {
    console.error("[TPL] doWithdraw: currentMember.id manquant !");
    window.showError();
    return;
  }
  console.log("[TPL] Désistement slot:", slotId, "| Member ID:", member.id);
  try {
    deleteRegistration(slotId, member.id);
    decrementQuota(member.id);
    window.showToast("Désistement enregistré.");
    _refreshMemberCalendar();
    renderQuotaBar();
  } catch (e) {
    console.error("[TPL] Erreur désistement:", e);
    window.showError();
  }
}

function _refreshMemberCalendar() {
  if (!currentMember) return;
  const { year, month } = memberState;
  const firstDate = dateToKey(new Date(year, month, 1));
  const lastDate  = dateToKey(lastDayOfMonth(year, month));
  memberState.slotsMap = getSlotsWithRegistrations(firstDate, lastDate);
  refreshDots(document.getElementById("member-cal-body"), year, month, currentMember.id, memberState.slotsMap);
  if (memberState.selectedWeek) renderMemberWeekDetail(memberState.selectedWeek);
}

/* ════════════════════════════════════════
   MES INSCRIPTIONS
════════════════════════════════════════ */

async function renderMySlots() {
  const member = currentMember;
  const wrap   = document.getElementById("my-slots-list");
  wrap.innerHTML = "";

  const upcoming = getMemberUpcomingRegistrations(member.id);

  if (upcoming.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-calendar-off"></i>
        Aucun créneau à venir —<br>inscrivez-vous depuis le calendrier.
      </div>`;
    return;
  }

  const allMembers = getMembers();
  const slotsWithCo = await Promise.all(
    upcoming.map(async slot => {
      if (!window.fbFunctions?.fbGetRegistrations) return { ...slot, coInscrits: [] };
      const regs = await window.fbFunctions.fbGetRegistrations(slot.date);
      const coInscrits = regs
        .filter(r => r.member_id !== member.id)
        .map(r => {
          const m = allMembers.find(mb => mb.id === r.member_id) || {};
          return {
            id:     r.member_id,
            prenom: m.prenom || r.member_prenom || "?",
            nom:    m.nom    || r.member_nom    || "",
            tel:    m.tel    || r.member_tel    || "",
          };
        });
      return { ...slot, coInscrits };
    })
  );

  const container = document.createElement("div");
  container.className = "my-slots-wrap";

  slotsWithCo.forEach(slot => {
    const d    = keyToDate(slot.date);
    const card = document.createElement("div");
    card.className = "my-slot-card";
    const dayName   = d.toLocaleDateString("fr-FR", { weekday: "long" });
    const dateStr   = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const timeLabel = slot.heure_debut && slot.heure_fin
      ? `${slot.heure_debut.slice(0,5)} – ${slot.heure_fin.slice(0,5)}` : "07:00 – 09:00";
    const lieuLabel = slot.lieu || "Gare d'Agen";

    const coInscrits = slot.coInscrits || [];
    const coInscritsHTML = coInscrits.length > 0
      ? coInscrits.map(co => {
          const bg       = getAvatarBgColor(getAvatarColorIndex(co.id));
          const initials = getInitials(`${co.prenom} ${co.nom}`);
          return `
            <div class="co-inscrit-row">
              <span class="co-inscrit-avatar" style="background:${bg}">${initials}</span>
              <span class="co-inscrit-name">${co.prenom} ${co.nom}</span>
              ${co.tel ? `<a href="tel:${co.tel.replace(/\s/g,'')}" class="co-inscrit-tel">📞 ${co.tel}</a>` : ""}
            </div>`;
        }).join("")
      : `<div class="co-inscrit-empty">Vous serez seul(e) sur ce créneau</div>`;

    card.innerHTML = `
      <div class="my-slot-info">
        <div class="my-slot-date">${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${dateStr}</div>
        <div class="my-slot-meta">${timeLabel} · ${lieuLabel} &nbsp;
          <span class="badge badge-orange">✓ Inscrit</span>
        </div>
        <div class="my-slot-coinscrits">
          <div class="co-inscrits-label">Avec vous :</div>
          ${coInscritsHTML}
        </div>
      </div>
      <button class="btn btn-outline-red btn-sm my-slot-desist-btn" data-slot-id="${slot.id}">Se désister</button>`;
    container.appendChild(card);
  });

  wrap.appendChild(container);
  container.addEventListener("click", e => {
    const btn = e.target.closest("[data-slot-id]");
    if (!btn) return;
    doWithdraw(btn.dataset.slotId);
    renderMySlots();
  });
}

/* ════════════════════════════════════════
   URGENCES
════════════════════════════════════════ */

function renderUrgences() {
  const settings = getSettings();
  const jcTel    = (settings.urgence_jc_tel || "").trim();
  const kbTel    = (settings.urgence_kb_tel || "").trim();
  const wrap     = document.getElementById("urgences-list");
  wrap.innerHTML = "";

  const intro = document.createElement("p");
  intro.className   = "urgences-intro";
  intro.textContent = "À contacter en cas d'urgence liée au présentoir";
  wrap.appendChild(intro);

  const contacts = [
    { icon: "👤", name: "Jean-Christophe Arcamone", role: "Responsable de prédication", tel: jcTel,  type: "normal" },
    { icon: "👤", name: "Kailash Bhunsee",         role: "Responsable de prédication", tel: kbTel,  type: "normal" },
    { icon: "🚒", name: "Pompiers",                 role: null,                         tel: "18",   type: "fire"   },
    { icon: "👮", name: "Police",                   role: null,                         tel: "17",   type: "police" },
  ];

  const grid = document.createElement("div");
  grid.className = "urgences-grid";

  for (const c of contacts) {
    const card = document.createElement("div");
    card.className = `urgence-card urgence-card-${c.type}`;

    const hasNumber = !!c.tel;
    const telHref   = hasNumber ? `tel:${c.tel.replace(/\s/g, "")}` : null;

    card.innerHTML = `
      <div class="urgence-icon">${c.icon}</div>
      <div class="urgence-info">
        <div class="urgence-name">${c.name}</div>
        ${c.role ? `<div class="urgence-role">${c.role}</div>` : ""}
        <div class="urgence-tel ${hasNumber ? "" : "urgence-tel-empty"}">${hasNumber ? c.tel : "Numéro non renseigné"}</div>
      </div>
      ${hasNumber
        ? `<a href="${telHref}" class="urgence-call-btn urgence-call-${c.type}">📞 Appeler</a>`
        : `<span class="urgence-call-btn urgence-call-disabled">📞 Appeler</span>`}`;

    grid.appendChild(card);
  }

  wrap.appendChild(grid);
}

/* ════════════════════════════════════════
   MODÉRATION — NAVIGATION MOIS
════════════════════════════════════════ */

function getModMonthBounds() {
  const today    = new Date();
  const curYear  = today.getFullYear();
  const curMonth = today.getMonth();

  let minYear = curYear, minMonth = curMonth - 2;
  while (minMonth < 0) { minMonth += 12; minYear--; }

  let maxYear = curYear, maxMonth = curMonth + 2;
  while (maxMonth > 11) { maxMonth -= 12; maxYear++; }

  return { minYear, minMonth, maxYear, maxMonth };
}

export function bindModMonthNav() {
  document.getElementById("mod-prev-month").addEventListener("click", () => shiftModMonth(-1));
  document.getElementById("mod-next-month").addEventListener("click", () => shiftModMonth(+1));
}

function shiftModMonth(delta) {
  let { year, month } = modState;
  month += delta;
  if (month < 0)  { month = 11; year--; }
  if (month > 11) { month = 0;  year++; }

  const { minYear, minMonth, maxYear, maxMonth } = getModMonthBounds();
  if (year < minYear || (year === minYear && month < minMonth)) return;
  if (year > maxYear || (year === maxYear && month > maxMonth)) return;

  modState.year = year; modState.month = month; modState.selectedWeek = null;
  clearListeners();
  try { generateMissingSlots(); } catch {}
  renderModCalendar();
}

/* ════════════════════════════════════════
   MODÉRATION — CALENDRIER
════════════════════════════════════════ */

function renderModCalendar() {
  const { year, month } = modState;

  const label = new Date(year, month, 1)
    .toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  document.getElementById("mod-month-label").textContent =
    label.charAt(0).toUpperCase() + label.slice(1);

  const { minYear, minMonth, maxYear, maxMonth } = getModMonthBounds();
  document.getElementById("mod-prev-month").disabled =
    (year < minYear || (year === minYear && month <= minMonth));
  document.getElementById("mod-next-month").disabled =
    (year > maxYear || (year === maxYear && month >= maxMonth));

  const firstDate = dateToKey(new Date(year, month, 1));
  const lastDate  = dateToKey(lastDayOfMonth(year, month));
  modState.slotsMap = getSlotsWithRegistrations(firstDate, lastDate);

  const calBody = document.getElementById("mod-cal-body");

  function handleWeekClick(mondayKey) {
    modState.selectedWeek = mondayKey;
    clearListeners();
    renderCalendarGrid(calBody, year, month, null, mondayKey, handleWeekClick, modState.slotsMap);
    renderModWeekDetail(mondayKey);
    setupModWeekListeners(mondayKey);
    setTimeout(() => document.getElementById("mod-week-detail")
      .scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  renderCalendarGrid(calBody, year, month, null, modState.selectedWeek, handleWeekClick, modState.slotsMap);
  if (!modState.selectedWeek) document.getElementById("mod-week-detail").hidden = true;
  else {
    renderModWeekDetail(modState.selectedWeek);
    setupModWeekListeners(modState.selectedWeek);
  }
}

/* ════════════════════════════════════════
   MODÉRATION — DÉTAIL SEMAINE
════════════════════════════════════════ */

function renderModWeekDetail(mondayKey) {
  const detail = document.getElementById("mod-week-detail");
  const title  = document.getElementById("mod-week-title");
  const cards  = document.getElementById("mod-day-cards");

  detail.hidden = false;
  title.textContent = weekRangeLabel(mondayKey);
  cards.innerHTML   = "";

  const slotsMap = modState.slotsMap;
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const monday   = keyToDate(mondayKey);

  const appendModCard = (slot, dayLabel, isPast) => {
    const card      = document.createElement("div");
    card.className  = "day-card";
    const hdrClass  = slot.is_closed ? "closed-header" : isPast ? "past-header" : "";
    const badge     = buildAdminBadge(slot);
    const timeLabel = slot.heure_debut && slot.heure_fin
      ? `${slot.heure_debut.slice(0,5)} – ${slot.heure_fin.slice(0,5)}` : "07:00 – 09:00";
    const lieuLabel = slot.lieu || "Gare d'Agen";

    card.innerHTML = `
      <div class="day-card-header ${hdrClass}">
        <div>
          <div class="day-card-name">${dayLabel}</div>
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
  };

  for (let i = 0; i < 5; i++) {
    const day    = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key    = dateToKey(day);
    const isPast = day < today;
    const label  = DAYS_FR[i];

    const morningSlot = slotsMap[key] || { id: null, date: key, inscrits: [], is_closed: false, close_reason: null, places: 2, heure_debut: null, heure_fin: null };
    appendModCard(morningSlot, label, isPast);

    const eveningSlot = slotsMap[key + "_17h"];
    if (eveningSlot) appendModCard(eveningSlot, label, isPast);
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
        _refreshModCalendar();
      });
    }
    if (action === "reopen") modReopenSlot(slotId);
    if (action === "remove") modRemoveInscrit(slotId, memberId);
  };
}

/* ════════════════════════════════════════
   MODÉRATION — ACTIONS
════════════════════════════════════════ */

function modReopenSlot(slotId) {
  try {
    openSlot(slotId);
    window.showToast("Créneau réouvert.");
    _refreshModCalendar();
  } catch (e) { window.showError(); }
}

function modRemoveInscrit(slotId, memberId) {
  try {
    deleteRegistration(slotId, memberId);
    window.showToast("Inscrit retiré.");
    _refreshModCalendar();
  } catch (e) { window.showError(); }
}

function _refreshModCalendar() {
  const { year, month } = modState;
  const firstDate = dateToKey(new Date(year, month, 1));
  const lastDate  = dateToKey(lastDayOfMonth(year, month));
  modState.slotsMap = getSlotsWithRegistrations(firstDate, lastDate);
  refreshDots(document.getElementById("mod-cal-body"), year, month, null, modState.slotsMap);
  if (modState.selectedWeek) renderModWeekDetail(modState.selectedWeek);
}
