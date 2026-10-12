// feature:production:start
function generateApiServerBlock(backendDomain) {
  return `    # API server (${backendDomain})
    server {
        listen 8443 ssl;
        listen [::]:8443 ssl;
        http2 on;
        server_name ${backendDomain};

        # SSL/TLS configuration
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_trusted_certificate /etc/nginx/ssl/chain.pem;

        # SSL protocols and ciphers
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
        ssl_prefer_server_ciphers off;

        # SSL session configuration
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:50m;
        ssl_session_tickets off;

        # OCSP stapling
        ssl_stapling on;
        ssl_stapling_verify on;
        resolver 8.8.8.8 8.8.4.4 valid=300s;
        resolver_timeout 5s;

        # Proxy to backend upstream
        location / {
            limit_req zone=api burst=30 nodelay;

            proxy_pass http://backend;
            proxy_http_version 1.1;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            # X-Forwarded-For is declared from $remote_addr, never appended from the client
            # header: the backend runs with trust proxy = 1 and rate limits key on req.ip,
            # which resolves to this edge. Putting a trusted LB or CDN in front of nginx means
            # reworking these directives and the backend's trust proxy together, otherwise
            # every real client behind that hop shares one throttle bucket.
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port $server_port;

            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;

            proxy_buffering on;
            proxy_buffer_size 4k;
            proxy_buffers 8 4k;
            proxy_busy_buffers_size 8k;

            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_redirect off;
        }

        # Auth endpoints with stricter rate limiting
        location /api/auth/ {
            limit_req zone=auth burst=10 nodelay;

            proxy_pass http://backend;
            proxy_http_version 1.1;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            # Declared at the edge, never appended -- see the note above.
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;

            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;

            proxy_buffering on;
            proxy_buffer_size 4k;
            proxy_buffers 8 4k;

            proxy_redirect off;
        }

        # Health check endpoint
        location /health {
            limit_req zone=general burst=10 nodelay;

            proxy_pass http://backend/health;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            # Declared at the edge, never appended -- see the note above.
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Deny access to hidden files
        location ~ /\\. {
            deny all;
            access_log off;
            log_not_found off;
        }

        # Deny access to sensitive files
        location ~* \\.(env|log|git|svn|sql|bak|backup)$ {
            deny all;
            access_log off;
            log_not_found off;
        }
    }`;
}

export function configureNginxDomains(content, domains) {
  const frontendDomains = [...new Set([domains.mainDomain, domains.frontendDomain])].join(' ');
  content = content.replace(/\n[ \t]*# API server\s*\([^)]*\)[\s\S]*?# End API server\n/, '\n');
  const frontend = /(listen 8443 ssl;[\s\S]*?server_name\s+)[^;]+;/;
  if (!frontend.test(content)) throw new Error('Frontend HTTPS virtual host not found');
  content = content.replace(frontend, (_, prefix) => `${prefix}${frontendDomains};`);
  const include = /^[ \t]*include \/etc\/nginx\/conf\.d\/\*\.conf;/m;
  if (!include.test(content)) throw new Error('Nginx HTTP include not found');
  const apiBlock = `${generateApiServerBlock(domains.backendDomain)}\n    # End API server\n`;
  return content.replace(include, `${apiBlock}    include /etc/nginx/conf.d/*.conf;`);
}
// feature:production:end

export function configureBackendPort(content, port) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Backend port must be an integer from 1 to 65535');
  const backend = /^  backend:\n[\s\S]*?(?=^  [a-zA-Z][\w-]*:|^volumes:|^networks:|(?![\s\S]))/m;
  if (!backend.test(content)) throw new Error('Backend service block not found');
  return content.replace(backend, (service) =>
    service
      .replace(/(ports:\s*\n\s*-\s*')\d+:\d+(')/, `$1${port}:${port}$2`)
      .replace(/(expose:\s*\n\s*-\s*')\d+(')/, `$1${port}$2`)
      .replace(/(http:\/\/localhost:)\d+(\/(?:api\/)?health)/g, `$1${port}$2`)
      .replace(/(\bPORT:\s*)\d+/, `$1${port}`),
  );
}

export function configureFrontendPort(content, port) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Frontend host port must be an integer from 1 to 65535');
  const frontend = /^  frontend:\n[\s\S]*?(?=^  [a-zA-Z][\w-]*:|^volumes:|^networks:|(?![\s\S]))/m;
  if (!frontend.test(content)) throw new Error('Frontend service block not found');
  return content.replace(frontend, (service) =>
    service
      .replace(/(ports:\s*\n\s*-\s*')\d+:\d+(')/, `$1${port}:3000$2`)
      .replace(/(expose:\s*\n\s*-\s*')\d+(')/, '$13000$2')
      .replace(/(healthcheck:[\s\S]*?http:\/\/(?:localhost|127\.0\.0\.1):)\d+/, '$13000')
      .replace(/(\bPORT:\s*)\d+/, '$13000'),
  );
}
