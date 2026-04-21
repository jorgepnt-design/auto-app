const DRAFT_KEY = "carRepairDraft";
const CLOUD_CONFIG_KEY = "carFirebaseConfig";
const MAX_ATTACHMENTS_PER_ENTRY = 2;
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCqvZD4B-n9aLNq4Ju9pH_r0rePH9yYaPU",
  authDomain: "auto-8c4a9.firebaseapp.com",
  projectId: "auto-8c4a9",
  appId: "1:350962808870:web:1ef02bf4513e5bf209cee7",
  storageBucket: "auto-8c4a9.firebasestorage.app",
};

const authForm = document.getElementById("auth-form");
const authEmailInput = document.getElementById("auth-email");
const authPasswordInput = document.getElementById("auth-password");
const forgotPasswordButton = document.getElementById("forgot-password-button");
const logoutButton = document.getElementById("logout-button");
const authStatus = document.getElementById("auth-status");
const appContent = document.getElementById("app-content");

const cloudForm = document.getElementById("cloud-form");
const firebaseApiKeyInput = document.getElementById("firebase-api-key");
const firebaseAuthDomainInput = document.getElementById("firebase-auth-domain");
const firebaseProjectIdInput = document.getElementById("firebase-project-id");
const firebaseAppIdInput = document.getElementById("firebase-app-id");
const cloudStatus = document.getElementById("cloud-status");

const vehicleForm = document.getElementById("vehicle-form");
const carInput = document.getElementById("car");
const buildDateInput = document.getElementById("build-date");
const vehicleStatus = document.getElementById("vehicle-status");
const activeVehicleOutput = document.getElementById("active-vehicle");

const repairForm = document.getElementById("repair-form");
const dateInput = document.getElementById("date");
const mileageInput = document.getElementById("mileage");
const commentInput = document.getElementById("comment");
const receiptsInput = document.getElementById("receipts");
const receiptsInfo = document.getElementById("receipts-info");
const errorOutput = document.getElementById("error");
const saveButton = document.getElementById("save-button");
const cancelEditButton = document.getElementById("cancel-edit");

const repairsBody = document.getElementById("repairs-body");
const emptyState = document.getElementById("empty-state");
const downloadPdfButton = document.getElementById("download-pdf");
const downloadCsvButton = document.getElementById("download-csv");

let editingId = null;
let editingAttachments = [];
let firebaseAuth = null;
let firestoreDb = null;
let firebaseStorage = null;
let repairsCache = [];
let vehicleCache = null;
let currentUser = null;
let authUnsubscribe = null;
let isCloudConnected = false;

const parseJsonOrNull = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const readCloudConfig = () => {
  const raw = localStorage.getItem(CLOUD_CONFIG_KEY);
  if (!raw) return null;

  const cfg = parseJsonOrNull(raw);
  if (!cfg || typeof cfg !== "object") return null;

  const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
  const authDomain = typeof cfg.authDomain === "string" ? cfg.authDomain.trim() : "";
  const projectId = typeof cfg.projectId === "string" ? cfg.projectId.trim() : "";
  const appId = typeof cfg.appId === "string" ? cfg.appId.trim() : "";
  const storageBucketRaw = typeof cfg.storageBucket === "string" ? cfg.storageBucket.trim() : "";
  const storageBucket = storageBucketRaw || `${projectId}.firebasestorage.app`;

  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId, storageBucket };
};

const saveCloudConfig = (config) => {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
};

const saveDraft = () => {
  const draft = {
    date: dateInput.value,
    mileage: mileageInput.value,
    comment: commentInput.value,
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
};

const restoreDraft = () => {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;

  const draft = parseJsonOrNull(raw);
  if (!draft || typeof draft !== "object") return;

  dateInput.value = draft.date || "";
  mileageInput.value = draft.mileage || "";
  commentInput.value = draft.comment || "";
};

const clearDraft = () => {
  localStorage.removeItem(DRAFT_KEY);
};

const formatDate = (isoDate) => {
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? isoDate : date.toLocaleDateString("de-DE");
};

const escapeHtml = (value) => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
};

const getCommentItems = (comment) => {
  if (typeof comment !== "string") return [];
  return comment
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const getCommentListHtml = (comment) => {
  const items = getCommentItems(comment);
  if (items.length === 0) return '<span class="muted-text">Kein Kommentar</span>';
  const listItems = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<ul class="comment-list">${listItems}</ul>`;
};

const normalizeAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "Beleg",
      url: typeof item.url === "string" ? item.url : "",
      path: typeof item.path === "string" ? item.path : "",
      type: typeof item.type === "string" ? item.type : "",
      size: Number(item.size) || 0,
    }))
    .filter((item) => item.url);
};

const getAttachmentsHtml = (attachments) => {
  const normalized = normalizeAttachments(attachments);
  if (normalized.length === 0) return "";

  const list = normalized
    .map(
      (file) =>
        `<li><a href="${file.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name)}</a></li>`,
    )
    .join("");

  return `<div class="attachments"><span class="attachment-title">Belege:</span><ul class="attachment-list">${list}</ul></div>`;
};

const isReceiptText = (item, attachments = []) => {
  const text = String(item).trim();
  const normalizedText = text.replace(/^[-*\s]+/, "");
  if (!text) return false;
  if (/belege\s*:/i.test(normalizedText)) return true;

  const attachmentNames = normalizeAttachments(attachments).map((file) => file.name.toLowerCase());
  if (attachmentNames.includes(normalizedText.toLowerCase())) return true;

  return /(?:^|\s)(?:[\w\s().-]+\.(?:pdf|png|jpe?g|webp|heic|gif|bmp|tiff?))(?:\s*\|)?(?:\s|$)/i.test(
    normalizedText,
  );
};

const getPdfCommentText = (comment, attachments = []) => {
  const commentItems = getCommentItems(comment).filter((item) => !isReceiptText(item, attachments));
  const lines = [];

  if (commentItems.length === 0) {
    lines.push("-");
  } else {
    lines.push(...commentItems.map((item) => `- ${item}`));
  }

  return lines.join("\n");
};

const formatBuildDate = (buildDate) => {
  if (typeof buildDate !== "string" || !/^\d{4}-\d{2}$/.test(buildDate)) {
    return "Nicht angegeben";
  }
  const [year, month] = buildDate.split("-");
  return `${month}/${year}`;
};

const getVehicleLabel = (vehicle) => {
  if (!vehicle) return "Kein Fahrzeug gespeichert";
  return `${vehicle.car} (Baujahr ${formatBuildDate(vehicle.build_date)})`;
};

const getUserBaseCollection = () => {
  if (!currentUser || !firestoreDb) return null;
  return firestoreDb.collection("users").doc(currentUser.uid);
};

const refreshAccess = () => {
  const canUseApp = isCloudConnected && !!currentUser;
  appContent.hidden = !canUseApp;

  vehicleForm.querySelectorAll("input, button").forEach((el) => {
    el.disabled = !canUseApp;
  });

  repairForm.querySelectorAll("input, textarea, button").forEach((el) => {
    el.disabled = !canUseApp;
  });

  downloadPdfButton.disabled = !canUseApp;
  downloadCsvButton.disabled = !canUseApp;
};

const clearInMemoryData = () => {
  repairsCache = [];
  vehicleCache = null;
  renderRepairs();
  renderVehicle();
  clearRepairForm();
  exitEditMode();
};

const setReceiptsInfo = () => {
  const selectedFiles = Array.from(receiptsInput.files || []);
  const existingCount = editingAttachments.length;

  if (editingId) {
    const selectedLabel =
      selectedFiles.length > 0
        ? `${selectedFiles.length} neue Datei(en) ausgewaehlt`
        : "keine neuen Dateien ausgewaehlt";
    receiptsInfo.textContent = `Vorhanden: ${existingCount} Datei(en), ${selectedLabel}. Maximal ${MAX_ATTACHMENTS_PER_ENTRY} pro Eintrag.`;
    return;
  }

  if (selectedFiles.length === 0) {
    receiptsInfo.textContent = `Maximal ${MAX_ATTACHMENTS_PER_ENTRY} Dateien pro Eintrag.`;
    return;
  }

  receiptsInfo.textContent = `${selectedFiles.length} Datei(en) ausgewaehlt. Maximal ${MAX_ATTACHMENTS_PER_ENTRY} pro Eintrag.`;
};

const renderVehicle = () => {
  if (!vehicleCache) {
    activeVehicleOutput.textContent = "Bitte zuerst Auto sowie Baujahr und Monat einmal speichern.";
    return;
  }

  carInput.value = vehicleCache.car || "";
  buildDateInput.value = vehicleCache.build_date || "";
  activeVehicleOutput.textContent = `Aktives Fahrzeug: ${getVehicleLabel(vehicleCache)}`;
};

const setEditMode = (id) => {
  editingId = id;
  saveButton.textContent = "Aktualisieren";
  cancelEditButton.hidden = false;
};

const exitEditMode = () => {
  editingId = null;
  editingAttachments = [];
  saveButton.textContent = "Speichern";
  cancelEditButton.hidden = true;
  setReceiptsInfo();
};

const fillFormForEdit = (repair) => {
  dateInput.value = repair.date || "";
  mileageInput.value = repair.mileage || "";
  commentInput.value = repair.comment || "";
  receiptsInput.value = "";
  editingAttachments = normalizeAttachments(repair.attachments);
  setReceiptsInfo();
  saveDraft();
};

const renderRepairs = () => {
  repairsBody.innerHTML = "";

  if (repairsCache.length === 0) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  repairsCache.forEach((repair) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${formatDate(repair.date)}</td>
      <td>${Number(repair.mileage).toLocaleString("de-DE")} km</td>
      <td>
        ${getCommentListHtml(repair.comment)}
        ${getAttachmentsHtml(repair.attachments)}
      </td>
      <td>
        <div class="row-actions">
          <button class="edit-btn" data-id="${repair.id}" data-action="edit" type="button">Bearbeiten</button>
          <button class="delete-btn" data-id="${repair.id}" data-action="delete" type="button">Loeschen</button>
        </div>
      </td>
    `;

    repairsBody.appendChild(tr);
  });
};

const loadRepairs = async () => {
  const root = getUserBaseCollection();
  if (!root) return;
  const snapshot = await root.collection("repairs").orderBy("date", "asc").get();
  repairsCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  renderRepairs();
};

const loadVehicle = async () => {
  const root = getUserBaseCollection();
  if (!root) return;
  const doc = await root.collection("app_meta").doc("vehicle_profile").get();
  vehicleCache = doc.exists ? doc.data() : null;
  renderVehicle();
};

const migrateLegacyDataIfNeeded = async () => {
  const root = getUserBaseCollection();
  if (!root || !firestoreDb) return false;

  const [userVehicleDoc, userRepairsSnapshot] = await Promise.all([
    root.collection("app_meta").doc("vehicle_profile").get(),
    root.collection("repairs").limit(1).get(),
  ]);

  if (userVehicleDoc.exists || !userRepairsSnapshot.empty) {
    return false;
  }

  const [legacyVehicleDoc, legacyRepairsSnapshot] = await Promise.all([
    firestoreDb.collection("app_meta").doc("vehicle_profile").get(),
    firestoreDb.collection("repairs").get(),
  ]);

  if (!legacyVehicleDoc.exists && legacyRepairsSnapshot.empty) {
    return false;
  }

  const batch = firestoreDb.batch();

  if (legacyVehicleDoc.exists) {
    batch.set(root.collection("app_meta").doc("vehicle_profile"), legacyVehicleDoc.data());
  }

  legacyRepairsSnapshot.forEach((docSnap) => {
    batch.set(root.collection("repairs").doc(docSnap.id), docSnap.data());
  });

  await batch.commit();
  return true;
};

const initFirebaseApp = async (config) => {
  if (firebase.apps.length === 0) {
    firebase.initializeApp(config);
    return;
  }

  const current = firebase.app().options || {};
  const sameProject =
    current.projectId === config.projectId &&
    current.apiKey === config.apiKey &&
    current.appId === config.appId &&
    current.storageBucket === config.storageBucket;

  if (!sameProject) {
    await firebase.app().delete();
    firebase.initializeApp(config);
  }
};

const attachAuthListener = () => {
  if (authUnsubscribe) authUnsubscribe();
  authUnsubscribe = firebaseAuth.onAuthStateChanged(async (user) => {
    currentUser = user || null;
    refreshAccess();

    if (!currentUser) {
      logoutButton.hidden = true;
      authStatus.textContent = "Bitte mit E-Mail und Passwort anmelden.";
      clearInMemoryData();
      return;
    }

    logoutButton.hidden = false;
    authStatus.textContent = `Angemeldet als ${currentUser.email || "Benutzer"}.`;

    try {
      const migrated = await migrateLegacyDataIfNeeded();
      await Promise.all([loadVehicle(), loadRepairs()]);
      if (migrated) {
        authStatus.textContent = "Alte Eintraege wurden in dein Konto uebernommen.";
      }
    } catch (error) {
      console.error(error);
      authStatus.textContent = "Anmeldung ok, aber Daten konnten nicht geladen werden.";
    }
  });
};

const connectCloud = async (config) => {
  await initFirebaseApp(config);
  firebaseAuth = firebase.auth();
  firestoreDb = firebase.firestore();
  firebaseStorage = firebase.storage();
  isCloudConnected = true;
  attachAuthListener();
  refreshAccess();
  cloudStatus.textContent = "Firebase verbunden.";
};

const sanitizeFileName = (name) => {
  return String(name || "beleg")
    .replaceAll(" ", "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(-80);
};

const uploadReceiptFiles = async (files, repairId) => {
  if (!firebaseStorage || !files || files.length === 0 || !currentUser) return [];

  const uploads = files.map(async (file) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const safeName = sanitizeFileName(file.name);
    const path = `users/${currentUser.uid}/receipts/${repairId}/${timestamp}-${random}-${safeName}`;
    const ref = firebaseStorage.ref().child(path);
    const snapshot = await ref.put(file);
    const url = await snapshot.ref.getDownloadURL();

    return {
      name: file.name,
      url,
      path,
      type: file.type || "",
      size: Number(file.size) || 0,
    };
  });

  return Promise.all(uploads);
};

const deleteAttachmentFiles = async (attachments) => {
  const normalized = normalizeAttachments(attachments);
  if (normalized.length === 0 || !firebaseStorage) return;

  await Promise.all(
    normalized.map(async (file) => {
      if (!file.path) return;
      try {
        await firebaseStorage.ref().child(file.path).delete();
      } catch (error) {
        console.warn("Attachment delete skipped:", error);
      }
    }),
  );
};

const exportRepairsToPdf = () => {
  if (repairsCache.length === 0) {
    errorOutput.textContent = "Keine Eintraege vorhanden, die als PDF exportiert werden koennen.";
    return;
  }

  if (!vehicleCache) {
    errorOutput.textContent = "Bitte zuerst Fahrzeugdaten speichern.";
    return;
  }

  errorOutput.textContent = "";

  const { jsPDF } = window.jspdf || {};
  if (!jsPDF || typeof jsPDF.API.autoTable !== "function") {
    errorOutput.textContent = "PDF-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung pruefen.";
    return;
  }

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const createdAt = new Date().toLocaleString("de-DE");
  const totalRepairs = repairsCache.length;
  const highestMileage = Math.max(...repairsCache.map((entry) => Number(entry.mileage) || 0));

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Auto-Reparaturprotokoll", 15, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Erstellt am: ${createdAt}`, 15, 22);

  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Fahrzeug: ${vehicleCache.car}`, 15, 38);
  doc.text(`Baujahr: ${formatBuildDate(vehicleCache.build_date)}`, 85, 38);
  doc.text(`Eintraege: ${totalRepairs}`, 128, 38);
  doc.text(`Max. km: ${highestMileage.toLocaleString("de-DE")}`, 165, 38);

  const bodyRows = repairsCache.map((repair, index) => [
    String(index + 1),
    formatDate(repair.date),
    `${Number(repair.mileage).toLocaleString("de-DE")} km`,
    getPdfCommentText(repair.comment, repair.attachments),
  ]);

  doc.autoTable({
    startY: 44,
    head: [["#", "Datum", "Kilometerstand", "Kommentar"]],
    body: bodyRows,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: 2.5,
      textColor: [17, 24, 39],
      lineColor: [209, 213, 219],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 28 },
      2: { cellWidth: 36 },
      3: { cellWidth: "auto" },
    },
    margin: { left: 15, right: 15 },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99);
      doc.text(`Seite ${data.pageNumber} von ${pageCount}`, data.settings.margin.left, 290);
      doc.text("Auto-Reparaturprotokoll", 195, 290, { align: "right" });
    },
  });

  const filenameDate = new Date().toISOString().split("T")[0];
  doc.save(`auto-reparaturen-${filenameDate}.pdf`);
};

const escapeCsvField = (value) => {
  const text = String(value ?? "");
  return `"${text.replaceAll("\"", "\"\"")}"`;
};

const exportRepairsToCsv = () => {
  if (repairsCache.length === 0) {
    errorOutput.textContent = "Keine Eintraege vorhanden, die als CSV exportiert werden koennen.";
    return;
  }

  if (!vehicleCache) {
    errorOutput.textContent = "Bitte zuerst Fahrzeugdaten speichern.";
    return;
  }

  errorOutput.textContent = "";

  const createdAt = new Date().toLocaleString("de-DE");
  const lines = [];

  lines.push([escapeCsvField("Auto-Reparaturprotokoll")].join(";"));
  lines.push([escapeCsvField("Erstellt am"), escapeCsvField(createdAt)].join(";"));
  lines.push([escapeCsvField("Fahrzeug"), escapeCsvField(vehicleCache.car)].join(";"));
  lines.push([escapeCsvField("Baujahr"), escapeCsvField(formatBuildDate(vehicleCache.build_date))].join(";"));
  lines.push("");
  lines.push(
    [
      escapeCsvField("Nr"),
      escapeCsvField("Datum"),
      escapeCsvField("Kilometerstand"),
      escapeCsvField("Kommentar"),
      escapeCsvField("Belege"),
    ].join(";"),
  );

  repairsCache.forEach((repair, index) => {
    const comment = getCommentItems(repair.comment).join(" | ");
    const attachments = normalizeAttachments(repair.attachments)
      .map((f) => `${f.name}: ${f.url}`)
      .join(" | ");

    lines.push(
      [
        escapeCsvField(index + 1),
        escapeCsvField(formatDate(repair.date)),
        escapeCsvField(`${Number(repair.mileage).toLocaleString("de-DE")} km`),
        escapeCsvField(comment),
        escapeCsvField(attachments),
      ].join(";"),
    );
  });

  const csvContent = `\uFEFF${lines.join("\r\n")}`;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filenameDate = new Date().toISOString().split("T")[0];
  link.href = url;
  link.download = `auto-reparaturen-${filenameDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const clearRepairForm = () => {
  repairForm.reset();
  dateInput.valueAsDate = new Date();
  receiptsInput.value = "";
  clearDraft();
  setReceiptsInfo();
};

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseAuth) {
    authStatus.textContent = "Bitte zuerst Firebase verbinden.";
    return;
  }

  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) {
    authStatus.textContent = "Bitte E-Mail und Passwort eingeben.";
    return;
  }

  try {
    await firebaseAuth.signInWithEmailAndPassword(email, password);
    authPasswordInput.value = "";
  } catch (error) {
    console.error(error);
    authStatus.textContent = "Anmeldung fehlgeschlagen. Bitte Daten pruefen.";
  }
});

forgotPasswordButton.addEventListener("click", async () => {
  if (!firebaseAuth) {
    authStatus.textContent = "Bitte zuerst Firebase verbinden.";
    return;
  }

  const email = authEmailInput.value.trim();
  if (!email) {
    authStatus.textContent = "Bitte zuerst deine E-Mail eintragen.";
    return;
  }

  try {
    await firebaseAuth.sendPasswordResetEmail(email);
    authStatus.textContent = "E-Mail zum Zuruecksetzen wurde gesendet.";
  } catch (error) {
    console.error(error);
    authStatus.textContent = "Passwort-Reset konnte nicht gesendet werden.";
  }
});

logoutButton.addEventListener("click", async () => {
  if (!firebaseAuth) return;
  try {
    await firebaseAuth.signOut();
  } catch (error) {
    console.error(error);
    authStatus.textContent = "Abmeldung fehlgeschlagen.";
  }
});

cloudForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  cloudStatus.textContent = "";

  const config = {
    apiKey: firebaseApiKeyInput.value.trim(),
    authDomain: firebaseAuthDomainInput.value.trim(),
    projectId: firebaseProjectIdInput.value.trim(),
    appId: firebaseAppIdInput.value.trim(),
    storageBucket: `${firebaseProjectIdInput.value.trim()}.firebasestorage.app`,
  };

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    cloudStatus.textContent = "Bitte alle Firebase-Felder ausfuellen.";
    return;
  }

  try {
    await connectCloud(config);
    saveCloudConfig(config);
  } catch (error) {
    console.error(error);
    isCloudConnected = false;
    refreshAccess();
    cloudStatus.textContent = "Verbindung fehlgeschlagen. Bitte Firebase-Daten pruefen.";
  }
});

vehicleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const root = getUserBaseCollection();
  if (!root) {
    vehicleStatus.textContent = "Bitte anmelden.";
    return;
  }

  const car = carInput.value.trim();
  const buildDate = buildDateInput.value;

  if (!car) {
    vehicleStatus.textContent = "Bitte ein Auto angeben.";
    return;
  }

  if (!/^\d{4}-\d{2}$/.test(buildDate)) {
    vehicleStatus.textContent = "Bitte Baujahr und Monat auswaehlen.";
    return;
  }

  try {
    await root.collection("app_meta").doc("vehicle_profile").set({
      car,
      build_date: buildDate,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await loadVehicle();
    vehicleStatus.textContent = "Fahrzeugdaten gespeichert.";
  } catch (error) {
    console.error(error);
    vehicleStatus.textContent = "Fahrzeugdaten konnten nicht gespeichert werden.";
  }
});

repairForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorOutput.textContent = "";
  const root = getUserBaseCollection();
  if (!root) {
    errorOutput.textContent = "Bitte anmelden.";
    return;
  }

  if (!vehicleCache) {
    errorOutput.textContent = "Bitte zuerst Auto und Baujahr/Monat einmal speichern.";
    return;
  }

  const date = dateInput.value;
  const mileage = Number(mileageInput.value);
  const comment = commentInput.value.trim();
  const files = Array.from(receiptsInput.files || []);

  if (!editingId && files.length > MAX_ATTACHMENTS_PER_ENTRY) {
    errorOutput.textContent = `Bitte maximal ${MAX_ATTACHMENTS_PER_ENTRY} Dateien hochladen.`;
    return;
  }

  if (!date) {
    errorOutput.textContent = "Bitte ein Datum angeben.";
    return;
  }

  if (!Number.isFinite(mileage) || mileage < 0) {
    errorOutput.textContent = "Bitte einen gueltigen Kilometerstand eingeben.";
    return;
  }

  if (!comment) {
    errorOutput.textContent = "Bitte einen Kommentar eingeben.";
    return;
  }

  try {
    if (editingId) {
      if (editingAttachments.length + files.length > MAX_ATTACHMENTS_PER_ENTRY) {
        errorOutput.textContent = `Maximal ${MAX_ATTACHMENTS_PER_ENTRY} Dateien pro Eintrag erlaubt.`;
        return;
      }

      const newAttachments = await uploadReceiptFiles(files, editingId);
      await root.collection("repairs").doc(editingId).update({
        date,
        mileage,
        comment,
        attachments: [...editingAttachments, ...newAttachments],
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const docRef = root.collection("repairs").doc();
      const newAttachments = await uploadReceiptFiles(files, docRef.id);
      await docRef.set({
        date,
        mileage,
        comment,
        car: vehicleCache.car,
        build_date: vehicleCache.build_date,
        attachments: newAttachments,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    await loadRepairs();
    clearRepairForm();
    exitEditMode();
  } catch (error) {
    console.error(error);
    errorOutput.textContent = "Eintrag konnte nicht gespeichert werden.";
  }
});

repairsBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const root = getUserBaseCollection();
  if (!root) return;

  const id = target.dataset.id;
  const action = target.dataset.action;
  if (!id || !action) return;

  if (action === "edit") {
    const repair = repairsCache.find((entry) => entry.id === id);
    if (!repair) return;
    setEditMode(id);
    fillFormForEdit(repair);
    errorOutput.textContent = "";
    dateInput.focus();
    return;
  }

  if (action === "delete") {
    try {
      const repair = repairsCache.find((entry) => entry.id === id);
      await root.collection("repairs").doc(id).delete();
      if (repair) await deleteAttachmentFiles(repair.attachments);

      if (editingId === id) {
        clearRepairForm();
        exitEditMode();
      }

      await loadRepairs();
    } catch (error) {
      console.error(error);
      errorOutput.textContent = "Eintrag konnte nicht geloescht werden.";
    }
  }
});

cancelEditButton.addEventListener("click", () => {
  clearRepairForm();
  exitEditMode();
  errorOutput.textContent = "";
});

repairForm.addEventListener("input", saveDraft);
receiptsInput.addEventListener("change", setReceiptsInfo);
downloadPdfButton.addEventListener("click", exportRepairsToPdf);
downloadCsvButton.addEventListener("click", exportRepairsToCsv);

if (!dateInput.value) {
  dateInput.valueAsDate = new Date();
}
restoreDraft();
refreshAccess();
setReceiptsInfo();

const boot = async () => {
  const config = readCloudConfig() || DEFAULT_FIREBASE_CONFIG;
  firebaseApiKeyInput.value = config.apiKey;
  firebaseAuthDomainInput.value = config.authDomain;
  firebaseProjectIdInput.value = config.projectId;
  firebaseAppIdInput.value = config.appId;

  try {
    await connectCloud(config);
    saveCloudConfig(config);
  } catch (error) {
    console.error(error);
    isCloudConnected = false;
    refreshAccess();
    cloudStatus.textContent = "Automatische Firebase-Verbindung fehlgeschlagen. Bitte Firebase-Verbindung pruefen.";
  }
};

boot();
