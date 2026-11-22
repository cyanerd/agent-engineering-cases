import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { PrivacyScreen } from '@capacitor/privacy-screen';

/** Checks of the native capabilities a banking app cannot ship without. Each returns a line for the screen. */
export async function checkBiometry(): Promise<string> {
  const info = await BiometricAuth.checkBiometry();
  if (!info.isAvailable) return `биометрия недоступна: ${info.reason || 'нет'} (тип ${info.biometryType})`;
  try {
    await BiometricAuth.authenticate({ reason: 'Вход в банк', cancelTitle: 'Отмена', allowDeviceCredential: false });
    return `биометрия: вход подтверждён (тип ${info.biometryType})`;
  } catch (e) {
    return `биометрия: отказ - ${(e as Error).message}`;
  }
}

export async function checkSecureStorage(): Promise<string> {
  const token = `demo-${Date.now()}`;
  await SecureStorage.set('selftest-probe', token);
  const back = await SecureStorage.get('selftest-probe');
  const inLocal = Object.keys(localStorage).some((k) => localStorage.getItem(k)?.includes(token));
  return `хранилище: записано и прочитано ${back === token ? 'верно' : 'НЕВЕРНО'}; в localStorage ${inLocal ? 'ЕСТЬ' : 'нет'}`;
}

export async function enablePrivacyScreen(): Promise<string> {
  const r = await PrivacyScreen.enable({ android: { dimBackground: true }, ios: { blurEffect: 'dark' } });
  const s = await PrivacyScreen.isEnabled();
  return `защита экрана: ${s.enabled ? 'включена' : 'НЕ включена'} (${JSON.stringify(r)})`;
}
