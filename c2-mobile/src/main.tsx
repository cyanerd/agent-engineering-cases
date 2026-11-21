import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
