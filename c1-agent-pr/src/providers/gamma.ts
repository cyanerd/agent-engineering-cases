import { HttpSmsProvider } from './http.ts';

export const gammaSms = (token: string, baseUrl = 'https://api.gamma-sms.test/v2') => new HttpSmsProvider('gamma-sms', baseUrl, token);
