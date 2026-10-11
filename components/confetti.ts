// A short burst of cube-coloured stickers from the middle of an element.
// Does nothing when the viewer prefers reduced motion.

const COLOURS = ['#f2545b', '#ff9f1c', '#ffd23f', '#2bb673', '#3d7bff', '#ffffff'];

export function confetti(from: HTMLElement | null, count = 70) {
  if (!from || typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height * 0.45;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  document.body.appendChild(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = COLOURS[i % COLOURS.length];
    layer.appendChild(p);
    const angle = Math.random() * Math.PI * 2;
    const speed = 140 + Math.random() * 260;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed * 0.7 - 180;
    const spin = (Math.random() - 0.5) * 900;
    p.animate(
      [
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.7}px, ${dy}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${dy + 520}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 700, easing: 'cubic-bezier(.25,.6,.45,1)', fill: 'forwards' },
    );
  }
  setTimeout(() => layer.remove(), 2200);
}
