FROM nginxinc/nginx-unprivileged:alpine

USER root

RUN apk add --no-cache curl ca-certificates openssl

RUN mkdir -p /etc/nginx/ssl /var/www/certbot && \
    chown -R 101:101 /etc/nginx/ssl /var/www/certbot

COPY nginx.conf /etc/nginx/nginx.conf

RUN rm -f /etc/nginx/conf.d/default.conf

USER 101

EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
