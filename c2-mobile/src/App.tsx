import { useState } from 'react';
import { answer } from './assistant.ts';
import { BALANCE, OPERATIONS } from './data.ts';
import { formatMoney } from './money.ts';

type Tab = 'account' | 'assistant';

function Account() {
  return (
    <section>
      <div className="balance-card">
        <div className="muted">Основной счёт</div>
        <div className="balance">{formatMoney(BALANCE)}</div>
      </div>
      <h2>Операции</h2>
      <ul className="ops">
        {OPERATIONS.map((o) => (
          <li key={o.id}>
            <div>
              <div>{o.title}</div>
              <div className="muted">{o.date} · {o.category}</div>
            </div>
            <div className={o.amount < 0 ? 'out' : 'in'}>{formatMoney(o.amount)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Assistant() {
  const [log, setLog] = useState<{ who: 'me' | 'bot'; text: string }[]>([{ who: 'bot', text: 'Здравствуйте! Я помогу разобраться в расходах.' }]);
  const [q, setQ] = useState('Сколько я потратил за неделю?');
  const ask = () => {
    if (!q.trim()) return;
    setLog((l) => [...l, { who: 'me', text: q }, { who: 'bot', text: answer(q) }]);
    setQ('');
  };
  return (
    <section className="chat">
      <div className="messages">
        {log.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>{m.text}</div>
        ))}
      </div>
      <div className="ask">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} placeholder="Вопрос о расходах" />
        <button onClick={ask}>Спросить</button>
      </div>
    </section>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>('account');
  return (
    <div className="app">
      <header>Банк</header>
      <main>{tab === 'account' ? <Account /> : <Assistant />}</main>
      <nav>
        <button className={tab === 'account' ? 'on' : ''} onClick={() => setTab('account')}>Счёт</button>
        <button className={tab === 'assistant' ? 'on' : ''} onClick={() => setTab('assistant')}>Помощник</button>
      </nav>
    </div>
  );
}
