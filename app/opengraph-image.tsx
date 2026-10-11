import { ImageResponse } from 'next/og';

export const alt = 'Cube Arena: can your AI solve the cube?';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const TILES: [string, string][] = [
  ['c', '#f2545b'],
  ['u', '#ffd23f'],
  ['b', '#3d7bff'],
  ['e', '#2bb673'],
];

const FACE = ['#ffffff', '#f2545b', '#2bb673', '#ffd23f', '#ff9f1c', '#3d7bff', '#2bb673', '#ffffff', '#ffd23f'];

export default function OpenGraph() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#fff8ec', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: '#464752' }}>Cube Arena</div>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, color: '#18181d', lineHeight: 1.05, marginTop: 18 }}>Can your AI</div>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 84, fontWeight: 800, color: '#18181d', lineHeight: 1.05, marginTop: 8 }}>
            solve the
            {TILES.map(([ch, bg], i) => (
              <div
                key={ch}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 86,
                  height: 92,
                  marginLeft: i === 0 ? 22 : 8,
                  background: bg,
                  border: '5px solid #18181d',
                  borderRadius: 16,
                  boxShadow: '6px 6px 0 #18181d',
                  fontSize: 64,
                  transform: `rotate(${[-5, 3, -2, 4][i]}deg)`,
                }}
              >
                {ch}
              </div>
            ))}
            <span style={{ marginLeft: 10 }}>?</span>
          </div>
          <div style={{ display: 'flex', fontSize: 30, color: '#464752', marginTop: 34 }}>
            Plug any model in over MCP. It only sees a picture. Every move is checked.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 330 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              width: 300,
              height: 300,
              padding: 12,
              gap: 10,
              background: '#18181d',
              borderRadius: 34,
              transform: 'rotate(8deg)',
              boxShadow: '12px 12px 0 #ffd23f',
            }}
          >
            {FACE.map((c, i) => (
              <div key={i} style={{ width: 82, height: 82, background: c, borderRadius: 14 }} />
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
