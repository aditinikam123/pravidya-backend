import express from 'express';
import {
  verifyWebhookSignature,
  processIncomingMessage,
  parseWebhookPayload,
} from '../services/whatsAppWebhookService.js';

const router = express.Router();

const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;

/**
 * GET /api/webhook/whatsapp
 * Meta webhook verification (required when configuring the webhook in Meta Developer Console).
 * Query: hub.mode, hub.verify_token, hub.challenge
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') {
    res.status(400).send('Bad request');
    return;
  }
  if (!META_VERIFY_TOKEN || token !== META_VERIFY_TOKEN) {
    res.status(403).send('Forbidden');
    return;
  }
  res.status(200).send(challenge);
});

/**
 * POST /api/webhook/whatsapp
 * Receive WhatsApp Cloud API webhook events.
 * Expects raw body (mount this router with express.raw({ type: 'application/json' }) for signature verification).
 * req.body will be Buffer when using express.raw().
 */
router.post('/', async (req, res) => {
  try {
    const rawBody = req.body;
    const signature = req.headers['x-hub-signature-256'];

    if (META_APP_SECRET && signature) {
      const isValid = verifyWebhookSignature(rawBody, signature, META_APP_SECRET);
      if (!isValid) {
        res.status(401).json({ success: false, message: 'Invalid signature' });
        return;
      }
    }

    const body = typeof rawBody === 'object' && Buffer.isBuffer(rawBody)
      ? JSON.parse(rawBody.toString('utf8'))
      : (typeof rawBody === 'object' ? rawBody : {});

    const messages = parseWebhookPayload(body);
    if (messages.length === 0) {
      res.status(200).send('OK');
      return;
    }

    const results = [];
    for (const msg of messages) {
      try {
        const result = await processIncomingMessage({
          phone: msg.phone,
          messageText: msg.messageText,
          timestamp: msg.timestamp,
        });
        results.push({ phone: msg.phone, ...result });
      } catch (err) {
        results.push({
          phone: msg.phone,
          error: err.message || 'Processing failed',
        });
      }
    }

    res.status(200).json({ success: true, processed: results.length, results });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message || 'Webhook processing failed',
    });
  }
});

export default router;
