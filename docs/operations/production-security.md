# Production security settings

What the backend checks before it starts in production, how cookies decide to be `Secure`, what the rate limiter counts, and which layer sends each security header.

## What a production start refuses

With `NODE_ENV=production` the backend reads its settings and stops with a message naming the setting when one of these is true. Nothing is checked this way in `development` or `test`.

| Setting                                                                                   | Refused in production when                                            | Why                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `CLIENT_URL`                                                                              | It is unset, uses `http`, or names `localhost` or a loopback address  | The session cookie, CORS and every mailed link are built on it             |
| `API_URL`                                                                                 | It is set and uses `http`, or names `localhost` or a loopback address | Provider callbacks and native sign-in are built on it                      |
| `SWAGGER_ENABLED`                                                                         | It is `true` and `SWAGGER_ALLOW_IN_PRODUCTION` is not `true`          | The explorer lists every route and its shapes to anyone who finds the page |
| `SEED_ADMIN_PASSWORD`, `SEED_USER_PASSWORD`, `SEED_PRINT_PASSWORDS`, `SEED_PASSWORD_FILE` | Any of them is set                                                    | They exist for the seed script, which itself refuses to run in production  |
| `THROTTLE_LIMIT`                                                                          | It is more than 20 requests for each second of `THROTTLE_TTL`         | A higher value switches the global limit off in practice                   |

`SWAGGER_ALLOW_IN_PRODUCTION` defaults to `false`. Setting it alone does nothing. Set both when you want the explorer on a production host, and put that host behind your own access control first.

`API_URL` may stay unset in production. Provider callbacks then fall back to `http://localhost:<PORT>`, so set it whenever a provider or native sign-in is on.

The number of proxies the backend trusts is fixed at one in `backend/src/main.ts` and has no setting, so nothing checks it. If a client can reach the backend without passing a proxy that sets `X-Forwarded-For`, that client picks its own address for the rate limiter.

## Cookies and the address

The session cookie is `Secure`, and named `__Host-sid`, when either of these is true:

- `NODE_ENV` is `production`.
- `CLIENT_URL` starts with `https://`.

A deployment that serves the app over `https` and forgot `NODE_ENV` still gets a secure cookie. The backend logs one warning at start in that case, because the other development defaults are still in force. A `SESSION_COOKIE_NAME` you set yourself is used as written, so leave it unset in production to keep the `__Host-` name.

| `NODE_ENV`    | `CLIENT_URL` | Cookie name  | `Secure` | Start                     |
| ------------- | ------------ | ------------ | -------- | ------------------------- |
| `development` | `http://`    | `sid`        | no       | Starts                    |
| `development` | `https://`   | `__Host-sid` | yes      | Starts and logs a warning |
| `production`  | `https://`   | `__Host-sid` | yes      | Starts                    |
| `production`  | `http://`    | none         | none     | Refuses to start          |

## Rate limits count per server process

The backend limits requests by client address. It keeps the counters in the memory of its own process.

| What                    | Limit for one client address                                   |
| ----------------------- | -------------------------------------------------------------- |
| Every route             | `THROTTLE_LIMIT` requests per `THROTTLE_TTL` seconds, 60 in 60 |
| Sign in with a password | 10 in 15 minutes                                               | <!-- feature:email-password --> |
| Register                | 5 in 15 minutes                                                | <!-- feature:email-password --> |
| Forgot password         | 5 in 15 minutes                                                | <!-- feature:email-password --> |
| Activate an account     | 10 in 15 minutes                                               | <!-- feature:email-password --> |
| Reset a password        | 10 in 15 minutes                                               | <!-- feature:email-password --> |
| Ask for a magic link    | 5 in 15 minutes                                                | <!-- feature:magic-link -->     |
| Use a magic link        | 10 in 15 minutes                                               | <!-- feature:magic-link -->     |
| Second step at sign-in  | 10 in 15 minutes                                               | <!-- feature:totp -->           |
| Passkey sign-in         | 20 in 15 minutes                                               | <!-- feature:passkeys -->       |

Because the counters live in one process:

- Two backend instances behind a load balancer each allow the full limit, so a client gets twice the numbers above. Ten instances give ten times.
- A restart or a new deployment sets every counter back to zero.
- The limits on guessing a mailed code or a password are these same counters, so they are multiplied too.

Pick one of these before you run more than one instance:

1. **Run one backend instance.** The template is set up this way.
2. **Route each client address to the same instance.** In nginx, add `ip_hash;` to the `upstream backend` block, or use your load balancer's source address affinity. Each client then meets one set of counters. A client that changes address still starts a new count, as it does with one instance.
3. **Keep the counters in a shared store.** `@nestjs/throttler` accepts a `storage` option with one method, `increment`. A store backed by the database or by Redis makes every instance read the same count. The template does not ship one.

<!-- feature:production:start -->

The production compose files run one backend. `--scale backend=2` doubles every limit above unless you take step 2 or 3.

nginx adds its own limits in front of the backend: 20 requests a second for `/api/`, 5 a second for `/api/auth/` and 10 a second for pages, each per client address. They are counted in nginx, so they hold whatever the number of backend instances, but they are far looser than the backend's and are there to stop floods. A request over an nginx limit gets status 503, not 429.

<!-- feature:production:end -->

## Security headers and who sends them

Each header is sent by one layer. Pages come from the frontend, API answers from the backend.

| Header                               | Sent by                          | Development                                                                                         | Production                                                                               |
| ------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Content-Security-Policy` on pages   | Frontend, `src/proxy.ts`         | Policy below, with `'unsafe-eval'` added to `script-src`                                            | Policy below                                                                             |
| `Content-Security-Policy` on files   | Frontend, `next.config.ts`       | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`                   | Same                                                                                     |
| `X-Content-Type-Options`             | Frontend, `next.config.ts`       | `nosniff`                                                                                           | Same                                                                                     |
| `Referrer-Policy`                    | Frontend, `next.config.ts`       | `strict-origin-when-cross-origin`                                                                   | Same                                                                                     |
| `Permissions-Policy`                 | Frontend, `next.config.ts`       | `camera=(), microphone=(), geolocation=()`                                                          | Same                                                                                     |
| `X-Frame-Options`                    | Frontend, `next.config.ts`       | `DENY`                                                                                              | Same                                                                                     |
| `Strict-Transport-Security`          | Frontend, `next.config.ts`       | Not sent                                                                                            | `max-age=63072000; includeSubDomains; preload`                                           |
| `Content-Security-Policy` on the API | Backend, helmet in `src/main.ts` | `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `connect-src 'self'` | helmet's default: `default-src 'self'`, `script-src 'self'`, `upgrade-insecure-requests` |
| `Strict-Transport-Security`          | Backend, helmet                  | `max-age=31536000; includeSubDomains`                                                               | Same                                                                                     |
| `X-Frame-Options`                    | Backend, helmet                  | `SAMEORIGIN`                                                                                        | Same                                                                                     |
| `X-Content-Type-Options`             | Backend, helmet                  | `nosniff`                                                                                           | Same                                                                                     |
| `Referrer-Policy`                    | Backend, helmet                  | `no-referrer`                                                                                       | Same                                                                                     |
| `Cross-Origin-Opener-Policy`         | Backend, helmet                  | `same-origin`                                                                                       | Same                                                                                     |
| `Cross-Origin-Resource-Policy`       | Backend, helmet                  | `same-origin`                                                                                       | Same                                                                                     |
| `X-XSS-Protection`                   | Backend, helmet                  | `0`                                                                                                 | Same                                                                                     |
| Any of the above                     | nginx                            | Not used                                                                                            | Sends none                                                                               | <!-- feature:production --> |

<!-- feature:production:start -->

nginx used to add its own copy of these, with a second content security policy that allowed no inline script. A browser applies every policy it receives, so that copy blocked the scripts Next writes into each page. nginx now adds no security header. Do not add one back without removing it from the layer that owns it.

<!-- feature:production:end -->

### The page policy

The frontend makes a random nonce for each request and sends this policy, as the Next.js guide for content security policy describes:

```text
default-src 'self';
script-src 'self' 'nonce-<random>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self';
connect-src 'self' <origin of NEXT_PUBLIC_API_URL>;
frame-ancestors 'none';
base-uri 'self';
form-action 'self' <origin of NEXT_PUBLIC_API_URL>;
object-src 'none'
```

| Directive         | Why it is there                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`      | A script runs only when it carries the nonce of this response, or was loaded by one that does. An injected inline script has no nonce and does not run. Development adds `'unsafe-eval'`, which React needs to rebuild error stacks |
| `style-src`       | Keeps `'unsafe-inline'`. The toast library and the dialog scroll lock add style elements while the page runs, and the UI primitives render `style` attributes. None of them can carry the nonce                                     |
| `img-src`         | Profile pictures come from provider hosts over `https`, and some icons are `data:` addresses                                                                                                                                        |
| `font-src`        | Fonts are built into the app, so only its own origin                                                                                                                                                                                |
| `connect-src`     | The app calls its own origin and the API                                                                                                                                                                                            |
| `form-action`     | Forms post to the app or to the API                                                                                                                                                                                                 |
| `frame-ancestors` | No other site may frame the app                                                                                                                                                                                                     |
| `base-uri`        | An injected `<base>` cannot redirect relative addresses                                                                                                                                                                             |
| `object-src`      | No plugins                                                                                                                                                                                                                          |

A nonce can only be written into a page that is rendered for the request, so no page can be prebuilt or cached by a CDN. Every page of this app was already rendered per request, so the policy changed no route.

If you add a third-party script, read the nonce from the `x-nonce` request header in a server component and pass it to the script, and add the script's origin to `connect-src` or `img-src` only if it calls home.

## Checks to run by hand

No automated test loads the app in a browser behind the production policy. After a change to the policy, a UI library upgrade or a new inline script:

1. Build and start the frontend: `pnpm --filter frontend run build`, then `pnpm --filter frontend run start`.
2. Open the sign-in page with the browser console open. Look for lines that start with `Refused to` or mention `Content Security Policy`.
3. Sign in, open a dialog, a dropdown and a select, raise a toast, switch the theme, and reload once with the dark theme chosen. The page must not flash the light theme first.
4. Repeat steps 2 and 3 in the right-to-left locale. <!-- feature:locale-ar -->
5. Run `pnpm --filter frontend run dev` and repeat step 2, to check the development policy.

<!-- feature:production:start -->

For the reverse proxy, with Docker running:

1. `docker compose -f docker-compose.prod.yml up -d --build`
2. `curl -skI https://localhost/en/auth/login` shows one `Content-Security-Policy` header and one `Strict-Transport-Security` header.
3. Copy a script address from the page source and `curl -skI https://localhost/_next/static/...` on it. It must answer 200 with `Cache-Control: public, max-age=31536000, immutable`.
4. `nginx -t` inside the container reports no error: `docker compose -f docker-compose.prod.yml exec nginx nginx -t`.

<!-- feature:production:end -->
