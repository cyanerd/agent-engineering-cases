import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor/privacy-screen';

// A banking app hides its screen from screenshots and the app switcher from the first frame, not on demand.
if (Capacitor.isNativePlatform()) PrivacyScreen.enable({ android: { dimBackground: true }, ios: { blurEffect: 'dark' } }).catch(() => {});
createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
