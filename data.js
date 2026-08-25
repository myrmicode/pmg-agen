/* ═══════════════════════════════════════════
   data.js — Utilitaires + stockage localStorage
   Source de vérité locale. Firebase est sync optionnel.
══════════════════════════════════════════════ */

/* ── Données de démonstration ── */

export const DEFAULT_MEMBERS = [
  { prenom: "Sophie",   nom: "Martin",  tel: "06 12 34 56 78", is_moderator: false },
  { prenom: "Pierre",   nom: "Leblanc", tel: "06 23 45 67 89", is_moderator: false },
  { prenom: "Isabelle", nom: "Roux",    tel: "06 34 56 78 90", is_moderator: false },
];

export const DEFAULT_SETTINGS = { admin_pwd: "1234", banner: "", places_default: "2" };

/* ── Normalisation partagée (login + admin + import) ── */

export function norm(s) {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ /g, " ")
    .trim()
    .toLowerCase();
}

/* ── Générateur d'ID ── */

export function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function _genInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TPL-";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* ── Helpers localStorage ── */

export function _load(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : def;
  } catch { return def; }
}

export function _save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

/* ── Initialisation des données de démonstration ── */

export function initDemoData() {
  if (!localStorage.getItem("tpl_members")) {
    _save("tpl_members", DEFAULT_MEMBERS.map(m => ({
      ...m, id: genId(),
    })));
  }
  if (!localStorage.getItem("tpl_settings"))      _save("tpl_settings",      DEFAULT_SETTINGS);
  if (!localStorage.getItem("tpl_slots"))         _save("tpl_slots",         []);
  if (!localStorage.getItem("tpl_registrations")) _save("tpl_registrations", []);
  if (!localStorage.getItem("tpl_quotas"))        _save("tpl_quotas",        {});
}

/* ── Helpers date ── */

export function dateToKey(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function keyToDate(key) {
  const parts = key.split("-");
  return new Date(+parts[0], +parts[1] - 1, parseInt(parts[2]));
}

export function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

export function sameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth()    === d2.getMonth()    &&
         d1.getDate()     === d2.getDate();
}

export function isWeekday(d) {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

export function formatDateFR(d) {
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function formatDateShort(d) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function getMondayOf(d) {
  const clone = new Date(d);
  const dow = clone.getDay() === 0 ? 7 : clone.getDay();
  clone.setDate(clone.getDate() - (dow - 1));
  clone.setHours(0, 0, 0, 0);
  return clone;
}

/* ── Helpers membres ── */

export function fullName(member) {
  return `${member.prenom} ${member.nom}`.trim();
}

export function getInitials(nameStr) {
  return nameStr.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

export function getAvatarColorIndex(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash += id.charCodeAt(i);
  return hash % 8;
}

export function getAvatarBgColor(idx) {
  const colors = [
    "#3b82f6","#8b5cf6","#10b981","#f59e0b",
    "#ef4444","#06b6d4","#84cc16","#ec4899",
  ];
  return colors[idx % colors.length];
}

/* ── Membres ── */

export function getMembers() {
  return _load("tpl_members", []).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export function getMemberById(id) {
  return _load("tpl_members", []).find(m => m.id === id) ?? null;
}

export function getMemberByName(prenom, nom) {
  const p = prenom.toLowerCase().trim();
  const n = nom.toLowerCase().trim();
  return _load("tpl_members", []).find(m =>
    m.prenom.toLowerCase().trim() === p &&
    m.nom.toLowerCase().trim()    === n
  ) ?? null;
}

export function addMember({ prenom, nom, tel }) {
  const members = _load("tpl_members", []);
  const member  = {
    id: genId(), prenom, nom, tel: tel || "", is_moderator: false,
  };
  members.push(member);
  _save("tpl_members", members);
  window.fbFunctions?.fbAddMember(member);
  return member;
}

export function updateMemberLocalAuth(id, fields) {
  const members = _load("tpl_members", []);
  const idx     = members.findIndex(m => m.id === id);
  if (idx < 0) return;
  members[idx] = { ...members[idx], ...fields };
  _save("tpl_members", members);
}

export function deleteMember(id) {
  _save("tpl_members",       _load("tpl_members", []).filter(m => m.id !== id));
  _save("tpl_registrations", _load("tpl_registrations", []).filter(r => r.member_id !== id));
  const quotas = _load("tpl_quotas", {});
  delete quotas[id];
  _save("tpl_quotas", quotas);
  window.fbFunctions?.fbDeleteMember(id);
}

export function setModerator(memberId, value) {
  _save("tpl_members",
    _load("tpl_members", []).map(m =>
      m.id === memberId ? { ...m, is_moderator: value } : m
    )
  );
  const m = getMemberById(memberId);
  if (m) window.fbFunctions?.fbAddMember(m);
}

export function importMembers(members) {
  const existing    = _load("tpl_members", []);
  const existingSet = new Set(
    existing.map(m => `${m.prenom.toLowerCase().trim()}|${m.nom.toLowerCase().trim()}`)
  );
  const toInsert = members.filter(m =>
    m.prenom.trim() && m.nom.trim() &&
    !existingSet.has(`${m.prenom.toLowerCase().trim()}|${m.nom.toLowerCase().trim()}`)
  );
  const newMembers = toInsert.map(m => ({
    id: genId(), prenom: m.prenom.trim(), nom: m.nom.trim(),
    tel: (m.tel || "").trim(), is_moderator: false,
  }));
  newMembers.forEach(m => existing.push(m));
  _save("tpl_members", existing);
  newMembers.forEach(m => window.fbFunctions?.fbAddMember(m));
  return { imported: toInsert.length, ignored: members.length - toInsert.length };
}

/* ── Paramètres ── */

export function getSettings() {
  return _load("tpl_settings", DEFAULT_SETTINGS);
}

export function updateSetting(key, value) {
  const s = getSettings();
  s[key] = String(value);
  _save("tpl_settings", s);
  window.fbFunctions?.fbUpdateSetting(key, value);
}

export function patchSlotFromFirebase(date, fields) {
  const slots = _load("tpl_slots", []);
  const idx   = slots.findIndex(s => s.date === date);
  if (idx < 0) return;
  slots[idx] = { ...slots[idx], ...fields };
  _save("tpl_slots", slots);
}

export function updateFutureSlotsPlaces(places) {
  const today = dateToKey(new Date());
  const slots = _load("tpl_slots", []);
  let count = 0;
  const futureDates = [];
  const updated = slots.map(s => {
    if (s.date >= today) {
      count++;
      futureDates.push(s.date);
      return { ...s, places };
    }
    return s;
  });
  _save("tpl_slots", updated);
  if (futureDates.length > 0) {
    window.fbFunctions?.fbUpdateFutureSlotsPlaces(places, futureDates);
  }
  return count;
}

/* ── Créneaux ── */

export function getSlots(dateDebut, dateFin) {
  return _load("tpl_slots", [])
    .filter(s => s.date.slice(0, 10) >= dateDebut && s.date.slice(0, 10) <= dateFin)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function generateMissingSlots() {
  const settings = getSettings();
  const places   = parseInt(settings.places_default) || 2;
  const today    = new Date();

  const months = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const allSlotDefs = [];
  for (const { year, month } of months) {
    const cur     = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    while (cur <= lastDay) {
      if (isWeekday(cur)) {
        const dateKey = dateToKey(new Date(cur));
        const dow     = cur.getDay();
        allSlotDefs.push({ date: dateKey,           heure_debut: "07:00", heure_fin: "09:00" });
        if (dow === 1 || dow === 5) {
          allSlotDefs.push({ date: dateKey + "_17h", heure_debut: "17:00", heure_fin: "19:00" });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  if (allSlotDefs.length === 0) return;

  const existing      = _load("tpl_slots", []);
  const existingDates = new Set(existing.map(s => s.date));
  const missing       = allSlotDefs.filter(s => !existingDates.has(s.date));
  if (missing.length === 0) return;

  missing.forEach(({ date, heure_debut, heure_fin }) => existing.push({
    id: genId(), date, places,
    heure_debut, heure_fin, lieu: null,
    is_closed: false, close_reason: null,
  }));
  _save("tpl_slots", existing);
  window.fbFunctions?.fbGenerateMissingSlots(missing, places);
}

export function closeSlot(slotId, reason) {
  const slots = _load("tpl_slots", []);
  const slot  = slots.find(s => s.id === slotId);
  _save("tpl_slots", slots.map(s =>
    s.id === slotId ? { ...s, is_closed: true, close_reason: reason || null } : s
  ));
  if (slot) window.fbFunctions?.fbCloseSlot(slot.date, reason || null);
}

export function openSlot(slotId) {
  const slots = _load("tpl_slots", []);
  const slot  = slots.find(s => s.id === slotId);
  _save("tpl_slots", slots.map(s =>
    s.id === slotId ? { ...s, is_closed: false, close_reason: null } : s
  ));
  if (slot) window.fbFunctions?.fbOpenSlot(slot.date);
}

/* ── Inscriptions ── */

export function addRegistration(slotId, memberId) {
  const regs   = _load("tpl_registrations", []);
  const member = getMemberById(memberId);
  const slot   = _load("tpl_slots", []).find(s => s.id === slotId);
  const reg    = { id: genId(), slot_id: slotId, slot_date: slot?.date ?? null, member_id: memberId, registered_at: new Date().toISOString() };
  regs.push(reg);
  _save("tpl_registrations", regs);
  if (slot && member) {
    window.fbFunctions?.fbAddRegistration({
      id:            reg.id,
      slot_id:       slotId,
      slot_date:     slot.date,
      member_id:     memberId,
      member_prenom: member.prenom,
      member_nom:    member.nom,
      member_tel:    member.tel || "",
    });
  }
  return reg;
}

export function deleteRegistration(slotId, memberId) {
  if (!memberId) {
    console.error("[TPL] deleteRegistration: memberId manquant !");
    return;
  }
  const regs = _load("tpl_registrations", []);
  const reg  = regs.find(r => r.slot_id === slotId && r.member_id === memberId);
  const slot = _load("tpl_slots", []).find(s => s.id === slotId);
  const slotDate = slot?.date ?? reg?.slot_date;
  console.log("[TPL] deleteRegistration — slot:", slotId, "| date:", slotDate, "| member:", memberId, "| reg trouvé:", reg?.id ?? "AUCUN");
  _save("tpl_registrations", regs.filter(r => !(r.slot_id === slotId && r.member_id === memberId)));
  if (slotDate) {
    window.fbFunctions?.fbDeleteRegistration(slotDate, memberId);
  } else {
    console.warn("[TPL] deleteRegistration: slotDate introuvable, Firebase non appelé");
  }
}

export function getSlotsWithRegistrations(dateDebut, dateFin) {
  const slots = getSlots(dateDebut, dateFin);
  if (slots.length === 0) return {};

  const members  = _load("tpl_members", []);
  const regs     = _load("tpl_registrations", []);
  const slotsMap = {};

  for (const slot of slots) {
    const slotRegs  = regs.filter(r => r.slot_id === slot.id);
    slot.inscrits   = slotRegs.map(r => {
      const m = members.find(x => x.id === r.member_id) || {};
      return { id: r.member_id, prenom: m.prenom || "?", nom: m.nom || "", tel: m.tel || "" };
    });
    slotsMap[slot.date] = slot;
  }
  return slotsMap;
}

/* ── Inscriptions à venir (membre) ── */

/* regsOverride : liste d'inscriptions déjà chargée (ex: depuis Firebase,
   pour un membre connecté sur un autre appareil que celui où il s'est
   inscrit). Les slot_id locaux sont propres à chaque appareil — la
   jointure se fait donc toujours par date (slot_date), jamais par slot_id. */
export function getMemberUpcomingRegistrations(memberId, regsOverride) {
  const today   = dateToKey(new Date());
  const slots   = _load("tpl_slots", []);
  const members = _load("tpl_members", []);

  const allRegs = (regsOverride ?? _load("tpl_registrations", []))
    .map(r => ({ ...r, _date: r.slot_date || slots.find(s => s.id === r.slot_id)?.date }))
    .filter(r => r._date);

  const myRegs = allRegs.filter(r => r.member_id === memberId);

  return myRegs
    .map(r => {
      const slot = slots.find(s => s.date === r._date);
      if (!slot) return null;
      const coInscrits = allRegs
        .filter(cr => cr._date === r._date && cr.member_id !== memberId)
        .map(cr => {
          const m = members.find(mb => mb.id === cr.member_id) || {};
          return {
            id:     cr.member_id,
            prenom: m.prenom || cr.member_prenom || "?",
            nom:    m.nom    || cr.member_nom    || "",
            tel:    m.tel    || cr.member_tel    || "",
          };
        });
      return { registrationId: r.id, ...slot, coInscrits };
    })
    .filter(r => r && r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getMemberUpcomingCount(memberId) {
  return getMemberUpcomingRegistrations(memberId).length;
}

/* ── Quotas ── */

export const QUOTA_MAX = 2;

/* override : quota déjà connu (ex: renvoyé par Firebase) — sert à faire
   confiance au serveur plutôt qu'au compteur local de cet appareil, qui
   ne connaît pas les réservations faites ailleurs. undefined = pas de
   valeur externe dispo (hors-ligne) → repli sur le stockage local. */
export function getQuotaState(memberId, override) {
  const now    = new Date();
  const quotas = _load("tpl_quotas", {});
  let   q      = override !== undefined ? override : (quotas[memberId] || { count: 0, next_reset: null });
  let   dirty  = override !== undefined;

  if (q.next_reset && now >= new Date(q.next_reset)) {
    q = { count: 0, next_reset: null };
    dirty = true;
  }

  if (dirty) {
    quotas[memberId] = q;
    _save("tpl_quotas", quotas);
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);
  const nextResetLabel = tomorrow.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  }) + " à 7h00";

  return { count: q.count, max: QUOTA_MAX, canSignup: q.count < QUOTA_MAX, nextResetLabel };
}

/* Va chercher le quota réel sur Firebase (avec timeout) et le fusionne
   dans le cache local — pour que le compteur reflète les réservations
   faites depuis n'importe quel appareil, pas seulement celui-ci. */
export async function fetchAndSyncQuota(memberId) {
  let fbQuota;
  if (window.fbFunctions?.fbGetQuota) {
    fbQuota = await Promise.race([
      window.fbFunctions.fbGetQuota(memberId),
      new Promise(r => setTimeout(() => r(undefined), 8000)),
    ]);
  }
  return getQuotaState(memberId, fbQuota);
}

export async function incrementQuota(memberId) {
  const state = await fetchAndSyncQuota(memberId);
  if (!state.canSignup) return false;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);

  const quotas   = _load("tpl_quotas", {});
  const cur      = quotas[memberId] || { count: 0, next_reset: null };
  const newQuota = { count: cur.count + 1, next_reset: tomorrow.toISOString() };
  quotas[memberId] = newQuota;
  _save("tpl_quotas", quotas);
  window.fbFunctions?.fbIncrementQuota(memberId, newQuota.count, newQuota.next_reset);
  return true;
}

export async function decrementQuota(memberId) {
  await fetchAndSyncQuota(memberId);
  const quotas   = _load("tpl_quotas", {});
  const cur      = quotas[memberId];
  if (!cur) return;
  const newCount = Math.max(0, cur.count - 1);
  quotas[memberId] = { ...cur, count: newCount };
  _save("tpl_quotas", quotas);
  window.fbFunctions?.fbDecrementQuota(memberId, newCount);
}
