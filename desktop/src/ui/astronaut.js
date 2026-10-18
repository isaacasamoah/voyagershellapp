function createAstronaut({
  frame,
  schedule = setTimeout,
  cancel = clearTimeout,
  random = Math.random,
  reducedMotion = false,
}) {
  const idle = 'idle.png';
  const reading = ['book-frames/reading-1.png', 'book-frames/reading-2.png'];
  const stretch = [
    ['stretch-frames/frame-1-uncrossing.png', 50, 120],
    ['stretch-frames/frame-2-stretched.png', 80, 120],
    ['stretch-frames/frame-3-peak-stretch.png', 1200, 200],
  ];
  const finish = [
    ['book-frames/book-away.png', 520, 180],
    ['stretch-frames/frame-1-uncrossing.png', 90, 120],
    ['stretch-frames/frame-2-stretched.png', 120, 120],
    ['stretch-frames/frame-3-peak-stretch.png', 950, 200],
  ];
  let busy = false;
  let scene = 'idle';
  let playing = false;
  let page = 0;
  let timer;

  function wait(ms, next) {
    timer = schedule(next, ms);
  }
  function play(steps, done) {
    playing = true;
    function next(index) {
      if (index === steps.length) {
        playing = false;
        done();
        return;
      }
      const [src, hold, fade] = steps[index];
      frame(src, fade);
      wait(hold + fade, () => next(index + 1));
    }
    next(0);
  }
  function settle(next) {
    page = 0;
    play([[next === 'reading' ? reading[0] : idle, 0, 500]], () => {
      scene = next;
      pump();
    });
  }
  function turnPage() {
    if (reducedMotion || playing || scene !== 'reading' || !busy) return;
    cancel(timer);
    page = 1 - page;
    play([[reading[page], 0, 240]], pump);
  }
  function pump() {
    if (playing) return;
    cancel(timer);
    const target = busy ? 'reading' : 'idle';
    if (reducedMotion) {
      scene = target;
      frame(busy ? reading[0] : idle, 0);
    } else if (scene !== target) {
      play(busy ? [['book-frames/book-out.png', 560, 260]] : finish, () => settle(target));
    } else if (busy) {
      wait(3600, turnPage);
    } else {
      wait(20000 + random() * 20000, () => play(stretch, () => settle('idle')));
    }
  }
  pump();
  return {
    setBusy(value) {
      if (busy === value) return;
      busy = value;
      pump();
    },
    toolBeat: turnPage,
    stop() {
      cancel(timer);
    },
  };
}

if (typeof module !== 'undefined') module.exports = { createAstronaut };
async function mountAstronaut() {
  const back = document.getElementById('astronaut-back');
  const front = document.getElementById('astronaut-front');
  const avatar = document.getElementById('avatar');
  let fadeTimer;
  const assets = [
    'idle.png',
    'book-frames/book-out.png',
    'book-frames/book-away.png',
    'book-frames/reading-1.png',
    'book-frames/reading-2.png',
    'stretch-frames/frame-1-uncrossing.png',
    'stretch-frames/frame-2-stretched.png',
    'stretch-frames/frame-3-peak-stretch.png',
  ];
  await Promise.all(
    assets.map((src) => {
      const image = new Image();
      image.src = `../../assets/${src}`;
      return image.decode();
    }),
  );
  window.voyagerAstronaut = createAstronaut({
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    frame(src, ms) {
      clearTimeout(fadeTimer);
      if (front.style.opacity === '1') back.src = front.src;
      front.style.transition = 'none';
      front.style.opacity = '0';
      front.src = `../../assets/${src}`;
      avatar.dataset.gesture = src;
      void front.offsetWidth;
      front.style.transition = `opacity ${ms}ms ease-in-out`;
      front.style.opacity = '1';
      fadeTimer = setTimeout(() => {
        back.src = front.src;
        front.style.opacity = '0';
      }, ms);
    },
  });
  window.addEventListener('pagehide', () => {
    window.voyagerAstronaut.stop();
    clearTimeout(fadeTimer);
  });
}

if (
  typeof window !== 'undefined' &&
  new URLSearchParams(location.search).get('view') === 'avatar'
) {
  mountAstronaut()
    .then(() => {
      window.voyagerAstronaut.setBusy(Boolean(window.voyagerConversation?.status().busy));
    })
    .catch((error) => console.error('Astronaut artwork could not load:', error));
}
