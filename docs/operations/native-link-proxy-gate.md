# Native link host through real nginx

This gate catches a proxy configuration that exposes API or frontend routes on
the link host, accepts forged forwarding headers, or misses an effective custom
mail/redirect path. It runs both shipped nginx configurations with the generated
include, using real HTTP and HTTPS requests.

The upstreams are synthetic Node HTTP servers. They record backend/frontend
requests and echo only fixture headers. The gate verifies nginx routing and
header ownership. The backend API suites separately prove association contents,
localized fixed-page output and the early application host boundary. This gate
does not prove real-browser cookie behavior or native OS association acceptance.

## Run locally

Prerequisites are the repository's Node 22 version, OpenSSL, Docker Engine and
Docker Compose v2 with `up --wait`. No running application, database, account,
production certificate or environment file is used.

From the repository root:

```bash
node --test nginx/render-native-link-host.test.mjs
docker build -t native-link-proxy-gate:local nginx
node scripts/verify-native-link-proxy.mjs native-link-proxy-gate:local
docker image rm native-link-proxy-gate:local
```

The image build uses the existing nginx Dockerfile. The script creates an
isolated Compose project, a temporary certificate, random loopback-only published
ports and a new manifest for `links.proxy.test`. Host headers select the virtual
hosts, so no DNS or hosts-file edit is required. Its synthetic allowed paths
include `/custom/en/activate`, `/native/return`, a Unicode pathname and a
literal-dollar pathname. A second handwritten manifest changes the API prefix,
reserved namespaces and association paths. Its previous namespace paths become
ordinary exact page paths, so copied renderer constants cannot pass that case.

Each configuration runs with default metadata, alternate metadata and an empty
include. Compose health checks wait for startup; each behavioral request is made
once. Assertions fail immediately. The script runs `nginx -t` inside each real
edge container before probing it. It removes its containers, network and known
temporary files in `finally`, including after interruption. Remove the named
fixture image with the final command even if the gate fails.

## Assertions

- Both association files answer 200 with JSON and no redirect over HTTP and
  HTTPS. Exact custom paths reach the backend with HTML and no redirect.
- HTTP-01 serves an existing fixture token from the mounted certbot webroot as
  text/plain and returns 404 for a missing token. HTTPS returns 404 for that
  same existing token. None of these requests reaches either upstream.
- Required metadata is checked even without a host. The consumer follows
  supplied association paths, API/reserved namespaces and ACME prefix.
- Client `Host` selects the virtual host. A forged `X-Forwarded-Host` cannot
  select the link host from the API host.
- Allowed backend requests receive the edge's host, protocol, port and client
  IP. Client forwarding headers are overwritten and `Forwarded` is removed.
- API, documentation, health, frontend assets, unlisted paths and descendants of
  an allowed path return 404 before either upstream runs. A wrong method returns
  405 without an upstream request.
- The association paths remain 404 on the separate API host, including when
  the caller supplies a forged link-host forwarding header.
- With no host, ordinary API/frontend routing remains available and no special
  association handler is added by nginx.
- The renderer refuses wildcard/injected hosts, URLs where paths were expected,
  reserved namespaces, dot-segment aliases and encoded separators.

Record the command output and revision when running this gate. Drafting these
instructions or passing backend API tests is not evidence that nginx passed.
