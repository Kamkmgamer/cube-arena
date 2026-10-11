// A tiny cube face: one colour when solved, a jumble when not. The jumble is
// seeded by the attempt id, so the same attempt always looks the same.

const COLOURS = ['var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--green)', 'var(--blue)', '#ffffff'];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export default function MiniFace({ n, solved, seed }: { n: number; solved: boolean; seed: string }) {
  let h = hash(seed);
  const cells = Array.from({ length: n * n }, () => {
    if (solved) return 'var(--green)';
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    return COLOURS[(h >>> 16) % COLOURS.length];
  });
  return (
    <span className="face" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} aria-hidden>
      {cells.map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}
