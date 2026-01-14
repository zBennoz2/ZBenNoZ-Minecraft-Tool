FROM eclipse-temurin:25-jre

WORKDIR /server

COPY start.sh /start.sh
RUN chmod +x /start.sh

VOLUME ["/server/universe", "/server/mods", "/server/logs", "/server/.cache"]

EXPOSE 5520/udp

ENTRYPOINT ["/start.sh"]
