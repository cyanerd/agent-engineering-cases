import { HttpSmsProvider } from './http.ts';

export const betaSms = (token: string, baseUrl = 'https://gw.beta-sms.test/api') => new HttpSmsProvider('beta-sms', baseUrl, token);
