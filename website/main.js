const steps = document.querySelectorAll(".steps li");

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
    { threshold: 0.25 }
  );
  steps.forEach((step) => io.observe(step));
} else {
  steps.forEach((step) => step.classList.add("in"));
}
