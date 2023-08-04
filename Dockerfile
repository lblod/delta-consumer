FROM semtech/mu-javascript-template:feature-node-18

LABEL maintainer="Redpencil <info@redpencil.io>"
RUN apk update
RUN apk add curl
