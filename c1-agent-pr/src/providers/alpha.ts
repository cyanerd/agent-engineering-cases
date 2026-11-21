import { HttpSmsProvider } from './http.ts';

export const alphaSms = (token: string, baseUrl = 'https://api.alpha-sms.test/v1') => new HttpSmsProvider('alpha-sms', baseUrl, token);
