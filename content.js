(function () {
  const fields = [
    { key: "heroEyebrow", label: "Hero eyebrow", section: "Home page" },
    { key: "heroLineOne", label: "Hero heading — line one", section: "Home page" },
    { key: "heroLineTwo", label: "Hero heading — line two", section: "Home page" },
    { key: "heroHighlight", label: "Hero heading — highlighted line", section: "Home page" },
    { key: "heroDescription", label: "Hero introduction", section: "Home page", multiline: true },
    { key: "heroLocation", label: "Hero location label", section: "Home page" },
    { key: "introLineOne", label: "Stay introduction — line one", section: "Stay details" },
    { key: "introLineTwo", label: "Stay introduction — line two", section: "Stay details" },
    { key: "introHighlight", label: "Stay introduction — highlight", section: "Stay details" },
    { key: "introDescription", label: "Stay introduction description", section: "Stay details", multiline: true },
    { key: "tentCount", label: "Number of private tents", section: "Stay details", type: "number", min: 1, max: 999 },
    { key: "elevation", label: "Elevation in metres", section: "Stay details", type: "number", min: 0, max: 99999 },
    { key: "starStat", label: "Star-count caption", section: "Stay details" },
    { key: "stayEyebrow", label: "Stays eyebrow", section: "Stay details" },
    { key: "stayHeading", label: "Stays heading", section: "Stay details" },
    { key: "stayHighlight", label: "Stays highlighted heading", section: "Stay details" },
    { key: "staySubheading", label: "Stays introduction", section: "Stay details" },
    { key: "stayDescription", label: "Stays supporting line", section: "Stay details" },
    { key: "room1Name", label: "Alpine Dome — name", section: "Tent options" },
    { key: "room1Description", label: "Alpine Dome — description", section: "Tent options", multiline: true },
    { key: "room1Price", label: "Alpine Dome — price per night (₹)", section: "Tent options", type: "number", min: 0, max: 999999 },
    { key: "room2Name", label: "Pine Tent — name", section: "Tent options" },
    { key: "room2Description", label: "Pine Tent — description", section: "Tent options", multiline: true },
    { key: "room2Price", label: "Pine Tent — price per night (₹)", section: "Tent options", type: "number", min: 0, max: 999999 },
    { key: "room3Name", label: "Summit Suite — name", section: "Tent options" },
    { key: "room3Description", label: "Summit Suite — description", section: "Tent options", multiline: true },
    { key: "room3Price", label: "Summit Suite — price per night (₹)", section: "Tent options", type: "number", min: 0, max: 999999 },
    { key: "stayNote", label: "What’s included", section: "Tent options", multiline: true },
    { key: "experienceEyebrow", label: "Experiences eyebrow", section: "Experiences" },
    { key: "experienceLineOne", label: "Experiences heading — line one", section: "Experiences" },
    { key: "experienceHighlight", label: "Experiences heading — highlight", section: "Experiences" },
    { key: "experienceDescription", label: "Experiences introduction", section: "Experiences", multiline: true },
    { key: "experience1Title", label: "Experience 1 — title", section: "Experiences" },
    { key: "experience1Description", label: "Experience 1 — description", section: "Experiences", multiline: true },
    { key: "experience2Title", label: "Experience 2 — title", section: "Experiences" },
    { key: "experience2Description", label: "Experience 2 — description", section: "Experiences", multiline: true },
    { key: "experience3Title", label: "Experience 3 — title", section: "Experiences" },
    { key: "experience3Description", label: "Experience 3 — description", section: "Experiences", multiline: true },
    { key: "experience4Title", label: "Experience 4 — title", section: "Experiences" },
    { key: "experience4Description", label: "Experience 4 — description", section: "Experiences", multiline: true },
    { key: "bookingEyebrow", label: "Booking eyebrow", section: "Booking" },
    { key: "bookingLineOne", label: "Booking heading — line one", section: "Booking" },
    { key: "bookingLineTwo", label: "Booking heading — line two", section: "Booking" },
    { key: "bookingHighlight", label: "Booking heading — highlight", section: "Booking" },
    { key: "bookingPrompt", label: "Booking introduction", section: "Booking" },
    { key: "bookingAssurance", label: "Booking reassurance", section: "Booking" },
    { key: "bookingFormEyebrow", label: "Booking form eyebrow", section: "Booking" },
    { key: "bookingFormTitle", label: "Booking form title", section: "Booking" },
    { key: "bookingCaption", label: "Booking note", section: "Booking", multiline: true },
    { key: "locationEyebrow", label: "Location eyebrow", section: "Location" },
    { key: "locationLineOne", label: "Location heading — line one", section: "Location" },
    { key: "locationLineTwo", label: "Location heading — line two", section: "Location" },
    { key: "locationHighlight", label: "Location heading — highlight", section: "Location" },
    { key: "locationDescription", label: "Location description", section: "Location", multiline: true },
    { key: "locationFactOne", label: "Location fact 1", section: "Location" },
    { key: "locationFactTwo", label: "Location fact 2", section: "Location" },
    { key: "quote", label: "Guest quote", section: "Closing note", multiline: true },
    { key: "footerTagline", label: "Footer tagline", section: "Closing note" }
  ];
  const imageFields = [
    { key: "heroImage", label: "Mountain hero" },
    { key: "room1Image", label: "Alpine Dome tent" },
    { key: "room2Image", label: "Pine Tent stay" },
    { key: "room3Image", label: "Summit Suite" },
    { key: "experienceImage", label: "Forest experiences" },
    { key: "locationImage", label: "Kuttikanam landscape" }
  ];

  function apply(content) {
    for (const field of fields) {
      const value = content[field.key];
      if (field.type === "number" && field.key.endsWith("Price")) {
        const price = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
        document.querySelectorAll(`[data-price="${field.key}"]`).forEach((element) => {
          element.textContent = `₹${price}`;
        });
      } else {
        document.querySelectorAll(`[data-content="${field.key}"]`).forEach((element) => {
          element.textContent = String(value);
        });
      }
    }

    for (const field of imageFields) {
      const imageId = content[field.key];
      if (typeof imageId !== "string" || !/^[a-f0-9-]{36}$/.test(imageId)) continue;
      const selectors = {
        heroImage: ".hero-photo",
        room1Image: ".image-dome",
        room2Image: ".image-pine",
        room3Image: ".image-summit",
        experienceImage: ".experience-photo",
        locationImage: ".location-photo"
      };
      document.querySelectorAll(selectors[field.key]).forEach((element) => {
        element.style.backgroundImage = `linear-gradient(rgba(5, 10, 13, .32), rgba(5, 10, 13, .32)), url("/api/images/${imageId}")`;
      });
    }

    const tentSelect = document.querySelector("#tentType");
    if (tentSelect) {
      const previousSelection = tentSelect.value;
      tentSelect.replaceChildren();
      for (let index = 1; index <= 3; index += 1) {
        const priceKey = `room${index}Price`;
        const name = content[`room${index}Name`];
        const price = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(content[priceKey]);
        tentSelect.add(new Option(`${name} · ₹${price}/night`, name));
      }
      if ([...tentSelect.options].some((option) => option.value === previousSelection)) {
        tentSelect.value = previousSelection;
      }
    }
  }

  async function load() {
    const response = await fetch("/api/content");
    if (!response.ok) throw new Error("Could not load website details.");
    const content = await response.json();
    apply(content);
    return content;
  }

  window.MistyAlphineContent = { fields, imageFields, apply, load };

  if (document.querySelector("[data-content]")) {
    load().catch((error) => console.error("Could not load saved Misty Alphine site content.", error));
  }
}());
