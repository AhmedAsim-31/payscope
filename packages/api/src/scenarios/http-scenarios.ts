import { createHmac, randomUUID } from 'node:crypto';
import { apiErrorSchema } from '@payscope/shared/api-error';
import { buildApp } from '../app';
import { organizationsTable } from '../db/schema/identity';
import { demoId } from '../seed/seed-ids';
import type { Lab, Scenario } from './lab';
import { checkProcessed, findPayment, labPayment } from './record-lookup';
import { paymentSucceeded } from './stripe-payloads';

const FOREIGN_ORG_ID = demoId('scenario-lab:foreign-org');

async function openApp(lab: Lab) {
  const { db, cipher, adapters, startedBy } = lab.env;
  const app = await buildApp({
    db,
    logger: false,
    credentialsCipher: cipher,
    adapters,
    tokenVerifier: {
      verify: (token) =>
        Promise.resolve({ userId: token, email: undefined, role: undefined, sessionId: undefined }),
    },
  });
  await app.ready();
  return { app, token: startedBy ?? randomUUID() };
}

type LabApp = Awaited<ReturnType<typeof openApp>>['app'];

function sign(body: string, secret: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${v1}` };
}

async function postWebhook(lab: Lab, app: LabApp, payload: object, secret: string) {
  const body = JSON.stringify(payload);
  const url = `/webhooks/stripe/${lab.connection.id}`;
  const res = await app.inject({ method: 'POST', url, headers: sign(body, secret), body });
  const json = res.json<Record<string, unknown>>();
  const code = apiErrorSchema.safeParse(json).data?.error.code ?? null;
  lab.http.push({ request: `POST ${url}`, status: res.statusCode, code });
  return { status: res.statusCode, json, code };
}

export const duplicateWebhook: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payload = paymentSucceeded(labPayment(lab, customer, 1));
  const { app } = await openApp(lab);
  try {
    const first = await postWebhook(lab, app, payload, lab.connection.secret);
    const second = await postWebhook(lab, app, payload, lab.connection.secret);
    lab.check('First delivery accepted', first.status === 200 && first.json['duplicate'] === false);
    lab.check('Second delivery acknowledged as duplicate', second.json['duplicate'] === true);
    const ingested = await lab.ingest(payload);
    await lab.drain([ingested.jobId]);
    await checkProcessed(lab, ingested);
    const record = await findPayment(lab, `pi_lab_${lab.tag}_1`);
    lab.check('Exactly one payment record', record?.status === 'succeeded');
  } finally {
    await app.close();
  }
};

export const invalidSignature: Scenario = async (lab) => {
  const customer = await lab.customer('buyer');
  const payload = paymentSucceeded(labPayment(lab, customer, 1));
  const { app } = await openApp(lab);
  try {
    const res = await postWebhook(lab, app, payload, 'whsec_wrong_secret');
    lab.check('Rejected with HTTP 400', res.status === 400, String(res.status));
    lab.check(
      'Error code is WEBHOOK_SIGNATURE_INVALID',
      res.code === 'WEBHOOK_SIGNATURE_INVALID',
      res.code ?? 'none',
    );
    const stored = await lab.findEventId(String(payload['id']));
    lab.check('No event stored', stored === undefined);
  } finally {
    await app.close();
  }
};

export const crossTenantAccess: Scenario = async (lab) => {
  const { db } = lab.env;
  await db
    .insert(organizationsTable)
    .values({
      id: FOREIGN_ORG_ID,
      name: 'Scenario lab foreign org (demo)',
      slug: 'scenario-lab-foreign-org',
    })
    .onConflictDoNothing();
  const { app, token } = await openApp(lab);
  const headers = { authorization: `Bearer ${token}` };
  try {
    const attempts = [
      `/api/v1/orgs/${FOREIGN_ORG_ID}/payments`,
      `/api/v1/orgs/${FOREIGN_ORG_ID}/connections`,
      `/api/v1/orgs/${FOREIGN_ORG_ID}/payments/${randomUUID()}`,
    ];
    for (const url of attempts) {
      const res = await app.inject({ method: 'GET', url, headers });
      const code = apiErrorSchema.safeParse(res.json()).data?.error.code ?? null;
      lab.http.push({ request: `GET ${url}`, status: res.statusCode, code });
      lab.check(
        `Foreign organization request rejected: ${url.split('/').slice(4).join('/')}`,
        res.statusCode === 404 && code === 'NOT_FOUND',
        String(res.statusCode),
      );
    }
    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/orgs/${lab.env.orgId}/payments`,
      headers,
    });
    lab.http.push({
      request: `GET /api/v1/orgs/${lab.env.orgId}/payments`,
      status: own.statusCode,
      code: null,
    });
    lab.check(
      'Own organization still readable (control)',
      own.statusCode === 200,
      String(own.statusCode),
    );
  } finally {
    await app.close();
  }
};
