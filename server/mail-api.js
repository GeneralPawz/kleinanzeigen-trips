import { Router } from 'express';
import { mailStatus, checkMail, mailNotifications, markSeen } from './mail.js';

export const mailApi = Router();

mailApi.get('/mail/status', (_q, res) => res.json(mailStatus()));
mailApi.post('/mail/check', async (_q, res) => res.json(await checkMail()));
mailApi.get('/mail/notifications', (_q, res) => res.json(mailNotifications()));
mailApi.post('/mail/seen/:adid', (q, res) => {
  if (!/^[\w-]{1,40}$/.test(q.params.adid)) return res.status(400).json({ error: 'ungültige adid' });
  markSeen(q.params.adid);
  res.json({ ok: true });
});
