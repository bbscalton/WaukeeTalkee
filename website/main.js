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
