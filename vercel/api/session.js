const { authorize } = require('../lib/api-shared');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (!authorize(req, res)) return;
  return res.status(200).json({ ok: true });
};
