const contentSettings = window.MistyAlphineContent;
const loginPanel = document.querySelector("#adminLogin");
const dashboard = document.querySelector("#adminDashboard");
const loginForm = document.querySelector("#loginForm");
const adminForm = document.querySelector("#adminForm");
const editorFields = document.querySelector("#editorFields");
const imageFields = document.querySelector("#imageFields");
const bookingList = document.querySelector("#bookingList");
const logoutButton = document.querySelector("#logoutButton");
const resetButton = document.querySelector("#resetButton");
let csrfToken = "";
let editorInputs = new Map();
let currentContent;

function showStatus(id, message, isError = false) {
  const status = document.querySelector(`#${id}`);
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  status.classList.toggle("is-visible", Boolean(message));
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET" && url !== "/api/admin/login") {
    if (!csrfToken) throw new Error("Your admin session has expired. Please sign in again.");
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      showLogin();
      throw new Error("Your admin session has expired. Please sign in again.");
    }
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function showLogin() {
  csrfToken = "";
  loginPanel.classList.remove("hidden");
  dashboard.classList.add("hidden");
  logoutButton.classList.add("hidden");
}

function showDashboard() {
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
}

function renderEditor(content) {
  editorFields.replaceChildren();
  editorInputs = new Map();
  let currentSection = "";
  let sectionFields;

  for (const field of contentSettings.fields) {
    if (field.section !== currentSection) {
      currentSection = field.section;
      const section = document.createElement("section");
      section.className = "editor-section";
      const heading = document.createElement("h3");
      heading.textContent = currentSection;
      sectionFields = document.createElement("div");
      sectionFields.className = "editor-grid";
      section.append(heading, sectionFields);
      editorFields.append(section);
    }

    const label = document.createElement("label");
    label.className = field.multiline ? "editor-field editor-field-wide" : "editor-field";
    const title = document.createElement("span");
    title.textContent = field.label;
    const input = field.multiline ? document.createElement("textarea") : document.createElement("input");
    input.id = `setting-${field.key}`;
    input.name = field.key;
    input.required = true;
    if (field.type === "number") {
      input.type = "number";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = "1";
    } else {
      input.maxLength = 1800;
    }
    label.htmlFor = input.id;
    label.append(title, input);
    sectionFields.append(label);
    editorInputs.set(field.key, input);
  }

  updateEditor(content);
}

function updateEditor(content) {
  for (const field of contentSettings.fields) {
    editorInputs.get(field.key).value = String(content[field.key]);
  }
}

function buildImageEditor(content) {
  imageFields.replaceChildren();
  for (const field of contentSettings.imageFields) {
    const card = document.createElement("div");
    card.className = "image-card";
    const heading = document.createElement("strong");
    heading.textContent = field.label;
    const preview = document.createElement("div");
    preview.className = "image-preview";
    preview.setAttribute("aria-label", `${field.label} preview`);
    if (content[field.key]) {
      preview.style.backgroundImage = `url("/api/images/${content[field.key]}")`;
    }
    const label = document.createElement("label");
    label.className = "image-upload-label";
    label.textContent = "Choose image";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.setAttribute("aria-label", `Upload ${field.label} image`);
    input.addEventListener("change", () => uploadImage(field, input, preview));
    label.append(input);
    card.append(heading, preview, label);
    imageFields.append(card);
  }
}

function readEditor() {
  const content = {};
  for (const field of contentSettings.fields) {
    const input = editorInputs.get(field.key);
    const value = field.type === "number" ? input.valueAsNumber : input.value.trim();
    if (field.type === "number") {
      if (!Number.isSafeInteger(value) || value < field.min || value > field.max) {
        input.focus();
        throw new Error(`${field.label} must be between ${field.min} and ${field.max}.`);
      }
    } else if (value.length === 0 || value.length > 1800) {
      input.focus();
      throw new Error(`${field.label} must contain between 1 and 1,800 characters.`);
    }
    content[field.key] = value;
  }
  for (const field of contentSettings.imageFields) content[field.key] = currentContent[field.key] || "";
  return content;
}

async function uploadImage(field, input, preview) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    showStatus("editorStatus", "Images must be 4 MB or smaller.", true);
    input.value = "";
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    showStatus("editorStatus", "Choose a JPG, PNG, or WebP image.", true);
    input.value = "";
    return;
  }

  try {
    showStatus("editorStatus", `Uploading ${field.label.toLowerCase()} image…`);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Could not read the selected image."));
          return;
        }
        resolve(reader.result);
      });
      reader.addEventListener("error", () => reject(new Error("Could not read the selected image.")));
      reader.readAsDataURL(file);
    });
    const result = await api("/api/admin/images", {
      method: "POST",
      body: JSON.stringify({ key: field.key, dataUrl })
    });
    currentContent[field.key] = result.id;
    preview.style.backgroundImage = `url("${result.url}")`;
    showStatus("editorStatus", `${field.label} image uploaded and published.`);
  } catch (error) {
    showStatus("editorStatus", error.message, true);
  } finally {
    input.value = "";
  }
}

function renderBookings(bookings) {
  bookingList.replaceChildren();
  if (bookings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "booking-empty";
    empty.textContent = "No booking requests yet. New requests will appear here.";
    bookingList.append(empty);
    return;
  }

  for (const booking of bookings) {
    const card = document.createElement("article");
    card.className = "booking-admin-card";
    const details = document.createElement("div");
    details.className = "booking-admin-details";
    const guest = document.createElement("h3");
    guest.textContent = booking.guestName;
    const email = document.createElement("a");
    email.href = `mailto:${booking.guestEmail}`;
    email.textContent = booking.guestEmail;
    const phone = document.createElement("p");
    phone.textContent = booking.guestPhone || "No phone number provided";
    const stay = document.createElement("p");
    stay.textContent = `${booking.roomName} · ${booking.guests} ${booking.guests === 1 ? "guest" : "guests"}`;
    const dates = document.createElement("p");
    dates.textContent = `${booking.checkIn} → ${booking.checkOut} · ₹${new Intl.NumberFormat("en-IN").format(booking.pricePerNight)}/night`;
    const submitted = document.createElement("small");
    submitted.textContent = `Received ${new Date(booking.createdAt).toLocaleString()}`;
    details.append(guest, email, phone, stay, dates, submitted);

    const controls = document.createElement("div");
    controls.className = "booking-admin-controls";
    const statusLabel = document.createElement("label");
    statusLabel.className = "editor-field";
    statusLabel.textContent = "REQUEST STATUS";
    const status = document.createElement("select");
    status.className = "booking-status";
    status.setAttribute("aria-label", `Status for ${booking.guestName} booking`);
    for (const optionValue of ["pending", "confirmed", "cancelled"]) {
      const option = new Option(optionValue[0].toUpperCase() + optionValue.slice(1), optionValue);
      status.add(option);
    }
    status.value = booking.status;
    statusLabel.append(status);
    const updateButton = document.createElement("button");
    updateButton.className = "button button-outline";
    updateButton.type = "button";
    updateButton.textContent = "Update";
    updateButton.addEventListener("click", async () => {
      updateButton.disabled = true;
      try {
        await api(`/api/admin/bookings/${booking.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: status.value })
        });
        showStatus("dashboardStatus", "Booking request status updated.");
      } catch (error) {
        showStatus("dashboardStatus", error.message, true);
      } finally {
        updateButton.disabled = false;
      }
    });
    controls.append(statusLabel, updateButton);
    card.append(details, controls);
    bookingList.append(card);
  }
}

async function loadDashboard() {
  showDashboard();
  try {
    const [content, bookingsResult] = await Promise.all([
      api("/api/content"),
      api("/api/admin/bookings")
    ]);
    currentContent = content;
    renderEditor(content);
    buildImageEditor(content);
    renderBookings(bookingsResult.bookings);
  } catch (error) {
    showStatus("dashboardStatus", error.message, true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const formData = new FormData(loginForm);
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showStatus("adminStatus", "Signing in…");
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password")
      })
    });
    csrfToken = result.csrfToken;
    loginForm.reset();
    showStatus("adminStatus", "");
    await loadDashboard();
  } catch (error) {
    showStatus("adminStatus", error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!adminForm.reportValidity() || !currentContent) return;
  const submitButton = adminForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await api("/api/admin/content", {
      method: "PUT",
      body: JSON.stringify(readEditor())
    });
    currentContent = result.content;
    contentSettings.apply(currentContent);
    buildImageEditor(currentContent);
    showStatus("editorStatus", "Changes saved to the website and visible to all visitors.");
  } catch (error) {
    showStatus("editorStatus", error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

resetButton.addEventListener("click", async () => {
  resetButton.disabled = true;
  try {
    const result = await api("/api/admin/content", { method: "DELETE" });
    currentContent = result.content;
    updateEditor(currentContent);
    buildImageEditor(currentContent);
    contentSettings.apply(currentContent);
    showStatus("editorStatus", "Default website text restored.");
  } catch (error) {
    showStatus("editorStatus", error.message, true);
  } finally {
    resetButton.disabled = false;
  }
});

document.querySelector("#refreshBookings").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api("/api/admin/bookings");
    renderBookings(result.bookings);
    showStatus("dashboardStatus", "Booking requests refreshed.");
  } catch (error) {
    showStatus("dashboardStatus", error.message, true);
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await api("/api/admin/logout", { method: "POST" });
    showLogin();
  } catch (error) {
    showStatus("dashboardStatus", error.message, true);
  } finally {
    logoutButton.disabled = false;
  }
});

async function restoreAdminSession() {
  try {
    const result = await api("/api/admin/session");
    if (!result.authenticated) {
      showLogin();
      return;
    }
    csrfToken = result.csrfToken;
    await loadDashboard();
  } catch (error) {
    if (!error.message.includes("sign in")) {
      showStatus("adminStatus", error.message, true);
    }
  }
}

restoreAdminSession();
