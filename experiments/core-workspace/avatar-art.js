(() => {
  const handle = $("avatar");
  let fadeTimer;
  async function animate() {
    const base = "../../desktop/assets/";
    const frames = [
      "idle.png",
      "book-frames/book-out.png",
      "book-frames/book-away.png",
      "book-frames/reading-1.png",
      "book-frames/reading-2.png",
      "stretch-frames/frame-1-uncrossing.png",
      "stretch-frames/frame-2-stretched.png",
      "stretch-frames/frame-3-peak-stretch.png",
    ];
    await Promise.all(
      frames.map(async (src) => {
        const image = new Image();
        image.src = base + src;
        await image.decode();
      }),
    );
    const front = $("astronaut-front");
    const back = $("astronaut-back");
    handle.dataset.gesture = "idle.png";
    const controller = createAstronaut({
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      frame(src, ms) {
        clearTimeout(fadeTimer);
        if (front.style.opacity === "1") back.src = front.src;
        front.style.transition = "none";
        front.style.opacity = "0";
        front.src = base + src;
        handle.dataset.gesture = src;
        void front.offsetWidth;
        front.style.transition = `opacity ${ms}ms cubic-bezier(.45, 0, .25, 1)`;
        front.style.opacity = "1";
        fadeTimer = setTimeout(() => {
          back.src = front.src;
          front.style.opacity = "0";
        }, ms);
      },
    });
    api.on("conversation", (event) => {
      if (event.type === "status")
        controller.setBusy(event.text === "Thinking…");
      if (event.type === "tool") controller.toolBeat();
      if (["complete", "error", "ready"].includes(event.type))
        controller.setBusy(false);
    });
    window.addEventListener("pagehide", () => {
      controller.stop();
      clearTimeout(fadeTimer);
    });
  }

  animate().catch((error) =>
    notify(`Voyager artwork could not load: ${error.message}`),
  );
})();
