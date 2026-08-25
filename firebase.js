/* ═══════════════════════════════════════════
   firebase.js — Couche sync non-bloquante
   localStorage reste la source de vérité.
   Firebase est fire-and-forget : l'appli ne se bloque JAMAIS.
══════════════════════════════════════════════ */

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs,
         deleteDoc, setDoc, updateDoc, writeBatch, query, where, orderBy, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBO-IsG95uFEJ8pbzFrZNHmdOi6MCcqAp0",
  authDomain:        "pmg-agen.firebaseapp.com",
  projectId:         "pmg-agen",
  storageBucket:     "pmg-agen.firebasestorage.app",
  messagingSenderId: "1061812432446",
  appId:             "1:1061812432446:web:fc6118f16b45d9eb8feb6f",
  measurementId:     "G-KD6NGMHT93",
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* ── Helpers auth (pas de Firebase) ── */

function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TPL-";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function hashPIN(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  return crypto.randomUUID() + "-" + Date.now().toString(36);
}

/* ── Normalisation locale (dupliquée de data.js — firebase.js ne peut pas importer) ── */

function norm(s) {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ /g, " ")
    .trim()
    .toLowerCase();
}

/* ── Membres (doc ID = UUID local) ── */

async function fbGetMembers() {
  try {
    const snap = await getDocs(collection(db, "members"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

async function fbAddMember(member) {
  try {
    await setDoc(doc(db, "members", member.id), {
      prenom:       member.prenom,
      nom:          member.nom,
      tel:          member.tel || "",
      is_moderator: !!member.is_moderator,
      pin_reset:    false,
    }, { merge: true });
  } catch {}
}

/* Recherche membre par prénom+nom (case-insensitive) — retourne le doc complet avec pin_hash */
async function fbFindMember(prenom, nom) {
  try {
    const p = norm(prenom);
    const n = norm(nom);
    const snap = await getDocs(collection(db, "members"));
    const matches = snap.docs.filter(d => {
      const data = d.data();
      return norm(data.prenom) === p && norm(data.nom) === n;
    });
    if (matches.length === 0) return null;
    /* Si doublons de nom normalisé, le PIN départagera */
    return { id: matches[0].id, ...matches[0].data() };
  } catch { return null; }
}

/* Mise à jour partielle d'un membre (pin_hash, pin_reset, etc.).
   Retourne true/false — l'appelant doit savoir si l'écriture a réussi
   pour garantir que le PIN est bien synchronisé avant de continuer. */
async function fbUpdateMember(memberId, fields) {
  try {
    await updateDoc(doc(db, "members", memberId), fields);
    return true;
  } catch { return false; }
}

/* Reset PIN admin : efface pin_hash + pose pin_reset:true */
async function fbSetPinReset(memberId) {
  try {
    await updateDoc(doc(db, "members", memberId), { pin_hash: null, pin_reset: true });
  } catch {}
}

/* ── Auth membre ── */

async function fbVerifyToken(token) {
  // Ne catch pas les erreurs réseau — l'appelant doit les distinguer de "token absent"
  const snap = await getDocs(collection(db, "members"));
  for (const d of snap.docs) {
    const data = d.data();
    if (data.tokens && data.tokens.includes(token)) return { id: d.id, ...data };
  }
  return null; // token introuvable (réseau OK mais token invalide)
}

async function fbFirstLogin(prenom, nom, inviteCode, pin) {
  const snap = await getDocs(collection(db, "members"));
  const memberDoc = snap.docs.find(d => {
    const data = d.data();
    return data.prenom.toLowerCase() === prenom.toLowerCase() &&
           data.nom.toLowerCase()    === nom.toLowerCase()    &&
           data.invite_code          === inviteCode.toUpperCase() &&
           data.invite_used          === false;
  });
  if (!memberDoc) throw new Error("INVALID_INVITE");

  const pinHash = await hashPIN(pin);
  const token   = generateToken();
  await updateDoc(doc(db, "members", memberDoc.id), {
    invite_used: true, pin_hash: pinHash, tokens: [token],
  });
  localStorage.setItem("tpl_token", token);
  return { id: memberDoc.id, ...memberDoc.data(), invite_used: true };
}

async function fbLoginWithPIN(prenom, nom, pin) {
  const pinHash = await hashPIN(pin);
  const snap = await getDocs(collection(db, "members"));
  const memberDoc = snap.docs.find(d => {
    const data = d.data();
    return data.prenom.toLowerCase() === prenom.toLowerCase() &&
           data.nom.toLowerCase()    === nom.toLowerCase()    &&
           data.pin_hash             === pinHash              &&
           data.invite_used          === true;
  });
  if (!memberDoc) throw new Error("INVALID_PIN");

  const token  = generateToken();
  const tokens = [...(memberDoc.data().tokens || []), token].slice(-5);
  await updateDoc(doc(db, "members", memberDoc.id), { tokens });
  localStorage.setItem("tpl_token", token);
  return { id: memberDoc.id, ...memberDoc.data() };
}

async function fbRevokeToken(token) {
  try {
    const snap = await getDocs(collection(db, "members"));
    for (const d of snap.docs) {
      const tokens = d.data().tokens || [];
      if (tokens.includes(token)) {
        await updateDoc(doc(db, "members", d.id), { tokens: tokens.filter(t => t !== token) });
        break;
      }
    }
  } catch {}
}

async function fbResetInvite(memberId) {
  try {
    const newCode = generateInviteCode();
    await updateDoc(doc(db, "members", memberId), {
      invite_code: newCode, invite_used: false, pin_hash: null, tokens: [],
    });
    return newCode;
  } catch { return null; }
}

async function fbRevokeAllTokens(memberId) {
  try { await updateDoc(doc(db, "members", memberId), { tokens: [] }); } catch {}
}

async function fbDeleteMember(id) {
  try { await deleteDoc(doc(db, "members", id)); } catch {}
}

/* ── Paramètres (doc ID = clé) ── */

async function fbGetSettings() {
  try {
    const snap = await getDocs(collection(db, "settings"));
    const out  = {};
    snap.docs.forEach(d => { out[d.id] = d.data().value; });
    return out;
  } catch { return {}; }
}

async function fbUpdateSetting(key, value) {
  try {
    await setDoc(doc(db, "settings", key), { value: String(value) }, { merge: true });
  } catch {}
}

/* ── Créneaux (doc ID = date "YYYY-MM-DD") ── */

async function fbGetSlots(dateDebut, dateFin) {
  try {
    const q    = query(
      collection(db, "slots"),
      where("date", ">=", dateDebut),
      where("date", "<=", dateFin),
      orderBy("date"),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data() }));
  } catch { return []; }
}

async function fbGenerateMissingSlots(missingSlots, places) {
  for (const slot of missingSlots) {
    try {
      const ref  = doc(db, "slots", slot.date);
      const snap = await getDoc(ref);
      /* Le créneau existe déjà côté Firestore (ex: places déjà modifié par
         l'admin) — ne jamais l'écraser juste parce qu'il est absent du
         cache local (nouvel appareil, cache vidé, etc.). */
      if (snap.exists()) continue;
      await setDoc(ref, {
        date:         slot.date.slice(0, 10),
        heure_debut:  slot.heure_debut,
        heure_fin:    slot.heure_fin,
        places,
        is_closed:    false,
        close_reason: null,
      });
    } catch {}
  }
}

async function fbCloseSlot(date, reason) {
  try {
    await setDoc(doc(db, "slots", date),
      { is_closed: true, close_reason: reason || null }, { merge: true });
  } catch {}
}

async function fbOpenSlot(date) {
  try {
    await setDoc(doc(db, "slots", date),
      { is_closed: false, close_reason: null }, { merge: true });
  } catch {}
}

async function fbUpdateFutureSlotsPlaces(places, dates) {
  try {
    const batch = writeBatch(db);
    dates.forEach(date => batch.update(doc(db, "slots", date), { places }));
    await batch.commit();
  } catch {
    for (const date of dates) {
      try { await setDoc(doc(db, "slots", date), { places }, { merge: true }); } catch {}
    }
  }
}

/* ── Inscriptions (doc ID = UUID local) ── */

async function fbGetRegistrations(slotDate) {
  try {
    const q    = query(collection(db, "registrations"), where("slot_date", "==", slotDate));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

/* Toutes les inscriptions d'un membre, tous appareils confondus (jointure
   par slot_date côté appelant — les slot_id locaux diffèrent d'un appareil
   à l'autre). Retourne null (et non []) en cas d'échec réseau, pour que
   l'appelant distingue "aucune inscription" de "impossible à vérifier". */
async function fbGetMemberRegistrations(memberId) {
  try {
    const q    = query(collection(db, "registrations"), where("member_id", "==", memberId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return null; }
}

async function fbAddRegistration(reg) {
  try {
    const q    = query(collection(db, "registrations"), where("slot_date", "==", reg.slot_date));
    const snap = await getDocs(q);
    const regs = snap.docs.map(d => d.data());
    if (regs.some(r => r.member_id === reg.member_id)) return "DEJA_INSCRIT";
    const slotSnap = await getDoc(doc(db, "slots", reg.slot_date));
    const places   = slotSnap.exists() ? (slotSnap.data().places || 2) : 2;
    if (regs.length >= places) return "COMPLET";
    await setDoc(doc(db, "registrations", reg.id), {
      slot_date:     reg.slot_date,
      slot_id:       reg.slot_id,
      member_id:     reg.member_id,
      member_prenom: reg.member_prenom,
      member_nom:    reg.member_nom,
      member_tel:    reg.member_tel || "",
    });
    return "OK";
  } catch { return "ERROR"; }
}

/* ── Écoute temps réel (onSnapshot) ── */

function fbListenDay(slotDate, callback) {
  let slotDoc  = null;
  let regsData = null;

  function fire() {
    if (slotDoc !== null && regsData !== null) callback(slotDate, regsData, slotDoc);
  }

  const unsubSlot = onSnapshot(doc(db, "slots", slotDate), snap => {
    slotDoc = snap.exists() ? snap.data() : {};
    fire();
  }, () => {});

  const q = query(collection(db, "registrations"), where("slot_date", "==", slotDate));
  const unsubRegs = onSnapshot(q, snap => {
    regsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    fire();
  }, () => {});

  return () => { unsubSlot(); unsubRegs(); };
}

function fbListenWeek(dateDebut, dateFin, callback) {
  const q = query(
    collection(db, "registrations"),
    where("slot_date", ">=", dateDebut),
    where("slot_date", "<=", dateFin),
    orderBy("slot_date"),
  );
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, () => {});
}

async function fbGetRegistrationsPeriod(dateStart, dateEnd) {
  try {
    const q = query(
      collection(db, "registrations"),
      where("slot_date", ">=", dateStart),
      where("slot_date", "<=", dateEnd),
      orderBy("slot_date"),
    );
    const snap = await getDocs(q);
    console.log("[TPL Stats] fbGetRegistrationsPeriod:", snap.size, "regs pour", dateStart, "→", dateEnd);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("[TPL Stats] fbGetRegistrationsPeriod erreur:", e);
    return [];
  }
}

async function fbDeleteRegistration(slotDate, memberId) {
  if (!slotDate || !memberId) {
    console.error("[TPL] ERREUR: paramètres manquants", { slotDate, memberId });
    return false;
  }
  try {
    const q = query(
      collection(db, "registrations"),
      where("slot_date", "==", slotDate),
      where("member_id", "==", memberId),
    );
    const snap = await getDocs(q);
    if (snap.size === 0) {
      console.error("[TPL] Aucune inscription trouvée pour", slotDate, memberId);
      return false;
    }
    if (snap.size > 1) {
      console.error("[TPL] ANOMALIE: plusieurs inscriptions trouvées", snap.size);
    }
    await deleteDoc(snap.docs[0].ref);
    console.log("[TPL] Désistement OK — 1 seul document supprimé:", slotDate, memberId);
    return true;
  } catch (e) {
    console.error("[TPL] fbDeleteRegistration — erreur:", e);
    return false;
  }
}

/* ── Quotas (doc ID = member_id) ── */

/* Retourne toujours un objet quota valide ({count, next_reset}) — y compris
   {count:0, next_reset:null} si le membre n'a encore aucun document.
   Retourne undefined UNIQUEMENT en cas d'échec réseau, pour que l'appelant
   distingue "vraiment aucune réservation" de "impossible à vérifier". */
async function fbGetQuota(member_id) {
  try {
    const d = await getDoc(doc(db, "quotas", member_id));
    return d.exists() ? d.data() : { count: 0, next_reset: null };
  } catch { return undefined; }
}

async function fbIncrementQuota(member_id, count, next_reset) {
  try {
    await setDoc(doc(db, "quotas", member_id), { count, next_reset });
  } catch {}
}

async function fbDecrementQuota(member_id, count) {
  try {
    await setDoc(doc(db, "quotas", member_id), { count }, { merge: true });
  } catch {}
}

/* ── Initialisation Firestore si vide ── */

async function fbSeedIfEmpty(defaultMembers, defaultSettings) {
  try {
    const snap = await getDocs(collection(db, "settings"));
    if (!snap.empty) return;
    await Promise.allSettled([
      ...Object.entries(defaultSettings).map(([k, v]) =>
        setDoc(doc(db, "settings", k), { value: String(v) })),
      ...defaultMembers.map(m =>
        setDoc(doc(db, "members", m.id), {
          prenom:       m.prenom,
          nom:          m.nom,
          tel:          m.tel || "",
          is_moderator: !!m.is_moderator,
          pin_reset:    false,
        })),
    ]);
  } catch {}
}

/* ── Exposition globale (non-bloquant : si ce module échoue, l'appli continue) ── */

window.fbFunctions = {
  fbGetMembers, fbAddMember, fbDeleteMember,
  fbFindMember, fbUpdateMember, fbSetPinReset,
  fbGetSettings, fbUpdateSetting,
  fbGetSlots, fbGenerateMissingSlots, fbCloseSlot, fbOpenSlot, fbUpdateFutureSlotsPlaces,
  fbGetRegistrations, fbGetRegistrationsPeriod, fbGetMemberRegistrations,
  fbAddRegistration, fbDeleteRegistration,
  fbListenDay, fbListenWeek,
  fbGetQuota, fbIncrementQuota, fbDecrementQuota,
  fbSeedIfEmpty,
};
