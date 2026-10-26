import { Router } from 'express';
import { getStore } from './store.js';

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
const checkAdid = (id) => {
  if (!/^[\w-]{1,40}$/.test(id)) throw Object.assign(new Error('ungültige adid'), { status: 400 });
};
const ok = (res) => res.json({ ok: true });

export const userApi = Router();
const s = () => getStore();

userApi.get('/routes', wrap((_q, res) => res.json(s().listRoutes())));
userApi.get('/routes/:id', wrap((q, res) => res.json(s().getRoute(q.params.id))));
userApi.post('/routes', wrap((q, res) => res.status(201).json(s().createRoute(q.body))));
userApi.put('/routes/:id', wrap((q, res) => res.json(s().updateRoute(q.params.id, q.body))));
userApi.delete('/routes/:id', wrap((q, res) => (s().deleteRoute(q.params.id), ok(res))));

userApi.get('/merkliste', wrap((_q, res) => res.json(s().listMerkliste())));
userApi.put('/merkliste/:adid', wrap((q, res) => (checkAdid(q.params.adid), res.json(s().putMerkliste(q.params.adid, q.body)))));
userApi.delete('/merkliste/:adid', wrap((q, res) => (s().deleteMerkliste(q.params.adid), ok(res))));

userApi.get('/contacts', wrap((_q, res) => res.json(s().listContacts())));
userApi.put('/contacts/:adid', wrap((q, res) => (checkAdid(q.params.adid), res.json(s().putContactStatus(q.params.adid, q.body)))));
userApi.post('/contacts/:adid/notes', wrap((q, res) => (checkAdid(q.params.adid), res.status(201).json(s().addNote(q.params.adid, q.body)))));
userApi.delete('/contacts/:adid/notes/:noteId', wrap((q, res) => (s().deleteNote(q.params.adid, q.params.noteId), ok(res))));
