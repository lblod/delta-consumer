FROM semtech/mu-javascript-template:1.7.0

LABEL maintainer="Redpencil <info@redpencil.io>"
RUN apt update
RUN apt -y install curl
