FROM semtech/mu-javascript-template:1.5.0-beta.4
LABEL maintainer="Redpencil <info@redpencil.io>"
RUN apk update
RUN apk add curl