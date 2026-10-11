'use client';

import { useState } from 'react';
import CopyButton from './CopyButton';

export interface ConnectClient {
  id: string;
  name: string;
  steps: string[];
  code?: string;
}

export default function ConnectTabs({ clients }: { clients: ConnectClient[] }) {
  const [tab, setTab] = useState(clients[0].id);
  const c = clients.find((x) => x.id === tab) ?? clients[0];
  return (
    <div className="tabs">
      <div className="tab-row" role="tablist">
        {clients.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === tab} className={`tab ${x.id === tab ? 'on' : ''}`} onClick={() => setTab(x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel">
        <ol className="steps">
          {c.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {c.code && (
          <div className="codebox">
            <pre>{c.code}</pre>
            <CopyButton text={c.code} />
          </div>
        )}
      </div>
    </div>
  );
}
