const loginScreen = document.querySelector("#loginScreen");
const homeScreen = document.querySelector("#homeScreen");
const loginForm = document.querySelector("#loginForm");
const bookingForm = document.querySelector("#bookingForm");
const bookingResponse = document.querySelector("#bookingResponse");
const checkInInput = document.querySelector("#checkIn");
const checkOutInput = document.querySelector("#checkOut");
const menuToggle = document.querySelector("#menuToggle");
const mainNav = document.querySelector(".main-nav");
const isGuestPage = Boolean(loginScreen && homeScreen && loginForm && bookingForm && bookingResponse && checkInInput && checkOutInput && menuToggle && mainNav);

function formatLocalDate(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

if (isGuestPage) {
  checkInInput.min = formatLocalDate(new Date());
  checkOutInput.min = checkInInput.min;

  checkInInput.addEventListener("change", () => {
    checkOutInput.min = checkInInput.value || checkInInput.min;
    if (checkOutInput.value && checkOutInput.value <= checkInInput.value) {
      checkOutInput.value = "";
    }
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;

    loginScreen.classList.add("hidden");
    homeScreen.classList.remove("hidden");
    window.scrollTo(0, 0);
  });

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!bookingForm.reportValidity()) return;

    const checkIn = new Date(`${checkInInput.value}T00:00:00`);
    const checkOut = new Date(`${checkOutInput.value}T00:00:00`);
    if (checkOut <= checkIn) {
      bookingResponse.textContent = "Please choose a check-out date after your check-in.";
      bookingResponse.classList.add("is-visible");
      return;
    }

    const submitButton = bookingForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    bookingResponse.textContent = "Sending your booking request…";
    bookingResponse.classList.add("is-visible");
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: document.querySelector("#bookingName").value.trim(),
          guestEmail: document.querySelector("#bookingEmail").value.trim(),
          guestPhone: document.querySelector("#bookingPhone").value.trim(),
          checkIn: checkInInput.value,
          checkOut: checkOutInput.value,
          roomName: document.querySelector("#tentType").value,
          guests: Number.parseInt(document.querySelector("#guestCount").value, 10)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your request could not be sent.");

      const dateOptions = { day: "numeric", month: "short" };
      const arrival = checkIn.toLocaleDateString("en-IN", dateOptions);
      const departure = checkOut.toLocaleDateString("en-IN", dateOptions);
      bookingResponse.textContent = `Request received · ${arrival}–${departure}. ${result.message}`;
      bookingForm.reset();
      checkInInput.min = formatLocalDate(new Date());
      checkOutInput.min = checkInInput.min;
    } catch (error) {
      bookingResponse.textContent = error instanceof Error ? error.message : "Your request could not be sent. Please try again.";
    } finally {
      submitButton.disabled = false;
    }
  });

  menuToggle.addEventListener("click", () => {
    const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isExpanded));
    menuToggle.setAttribute("aria-label", isExpanded ? "Open navigation" : "Close navigation");
    mainNav.classList.toggle("open", !isExpanded);
  });

  mainNav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      mainNav.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open navigation");
    }
  });
}
