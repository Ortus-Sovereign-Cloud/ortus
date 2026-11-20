# The Ortus container image: one static program and nothing else.
# Built from a checkout where ci/fetch.sh has run (it brings .deps/ with
# the built web clients). The image ships only the program, which is
# MIT/Apache-licensed code linked against musl (MIT): no base system.
FROM rust:1.99-alpine3.22 AS build
# ortus (every app), or one of ortus-mail, ortus-drive, ortus-chat.
ARG PROGRAM=ortus
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY . .
RUN cargo build --release --locked --bin "$PROGRAM" && install -D -m 0755 "target/release/$PROGRAM" /out/ortus \
    && install -d -m 0750 -o 65532 -g 65532 /out/data /out/run

FROM scratch
COPY --from=build /out/ortus /ortus
COPY --from=build --chown=65532:65532 /out/data /data
COPY --from=build --chown=65532:65532 /out/run /run
USER 65532:65532
WORKDIR /run
ENV ORTUS_DATA_DIR=/data ORTUS_WEB_IP=0.0.0.0 ORTUS_WEB_PORT=7878
EXPOSE 7878
ENTRYPOINT ["/ortus"]
CMD ["serve"]
