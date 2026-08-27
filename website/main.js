const steps = document.querySelectorAll(".steps li");
const worldCards = document.querySelectorAll(".world-card");

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  steps.forEach((step) => io.observe(step));
  worldCards.forEach((card) => io.observe(card));
} else {
  steps.forEach((step) => step.classList.add("in"));
  worldCards.forEach((card) => card.classList.add("in"));
}

// Lightbox functionality
(function () {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;

  const lightboxImg = lightbox.querySelector(".lightbox-img");
  const lightboxCaption = lightbox.querySelector(".lightbox-caption");
  const lightboxClose = lightbox.querySelector(".lightbox-close");
  const zoomables = document.querySelectorAll(".zoomable");

  function openLightbox(img) {
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightboxCaption.textContent = img.dataset.caption || img.alt || "";
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  zoomables.forEach(function (img) {
    img.addEventListener("click", function (e) {
      e.preventDefault();
      openLightbox(img);
    });
  });

  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox || e.target === lightboxClose) {
      closeLightbox();
    }
  });

  lightboxClose.addEventListener("click", closeLightbox);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && lightbox.classList.contains("open")) {
      closeLightbox();
    }
  });
})();
