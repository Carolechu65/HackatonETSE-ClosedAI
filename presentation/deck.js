(() => {
  const ICONS = {
    home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    'credit-card': '<rect x="2" y="5" width="20" height="14" rx="1"/><path d="M2 10h20"/>',
    'check-square': '<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="M8.5 11.5 12 15l9-10"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    sparkles: '<path fill="currentColor" stroke="none" d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path fill="currentColor" stroke="none" d="M18.3 15.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/>',
  };

  document.querySelectorAll('[data-icon]').forEach((node) => {
    const paths = ICONS[node.dataset.icon];
    if (!paths) return;
    node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  });

  const slides = [...document.querySelectorAll('.slide')];
  const dots = document.getElementById('dots');
  const current = document.getElementById('current');
  const total = document.getElementById('total');
  const title = document.getElementById('slide-title');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const hint = document.getElementById('hint');
  let index = 0;
  let hideHintTimer;

  total.textContent = String(slides.length).padStart(2, '0');

  const buttons = slides.map((slide, i) => {
    const button = document.createElement('button');
    button.className = 'dot';
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-label', slide.dataset.title || `Diapositiva ${i + 1}`);
    button.addEventListener('click', () => go(i));
    dots.append(button);
    return button;
  });

  function render() {
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    buttons.forEach((button, i) => {
      button.classList.toggle('is-active', i === index);
      button.setAttribute('aria-selected', String(i === index));
    });
    current.textContent = String(index + 1).padStart(2, '0');
    title.textContent = slides[index]?.dataset.title || '';
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    history.replaceState(null, '', `#${index + 1}`);
  }

  function go(target) {
    const clamped = Math.max(0, Math.min(slides.length - 1, target));
    if (clamped === index) return;
    index = clamped;
    render();
    slides[index]?.scrollTo?.({ top: 0 });
  }

  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        event.preventDefault();
        go(index + 1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        go(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        go(0);
        break;
      case 'End':
        event.preventDefault();
        go(slides.length - 1);
        break;
      case 'n':
      case 'N':
        document.body.classList.toggle('show-notes');
        break;
      case 'f':
      case 'F':
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.();
        break;
      default:
        break;
    }
  });

  // Deep link: /#3
  const fromHash = Number.parseInt(location.hash.replace('#', ''), 10);
  if (Number.isFinite(fromHash) && fromHash >= 1 && fromHash <= slides.length) {
    index = fromHash - 1;
  }
  render();

  // La pista desaparece al empezar a navegar.
  hideHintTimer = window.setTimeout(() => {
    if (hint) hint.style.opacity = '0';
  }, 6000);
  document.addEventListener('pointerdown', () => {
    window.clearTimeout(hideHintTimer);
    if (hint) hint.style.opacity = '0';
  }, { once: true });
})();
