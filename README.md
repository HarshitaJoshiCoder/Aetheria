# Aetheria

Full-stack eCommerce platform built as TypeScript microservices: a React storefront and admin app, an API gateway, and Node.js services that each own their data and talk over RabbitMQ.

## Repository layout

| Path                 | What it is                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apps/gateway`       | API gateway: the only public entry point. Verifies JWTs, forwards signed identity to services, rate limits, CORS, security headers |
| `services/auth`      | Auth service: register, login, Google sign-in, rotating refresh tokens, `/me`                                                      |
| `packages/contracts` | Zod schemas shared by every service and the frontend (API types, event payloads)                                                   |
| `packages/common`    | Logging, error handling, health checks, env validation, gateway-to-service identity signing                                        |
| `packages/messaging` | RabbitMQ event bus with retries and dead-letter queues, transactional outbox relay                                                 |

More services (catalog, cart, inventory, order, payment, notification, realtime, analytics) and the web app arrive in later milestones.

## Running locally

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
pnpm test                    # unit and API tests

cp .env.example .env         # then put real random secrets in it
docker compose up --build    # MongoDB, RabbitMQ, Redis, auth service, gateway
```

The gateway listens on http://localhost:4000. Try it:

```bash
curl -i -c jar -X POST localhost:4000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"secret123"}'
```

RabbitMQ's dashboard is at http://localhost:15672 (aetheria / aetheria).

## How auth works

- Access tokens are short-lived JWTs (15 minutes) sent as `Authorization: Bearer`.
- Refresh tokens are random strings in an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. Only their SHA-256 hash is stored. Each one works once; reusing an old one revokes every token from that login.
- The gateway checks the JWT, strips any identity headers the client sent, and forwards `x-user-id` and `x-user-role` signed with HMAC. Services reject unsigned identity, so calling a service directly cannot impersonate a user.
- Registering writes the user and a `user.registered` event in one MongoDB transaction (outbox pattern); a relay publishes it to RabbitMQ.
